'use server'

import { revalidatePath } from 'next/cache'
import { revalidateTenderPages } from '@/lib/revalidate'
import { requireMembership } from '@/lib/dal/auth'
import { audit } from '@/lib/audit'
import { getEnv } from '@/env'
import { peekText, unrarEntries, unzipEntries } from '@/lib/dce/extract'
import { loadTenderSourceFiles } from '@/lib/dce/source-docs'
import { classifyDoc } from '@/lib/dce/classify'
import type { DceDocType } from '@/lib/dce/types'
import { analyzeDce } from '@/lib/dce/analyze'
import { normalizeAnalysis, plausiblePublishedAt } from '@/lib/dce/normalize'
import {
  attachCompanyDocsToChecklist,
  syncChecklistItems,
} from '@/lib/checklist-attach'
import { tenderFolderName } from '@/lib/doc-folders'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DceAnalysis, SkippedDoc } from '@/lib/dce/types'
import type { ActionState } from '@/lib/validation/auth'

export interface DceAnalysisMeta {
  id: string
  model: string | null
  files: { name: string; type: string; chars: number; lots?: number[] }[]
  skipped: SkippedDoc[]
  created_at: string
}

// ============================ IMPORT DCE (drag & drop) ============================

/** Sous-dossiers de rangement par type de pièce, sous le dossier de l'AO. */
const DOC_TYPE_FOLDERS: Record<DceDocType, string> = {
  rc: '01 - Règlement de consultation',
  cctp: '02 - CCTP',
  ccap: '03 - CCAP-CCAG',
  ccag: '03 - CCAP-CCAG',
  ae: "04 - Acte d'engagement",
  bpu: '05 - BPU-DPGF',
  dpgf: '05 - BPU-DPGF',
  annexe: '06 - Annexes',
  autre: '07 - Divers',
}

const MAX_IMPORT_FILES = 80
const MAX_ZIP_BYTES = 80 * 1024 * 1024
const MAX_ENTRY_BYTES = 80 * 1024 * 1024

export interface DceImportResult {
  imported: { name: string; docType: DceDocType; folder: string }[]
  skipped: SkippedDoc[]
}

type Payload = { name: string; data: Uint8Array; mime?: string }

/** Aplatit un fichier déposé : direct ou déplié (ZIP / RAR) en payloads. */
async function expandUpload(
  name: string,
  buf: Uint8Array,
  mime: string | undefined,
  payloads: Payload[],
  skipped: SkippedDoc[],
): Promise<void> {
  const isZip = mime === 'application/zip' || /\.zip$/i.test(name)
  const isRar =
    mime === 'application/vnd.rar' ||
    mime === 'application/x-rar-compressed' ||
    /\.rar$/i.test(name)
  if (!isZip && !isRar) {
    payloads.push({ name, data: buf, mime })
    return
  }
  try {
    // Nom = chemin relatif : « LOT 3/DPGF.xlsx » garde le contexte du lot
    // (classification + détection de lot + traçabilité dans le dossier).
    const { entries, total } = isRar ? await unrarEntries(buf) : unzipEntries(buf)
    for (const e of entries) payloads.push({ name: e.path, data: e.data })
    if (total > entries.length) {
      skipped.push({
        name,
        reason: `archive tronquée — ${total - entries.length} entrée(s) ignorée(s), renvoyez-les séparément`,
      })
    }
  } catch {
    skipped.push({
      name,
      reason: isRar ? 'RAR illisible ou protégé par mot de passe' : 'ZIP illisible',
    })
  }
}

