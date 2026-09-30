'use server'

import { revalidatePath } from 'next/cache'
import { revalidateTenderPages } from '@/lib/revalidate'
import { z } from 'zod'
import { requireMembership } from '@/lib/dal/auth'
import { ensureTenderLot } from '@/lib/dal/tenders'
import { audit } from '@/lib/audit'
import { getEnv } from '@/env'
import { loadTenderSourceFiles } from '@/lib/dce/source-docs'
import { tenderFolderOf } from '@/lib/doc-folders'
import { storageSafeName } from '@/lib/storage-key'
import { memoireFilenameBase } from '@/lib/naming'
import { analyzeForMemoire } from '@/lib/memoire/analyze'
import { generateContentPy, validateContentPy } from '@/lib/memoire/generate'
import { buildMemoireDocx as buildDocx } from '@/lib/memoire/build'
import {
  companyContext,
  companyCoverLine,
  parseCompanyProfile,
} from '@/lib/company'
import { EMPTY_ANALYSIS } from '@/lib/memoire/types'
import { syncChecklistItems } from '@/lib/checklist-attach'
import type { MemoireRunRow } from '@/lib/dal/memoire'
import type { ActionState } from '@/lib/validation/auth'
import type { SupabaseClient } from '@supabase/supabase-js'

function fail(e: unknown, fallback = 'Une erreur est survenue.'): NonNullable<ActionState> {
  const msg = e instanceof Error ? e.message : fallback
  return { error: msg === 'Accès refusé' ? msg : fallback }
}

// `memoireFilenameBase` (politique de nommage courte) vient de @/lib/naming :
// « LOT 01 - Pôle Compans Montreuil » → « LOT01_POLE_COMPANS_MONTREUIL »,
// borné à 34 caractères pour que MEMOIRE_TECHNIQUE_…_DCR.docx reste lisible.

const runSchema = z.object({
  lotId: z.uuid().optional().or(z.literal('')),
  // Lot issu de l'analyse DCE (pas encore appliquée → pas de tender_lots) :
  // le serveur crée la ligne lot à la volée.
  lotNumber: z.number().min(0).optional(),
  lotTitle: z.string().max(200).optional().or(z.literal('')),
  lotLabel: z.string().min(1, 'Lot requis').max(200),
})

async function loadRun(
  supabase: SupabaseClient,
  orgId: string,
  tenderId: string,
  runId: string,
): Promise<MemoireRunRow | null> {
  const { data } = await supabase
    .from('tender_memoire_runs')
    .select('*')
    .eq('organization_id', orgId)
    .eq('tender_id', tenderId)
    .eq('id', runId)
    .single()
  return (data as MemoireRunRow | null) ?? null
}

/** Pièces du DCE liées au dossier → textes extraits (hors fichiers générés). */
async function extractTenderDocs(supabase: SupabaseClient, orgId: string, tenderId: string) {
  const { docs, skipped } = await loadTenderSourceFiles(supabase, orgId, tenderId)
  return { docs, skipped }
}

// ============================ CRÉATION ============================

export async function createMemoireRun(
  orgSlug: string,
  tenderId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = runSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { data: tender } = await ctx.supabase
    .from('tenders')
    .select('id')
    .eq('organization_id', ctx.org.id)
    .eq('id', tenderId)
    .single()
  if (!tender) return { error: 'Dossier introuvable.' }

  // Lot choisi parmi ceux détectés par l'analyse → création de la ligne
  // tender_lots si elle n'existe pas encore (analyse non appliquée).
  const lotId =
    d.lotId ||
    (d.lotNumber != null
      ? await ensureTenderLot(ctx.supabase, ctx.org.id, tenderId, {
          number: d.lotNumber,
          title: d.lotTitle?.trim() || d.lotLabel,
        })
      : null)

  const { data: row, error } = await ctx.supabase
    .from('tender_memoire_runs')
    .insert({
      organization_id: ctx.org.id,
      tender_id: tenderId,
      lot_id: lotId || null,
      lot_label: d.lotLabel,
      created_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (error || !row) return fail(error, 'Erreur lors de la création du run.')

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'memoire_run.created',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { run_id: row.id, lot_label: d.lotLabel },
  })
  revalidateTenderPages(orgSlug)
  return { success: true, id: row.id }
}

