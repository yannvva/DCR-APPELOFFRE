'use server'

import { revalidatePath } from 'next/cache'
import { revalidateTenderPages } from '@/lib/revalidate'
import { createHash } from 'node:crypto'
import { strToU8, zipSync, type ZippableFile } from 'fflate'
import { requireMembership } from '@/lib/dal/auth'
import { audit } from '@/lib/audit'
import { linkDocumentSchema } from '@/lib/validation/domain'
import { normalizeFolderPath } from '@/lib/folder-tree'
import { isPipelineManagedDoc } from '@/lib/pipeline-docs'
import { shortText } from '@/lib/naming'
import { ZIP_MAX_PATH, zipSafeSegment } from '@/lib/datasheets/deliverable'
import type { ActionState } from '@/lib/validation/auth'

const MAX_SIZE = 25 * 1024 * 1024
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/zip',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

function fail(msg = 'Une erreur est survenue.'): ActionState {
  return { error: msg }
}

export async function uploadDocument(orgSlug: string, formData: FormData): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, org, user } = ctx

  const file = formData.get('file')
  if (!(file instanceof File)) return fail('Fichier manquant.')
  if (file.size <= 0 || file.size > MAX_SIZE) return fail('Taille maximale : 25 Mo.')
  if (!ALLOWED_MIME.has(file.type)) return fail('Type de fichier non autorisé.')

  const name = (formData.get('name') as string) || file.name
  const folder = sanitizeFolder((formData.get('folder') as string) || '/')
  const entityType = formData.get('entityType') as string | null
  const entityId = formData.get('entityId') as string | null
  const category = (formData.get('category') as string) || 'autre'
  const documentType = (formData.get('documentType') as string) || null
  const validUntil = (formData.get('validUntil') as string) || null
  const isReusable = formData.get('isReusable') === 'true'

  const docId = crypto.randomUUID()
  const storagePath = `org_${org.id}/${docId}/${file.name.replace(/[^\w.()-]/g, '_')}`

  const { error: upErr } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, { contentType: file.type })
  if (upErr) return fail('Échec de l’envoi du fichier.')

  const { data: doc, error: dbErr } = await supabase
    .from('documents')
    .insert({
      id: docId,
      organization_id: org.id,
      name,
      folder_path: folder,
      storage_path: storagePath,
      mime_type: file.type,
      size_bytes: file.size,
      category,
      document_type: documentType,
      valid_until: validUntil,
      is_reusable: isReusable,
      uploaded_by: user.id,
    })
    .select('id')
    .single()

  if (dbErr) {
    await supabase.storage.from('documents').remove([storagePath])
    return fail('Échec de l’enregistrement du document.')
  }

  if (entityType && entityId) {
    const parsed = linkDocumentSchema.safeParse({
      documentId: doc.id,
      entityType,
      entityId,
    })
    if (parsed.success) {
      await supabase.from('document_links').insert({
        organization_id: org.id,
        document_id: doc.id,
        entity_type: parsed.data.entityType,
        entity_id: parsed.data.entityId,
      })
    }
  }

  await audit(supabase, {
    organizationId: org.id,
    action: 'document.uploaded',
    entityType: 'document',
    entityId: doc.id,
    metadata: { name, size: file.size },
  })
  revalidatePath(`/${orgSlug}/documents`)
  revalidatePath(`/${orgSlug}/societe`)
  return { success: true }
}

/** Marque une pièce comme signée / non signée. Alimente la garde de
 *  validation des lignes « signature requise » de la checklist et le
 *  contrôle de recevabilité (run_compliance_checks) quand un dossier
 *  d'AO est connu. */
export async function setDocumentSigned(
  orgSlug: string,
  documentId: string,
  signed: boolean,
  tenderId?: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { data: doc } = await ctx.supabase
    .from('documents')
    .select('id, name')
    .eq('organization_id', ctx.org.id)
    .eq('id', documentId)
    .single()
  if (!doc) return fail('Document introuvable.')

  const { error } = await ctx.supabase
    .from('documents')
    .update({ is_signed: signed })
    .eq('organization_id', ctx.org.id)
    .eq('id', documentId)
  if (error) return fail()

  // La signature conditionne la recevabilité : recalculer les contrôles du
  // dossier qui consomme cette pièce (checklist → alertes).
  if (tenderId) {
    await ctx.supabase.rpc('run_compliance_checks', { p_tender_id: tenderId })
    revalidateTenderPages(orgSlug)
  }
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: signed ? 'document.marked_signed' : 'document.marked_unsigned',
    entityType: 'document',
    entityId: documentId,
    metadata: { name: doc.name, ...(tenderId ? { tender_id: tenderId } : {}) },
  })
  revalidatePath(`/${orgSlug}/documents`)
  revalidatePath(`/${orgSlug}/societe`)
  return { success: true }
}