/** Classe, stocke et lie chaque payload au dossier d'AO. */
async function persistPayloads(
  supabase: SupabaseClient,
  org: { id: string },
  user: { id: string },
  tender: { id: string; title: string | null; reference: string | null },
  payloads: Payload[],
  skipped: SkippedDoc[],
): Promise<DceImportResult['imported']> {
  const imported: DceImportResult['imported'] = []
  for (const p of payloads.slice(0, MAX_IMPORT_FILES)) {
    if (p.data.byteLength === 0 || p.data.byteLength > MAX_ENTRY_BYTES) {
      skipped.push({ name: p.name, reason: 'vide ou trop volumineux (>80 Mo)' })
      continue
    }

    // Classification : nom d'abord, échantillon de contenu si ambigu.
    let docType = classifyDoc(p.name, '')
    if (docType === 'autre') {
      const sample = await peekText(p.name, p.data, p.mime)
      if (sample) docType = classifyDoc(p.name, sample)
    }
    const folder = tenderFolderName(tender, `DCE/${DOC_TYPE_FOLDERS[docType]}`)

    const docId = crypto.randomUUID()
    const safeName = p.name.replace(/[^\w.()-]/g, '_')
    const storagePath = `org_${org.id}/${docId}/${safeName}`

    const mime =
      p.mime ??
      (/\.pdf$/i.test(p.name)
        ? 'application/pdf'
        : /\.docx$/i.test(p.name)
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : /\.(txt|md|csv)$/i.test(p.name)
            ? 'text/plain'
            : 'application/octet-stream')

    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, p.data, { contentType: mime })
    if (upErr) {
      skipped.push({ name: p.name, reason: `échec upload : ${upErr.message}` })
      continue
    }

    const { error: dbErr } = await supabase.from('documents').insert({
      id: docId,
      organization_id: org.id,
      name: p.name,
      folder_path: folder,
      storage_path: storagePath,
      mime_type: mime,
      size_bytes: p.data.byteLength,
      category: 'dce',
      document_type: docType,
      uploaded_by: user.id,
    })
    if (dbErr) {
      await supabase.storage.from('documents').remove([storagePath])
      skipped.push({ name: p.name, reason: `échec enregistrement : ${dbErr.message}` })
      continue
    }

    const { error: linkErr } = await supabase.from('document_links').upsert(
      {
        organization_id: org.id,
        document_id: docId,
        entity_type: 'tender',
        entity_id: tender.id,
      },
      { onConflict: 'document_id,entity_type,entity_id' },
    )
    if (linkErr) {
      // Stocké mais non lié à l'AO : visible dans Documents mais absent de
      // l'onglet — on le signale au lieu de le perdre silencieusement.
      skipped.push({ name: p.name, reason: 'importé mais échec de la liaison au dossier' })
      continue
    }
    imported.push({ name: p.name, docType, folder })
  }

  if (payloads.length > MAX_IMPORT_FILES) {
    skipped.push({
      name: `+${payloads.length - MAX_IMPORT_FILES} fichiers`,
      reason: 'limite de 80 fichiers par import',
    })
  }
  return imported
}

/**
 * Fichier déjà uploadé dans le storage (`org_<id>/incoming/…`) : le serveur le
 * télécharge, le déplie et le range. Permet aux gros fichiers de contourner la
 * limite de corps des Server Actions (upload direct navigateur → storage).
 */
export async function importStoredFile(
  orgSlug: string,
  tenderId: string,
  storagePath: string,
  displayName: string,
): Promise<{ data?: DceImportResult; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, org, user } = ctx

  // Le chemin temporaire doit appartenir à l'org et à la zone d'import.
  if (!storagePath.startsWith(`org_${org.id}/incoming/`)) {
    return { error: 'Chemin de stockage invalide.' }
  }

  const { data: tender } = await supabase
    .from('tenders')
    .select('id, title, reference')
    .eq('organization_id', org.id)
    .eq('id', tenderId)
    .single()
  if (!tender) return { error: 'Dossier introuvable.' }

  const { data: fileData, error: dlErr } = await supabase.storage
    .from('documents')
    .download(storagePath)
  if (dlErr || !fileData) {
    return { error: 'Fichier temporaire introuvable — renvoyez-le.' }
  }

  // Sweep opportuniste : objets temporaires laissés par des imports ayant
  // planté avant le nettoyage (> 1 h). Non bloquant.
  try {
    const { data: stale } = await supabase.storage
      .from('documents')
      .list(`org_${org.id}/incoming`, { limit: 100 })
    const cutoff = Date.now() - 60 * 60 * 1000
    const old = (stale ?? [])
      .filter((o) => o.created_at && new Date(o.created_at).getTime() < cutoff)
      .map((o) => `org_${org.id}/incoming/${o.name}`)
    if (old.length) await supabase.storage.from('documents').remove(old)
  } catch {
    /* best-effort */
  }

  const payloads: Payload[] = []
  const skipped: SkippedDoc[] = []
  const buf = new Uint8Array(await fileData.arrayBuffer())
  let imported: DceImportResult['imported'] = []
  try {
    await expandUpload(displayName, buf, undefined, payloads, skipped)
    imported = await persistPayloads(supabase, org, user, tender, payloads, skipped)
  } finally {
    // Objet temporaire : nettoyé même si le dépliage plante.
    await supabase.storage.from('documents').remove([storagePath])
  }

  if (!imported.length) return { error: 'Aucun fichier importé.', data: { imported, skipped } }

  await audit(supabase, {
    organizationId: org.id,
    action: 'tender.dce_imported',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { files: imported.length, skipped: skipped.length, via: 'storage' },
  })
  revalidateTenderPages(orgSlug)
  return { data: { imported, skipped } }
}