// ============================ ÉTAPE 1a — FICHE D'ANALYSE ============================

export async function analyzeMemoireDce(
  orgSlug: string,
  tenderId: string,
  runId: string,
): Promise<{ data?: { criteres: number; manquants: number; skipped: number }; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!getEnv().DEEPSEEK_API_KEY) {
    return { error: 'DEEPSEEK_API_KEY manquante — ajoutez-la dans .env.local.' }
  }
  const run = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  if (!run) return { error: 'Run introuvable.' }

  const { docs, skipped } = await extractTenderDocs(ctx.supabase, ctx.org.id, tenderId)
  if (!docs.length) {
    return {
      error: 'Aucune pièce lisible — joignez le DCE dans l’onglet Documents ou « Analyse DCE ».',
    }
  }

  try {
    const { analysis, model, usage } = await analyzeForMemoire(docs, run.lot_label)
    const { error } = await ctx.supabase
      .from('tender_memoire_runs')
      .update({
        status: 'analyzed',
        analysis: { ...analysis, skipped },
        model,
        input_tokens: (run.input_tokens ?? 0) + usage.inputTokens,
        output_tokens: (run.output_tokens ?? 0) + usage.outputTokens,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)
    if (error) return { error: 'Analyse réussie mais enregistrement impossible.' }
    revalidateTenderPages(orgSlug)
    return {
      data: {
        criteres: analysis.criteres.length,
        manquants: analysis.manquants.length,
        skipped: skipped.length,
      },
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Échec de l’analyse.'
    await ctx.supabase
      .from('tender_memoire_runs')
      .update({ status: 'error', error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', runId)
    return { error: message }
  }
}

// ============================ ÉTAPE 1b — GÉNÉRATION DU FICHIER ============================

export async function generateMemoireContent(
  orgSlug: string,
  tenderId: string,
  runId: string,
): Promise<{ data?: { filename: string; warnings: string[] }; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!getEnv().DEEPSEEK_API_KEY) {
    return { error: 'DEEPSEEK_API_KEY manquante — ajoutez-la dans .env.local.' }
  }
  const run = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  if (!run) return { error: 'Run introuvable.' }
  if (!run.analysis?.couverture?.operation) {
    return { error: 'Lancez d’abord l’analyse du DCE (étape « Fiche d’analyse »).' }
  }

  const analysis = { ...EMPTY_ANALYSIS, ...run.analysis }
  const filenameBase = memoireFilenameBase(run.lot_label)

  // Profil société (page /societe) : source de vérité entreprise pour les
  // agents — équipe §3, coordonnées de couverture, présentation §1.
  const company = parseCompanyProfile(ctx.org.settings)
  const companyCtx = companyContext(company)

  try {
    const { code, filename, warnings, model, usage } = await generateContentPy({
      analysis,
      lotLabel: run.lot_label,
      filenameBase,
      company: companyCtx
        ? { context: companyCtx, coverLine: companyCoverLine(company) }
        : undefined,
    })

    // Supprime l'ancien fichier généré s'il existe (régénération propre)
    if (run.content_document_id) {
      const { data: old } = await ctx.supabase
        .from('documents')
        .select('storage_path')
        .eq('organization_id', ctx.org.id)
        .eq('id', run.content_document_id)
        .single()
      if (old) await ctx.supabase.storage.from('documents').remove([old.storage_path])
      await ctx.supabase
        .from('documents')
        .delete()
        .eq('organization_id', ctx.org.id)
        .eq('id', run.content_document_id)
    }

    const docId = crypto.randomUUID()
    const storagePath = `org_${ctx.org.id}/memoire/${runId}/${docId}-${storageSafeName(filename)}`
    const bytes = new TextEncoder().encode(code)
    // Le bucket whitelist les MIME : 'text/x-python' n'y figure pas → text/plain.
    const { error: upErr } = await ctx.supabase.storage
      .from('documents')
      .upload(storagePath, bytes, { contentType: 'text/plain' })
    if (upErr) return { error: 'Génération réussie mais upload impossible.' }

    const { error: dbErr } = await ctx.supabase.from('documents').insert({
      id: docId,
      organization_id: ctx.org.id,
      name: filename,
      folder_path: await tenderFolderOf(
        ctx.supabase,
        ctx.org.id,
        tenderId,
        'Mémoire technique',
      ),
      storage_path: storagePath,
      mime_type: 'text/plain',
      size_bytes: bytes.byteLength,
      category: 'memoire',
      document_type: 'content_py',
      uploaded_by: ctx.user.id,
    })
    if (dbErr) {
      await ctx.supabase.storage.from('documents').remove([storagePath])
      return { error: 'Génération réussie mais enregistrement impossible.' }
    }
    await ctx.supabase.from('document_links').upsert(
      {
        organization_id: ctx.org.id,
        document_id: docId,
        entity_type: 'tender',
        entity_id: tenderId,
      },
      { onConflict: 'document_id,entity_type,entity_id' },
    )

    await ctx.supabase
      .from('tender_memoire_runs')
      .update({
        status: 'generated',
        content_document_id: docId,
        content_filename: filename,
        warnings,
        model,
        input_tokens: (run.input_tokens ?? 0) + usage.inputTokens,
        output_tokens: (run.output_tokens ?? 0) + usage.outputTokens,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)

    await audit(ctx.supabase, {
      organizationId: ctx.org.id,
      action: 'memoire_run.generated',
      entityType: 'tender',
      entityId: tenderId,
      metadata: { run_id: runId, filename },
    })
    revalidateTenderPages(orgSlug)
    revalidatePath(`/${orgSlug}/documents`)
    return { data: { filename, warnings } }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Échec de la génération.'
    await ctx.supabase
      .from('tender_memoire_runs')
      .update({ status: 'error', error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', runId)
    return { error: message }
  }
}

// ============================ BUILD .DOCX — ÉTAPES 1 et 2 ============================

type Ctx = NonNullable<Awaited<ReturnType<typeof requireMembership>>>

/** Charge le content_*.py validé du run (re-validation avant exécution). */
async function loadValidatedContent(
  ctx: Ctx,
  run: MemoireRunRow,
): Promise<{ code?: string; error?: string }> {
  if (!run.content_document_id) {
    return { error: 'Générez d’abord le fichier de contenu (étape « Fichier de contenu »).' }
  }
  const { data: doc } = await ctx.supabase
    .from('documents')
    .select('storage_path')
    .eq('organization_id', ctx.org.id)
    .eq('id', run.content_document_id)
    .single()
  if (!doc) return { error: 'Fichier de contenu introuvable.' }
  const { data: blob } = await ctx.supabase.storage.from('documents').download(doc.storage_path)
  if (!blob) return { error: 'Téléchargement du fichier de contenu impossible.' }
  const code = await blob.text()
  // Le fichier est exécuté par Python : re-validation complète (structure +
  // liste blanche) avant toute exécution, même si le document a été modifié.
  const { errors } = validateContentPy(code)
  if (errors.length) {
    return { error: `Fichier de contenu invalide : ${errors.slice(0, 3).join(' ; ')}` }
  }
  return { code }
}

/** Upload + insertion documents + lien dossier pour un .docx produit. */
async function storeDocx(
  ctx: Ctx,
  tenderId: string,
  runId: string,
  docx: Uint8Array,
  filename: string,
): Promise<{ docId?: string; error?: string }> {
  const docId = crypto.randomUUID()
  const storagePath = `org_${ctx.org.id}/memoire/${runId}/${docId}-${storageSafeName(filename)}`
  const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const { error: upErr } = await ctx.supabase.storage
    .from('documents')
    .upload(storagePath, docx, { contentType: mime })
  if (upErr) return { error: 'Build réussi mais upload impossible.' }
  const { error: dbErr } = await ctx.supabase.from('documents').insert({
    id: docId,
    organization_id: ctx.org.id,
    name: filename,
    folder_path: await tenderFolderOf(
      ctx.supabase,
      ctx.org.id,
      tenderId,
      'Mémoire technique',
    ),
    storage_path: storagePath,
    mime_type: mime,
    size_bytes: docx.byteLength,
    category: 'memoire',
    document_type: 'memoire_docx',
    uploaded_by: ctx.user.id,
  })
  if (dbErr) {
    await ctx.supabase.storage.from('documents').remove([storagePath])
    return { error: 'Build réussi mais enregistrement impossible.' }
  }
  await ctx.supabase.from('document_links').upsert(
    {
      organization_id: ctx.org.id,
      document_id: docId,
      entity_type: 'tender',
      entity_id: tenderId,
    },
    { onConflict: 'document_id,entity_type,entity_id' },
  )
  return { docId }
}

/** Supprime un document généré (storage + ligne) — régénération propre. */
async function removeStoredDoc(ctx: Ctx, docId: string | null) {
  if (!docId) return
  const { data: old } = await ctx.supabase
    .from('documents')
    .select('storage_path')
    .eq('organization_id', ctx.org.id)
    .eq('id', docId)
    .single()
  if (old) await ctx.supabase.storage.from('documents').remove([old.storage_path])
  await ctx.supabase.from('documents').delete().eq('organization_id', ctx.org.id).eq('id', docId)
}

async function buildVariant(
  orgSlug: string,
  tenderId: string,
  runId: string,
  variant: 'ref' | 'full',
): Promise<{ data?: { filename: string; warnings: string[] }; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const run = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  if (!run) return { error: 'Run introuvable.' }
  const { code, error } = await loadValidatedContent(ctx, run)
  if (!code) return { error }

  const base = memoireFilenameBase(run.lot_label)
  const filename =
    variant === 'full'
      ? `MEMOIRE_TECHNIQUE_${base}_DCR_avec_couverture.docx`
      : `MEMOIRE_TECHNIQUE_${base}_DCR.docx`
  const prevDocId = variant === 'full' ? run.docx_full_document_id : run.docx_document_id

  try {
    const { docx, warnings } = buildDocx(code, { full: variant === 'full' })
    await removeStoredDoc(ctx, prevDocId)
    const stored = await storeDocx(ctx, tenderId, runId, docx, filename)
    if (!stored.docId) return { error: stored.error }

    await ctx.supabase
      .from('tender_memoire_runs')
      .update({
        status: variant === 'full' ? 'built_full' : 'built',
        ...(variant === 'full'
          ? { docx_full_document_id: stored.docId, docx_full_filename: filename }
          : { docx_document_id: stored.docId, docx_filename: filename }),
        warnings: Array.from(
          new Set([...(Array.isArray(run.warnings) ? run.warnings : []), ...warnings]),
        ),
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)

    // La ligne « Mémoire technique » (ou « [Lot N] … » du même lot) reçoit
    // le DOCX produit — « à vérifier », la validation reste humaine.
    await syncChecklistItems(
      ctx.supabase,
      ctx.org.id,
      tenderId,
      [/m[ée]moire/i],
      { document_id: stored.docId, status: 'a_verifier' },
      { lotNumber: Number(/(\d+)/.exec(run.lot_label ?? '')?.[1]) || null },
    )

    await audit(ctx.supabase, {
      organizationId: ctx.org.id,
      action: variant === 'full' ? 'memoire_run.built_full' : 'memoire_run.built',
      entityType: 'tender',
      entityId: tenderId,
      metadata: { run_id: runId, filename },
    })
    revalidateTenderPages(orgSlug)
    revalidatePath(`/${orgSlug}/documents`)
    return { data: { filename, warnings } }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Échec de la construction.'
    await ctx.supabase
      .from('tender_memoire_runs')
      .update({ error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', runId)
    return { error: message }
  }
}

/** Étape 1 : MEMOIRE_TECHNIQUE_<LOT>_<AFFAIRE>_DCR.docx (couverture + §2/4/5). */
export async function buildMemoireDocx(orgSlug: string, tenderId: string, runId: string) {
  return buildVariant(orgSlug, tenderId, runId, 'ref')
}

/** Étape 2 : ..._avec_couverture.docx — mémoire complet 7 parties. */
export async function buildMemoireComplet(orgSlug: string, tenderId: string, runId: string) {
  return buildVariant(orgSlug, tenderId, runId, 'full')
}

// ============================ IMPORT D'UN MÉMOIRE EXISTANT ============================

const importSchema = z.object({
  runId: z.uuid().optional().or(z.literal('')),
  lotId: z.uuid().optional().or(z.literal('')),
  lotNumber: z.number().min(0).optional(),
  lotTitle: z.string().max(200).optional().or(z.literal('')),
  lotLabel: z.string().max(200).optional().or(z.literal('')),
})

/** Importe un mémoire .docx déjà produit hors pipeline et le rattache au run
 *  (mémoire complet — étape 2). Crée le run si nécessaire. */
export async function importMemoireDocx(
  orgSlug: string,
  tenderId: string,
  input: unknown,
  formData: FormData,
): Promise<{ data?: { filename: string; runId: string }; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = importSchema.safeParse(input)
  if (!parsed.success) return { error: 'Paramètres invalides.' }
  const d = parsed.data

  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'Fichier manquant.' }
  if (!file.name.toLowerCase().endsWith('.docx')) {
    return { error: 'Format attendu : .docx' }
  }
  if (file.size <= 0 || file.size > 25 * 1024 * 1024) {
    return { error: 'Taille maximale : 25 Mo.' }
  }

  // Run cible : existant ou créé à la volée (libellé de lot requis)
  let run: MemoireRunRow | null = null
  if (d.runId) {
    run = await loadRun(ctx.supabase, ctx.org.id, tenderId, d.runId)
    if (!run) return { error: 'Run introuvable.' }
  } else {
    const lotLabel = d.lotLabel?.trim()
    if (!lotLabel) return { error: 'Sélectionnez le lot concerné.' }
    const lotId =
      d.lotId ||
      (d.lotNumber != null
        ? await ensureTenderLot(ctx.supabase, ctx.org.id, tenderId, {
            number: d.lotNumber,
            title: d.lotTitle?.trim() || lotLabel,
          })
        : null)
    const { data: created, error } = await ctx.supabase
      .from('tender_memoire_runs')
      .insert({
        organization_id: ctx.org.id,
        tender_id: tenderId,
        lot_id: lotId || null,
        lot_label: lotLabel,
        created_by: ctx.user.id,
      })
      .select('*')
      .single()
    if (error || !created) return { error: 'Création du run impossible.' }
    run = created as MemoireRunRow
  }

  const filename = file.name
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Remplace l'ancien mémoire complet si le run en avait déjà un
  await removeStoredDoc(ctx, run.docx_full_document_id)
  const stored = await storeDocx(ctx, tenderId, run.id, bytes, filename)
  if (!stored.docId) return { error: stored.error }
  const docId = stored.docId

  await ctx.supabase
    .from('tender_memoire_runs')
    .update({
      status: 'built_full',
      docx_full_document_id: docId,
      docx_full_filename: filename,
      updated_at: new Date().toISOString(),
    })
    .eq('id', run.id)

  await syncChecklistItems(
    ctx.supabase,
    ctx.org.id,
    tenderId,
    [/m[ée]moire/i],
    { document_id: docId, status: 'a_verifier' },
    { lotNumber: Number(/(\d+)/.exec(run.lot_label ?? '')?.[1]) || null },
  )

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'memoire_run.docx_imported',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { run_id: run.id, filename },
  })
  revalidateTenderPages(orgSlug)
  revalidatePath(`/${orgSlug}/documents`)
  return { data: { filename, runId: run.id } }
}

// ============================ SUPPRESSION ============================

export async function deleteMemoireRun(
  orgSlug: string,
  tenderId: string,
  runId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'admin')
  if (!ctx) return { error: 'Accès refusé.' }
  const run = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  const { error } = await ctx.supabase
    .from('tender_memoire_runs')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', runId)
  if (error) return fail(error)
  // Nettoie les fichiers générés associés (best-effort)
  for (const docId of [
    run?.content_document_id,
    run?.docx_document_id,
    run?.docx_full_document_id,
  ]) {
    if (!docId) continue
    const { data: doc } = await ctx.supabase
      .from('documents')
      .select('storage_path')
      .eq('organization_id', ctx.org.id)
      .eq('id', docId)
      .single()
    if (doc) await ctx.supabase.storage.from('documents').remove([doc.storage_path])
    await ctx.supabase
      .from('documents')
      .delete()
      .eq('organization_id', ctx.org.id)
      .eq('id', docId)
  }
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'memoire_run.deleted',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { run_id: runId },
  })
  revalidateTenderPages(orgSlug)
  return { success: true }
}