export async function getDocumentUrl(
  orgSlug: string,
  documentId: string,
  opts?: { download?: boolean },
) {
  const ctx = await requireMembership(orgSlug)
  if (!ctx) return { error: 'Accès refusé.' as const }

  const { data: doc } = await ctx.supabase
    .from('documents')
    .select('storage_path, name')
    .eq('organization_id', ctx.org.id)
    .eq('id', documentId)
    .single()
  if (!doc) return { error: 'Document introuvable.' as const }

  // `download` impose Content-Disposition: attachment avec le NOM du document
  // — sans lui le fichier téléchargé portait la clé de stockage
  // (« <uuid>-<nom> »). Ne pas l'activer pour les aperçus iframe.
  const { data, error } = await ctx.supabase.storage
    .from('documents')
    .createSignedUrl(
      doc.storage_path,
      60,
      opts?.download ? { download: doc.name } : undefined,
    )
  if (error || !data) return { error: 'Impossible de générer le lien.' as const }
  return { url: data.signedUrl }
}

/** Bornes de l'export ZIP : au-delà, le serveur téléchargerait/zipperait
 *  trop longtemps en mémoire — l'utilisateur exporte alors par sous-dossier. */
const ZIP_MAX_FILES = 500
const ZIP_MAX_BYTES = 350 * 1024 * 1024

/** Exporte un dossier et tout son sous-arbre en ZIP : l'arborescence des
 *  sous-dossiers est conservée, les fichiers gardent leur nom métier
 *  (`documents.name`, pas la clé de stockage). Le ZIP est déposé dans le
 *  bucket `documents` sous `exports/` puis servi par lien signé. */