/**
 * Importe un DCE complet (ZIP ou sélection de fichiers) : déplie les archives,
 * classe chaque pièce (nom puis contenu si ambigu) et la range dans
 * `DCE/<type>` — le dossier reste organisé et l'agent sait où tout est.
 */
export async function importDcePackage(
  orgSlug: string,
  tenderId: string,
  formData: FormData,
): Promise<{ data?: DceImportResult; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, org, user } = ctx

  // Vérifier que le tender existe (scoping org) + nom du dossier de rangement
  const { data: tender } = await supabase
    .from('tenders')
    .select('id, title, reference')
    .eq('organization_id', org.id)
    .eq('id', tenderId)
    .single()
  if (!tender) return { error: 'Dossier introuvable.' }

  // Aplatir : fichiers directs + contenu des ZIP.
  // `paths[i]` = chemin relatif envoyé par le client pour `files[i]` — un
  // dossier glissé-déposé envoie « LOT 3/DPGF.xlsx » : la classification et
  // la détection de lot s'appuient sur ce contexte.
  const dropped = formData.getAll('files').filter((f): f is File => f instanceof File)
  if (!dropped.length) return { error: 'Aucun fichier reçu.' }
  const paths = formData.getAll('paths').map(String)

  const payloads: Payload[] = []
  const skipped: SkippedDoc[] = []
  for (const [i, file] of dropped.entries()) {
    const relName = paths[i] || file.name
    if (file.size > MAX_ZIP_BYTES) {
      skipped.push({ name: relName, reason: 'fichier trop volumineux (>80 Mo)' })
      continue
    }
    const buf = new Uint8Array(await file.arrayBuffer())
    await expandUpload(relName, buf, file.type || undefined, payloads, skipped)
  }

  const imported = await persistPayloads(supabase, org, user, tender, payloads, skipped)

  if (!imported.length) return { error: 'Aucun fichier importé.', data: { imported, skipped } }

  await audit(supabase, {
    organizationId: org.id,
    action: 'tender.dce_imported',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { files: imported.length, skipped: skipped.length },
  })
  revalidateTenderPages(orgSlug)
  return { data: { imported, skipped } }
}

/**
 * Lance l'agent de lecture sur les documents liés au dossier d'AO.
 * Les ZIP sont dépliés, les pièces classées (RC, CCTP, CCAP…) puis
 * analysées par le LLM. Résultat persisté dans tender_dce_analyses.
 */
