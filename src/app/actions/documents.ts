'use server'

import { revalidatePath } from 'next/cache'
import { requireMembership } from '@/lib/dal/auth'
import { audit } from '@/lib/audit'
import { linkDocumentSchema } from '@/lib/validation/domain'
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
  return { success: true }
}

export async function getDocumentUrl(orgSlug: string, documentId: string) {
  const ctx = await requireMembership(orgSlug)
  if (!ctx) return { error: 'Accès refusé.' as const }

  const { data: doc } = await ctx.supabase
    .from('documents')
    .select('storage_path')
    .eq('organization_id', ctx.org.id)
    .eq('id', documentId)
    .single()
  if (!doc) return { error: 'Document introuvable.' as const }

  const { data, error } = await ctx.supabase.storage
    .from('documents')
    .createSignedUrl(doc.storage_path, 60)
  if (error || !data) return { error: 'Impossible de générer le lien.' as const }
  return { url: data.signedUrl }
}

export async function deleteDocument(orgSlug: string, documentId: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, org, user, role } = ctx

  const { data: doc } = await supabase
    .from('documents')
    .select('storage_path, uploaded_by, name')
    .eq('organization_id', org.id)
    .eq('id', documentId)
    .single()
  if (!doc) return fail('Document introuvable.')
  if (doc.uploaded_by !== user.id && role !== 'owner' && role !== 'admin') {
    return fail('Seul l’auteur ou un admin peut supprimer ce document.')
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
  const clean = ('/' + path).replace(/\/+/g, '/').replace(/\.\./g, '').replace(/\/$/, '')
  return clean || '/'
}