export async function exportFolderZip(orgSlug: string, rawFolder: string) {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' as const }
  const { supabase, org } = ctx
  const folder = normalizeFolderPath(rawFolder || '/')

  // Sous-arbre complet : dossier exact + descendants.
  const f = folder.replaceAll('"', '')
  const query =
    folder === '/'
      ? supabase
          .from('documents')
          .select('id, name, folder_path, storage_path, size_bytes')
          .eq('organization_id', org.id)
      : supabase
          .from('documents')
          .select('id, name, folder_path, storage_path, size_bytes')
          .eq('organization_id', org.id)
          .or(`folder_path.eq."${f}",folder_path.like."${f}/%"`)
  const { data: docs, error } = await query
      .order('folder_path')
      .order('name')
      .limit(ZIP_MAX_FILES + 1)
  if (error) return { error: 'Impossible de lister les documents.' as const }
  if (!docs?.length) return { error: 'Aucun fichier dans ce dossier.' as const }
  if (docs.length > ZIP_MAX_FILES) {
    return {
      error: `Plus de ${ZIP_MAX_FILES} fichiers — exportez par sous-dossier.` as const,
    }
  }
  const totalBytes = docs.reduce((s, d) => s + (d.size_bytes ?? 0), 0)
  if (totalBytes > ZIP_MAX_BYTES) {
    return {
      error: 'Dossier trop volumineux (350 Mo max) — exportez par sous-dossier.' as const,
    }
  }

  const zp = (path: string) => path.split('/').map(zipSafeSegment).join('/')
  const rootName =
    folder === '/'
      ? 'Organisation'
      : folder.split('/').pop() || 'Dossier'
  const root = zp(shortText(rootName, 40)) + '/'
  const files: Record<string, ZippableFile> = {}
  const missing: string[] = []

  // Chemin d'entrée « dossier-relatif/fichier » borné à ZIP_MAX_PATH (les
  // noms de pièces de DCE dépassent régulièrement 150 c — sans troncature
  // l'Explorateur Windows refuse l'extraction). Collisions → « (n) ».
  const entry = (relFolder: string, filename: string): string => {
    const rf = relFolder ? zp(relFolder) + '/' : ''
    let n = zp(filename || 'document')
    const budget = ZIP_MAX_PATH - root.length - rf.length
    if (n.length > budget) {
      const ext = n.match(/\.[A-Za-z0-9]{2,6}$/)?.[0] ?? ''
      n =
        n
          .slice(0, Math.max(16, budget - ext.length))
          .replace(/[\s.,;:_-]+$/, '') + ext
    }
    if (files[`${root}${rf}${n}`]) {
      const ext = n.match(/\.[A-Za-z0-9]{2,6}$/)?.[0] ?? ''
      const base = ext ? n.slice(0, -ext.length) : n
      for (let i = 2; ; i++) {
        const cand = `${base} (${i})${ext}`
        if (!files[`${root}${rf}${cand}`]) {
          n = cand
          break
        }
      }
    }
    return `${root}${rf}${n}`
  }

  // Téléchargements storage par lots de 6 — des centaines de fichiers en
  // série (~200-500 ms chacun) faisaient de l'export l'étape la plus lente.
  const DL_CONCURRENCY = 6
  for (let i = 0; i < docs.length; i += DL_CONCURRENCY) {
    await Promise.all(
      docs.slice(i, i + DL_CONCURRENCY).map(async (d) => {
        const relFolder =
          folder === '/'
            ? normalizeFolderPath(d.folder_path ?? '/')
            : normalizeFolderPath(d.folder_path ?? '/') === folder
              ? ''
              : normalizeFolderPath(d.folder_path ?? '/').slice(folder.length + 1)
        const { data: blob, error: dlErr } = await supabase.storage
          .from('documents')
          .download(d.storage_path)
        if (dlErr || !blob) {
          missing.push(`${relFolder ? relFolder + '/' : ''}${d.name}`)
          return
        }
        const bytes = new Uint8Array(await blob.arrayBuffer())
        // PDF/Office déjà compressés : stockage sans re-déflater (level 0).
        const compressible = /\.(txt|csv|svg|xml|json)$/i.test(d.name)
        files[entry(relFolder, d.name)] = [bytes, { level: compressible ? 6 : 0 }]
      }),
    )
  }

  if (missing.length) {
    missing.sort((a, b) => a.localeCompare(b, 'fr'))
    files[root + '_MANQUANTS.txt'] = strToU8(
      `Fichiers absents du stockage (non inclus dans l'export) :\n\n${missing.join('\n')}\n`,
    )
  }
  if (!Object.keys(files).length || Object.keys(files).every((k) => k.endsWith('.txt'))) {
    return { error: 'Aucun fichier téléchargeable dans ce dossier.' as const }
  }

  const zip = zipSync(files, { level: 6 })
  const stamp = new Date().toISOString().slice(0, 10)
  const zipName = `${zp(shortText(rootName, 40))}_${stamp}.zip`
  const storageKey = `org_${org.id}/exports/${createHash('sha1')
    .update(folder)
    .digest('hex')
    .slice(0, 12)}.zip`

  const { error: upErr } = await supabase.storage
    .from('documents')
    .upload(storageKey, zip, { contentType: 'application/zip', upsert: true })
  if (upErr) return { error: 'Échec de la création de l’archive.' as const }

  const { data: signed, error: signErr } = await supabase.storage
    .from('documents')
    .createSignedUrl(storageKey, 300, { download: zipName })
  if (signErr || !signed) return { error: 'Impossible de générer le lien.' as const }

  await audit(supabase, {
    organizationId: org.id,
    action: 'document.folder_exported',
    entityType: 'document',
    metadata: {
      folder,
      files: Object.keys(files).length - (missing.length ? 1 : 0),
      missing: missing.length,
      bytes: totalBytes,
    },
  })
  return { url: signed.signedUrl, count: Object.keys(files).length, missing: missing.length }
}