export async function analyzeTenderDce(
  orgSlug: string,
  tenderId: string,
): Promise<{ data?: { analysis: DceAnalysis; meta: DceAnalysisMeta }; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!getEnv().DEEPSEEK_API_KEY) {
    return { error: 'DEEPSEEK_API_KEY manquante — ajoutez-la dans .env.local.' }
  }
  const { supabase, org, user } = ctx

  // Pièces du DCE liées au dossier (hors sorties des pipelines : fiches
  // techniques, mémoires, DC1/DC2 générés — ce ne sont pas des pièces DCE).
  const { candidates, docs: extracted, skipped: allSkipped } =
    await loadTenderSourceFiles(supabase, org.id, tenderId)

  if (!candidates) {
    return {
      error:
        'Aucun document analysable lié à ce dossier — joignez le DCE (PDF, ZIP, DOCX) dans l’onglet Documents.',
    }
  }
  if (!extracted.length) {
    return { error: 'Aucune pièce lisible (PDF scanné sans OCR ?).' }
  }

  // Lots déjà saisis : désambiguïsent les numéros/intitulés pour l'agent.
  const { data: knownLots } = await supabase
    .from('tender_lots')
    .select('number, title')
    .eq('organization_id', org.id)
    .eq('tender_id', tenderId)
    .order('number')

  try {
    const {
      analysis,
      model,
      usage,
      files: usedFiles,
      dropped,
    } = await analyzeDce(extracted, { knownLots: knownLots ?? undefined })

    // Pièces exclues du prompt (limite/budget) : remontées comme ignorées,
    // jamais silencieusement.
    for (const d of dropped) {
      allSkipped.push({ name: d.name, reason: 'non analysée (budget de contexte épuisé)' })
    }

    const { data: row, error: insErr } = await supabase
      .from('tender_dce_analyses')
      .insert({
        organization_id: org.id,
        tender_id: tenderId,
        status: 'done',
        model,
        files: usedFiles,
        skipped: allSkipped,
        result: analysis,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        created_by: user.id,
      })
      .select('id, created_at')
      .single()
    if (insErr || !row) return { error: 'Analyse réussie mais enregistrement impossible.' }

    await audit(supabase, {
      organizationId: org.id,
      action: 'tender.dce_analyzed',
      entityType: 'tender',
      entityId: tenderId,
      metadata: { analysis_id: row.id, model, files: usedFiles.length },
    })
    revalidateTenderPages(orgSlug)

    return {
      data: {
        analysis,
        meta: {
          id: row.id,
          model,
          files: usedFiles,
          skipped: allSkipped,
          created_at: row.created_at,
        },
      },
    }
  } catch (e) {
    // Persister l'échec pour traçabilité
    await supabase.from('tender_dce_analyses').insert({
      organization_id: org.id,
      tender_id: tenderId,
      status: 'error',
      files: extracted.map((d) => ({ name: d.name, type: d.docType, chars: d.text.length })),
      skipped: allSkipped,
      error: e instanceof Error ? e.message.slice(0, 500) : 'Échec de l’analyse.',
      created_by: user.id,
    })
    return { error: e instanceof Error ? e.message : 'Échec de l’analyse IA.' }
  }
}

/**
 * Applique le résultat d'une analyse au dossier : renseigne les champs
 * extraits, crée les lots manquants et ajoute les pièces exigées à la
 * checklist (sans dupliquer les lignes existantes).
 */
export async function applyDceAnalysis(
  orgSlug: string,
  tenderId: string,
  analysisId: string,
): Promise<ActionState & { attached?: number; validated?: number }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, org } = ctx

  const { data: row } = await supabase
    .from('tender_dce_analyses')
    .select('id, result, status')
    .eq('organization_id', org.id)
    .eq('id', analysisId)
    .eq('tender_id', tenderId)
    .single()
  if (!row?.result || row.status !== 'done') return { error: 'Analyse introuvable.' }
  const a = normalizeAnalysis(row.result)
  const { identification: id, deadlines: dl } = a

  // Référence pour les échéances internes de la checklist : la deadline
  // extraite du DCE prime, sinon celle déjà saisie au dossier — validée
  // plus bas (validIso) avant toute écriture ou calcul.

  // Acheteur : rattacher à un compte existant si le nom correspond
  // (% et _ échappés — un nom contenant un wildcard casserait le match)
  let buyerAccountId: string | null = null
  if (id.buyer) {
    const escaped = id.buyer.slice(0, 60).replace(/[%_\\]/g, (c) => `\\${c}`)
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, name')
      .eq('organization_id', org.id)
      .ilike('name', `%${escaped}%`)
      .limit(1)
    buyerAccountId = accounts?.[0]?.id ?? null
  }

  const update: Record<string, unknown> = {}
  if (id.title) update.title = id.title
  if (id.reference) update.reference = id.reference
  if (buyerAccountId) update.buyer_account_id = buyerAccountId
  if (id.platform) update.platform = id.platform
  if (id.region) update.region = id.region
  if (id.procedure_type) update.procedure_type = id.procedure_type
  if (id.market_type) update.market_type = id.market_type
  if (id.deposit_mode) update.deposit_mode = id.deposit_mode
  if (id.duration_months) update.duration_months = Math.round(id.duration_months)
  if (id.estimated_amount_euros != null)
    update.estimated_amount_cents = Math.round(id.estimated_amount_euros * 100)
  // Le normaliseur conserve la chaîne brute quand la date n'est pas
  // parsable (« fin octobre »…) — elle est affichée à l'écran mais ne doit
  // JAMAIS être écrite dans une colonne timestamptz (rejet SQL).
  const validIso = (v?: string) =>
    v && !Number.isNaN(Date.parse(v)) ? v : undefined
  const responseDeadline = validIso(dl.response_deadline)
  const questionsDeadline = validIso(dl.questions_deadline)
  const visitDate = validIso(dl.site_visit?.date)
  // Publication validée comme les échéances, et écartée si aberrante :
  // « 07 janv. 2020 » pour un marché 2026 était une date interne d'une pièce
  // (PGC, rapport de contrôle technique) lue comme date de parution.
  const publishedAt = plausiblePublishedAt(id.published_at, responseDeadline)
  if (publishedAt) update.published_at = publishedAt
  if (responseDeadline) update.response_deadline = responseDeadline
  if (questionsDeadline) update.questions_deadline = questionsDeadline
  if (dl.site_visit?.mandatory) update.site_visit_mandatory = true
  if (visitDate) update.site_visit_at = visitDate
  if (a.award_criteria.length) {
    update.award_criteria = Object.fromEntries(
      a.award_criteria
        .filter((c) => c.weight_pct != null)
        .map((c) => [c.label.toLowerCase(), c.weight_pct]),
    )
  }
  const { data: tender } = await supabase
    .from('tenders')
    .select('status, notes, response_deadline')
    .eq('organization_id', org.id)
    .eq('id', tenderId)
    .single()
  // La synthèse ne remplace jamais des notes déjà saisies à la main.
  if (a.summary && !tender?.notes?.trim()) update.notes = a.summary
  if (tender?.status === 'detecte') update.status = 'analyse'

  if (Object.keys(update).length) {
    const { error } = await supabase
      .from('tenders')
      .update(update)
      .eq('organization_id', org.id)
      .eq('id', tenderId)
    if (error) return { error: 'Échec de la mise à jour du dossier.' }
  }

  // Lots manquants (dédupliqué par numéro) + complétion des existants :
  // un lot saisi à la main sans montant reçoit celui extrait du DCE.
  if (a.lots.length) {
    const { data: existing } = await supabase
      .from('tender_lots')
      .select('id, number, amount_cents')
      .eq('organization_id', org.id)
      .eq('tender_id', tenderId)
    const byNumber = new Map((existing ?? []).map((l) => [l.number, l]))
    const toInsert = a.lots
      .filter((l) => !byNumber.has(l.number))
      .map((l) => ({
        organization_id: org.id,
        tender_id: tenderId,
        number: l.number,
        title: l.title,
        amount_cents: l.amount_euros != null ? Math.round(l.amount_euros * 100) : null,
      }))
    if (toInsert.length) await supabase.from('tender_lots').insert(toInsert)
    for (const l of a.lots) {
      const cur = byNumber.get(l.number)
      if (cur && cur.amount_cents == null && l.amount_euros != null) {
        await supabase
          .from('tender_lots')
          .update({ amount_cents: Math.round(l.amount_euros * 100) })
          .eq('id', cur.id)
      }
    }
  }

  // Pièces exigées → checklist (dédupliqué par libellé normalisé)
  if (a.required_documents.length) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-zà-ÿ0-9]+/g, ' ').trim()
    const { data: existing } = await supabase
      .from('tender_checklist_items')
      .select('label')
      .eq('organization_id', org.id)
      .eq('tender_id', tenderId)
    const have = new Set((existing ?? []).map((i) => norm(i.label)))
    // Les exigences propres à un lot sont préfixées « [Lot N] » dans la
    // checklist — le label normalisé inclut le préfixe pour le dédoublonnage.
    const labelOf = (d: (typeof a.required_documents)[number]) =>
      `${d.lot ? `[Lot ${d.lot}] ` : ''}${d.label}`
    // Échéance interne par défaut, calée sur la deadline de remise :
    // pièces de dépôt J-1, administratives J-2, production (mémoire,
    // technique, financier) J-3. Ajustable à la main dans la checklist.
    const dlDate = new Date(responseDeadline ?? tender?.response_deadline ?? '')
    const internalDeadline = (category: string) => {
      if (Number.isNaN(dlDate.getTime())) return null
      const days =
        category === 'depot'
          ? 1
          : category === 'administratif'
            ? 2
            : category === 'technique' ||
                category === 'financier' ||
                category === 'memoire'
              ? 3
              : 2
      const d = new Date(dlDate)
      d.setDate(d.getDate() - days)
      return d.toISOString().slice(0, 10)
    }
    const toInsert = a.required_documents
      .filter((d) => !have.has(norm(labelOf(d))))
      .map((d, i) => ({
        organization_id: org.id,
        tender_id: tenderId,
        label: labelOf(d).slice(0, 300),
        category: d.category,
        requirement: d.requirement,
        requires_signature: d.requires_signature,
        requires_chiffrage: d.requires_chiffrage,
        internal_deadline: internalDeadline(d.category),
        comment: d.source ? `Source : ${d.source}` : null,
        position: 1000 + i,
      }))
    if (toInsert.length) await supabase.from('tender_checklist_items').insert(toInsert)
  }

  // Rattache les pièces du kit candidature société aux lignes sans document
  // (Kbis, URSSAF, attestations, DC1/DC2…) — y compris celles créées au
  // seed du dossier. Best-effort : ne doit pas faire échouer l'application.
  let attached = 0
  let validated = 0
  try {
    ;({ attached, validated } = await attachCompanyDocsToChecklist(
      supabase,
      org.id,
      tenderId,
      ctx.user.id,
    ))
  } catch {
    // noop — rejouable via « Rattacher les pièces société »
  }

  // « Règlement de consultation analysé » : l'analyse du DCE vient d'être
  // appliquée — la ligne passe « à vérifier » avec le RC du dossier en
  // pièce jointe s'il existe (sinon la ligne est juste avancée).
  try {
    const { data: rcLink } = await supabase
      .from('document_links')
      .select('document_id, documents!inner(document_type)')
      .eq('organization_id', org.id)
      .eq('entity_type', 'tender')
      .eq('entity_id', tenderId)
      .eq('documents.document_type', 'rc')
      .limit(1)
      .maybeSingle()
    await syncChecklistItems(
      supabase,
      org.id,
      tenderId,
      // « RC » nu exige « analys » à proximité — sinon « Assurance RC
      // professionnelle » recevrait le règlement en pièce jointe.
      [/r[èe]glement de consultation/i, /\brc\b.{0,30}analys|analys.{0,30}\brc\b/i],
      {
        ...(rcLink?.document_id ? { document_id: rcLink.document_id } : {}),
        status: 'a_verifier',
      },
    )
  } catch {
    // noop — la checklist reste modifiable à la main
  }

  // Le moteur de conformité tourne d'abord : depuis la migration 0010 sa
  // purge ignore les clés dce_risk_* — et en attendant le déploiement,
  // insérer les risques APRÈS le RPC évite qu'ils soient purgés.
  await supabase.rpc('run_compliance_checks', { p_tender_id: tenderId })

  // Risques relevés par l'analyse → alertes du dossier (check_key dce_risk_*).
  // Dédupliquées par message normalisé : un risque déjà remonté n'est pas
  // re-inséré ; un risque disparu de la nouvelle analyse est auto-résolu.
  if (a.risks.length) {
    const normMsg = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
    const { data: openRiskAlerts } = await supabase
      .from('tender_alerts')
      .select('id, message')
      .eq('organization_id', org.id)
      .eq('tender_id', tenderId)
      .is('resolved_at', null)
      .like('check_key', 'dce_risk_%')
    const open = openRiskAlerts ?? []
    const newMsgs = new Set(a.risks.map((r) => normMsg(r.message)))
    // Risques disparus de la nouvelle analyse → résolus automatiquement.
    const stale = open.filter((o) => !newMsgs.has(normMsg(o.message)))
    if (stale.length) {
      await supabase
        .from('tender_alerts')
        .update({ resolved_at: new Date().toISOString() })
        .in('id', stale.map((o) => o.id))
    }
    const openMsgs = new Set(open.map((o) => normMsg(o.message)))
    const severities = new Set(['bloquante', 'critique', 'importante', 'info'])
    const riskRows = a.risks
      .filter((r) => !openMsgs.has(normMsg(r.message)))
      .map((r, i) => ({
        organization_id: org.id,
        tender_id: tenderId,
        severity: severities.has(r.severity) ? r.severity : 'info',
        check_key: `dce_risk_${i}`,
        message: r.message.slice(0, 500),
        recommended_action: 'Analyser le point de vigilance et décider de la conduite à tenir.',
      }))
    if (riskRows.length) await supabase.from('tender_alerts').insert(riskRows)
  }

  await supabase
    .from('tender_dce_analyses')
    .update({ applied_at: new Date().toISOString() })
    .eq('id', analysisId)

  await audit(supabase, {
    organizationId: org.id,
    action: 'tender.dce_applied',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { analysis_id: analysisId, kit_docs_attached: attached },
  })
  revalidateTenderPages(orgSlug)
  revalidatePath(`/${orgSlug}/tenders`)
  return { success: true, attached, validated }
}