export async function deleteDocument(orgSlug: string, documentId: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, org, user, role } = ctx

  const { data: doc } = await supabase
    .from('documents')
    .select('storage_path, uploaded_by, name, document_type')
    .eq('organization_id', org.id)
    .eq('id', documentId)
    .single()
  if (!doc) return fail('Document introuvable.')
  if (doc.uploaded_by !== user.id && role !== 'owner' && role !== 'admin') {
    return fail('Seul l’auteur ou un admin peut supprimer ce document.')
  }

  // Documents gérés par un pipeline (fiches techniques, mémoire, DC1/DC2) :
  // les runs les référencent dans leur JSONB (`document_id`) — une
  // suppression ici laisserait une ligne « livrée » pointant vers un fichier
  // mort (ZIP incomplet, « Ouvrir » en échec). Ils se suppriment via leur
  // workflow (ex. suppression du dossier de fiches).
  if (isPipelineManagedDoc(doc)) {
    return fail(
      'Ce document est produit par un workflow (fiches techniques, mémoire, DC1/DC2). ' +
        'Supprimez-le depuis son dossier d’origine pour garder le dossier cohérent.',
    )
  }
  // Réutilisé par la bibliothèque de fiches : sa suppression priverait les
  // autres AO du PDF partagé — l'entrée se retrouverait « PDF non récupéré ».
  const { count: libRefs } = await supabase
    .from('datasheet_library')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)
    .eq('document_id', documentId)
  if (libRefs) {
    return fail(
      'Ce PDF est enregistré dans la bibliothèque de fiches techniques et peut ' +
        'être réutilisé par d’autres appels d’offres.',
    )
  }

  const { error: stErr } = await supabase.storage.from('documents').remove([doc.storage_path])
  if (stErr) return fail('Échec de la suppression du fichier.')

  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('organization_id', org.id)
    .eq('id', documentId)
  if (error) return fail()

  await audit(supabase, {
    organizationId: org.id,
    action: 'document.deleted',
    entityType: 'document',
    entityId: documentId,
    metadata: { name: doc.name },
  })
  revalidatePath(`/${orgSlug}/documents`)
  revalidatePath(`/${orgSlug}/societe`)
  return { success: true }
}

const VALIDITY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function setDocumentValidity(
  orgSlug: string,
  documentId: string,
  validUntil: string | null,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (validUntil !== null && !VALIDITY_DATE_RE.test(validUntil)) {
    return fail('Date invalide.')
  }

  const { data: doc } = await ctx.supabase
    .from('documents')
    .select('id, name')
    .eq('organization_id', ctx.org.id)
    .eq('id', documentId)
    .single()
  if (!doc) return fail('Document introuvable.')

  const { error } = await ctx.supabase
    .from('documents')
    .update({ valid_until: validUntil })
    .eq('organization_id', ctx.org.id)
    .eq('id', documentId)
  if (error) return fail()

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'document.validity_updated',
    entityType: 'document',
    entityId: documentId,
    metadata: { name: doc.name, validUntil },
  })
  revalidatePath(`/${orgSlug}/documents`)
  revalidatePath(`/${orgSlug}/societe`)
  return { success: true }
}

export async function linkDocument(orgSlug: string, input: unknown): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = linkDocumentSchema.safeParse(input)
  if (!parsed.success) return fail('Lien invalide.')

  const { error } = await ctx.supabase.from('document_links').upsert(
    {
      organization_id: ctx.org.id,
      document_id: parsed.data.documentId,
      entity_type: parsed.data.entityType,
      entity_id: parsed.data.entityId,
    },
    { onConflict: 'document_id,entity_type,entity_id' },
  )
  if (error) return fail()
  revalidatePath(`/${orgSlug}/documents`)
  return { success: true }
}

export async function unlinkDocument(
  orgSlug: string,
  linkId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('document_links')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', linkId)
  if (error) return fail()
  revalidatePath(`/${orgSlug}/documents`)
  return { success: true }
}

export async function unlinkDocumentByEntity(
  orgSlug: string,
  documentId: string,
  entityType: string,
  entityId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = linkDocumentSchema.safeParse({ documentId, entityType, entityId })
  if (!parsed.success) return fail('Lien invalide.')
  // Même garde-fou que deleteDocument : délier un document de workflow le
  // rendrait invisible dans l'onglet alors que le run le livre toujours.
  const { data: doc } = await ctx.supabase
    .from('documents')
    .select('storage_path, document_type')
    .eq('organization_id', ctx.org.id)
    .eq('id', parsed.data.documentId)
    .single()
  if (doc && isPipelineManagedDoc(doc)) {
    return fail(
      'Ce document est géré par un workflow (fiches, mémoire…) — il ne peut pas être délié ici.',
    )
  }
  const { error } = await ctx.supabase
    .from('document_links')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('document_id', parsed.data.documentId)
    .eq('entity_type', parsed.data.entityType)
    .eq('entity_id', parsed.data.entityId)
  if (error) return fail()
  revalidatePath(`/${orgSlug}/documents`)
  return { success: true }
}

function sanitizeFolder(path: string) {
  return normalizeFolderPath(path)
}
