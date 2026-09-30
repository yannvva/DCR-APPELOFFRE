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
import { parseLotLabel, shortenLotLabel } from '@/lib/naming'

/** Préfixe de stockage des fichiers produits par un dossier de fiches. */
const DATASHEET_RUN_PREFIX = (runId: string) => `/datasheets/${runId}/`
import { storageSafeName } from '@/lib/storage-key'
import { extractRequirements } from '@/lib/datasheets/brief'
import {
  docFilename,
  ensureProductDocRows,
  researchChapter,
  sanitizeFilename,
  searchMissingDocUrls,
} from '@/lib/datasheets/research'
import { fetchPdf, resolvePdfFromPage } from '@/lib/datasheets/download'
import { resetSearchHealth, searchHealth } from '@/lib/ai/web-tools'
import { buildWorkbook } from '@/lib/datasheets/workbook'
import {
  buildDeliveryZip,
  classeurFilename,
  dedupeFilenames,
  lotShortLabel,
} from '@/lib/datasheets/deliverable'
import {
  EMPTY_CHAPTER_RESULT,
  PDF_NON_TROUVE,
  isProductDocument,
} from '@/lib/datasheets/types'
import { datasheetDedupKey, upsertLibraryEntry } from '@/lib/dal/datasheet-library'
import {
  discoverPdfsOnSite,
  resolveManufacturerDomains,
  tokensOf,
} from '@/lib/datasheets/site-discovery'
import type { ChapterDef, ChapterResult } from '@/lib/datasheets/types'
import type { DatasheetRunRow } from '@/lib/dal/datasheets'
import type { ActionState } from '@/lib/validation/auth'
import type { SupabaseClient } from '@supabase/supabase-js'

function fail(
  e: unknown,
  fallback = 'Une erreur est survenue.',
): NonNullable<ActionState> {
  const msg = e instanceof Error ? e.message : fallback
  return { error: msg === 'Accès refusé' ? msg : fallback }
}

const runSchema = z.object({
  lotId: z.uuid().optional().or(z.literal('')),
  // Lot issu de l'analyse DCE (pas encore appliquée → pas de tender_lots) :
  // le serveur crée la ligne lot à la volée.
  lotNumber: z.number().min(0).optional(),
  lotTitle: z.string().max(200).optional().or(z.literal('')),
  lotLabel: z.string().min(1, 'Lot requis').max(200),
  operationShort: z.string().max(80).optional().or(z.literal('')),
  variantes: z.array(z.string().max(80)).max(6).default([]),
})

async function loadRun(
  supabase: SupabaseClient,
  orgId: string,
  tenderId: string,
  runId: string,
): Promise<DatasheetRunRow | null> {
  const { data } = await supabase
    .from('tender_datasheet_runs')
    .select('*')
    .eq('organization_id', orgId)
    .eq('tender_id', tenderId)
    .eq('id', runId)
    .single()
  return (data as DatasheetRunRow | null) ?? null
}

/** Documents (pièces DCE) liés au dossier d'AO → textes extraits. */
async function extractTenderDocs(
  supabase: SupabaseClient,
  orgId: string,
  tenderId: string,
) {
  const { docs, skipped } = await loadTenderSourceFiles(
    supabase,
    orgId,
    tenderId,
  )
  return { docs, skipped }
}

// ============================ CRÉATION ============================

export async function createDatasheetRun(
  orgSlug: string,
  tenderId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = runSchema.safeParse(input)
  if (!parsed.success)
    return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { data: tender } = await ctx.supabase
    .from('tenders')
    .select('title, buyer:accounts!buyer_account_id(name), response_deadline')
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

  const buyer = Array.isArray(tender.buyer) ? tender.buyer[0] : tender.buyer
  const operation = [
    tender.title,
    buyer?.name ? `MOA : ${buyer.name}` : '',
    tender.response_deadline
      ? `Remise des offres ${new Date(tender.response_deadline).toLocaleDateString('fr-FR')}`
      : '',
  ].filter(Boolean)

  const { data: row, error } = await ctx.supabase
    .from('tender_datasheet_runs')
    .insert({
      organization_id: ctx.org.id,
      tender_id: tenderId,
      lot_id: lotId || null,
      lot_label: d.lotLabel,
      config: {
        operation,
        operationShort: d.operationShort?.trim() || undefined,
        variantes: d.variantes,
      },
      created_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (error || !row)
    return fail(error, 'Erreur lors de la création du dossier.')

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'datasheet_run.created',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { run_id: row.id, lot_label: d.lotLabel },
  })
  revalidateTenderPages(orgSlug)
  return { success: true, id: row.id }
}

// ============================ ÉTAPE 1 — DÉPOUILLAGE ============================

export async function extractRunBrief(
  orgSlug: string,
  tenderId: string,
  runId: string,
): Promise<{
  data?: { chapters: string[]; doutes: string[] }
  error?: string
}> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!getEnv().DEEPSEEK_API_KEY) {
    return { error: 'DEEPSEEK_API_KEY manquante — ajoutez-la dans .env.local.' }
  }
  const run = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  if (!run) return { error: 'Dossier introuvable.' }

  const { docs, skipped } = await extractTenderDocs(
    ctx.supabase,
    ctx.org.id,
    tenderId,
  )
  if (!docs.length) {
    return {
      error:
        'Aucune pièce lisible — joignez le DCE (CCTP, CCAP, DPGF…) dans l’onglet Documents du dossier.',
    }
  }

  try {
    const { brief, model, usage, files } = await extractRequirements(
      docs,
      run.lot_label,
      run.config.variantes ?? [],
    )
    // Re-dépouillage : les chapitres disparus du nouveau brief ne doivent pas
    // garder leurs anciens résultats (ils seraient exportés). Les résultats
    // des chapitres encore présents sont conservés.
    const keptResult = Object.fromEntries(
      Object.entries(run.result).filter(([code]) => brief.chapitres[code]),
    )
    const keptNames = new Set(
      Object.values(keptResult).flatMap((r) =>
        r.documents.map((d) => d.filename),
      ),
    )
    const keptReport = Object.fromEntries(
      Object.entries(run.download_report).filter(([name]) =>
        keptNames.has(name),
      ),
    )
    const { error } = await ctx.supabase
      .from('tender_datasheet_runs')
      .update({
        status: 'brief_ready',
        chapters: brief.chapitres,
        result: keptResult,
        download_report: keptReport,
        // Re-dépouillage : les doutes sont régénérés, pas cumulés.
        config: {
          ...run.config,
          doutes: brief.doutes,
          skipped,
          files: files.map((f) => f.name),
        },
        model,
        input_tokens: (run.input_tokens ?? 0) + usage.inputTokens,
        output_tokens: (run.output_tokens ?? 0) + usage.outputTokens,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)
    if (error)
      return { error: 'Extraction réussie mais enregistrement impossible.' }
    revalidateTenderPages(orgSlug)
    return {
      data: { chapters: Object.keys(brief.chapitres), doutes: brief.doutes },
    }
  } catch (e) {
    await ctx.supabase
      .from('tender_datasheet_runs')
      .update({
        status: 'error',
        error: e instanceof Error ? e.message.slice(0, 500) : 'Échec',
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)
    return { error: e instanceof Error ? e.message : 'Échec de l’analyse IA.' }
  }
}

// ============================ ÉTAPE 2 — AGENTS DE RECHERCHE ============================

export async function researchRunChapter(
  orgSlug: string,
  tenderId: string,
  runId: string,
  code: string,
): Promise<{
  data?: { produits: number; documents: number; ecarts: number }
  error?: string
}> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!getEnv().DEEPSEEK_API_KEY) {
    return { error: 'DEEPSEEK_API_KEY manquante — ajoutez-la dans .env.local.' }
  }
  const run = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  if (!run) return { error: 'Dossier introuvable.' }
  const chapter = run.chapters[code]
  if (!chapter) return { error: `Chapitre ${code} inconnu.` }

  try {
    const { result, model, usage } = await researchChapter({
      operation: (run.config.operation ?? []).join(' — '),
      lotLabel: run.lot_label,
      variantes: run.config.variantes ?? [],
      code,
      chapter,
      doutes: run.config.doutes ?? [],
    })
    // La recherche peut durer plusieurs minutes : relecture juste avant
    // l'écriture pour ne pas écraser des drapeaux « downloaded » posés entre-
    // temps par un téléchargement concurrent (lost update).
    const fresh = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
    // Une re-recherche réécrit le chapitre : on reporte les drapeaux de
    // téléchargement sur les documents identiques pour ne pas masquer
    // visuellement les PDF déjà livrés. Clé primaire : url/filename ; repli :
    // contenu (désignation+marque+référence+type) — une re-recherche peut
    // renvoyer le même produit sans URL sans perdre le drapeau.
    const prevDocs = (fresh?.result ?? run.result)[code]?.documents ?? []
    const prevByKey = new Map(prevDocs.map((d) => [d.url || d.filename, d] as const))
    const prevContent = new Map<string, (typeof prevDocs)[number][]>()
    for (const d of prevDocs) {
      const k = [d.designation, d.marque, d.reference, d.type_document]
        .join('|')
        .toLowerCase()
      prevContent.set(k, [...(prevContent.get(k) ?? []), d])
    }
    for (const doc of result.documents) {
      const byContent = prevContent.get(
        [doc.designation, doc.marque, doc.reference, doc.type_document]
          .join('|')
          .toLowerCase(),
      )
      const prev =
        prevByKey.get(doc.url || doc.filename) ??
        (doc.url === '' || doc.filename === '—' ? byContent?.[0] : undefined)
      if (prev?.downloaded || prev?.document_id) {
        doc.downloaded = true
        doc.document_id = prev.document_id ?? doc.document_id
        // Le nom de fichier livré sert de clé au rapport/classeur/ZIP — le
        // restaurer pour que le document reste comptabilisé comme livré.
        if (doc.filename === '—' && prev.filename !== '—') {
          doc.filename = prev.filename
        }
        if (doc.statut.includes(PDF_NON_TROUVE)) doc.statut = prev.statut
      }
    }
    const mergedResult = { ...(fresh?.result ?? run.result), [code]: result }
    const { error } = await ctx.supabase
      .from('tender_datasheet_runs')
      .update({
        status: 'researched',
        result: mergedResult,
        model,
        input_tokens: (fresh?.input_tokens ?? run.input_tokens ?? 0) + usage.inputTokens,
        output_tokens: (fresh?.output_tokens ?? run.output_tokens ?? 0) + usage.outputTokens,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)
    if (error)
      return { error: 'Recherche réussie mais enregistrement impossible.' }
    revalidateTenderPages(orgSlug)
    return {
      data: {
        produits: result.produits.length,
        documents: result.documents.length,
        ecarts: result.ecarts.length,
      },
    }
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Échec de l’agent de recherche.'
    // L'erreur est persistée pour rester visible après rechargement (le statut
    // n'est pas touché : les autres chapitres restent rejouables).
    await ctx.supabase
      .from('tender_datasheet_runs')
      .update({
        error: `[${code}] ${message.slice(0, 500)}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)
    return { error: message }
  }
}

// ==================== ÉTAPE 2 bis — RECHERCHE CIBLÉE DES URL MANQUANTES ====================

/** Seconde passe : relance un agent qui ne cherche QUE les URL PDF officielles
 *  des documents restés sans lien après la recherche par chapitre. Les URL
 *  trouvées sont fusionnées dans le résultat (statut « à valider ») — le
 *  bouton « Télécharger les PDF » les récupère ensuite. */
export async function findMissingDocUrls(
  orgSlug: string,
  tenderId: string,
  runId: string,
): Promise<{
  data?: { found: number; missing: number; prescriptive: number }
  error?: string
}> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!getEnv().DEEPSEEK_API_KEY) {
    return { error: 'DEEPSEEK_API_KEY manquante — ajoutez-la dans .env.local.' }
  }
  const run = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  if (!run) return { error: 'Dossier introuvable.' }
  if (!Object.keys(run.result).length) {
    return { error: 'Lancez d’abord les agents de recherche.' }
  }

  const result: Record<string, ChapterResult> = {}
  for (const [code, res] of Object.entries(run.result)) {
    const chapter: ChapterResult = { ...EMPTY_CHAPTER_RESULT, ...res }
    // Complétion « 1 produit = 1 fiche » : les produits proposés sans ligne
    // « documents » (runs créés avant la complétion) obtiennent leur ligne à
    // rechercher — sinon la couverture plafonnait à ce que l'agent avait émis.
    ensureProductDocRows(
      chapter,
      code,
      (run.chapters[code]?.exigences ?? [])
        .map((e) => e.code)
        .filter((c) => c.trim()),
    )
    result[code] = chapter
  }
  // TOUS les documents sans URL sont recherchés — y compris les références
  // normatives (DTU, NF EN, guides CSTB…) : beaucoup sont librement
  // accessibles (guides éditeurs, miroirs officiels, Legifrance) et l'agent
  // sait les trouver. Le compteur `prescriptive` n'est qu'informatif.
  const searchable = (d: ChapterResult['documents'][number]) => !d.url
  // État de santé de la recherche remis à zéro : permet de distinguer
  // « aucun document n'existe » de « les moteurs sont bloqués » en fin de passe.
  resetSearchHealth()
  const totalMissing = Object.values(result).reduce(
    (n, r) => n + r.documents.filter(searchable).length,
    0,
  )
  const prescriptive = Object.values(result).reduce(
    (n, r) => n + r.documents.filter((d) => !d.url && !isProductDocument(d)).length,
    0,
  )
  if (!totalMissing) return { data: { found: 0, missing: 0, prescriptive } }

  let found = 0
  let lastModel = run.model
  const errors: string[] = []
  const tokenUsage = { inputTokens: 0, outputTokens: 0 }

  // Toutes les recherches sont préparées puis exécutées avec une concurrence
  // bornée : un dossier réel compte des dizaines de pièces sans URL — en
  // séquentiel, la passe n'aboutissait jamais en un clic.
  const jobs: { code: string; chapter: ChapterDef; batch: ChapterResult['documents'] }[] = []
  for (const [code, chapter] of Object.entries(result)) {
    const missing = chapter.documents.filter(searchable)
    if (!missing.length) continue
    // Lots de 6 produits max par appel agent : des lots plus petits donnent à
    // chaque produit un vrai budget de requêtes (meilleure couverture).
    for (let b = 0; b < missing.length; b += 6) {
      jobs.push({
        code,
        chapter: run.chapters[code] ?? { libelle: '', onglet: code, exigences: [] },
        batch: missing.slice(b, b + 6),
      })
    }
  }

  const runJob = async (job: (typeof jobs)[number]) => {
    try {
      const r = await searchMissingDocUrls({
        operation: (run.config.operation ?? []).join(' — '),
        lotLabel: run.lot_label,
        code: job.code,
        chapter: job.chapter,
        docs: job.batch.map((d) => ({
          designation: d.designation,
          marque: d.marque,
          reference: d.reference,
          type_document: d.type_document,
        })),
      })
      tokenUsage.inputTokens += r.usage.inputTokens
      tokenUsage.outputTokens += r.usage.outputTokens
      lastModel = r.model
      for (const t of r.trouvailles) {
        const doc = job.batch[t.n - 1]
        if (!doc || !/^https?:\/\/\S+$/i.test(t.url)) continue
        doc.url = t.url.slice(0, 2000)
        if (t.source) doc.source = t.source.slice(0, 500)
        doc.statut =
          'À VALIDER | URL trouvée en seconde passe — vérifier le document avant livraison'
        doc.filename = docFilename(doc)
        found++
      }
    } catch (e) {
      errors.push(
        `[${job.code}] ${e instanceof Error ? e.message : 'recherche en échec'}`.slice(0, 200),
      )
    }
  }

  const SEARCH_CONCURRENCY = 4
  for (let i = 0; i < jobs.length; i += SEARCH_CONCURRENCY) {
    await Promise.all(jobs.slice(i, i + SEARCH_CONCURRENCY).map(runJob))
  }
  const { inputTokens, outputTokens } = tokenUsage

  // Passe 3 — exploration directe des sites fabricants. Les moteurs de
  // recherche sont bloqués ou servent des leurres sur certains réseaux
  // d'entreprise : on va chercher les PDF à la source (domaine résolu par le
  // LLM, puis exploration de l'accueil / de la recherche interne du site).
  // Uniquement les fiches de PRODUITS fabricants (même définition que la
  // seconde passe) : une norme/DTU n'a pas de site fabricant à explorer.
  const crawlTargets = Object.values(result)
    .flatMap((r) => r.documents)
    .filter((d) => !d.url && isProductDocument(d))
    .slice(0, 24)
  if (crawlTargets.length) {
    // Cache de PROMESSES par marque : deux produits de la même marque
    // traités en parallèle partagent le même appel LLM au lieu de le doubler.
    const domainsByMarque = new Map<string, Promise<string[]>>()
    const crawlOne = async (doc: (typeof crawlTargets)[number]) => {
      try {
        const marque = doc.marque
        let domainsP = domainsByMarque.get(marque)
        if (!domainsP) {
          domainsP = resolveManufacturerDomains(
            marque,
            doc.designation,
            doc.reference === '—' ? '' : doc.reference,
          )
          domainsByMarque.set(marque, domainsP)
        }
        const domains = await domainsP
        const tokens = tokensOf(
          marque,
          doc.designation,
          doc.reference === '—' ? '' : doc.reference,
        )
        for (const domain of domains) {
          const pdfs = await discoverPdfsOnSite(domain, tokens)
          if (!pdfs.length) continue
          doc.url = pdfs[0].slice(0, 2000)
          doc.source = `Site fabricant (${new URL(domain).hostname})`
          doc.statut =
            'À VALIDER | URL trouvée par exploration du site fabricant — vérifier le document avant livraison'
          doc.filename = docFilename(doc)
          found++
          return
        }
      } catch (e) {
        errors.push(
          `[crawl] ${e instanceof Error ? e.message : 'échec'}`.slice(0, 200),
        )
      }
    }
    const CRAWL_CONCURRENCY = 3
    for (let i = 0; i < crawlTargets.length; i += CRAWL_CONCURRENCY) {
      await Promise.all(
        crawlTargets.slice(i, i + CRAWL_CONCURRENCY).map(crawlOne),
      )
    }
  }

  if (found) {
    // Nouvelles URL → nouveaux noms de fichiers : dédup globale sur tout le run.
    dedupeFilenames(result)
  }

  // Merge sur l'état frais : un téléchargement/recherche concurrent ne doit pas
  // être écrasé (même logique que downloadRunPdfs). L'identité est le contenu
  // du document (désignation+marque+référence+type + rang d'occurrence) — url
  // et filename ne peuvent PAS servir de clé : la 2e passe les modifie.
  const fresh = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  const mergedResult: Record<string, ChapterResult> = { ...(fresh?.result ?? {}) }
  const docKey = (d: ChapterResult['documents'][number]) =>
    [d.designation, d.marque, d.reference, d.type_document]
      .join('|')
      .toLowerCase()
  for (const [code, res] of Object.entries(result)) {
    const base = mergedResult[code] ?? res
    const counts = new Map<string, number>()
    const ours = new Map<string, ChapterResult['documents'][number]>()
    for (const d of res.documents) {
      const k = docKey(d)
      const n = counts.get(k) ?? 0
      counts.set(k, n + 1)
      ours.set(`${k}~${n}`, d)
    }
    counts.clear()
    const consumed = new Set<ChapterResult['documents'][number]>()
    const mergedDocs = base.documents.map((fd) => {
      const k = docKey(fd)
      const n = counts.get(k) ?? 0
      counts.set(k, n + 1)
      const mine = ours.get(`${k}~${n}`)
      if (mine) consumed.add(mine)
      // URL déjà présente côté frais (recherche concurrente) : ne pas écraser.
      if (!mine?.url || fd.url) return fd
      return {
        ...fd,
        url: mine.url,
        source: mine.source,
        statut: mine.statut,
        filename: mine.filename,
      }
    })
    // Lignes synthétisées (produit sans fiche) absentes de l'état frais : on
    // les ajoute telles quelles, avec l'URL trouvée s'il y en a une.
    for (const d of res.documents) {
      if (!consumed.has(d)) mergedDocs.push(d)
    }
    mergedResult[code] = { ...base, documents: mergedDocs }
  }

  const stillMissing = Object.values(mergedResult).reduce(
    (n, r) => n + r.documents.filter((d) => !d.url).length,
    0,
  )
  const stillPrescriptive = Object.values(mergedResult).reduce(
    (n, r) => n + r.documents.filter((d) => !d.url && !isProductDocument(d)).length,
    0,
  )
  const { error } = await ctx.supabase
    .from('tender_datasheet_runs')
    .update({
      result: mergedResult,
      model: lastModel,
      input_tokens: (fresh?.input_tokens ?? run.input_tokens ?? 0) + inputTokens,
      output_tokens: (fresh?.output_tokens ?? run.output_tokens ?? 0) + outputTokens,
      error: errors.length ? errors.join(' | ').slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
  if (error) return { error: 'Recherche terminée mais enregistrement impossible.' }
  // Distinguer « aucun document n'existe » de « les moteurs sont bloqués » :
  // sans ça, l'utilisateur croit que les fiches sont introuvables alors que la
  // recherche n'a simplement pas pu s'exécuter.
  const health = searchHealth()
  const searchDown = health.successes === 0 && health.failures > 0
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'datasheet_run.doc_search',
    entityType: 'tender',
    entityId: tenderId,
    metadata: {
      run_id: runId,
      found,
      missing: stillMissing,
      prescriptive: stillPrescriptive,
      search: health,
    },
  })
  revalidateTenderPages(orgSlug)
  if (searchDown) {
    return {
      error: health.apiError
        ? `Recherche web indisponible — l’API configurée (SEARCH_API_URL) a échoué : ${health.apiError}. Vérifiez SEARCH_API_KEY et l’URL du fournisseur.`
        : 'Recherche web indisponible : les moteurs gratuits sont temporairement limités ou bloqués. ' +
          'Réessayez dans quelques minutes, ou configurez SEARCH_API_URL dans .env.local ' +
          '(SearxNG auto-hébergé ou API Brave/Serper) pour une recherche fiable.',
    }
  }
  return {
    data: { found, missing: stillMissing, prescriptive: stillPrescriptive },
  }
}

// ============================ ÉTAPE 3 — TÉLÉCHARGEMENT DES PDF ============================

export async function downloadRunPdfs(
  orgSlug: string,
  tenderId: string,
  runId: string,
): Promise<{ data?: { ok: number; failed: number }; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const run = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  if (!run) return { error: 'Dossier introuvable.' }
  const folder = await tenderFolderOf(
    ctx.supabase,
    ctx.org.id,
    tenderId,
    `Fiches techniques/${shortenLotLabel(run.lot_label)}`,
  )
  if (!Object.keys(run.result).length) {
    return { error: 'Lancez d’abord les agents de recherche.' }
  }

  const report = { ...run.download_report }
  const result = { ...run.result }
  // Deux chapitres peuvent désigner le même produit → même nom de PDF.
  // Dédup globale avant tout téléchargement (clé du rapport et du stockage).
  dedupeFilenames(result)

  // Collecte de tous les PDF à télécharger, puis fetch parallèle borné —
  // le goulot est le réseau (jusqu'à 30 s de timeout par URL). Les écritures
  // storage/DB sont ensuite parallélisées par URL unique (voir plus bas).
  const pending: ChapterResult['documents'][number][] = []
  for (const [code, res] of Object.entries(result)) {
    const chapter: ChapterResult = { ...EMPTY_CHAPTER_RESULT, ...res }
    result[code] = chapter
    for (const doc of chapter.documents) {
      if (!doc.url || doc.filename === '—' || doc.downloaded) continue
      pending.push(doc)
    }
  }

  // Bibliothèque produits : un PDF officiel déjà téléchargé pour le même
  // produit (marque + référence + type, autre AO) est réutilisé — on rattache
  // le document existant au dossier au lieu de re-télécharger.
  const dedupKeyOf = (d: ChapterResult['documents'][number]) =>
    datasheetDedupKey(
      d.marque === '—' ? '' : d.marque,
      d.reference && d.reference !== '—' ? d.reference : d.designation,
      d.type_document,
    )
  const knownDocs = new Map<string, string>()
  const keys = [...new Set(pending.map(dedupKeyOf))]
  if (keys.length) {
    const { data: lib } = await ctx.supabase
      .from('datasheet_library')
      .select('dedup_key, document_id')
      .eq('organization_id', ctx.org.id)
      .in('dedup_key', keys)
    for (const r of lib ?? []) if (r.document_id) knownDocs.set(r.dedup_key, r.document_id)
  }
  let reused = 0
  const toFetch: ChapterResult['documents'][number][] = []
  const reuse: { doc: ChapterResult['documents'][number]; id: string }[] = []
  for (const doc of pending) {
    const existingId = knownDocs.get(dedupKeyOf(doc))
    if (!existingId) {
      toFetch.push(doc)
      continue
    }
    reuse.push({ doc, id: existingId })
  }
  if (reuse.length) {
    // Toutes les liaisons « réutilisées » en UN upsert — avant : un
    // aller-retour réseau par document. Dédupliqué par document_id : deux
    // lignes peuvent pointer vers le même PDF bibliothèque et un upsert
    // groupé échoue sur des clés de conflit dupliquées.
    const reuseLinks = [
      ...new Map(
        reuse.map((r) => [
          r.id,
          {
            organization_id: ctx.org.id,
            document_id: r.id,
            entity_type: 'tender',
            entity_id: tenderId,
          },
        ]),
      ).values(),
    ]
    const { error: reuseErr } = await ctx.supabase
      .from('document_links')
      .upsert(reuseLinks, { onConflict: 'document_id,entity_type,entity_id' })
    for (const { doc, id } of reuse) {
      doc.downloaded = true
      doc.document_id = id
      report[doc.filename] = {
        ok: true,
        document_id: id,
        reason: reuseErr
          ? 'Réutilisé mais liaison au dossier en échec'
          : 'Réutilisé depuis la bibliothèque de fiches',
      }
      reused++
    }
  }

  async function fetchWithRetry(url: string) {
    let dl = await fetchPdf(url)
    // L'agent renvoie parfois la PAGE produit au lieu du PDF : on la résout
    // (extraction des liens) avant de déclarer l'échec.
    if (!dl.data && /pas un PDF/i.test(dl.error ?? '')) {
      const viaPage = await resolvePdfFromPage(url)
      if (viaPage.data) {
        // Traçabilité : on retient l'URL réellement téléchargée.
        if (viaPage.url) resolvedFrom.set(url, viaPage.url)
        return viaPage
      }
    }
    // Un retry sur les erreurs transitoires (réseau, timeout, 429/5xx) —
    // pas sur les erreurs définitives (URL invalide, pas un PDF, 4xx).
    if (!dl.data && /réseau|timeout|abort|HTTP (429|5\d\d)/i.test(dl.error ?? '')) {
      await new Promise((r) => setTimeout(r, 1500))
      dl = await fetchPdf(url)
    }
    return dl
  }
  // URL demandée → URL réellement téléchargée (page produit résolue en PDF).
  const resolvedFrom = new Map<string, string>()
  // Deux documents peuvent partager la même URL officielle (ex. une fiche
  // couvrant deux produits) — le fetch n'est fait qu'une fois par URL.
  const fetchResults = new Map<string, Awaited<ReturnType<typeof fetchPdf>>>()
  const uniqueUrls = [...new Set(toFetch.map((d) => d.url!))]
  // 8 en parallèle : les PDF sont chez des fabricants différents — 6 restait
  // sous le seuil de saturation réseau observé sur les dossiers réels.
  const CONCURRENCY = 8
  for (let i = 0; i < uniqueUrls.length; i += CONCURRENCY) {
    const batch = uniqueUrls.slice(i, i + CONCURRENCY)
    const dls = await Promise.all(batch.map((url) => fetchWithRetry(url)))
    batch.forEach((url, j) => fetchResults.set(url, dls[j]))
  }
  const downloads = new Map<ChapterResult['documents'][number], Awaited<ReturnType<typeof fetchPdf>>>()
  for (const doc of toFetch) {
    const dl = fetchResults.get(doc.url!)
    if (dl) downloads.set(doc, dl)
  }

  let ok = 0
  let failed = 0

  // Même URL officielle partagée par plusieurs documents → un seul fichier
  // en stockage, un lien par document (pas de doublon ni en bibliothèque).
  type DlResult = Awaited<ReturnType<typeof fetchPdf>>
  const groups = new Map<
    string,
    { dl: DlResult; docs: ChapterResult['documents'] }
  >()
  for (const res of Object.values(result)) {
    for (const doc of res.documents) {
      const dl = downloads.get(doc)
      if (!dl) continue
      if (!dl.data) {
        doc.download_error = dl.error ?? 'échec'
        report[doc.filename] = { ok: false, reason: dl.error }
        failed++
        continue
      }
      const g = groups.get(doc.url!) ?? { dl, docs: [] }
      g.docs.push(doc)
      groups.set(doc.url!, g)
    }
  }

  // Upload + insert + lien + bibliothèque PAR URL : 4 appels séquentiels × N
  // pièces en série plafonnaient l'étape — les jobs sont indépendants, on les
  // parallèle à 4 (storage et PostgREST encaissent sans contention).
  const storeOne = async (
    url: string,
    g: { dl: DlResult; docs: ChapterResult['documents'] },
  ) => {
    const { dl, docs } = g
    const first = docs[0]
    const docId = crypto.randomUUID()
    const storagePath = `org_${ctx.org.id}/datasheets/${runId}/${docId}-${storageSafeName(sanitizeFilename(first.filename))}`
    const { error: upErr } = await ctx.supabase.storage
      .from('documents')
      .upload(storagePath, dl.data!, { contentType: 'application/pdf' })
    if (upErr) {
      // Le message réel (InvalidKey, quota, policy…) doit rester visible —
      // « upload impossible » seul ne permettait pas le diagnostic.
      const reason = `upload impossible (${upErr.message.slice(0, 120)})`
      for (const doc of docs) {
        doc.download_error = reason
        report[doc.filename] = { ok: false, reason }
        failed++
      }
      return
    }
    const { error: dbErr } = await ctx.supabase.from('documents').insert({
      id: docId,
      organization_id: ctx.org.id,
      name: first.filename.slice(0, 300),
      folder_path: folder,
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: dl.size!,
      category: 'technique',
      document_type: first.type_document,
      uploaded_by: ctx.user.id,
    })
    if (dbErr) {
      await ctx.supabase.storage.from('documents').remove([storagePath])
      for (const doc of docs) {
        doc.download_error = 'enregistrement impossible'
        report[doc.filename] = { ok: false, reason: 'enregistrement impossible' }
        failed++
      }
      return
    }
    // Tous les documents du groupe pointent vers le même PDF : une seule
    // liaison document ↔ dossier (plusieurs lignes identiques dans le même
    // upsert échoueraient sur la clé de conflit).
    const { error: linkErr } = await ctx.supabase
      .from('document_links')
      .upsert(
        {
          organization_id: ctx.org.id,
          document_id: docId,
          entity_type: 'tender',
          entity_id: tenderId,
        },
        { onConflict: 'document_id,entity_type,entity_id' },
      )
    const direct = resolvedFrom.get(url)
    for (const doc of docs) {
      doc.downloaded = true
      doc.document_id = docId
      doc.download_error = undefined
      report[doc.filename] = {
        ok: true,
        document_id: docId,
        size: dl.size,
        // Le PDF est bien en stockage ; une liaison en échec doit rester
        // visible (sinon le fichier n'apparaît pas dans l'onglet Documents).
        ...(linkErr
          ? { reason: 'PDF téléchargé mais liaison au dossier en échec' }
          : doc !== first
            ? { reason: 'Même PDF officiel qu’un autre document — partagé' }
            : direct
              ? { reason: 'PDF extrait de la page produit officielle' }
              : {}),
      }
      ok++
    }
    // Enrichit la bibliothèque produits — le même produit cité dans un
    // autre AO réutilisera ce PDF sans re-téléchargement.
    await upsertLibraryEntry(ctx.supabase, ctx.org.id, ctx.user.id, {
      designation: first.designation,
      brand: first.marque === '—' ? '' : first.marque,
      reference:
        first.reference && first.reference !== '—'
          ? first.reference
          : first.designation,
      doc_type: first.type_document,
      theme:
        run.chapters[first.chap]?.libelle ??
        run.chapters[first.chap]?.onglet ??
        null,
      source_url: url || null,
      statut: first.statut?.split('|')[0].trim() || 'OK',
      document_id: docId,
    })
  }

  const WRITE_CONCURRENCY = 4
  const writeJobs = [...groups.entries()]
  for (let i = 0; i < writeJobs.length; i += WRITE_CONCURRENCY) {
    await Promise.all(
      writeJobs
        .slice(i, i + WRITE_CONCURRENCY)
        .map(([url, g]) => storeOne(url, g)),
    )
  }

  // Lost update : la boucle de téléchargement peut durer longtemps — une
  // recherche de chapitre terminée entre-temps aurait réécrit `result`.
  // On recopie nos drapeaux de téléchargement sur l'état frais (clé : url,
  // repli : filename).
  const fresh = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  const mergedResult: Record<string, ChapterResult> = { ...(fresh?.result ?? {}) }
  for (const [code, res] of Object.entries(result)) {
    const base = mergedResult[code] ?? res
    const ours = new Map(
      res.documents.map((d) => [d.url || d.filename, d] as const),
    )
    mergedResult[code] = {
      ...base,
      documents: base.documents.map((fd) => {
        const mine = ours.get(fd.url || fd.filename)
        if (!mine) return fd
        return {
          ...fd,
          downloaded: mine.downloaded,
          download_error: mine.download_error,
          document_id: mine.document_id ?? fd.document_id,
        }
      }),
    }
  }
  // Une page produit résolue en PDF : on retient l'URL du PDF réellement
  // téléchargé (traçabilité) et on signale la résolution dans la source.
  for (const res of Object.values(mergedResult)) {
    for (const d of res.documents) {
      const direct = d.url ? resolvedFrom.get(d.url) : undefined
      if (!direct) continue
      d.url = direct
      if (!/page produit/i.test(d.source)) {
        d.source = `${d.source} (PDF extrait de la page produit)`.slice(0, 500)
      }
    }
  }
  await ctx.supabase
    .from('tender_datasheet_runs')
    .update({
      // 'downloaded' seulement si au moins un PDF est présent (téléchargé
      // ou réutilisé depuis la bibliothèque produits).
      status: ok + reused > 0 ? 'downloaded' : 'researched',
      result: mergedResult,
      download_report: report,
      error:
        failed > 0
          ? `${failed} PDF non téléchargé(s) — voir les erreurs par document.`
          : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'datasheet_run.downloaded',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { run_id: runId, ok, failed, reused },
  })
  revalidateTenderPages(orgSlug)
  revalidatePath(`/${orgSlug}/documents`)
  revalidatePath(`/${orgSlug}/fiches`)
  return { data: { ok: ok + reused, failed } }
}

// ============================ ÉTAPE 4 — LIVRABLES ============================

export async function exportRunDeliverables(
  orgSlug: string,
  tenderId: string,
  runId: string,
): Promise<{ data?: { files: string[]; failed: string[] }; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const run = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  if (!run) return { error: 'Dossier introuvable.' }
  const folder = await tenderFolderOf(
    ctx.supabase,
    ctx.org.id,
    tenderId,
    `Fiches techniques/${shortenLotLabel(run.lot_label)}`,
  )
  if (!Object.keys(run.result).length)
    return { error: 'Aucun résultat de recherche.' }

  // Régénération : supprimer les livrables précédents pour ne pas empiler des
  // classeurs/ZIP obsolètes. Le nettoyage se fait par PRÉFIXE de stockage
  // (`org_<id>/datasheets/<runId>/`) et non par la seule liste
  // `deliverable_document_ids` : des exports antérieurs non tracés laissaient
  // des doublons (5 ZIP identiques observés).
  // ATTENTION : ne cibler QUE les livrables générés — les PDF de fiches
  // téléchargés vivent sous le même préfixe et ne doivent JAMAIS être
  // supprimés ici (bug corrigé : un filtre « tout sauf Livrable_importe »
  // effaçait toutes les fiches à chaque export).
  const { data: underRun } = await ctx.supabase
    .from('documents')
    .select('id, storage_path, document_type')
    .eq('organization_id', ctx.org.id)
    .like('storage_path', `%${DATASHEET_RUN_PREFIX(runId)}%`)
  const stale = (underRun ?? []).filter(
    (d) =>
      d.document_type === 'Classeur_DCR' ||
      d.document_type === 'Arborescence_livraison',
  )

  // Livrables d'exports antérieurs pour le MÊME lot mais un autre run/préfixe
  // (re-création du dossier de fiches, ancien nommage) : un seul jeu
  // classeur+ZIP par lot — sinon l'onglet Documents se remplit de doublons
  // identiques (6 paires observées sur le run Laval). Les livrables importés
  // à la main sont préservés (type différent).
  const { number: lotNumber } = parseLotLabel(run.lot_label)
  const { data: tenderLinks } = await ctx.supabase
    .from('document_links')
    .select('document_id')
    .eq('organization_id', ctx.org.id)
    .eq('entity_type', 'tender')
    .eq('entity_id', tenderId)
  const linkedIds = (tenderLinks ?? []).map((l) => l.document_id).slice(0, 400)
  if (lotNumber != null && linkedIds.length) {
    const { data: staleOther } = await ctx.supabase
      .from('documents')
      .select('id, name, storage_path, document_type')
      .eq('organization_id', ctx.org.id)
      .in('id', linkedIds)
      .in('document_type', ['Classeur_DCR', 'Arborescence_livraison'])
      // « LOT 01 - … », « Lot 01 - … » (ancien nommage) et « Fiche technique -
      // Lot 01 » / « Fiches techniques - Lot 01 » (nommage court) — ilike
      // pré-filtre, le regex JS retient le numéro de lot exact.
      .ilike('name', `%lot ${String(lotNumber).padStart(2, '0')}%`)
      .not('storage_path', 'like', `%${DATASHEET_RUN_PREFIX(runId)}%`)
    const lotRe = new RegExp(
      `\\blot\\s*0*${lotNumber}(?!\\d)`,
      'i',
    )
    for (const d of staleOther ?? []) {
      if (lotRe.test(d.name) && !stale.some((s) => s.id === d.id)) stale.push(d)
    }
  }

  if (stale.length) {
    await ctx.supabase.storage
      .from('documents')
      .remove(stale.map((d) => d.storage_path))
    await ctx.supabase
      .from('documents')
      .delete()
      .eq('organization_id', ctx.org.id)
      .in('id', stale.map((d) => d.id))
  }

  // Contenu des PDF téléchargés (pour le ZIP) — clé : doc.filename. Les docs
  // qui partagent un même document_id (même URL officielle) reçoivent chacun
  // leur entrée pour figurer dans l'arborescence.
  const pdfs = new Map<string, Uint8Array>()
  const docIds = new Set<string>()
  for (const r of Object.values(run.download_report)) {
    if (r.document_id) docIds.add(r.document_id)
  }
  for (const res of Object.values(run.result)) {
    for (const d of res.documents ?? []) {
      if (d.document_id) docIds.add(d.document_id)
    }
  }
  if (docIds.size) {
    const { data: docs } = await ctx.supabase
      .from('documents')
      .select('id, name, storage_path')
      .eq('organization_id', ctx.org.id)
      .in('id', [...docIds])
    const bytesById = new Map<string, Uint8Array>()
    const nameById = new Map<string, string>()
    // Téléchargements storage par lots de 6 : des dizaines de PDF en série
    // (~200-500 ms chacun) faisaient de l'export l'étape la plus lente.
    const docRows = docs ?? []
    const DL_CONCURRENCY = 6
    for (let i = 0; i < docRows.length; i += DL_CONCURRENCY) {
      await Promise.all(
        docRows.slice(i, i + DL_CONCURRENCY).map(async (d) => {
          const { data: blob } = await ctx.supabase.storage
            .from('documents')
            .download(d.storage_path)
          if (blob) {
            bytesById.set(d.id, new Uint8Array(await blob.arrayBuffer()))
            nameById.set(d.id, d.name)
          }
        }),
      )
    }
    for (const res of Object.values(run.result)) {
      for (const d of res.documents ?? []) {
        const bytes = d.document_id ? bytesById.get(d.document_id) : undefined
        if (bytes && d.filename !== '—') pdfs.set(d.filename, bytes)
      }
    }
  }

  // Dédup globale des noms de PDF (même produit cité dans deux chapitres) —
  // les chemins du ZIP et l'index du classeur doivent rester uniques.
  dedupeFilenames(run.result)
  const variantes = run.config.variantes?.length ? run.config.variantes : ['']
  // Nom de lot court : le libellé complet (liste des corps d'état) donnait un
  // ZIP de 153 caractères.
  const base = sanitizeFilename(shortenLotLabel(run.lot_label))
  const created: string[] = []
  const failed: string[] = []
  const deliverables: { id: string; name: string }[] = []

  // Stats d'intégrité : conservées dans la config du run pour que le panneau
  // affiche la couverture réelle au moment de l'export (produits analysés,
  // documents recherchés, URL trouvées, PDF livrés).
  const allDocs = Object.values(run.result).flatMap((r) => r.documents ?? [])
  const productDocs = allDocs.filter((d) => isProductDocument(d))
  const stats = {
    produits: Object.values(run.result).reduce(
      (n, r) => n + (r.produits?.length ?? 0),
      0,
    ),
    documents: allDocs.length,
    avecUrl: allDocs.filter((d) => d.url).length,
    pdfLivres: allDocs.filter((d) => d.downloaded || d.document_id).length,
    sansUrl: allDocs.filter((d) => !d.url).length,
    /** Fiches fabricants (téléchargeables) vs prescriptions CCTP/normes. */
    fichesFabricants: productDocs.length,
    fichesFabricantsLivrees: productDocs.filter(
      (d) => d.downloaded || d.document_id,
    ).length,
    prescriptions: allDocs.filter((d) => !isProductDocument(d)).length,
    pdfsEmbarques: pdfs.size,
    /** Contrôle d'intégrité : PDF livrés vs PDF réellement embarqués dans le
     *  ZIP — un écart signale un document livré non repris dans la livraison. */
    pdfsAttendus: allDocs.filter(
      (d) => (d.downloaded || d.document_id) && d.filename !== '—',
    ).length,
    exporteLe: new Date().toISOString(),
  }

  for (const variante of variantes) {
    const classeurName = classeurFilename(
      run.lot_label,
      variante,
      run.config.operationShort,
    )
    const classeur = await buildWorkbook({
      operation: run.config.operation ?? [],
      variante,
      lotLabel: run.lot_label,
      chapitres: run.chapters,
      results: run.result,
      downloaded: new Set(
        Object.entries(run.download_report)
          .filter(([, r]) => r.ok)
          .map(([f]) => f),
      ),
    })

    const zip = buildDeliveryZip({
      dossierLot: base,
      variante,
      operation: run.config.operation ?? [],
      classeurFilename: classeurName,
      classeur,
      chapitres: run.chapters,
      results: run.result,
      pdfs,
    })
    const zipName = sanitizeFilename(
      `Fiches techniques - ${lotShortLabel(run.lot_label)}${variante ? ` - ${variante}` : ''}.zip`,
    )

    for (const [name, bytes, mime, docType] of [
      [
        classeurName,
        new Uint8Array(classeur),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Classeur_DCR',
      ],
      [zipName, zip, 'application/zip', 'Arborescence_livraison'],
    ] as const) {
      const docId = crypto.randomUUID()
      const storagePath = `org_${ctx.org.id}/datasheets/${runId}/${docId}-${storageSafeName(name)}`
      const { error: upErr } = await ctx.supabase.storage
        .from('documents')
        .upload(storagePath, bytes, { contentType: mime })
      if (upErr) {
        failed.push(`${name} : échec upload`)
        continue
      }
      const { error: dbErr } = await ctx.supabase.from('documents').insert({
        id: docId,
        organization_id: ctx.org.id,
        name: name.slice(0, 300),
        folder_path: folder,
        storage_path: storagePath,
        mime_type: mime,
        size_bytes: bytes.byteLength,
        category: 'technique',
        document_type: docType,
        uploaded_by: ctx.user.id,
      })
      if (dbErr) {
        await ctx.supabase.storage.from('documents').remove([storagePath])
        failed.push(`${name} : échec enregistrement`)
        continue
      }
      const { error: linkErr } = await ctx.supabase.from('document_links').upsert(
        {
          organization_id: ctx.org.id,
          document_id: docId,
          entity_type: 'tender',
          entity_id: tenderId,
        },
        { onConflict: 'document_id,entity_type,entity_id' },
      )
      if (linkErr) {
        failed.push(`${name} : stocké mais non lié au dossier`)
        continue
      }
      created.push(name)
      deliverables.push({ id: docId, name })
    }
  }

  if (!created.length) return { error: 'Aucun livrable généré.' }
  await ctx.supabase
    .from('tender_datasheet_runs')
    .update({
      deliverable_document_ids: deliverables.map((d) => d.id),
      result: run.result,
      config: { ...run.config, deliverables, deliverable_stats: stats },
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'datasheet_run.exported',
    entityType: 'tender',
    entityId: tenderId,
    metadata: {
      run_id: runId,
      files: created,
      failed,
      stats,
      // Écart ZIP/livrés : remonté dans l'audit plutôt que silencieux.
      ...(stats.pdfsEmbarques < stats.pdfsAttendus
        ? {
            integrity: `ZIP: ${stats.pdfsEmbarques} PDF embarqués / ${stats.pdfsAttendus} livrés`,
          }
        : {}),
    },
  })
  revalidateTenderPages(orgSlug)
  return { data: { files: created, failed } }
}

/** Importe un livrable déjà produit hors pipeline (classeur .xlsx, ZIP
 *  d'arborescence, PDF) et l'ajoute aux livrables du dossier de fiches. */
export async function importDatasheetDeliverable(
  orgSlug: string,
  tenderId: string,
  runId: string,
  formData: FormData,
): Promise<{ data?: { filename: string }; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const run = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  if (!run) return { error: 'Dossier introuvable.' }
  const folder = await tenderFolderOf(
    ctx.supabase,
    ctx.org.id,
    tenderId,
    `Fiches techniques/${shortenLotLabel(run.lot_label)}`,
  )

  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'Fichier manquant.' }
  const okExt = /\.(zip|xlsx|pdf)$/i.test(file.name)
  if (!okExt) return { error: 'Formats acceptés : .zip, .xlsx, .pdf' }
  if (file.size <= 0 || file.size > 25 * 1024 * 1024) {
    return { error: 'Taille maximale : 25 Mo.' }
  }

  const name = file.name.slice(0, 300)
  const docId = crypto.randomUUID()
  const storagePath = `org_${ctx.org.id}/datasheets/${runId}/${docId}-${file.name.replace(/[^\w.()-]/g, '_')}`
  const mime =
    file.type ||
    (file.name.endsWith('.zip')
      ? 'application/zip'
      : file.name.endsWith('.pdf')
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

  const { error: upErr } = await ctx.supabase.storage
    .from('documents')
    .upload(storagePath, file, { contentType: mime })
  if (upErr) return { error: 'Échec de l’envoi du fichier.' }

  const { error: dbErr } = await ctx.supabase.from('documents').insert({
    id: docId,
    organization_id: ctx.org.id,
    name,
    folder_path: folder,
    storage_path: storagePath,
    mime_type: mime,
    size_bytes: file.size,
    category: 'technique',
    document_type: 'Livrable_importe',
    uploaded_by: ctx.user.id,
  })
  if (dbErr) {
    await ctx.supabase.storage.from('documents').remove([storagePath])
    return { error: 'Échec de l’enregistrement du document.' }
  }
  const { error: linkErr } = await ctx.supabase.from('document_links').upsert(
    {
      organization_id: ctx.org.id,
      document_id: docId,
      entity_type: 'tender',
      entity_id: tenderId,
    },
    { onConflict: 'document_id,entity_type,entity_id' },
  )
  if (linkErr) {
    // Stocké mais invisible dans l'onglet du dossier : mieux vaut échouer
    // proprement que laisser un livrable orphelin.
    await ctx.supabase.from('documents').delete().eq('id', docId)
    await ctx.supabase.storage.from('documents').remove([storagePath])
    return { error: 'Échec de la liaison du livrable au dossier.' }
  }

  const deliverables = [...(run.config.deliverables ?? []), { id: docId, name }]
  await ctx.supabase
    .from('tender_datasheet_runs')
    .update({
      deliverable_document_ids: [...run.deliverable_document_ids, docId],
      config: { ...run.config, deliverables },
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'datasheet_run.deliverable_imported',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { run_id: runId, filename: name },
  })
  revalidateTenderPages(orgSlug)
  revalidatePath(`/${orgSlug}/documents`)
  return { data: { filename: name } }
}

// ============ FALLBACK MANUEL — RATTACHER UNE FICHE À UNE LIGNE ============

const attachSchema = z.object({
  code: z.string().min(1).max(10),
  docIndex: z.coerce.number().int().min(0).max(500),
  url: z.string().max(2000).optional().or(z.literal('')),
})

/**
 * Dernier recours, garanti : rattache une fiche technique à un document
 * précis du run — soit par import de fichier (PDF téléchargé à la main), soit
 * par URL. Sans ce fallback, une fiche introuvable par les agents restait
 * définitivement absente du classeur et de l'arborescence.
 */
export async function attachDatasheetDocument(
  orgSlug: string,
  tenderId: string,
  runId: string,
  formData: FormData,
): Promise<{ data?: { filename: string }; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const run = await loadRun(ctx.supabase, ctx.org.id, tenderId, runId)
  if (!run) return { error: 'Dossier introuvable.' }
  const parsed = attachSchema.safeParse({
    code: formData.get('code'),
    docIndex: formData.get('docIndex'),
    url: formData.get('url') ?? '',
  })
  if (!parsed.success) return { error: 'Requête invalide.' }
  const { code, docIndex, url } = parsed.data

  const result: Record<string, ChapterResult> = { ...run.result }
  const chapter: ChapterResult = { ...EMPTY_CHAPTER_RESULT, ...result[code] }
  const doc = chapter.documents[docIndex]
  if (!doc) return { error: 'Document introuvable dans ce chapitre.' }

  // 1. Récupération du contenu : fichier importé, sinon URL.
  const file = formData.get('file')
  let bytes: Uint8Array | null = null
  let sourceLabel = ''
  let resolvedUrl: string = url ?? ''
  if (file instanceof File && file.size > 0) {
    if (file.size > 25 * 1024 * 1024) return { error: 'Taille maximale : 25 Mo.' }
    bytes = new Uint8Array(await file.arrayBuffer())
    sourceLabel = 'Fiche importée manuellement'
  } else if (url) {
    let dl = await fetchPdf(url)
    if (!dl.data && /pas un PDF/i.test(dl.error ?? '')) {
      const viaPage = await resolvePdfFromPage(url)
      if (viaPage.data) {
        dl = viaPage
        resolvedUrl = viaPage.url ?? url
      }
    }
    if (!dl.data) return { error: `Téléchargement impossible : ${dl.error}` }
    bytes = dl.data
    sourceLabel = 'URL fournie manuellement'
  } else {
    return { error: 'Fournissez un fichier PDF ou une URL.' }
  }

  // 2. Validation PDF (%PDF) — le fichier doit être une vraie fiche.
  if (
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46
  ) {
    return { error: 'Le document fourni n’est pas un PDF valide.' }
  }

  const filename = doc.filename !== '—' ? doc.filename : docFilename(doc)
  const folder = await tenderFolderOf(
    ctx.supabase,
    ctx.org.id,
    tenderId,
    `Fiches techniques/${shortenLotLabel(run.lot_label)}`,
  )
  const docId = crypto.randomUUID()
  const storagePath = `org_${ctx.org.id}/datasheets/${runId}/${docId}-${storageSafeName(sanitizeFilename(filename))}`
  const { error: upErr } = await ctx.supabase.storage
    .from('documents')
    .upload(storagePath, bytes, { contentType: 'application/pdf' })
  if (upErr) return { error: `Stockage impossible (${upErr.message.slice(0, 120)})` }
  const { error: dbErr } = await ctx.supabase.from('documents').insert({
    id: docId,
    organization_id: ctx.org.id,
    name: filename.slice(0, 300),
    folder_path: folder,
    storage_path: storagePath,
    mime_type: 'application/pdf',
    size_bytes: bytes.byteLength,
    category: 'technique',
    document_type: doc.type_document,
    uploaded_by: ctx.user.id,
  })
  if (dbErr) {
    await ctx.supabase.storage.from('documents').remove([storagePath])
    return { error: 'Enregistrement du document impossible.' }
  }
  const { error: linkErr } = await ctx.supabase.from('document_links').upsert(
    {
      organization_id: ctx.org.id,
      document_id: docId,
      entity_type: 'tender',
      entity_id: tenderId,
    },
    { onConflict: 'document_id,entity_type,entity_id' },
  )
  if (linkErr) {
    await ctx.supabase.from('documents').delete().eq('id', docId)
    await ctx.supabase.storage.from('documents').remove([storagePath])
    return { error: 'Liaison au dossier impossible.' }
  }

  // 3. Mise à jour du run : la ligne devient « livrée ».
  doc.filename = filename
  doc.url = resolvedUrl
  doc.source = `${sourceLabel}${doc.source ? ` — ${doc.source}` : ''}`.slice(0, 500)
  doc.statut = 'OK | document fourni et vérifié manuellement'
  doc.downloaded = true
  doc.document_id = docId
  doc.download_error = undefined
  chapter.documents[docIndex] = doc
  result[code] = chapter
  const report = {
    ...run.download_report,
    [filename]: {
      ok: true,
      document_id: docId,
      size: bytes.byteLength,
      reason: sourceLabel,
    },
  }
  await ctx.supabase
    .from('tender_datasheet_runs')
    .update({
      result,
      download_report: report,
      status: 'downloaded',
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
  // Bibliothèque : la fiche importée est réutilisable sur les autres AO.
  await upsertLibraryEntry(ctx.supabase, ctx.org.id, ctx.user.id, {
    designation: doc.designation,
    brand: doc.marque === '—' ? '' : doc.marque,
    reference:
      doc.reference && doc.reference !== '—' ? doc.reference : doc.designation,
    doc_type: doc.type_document,
    theme: run.chapters[doc.chap]?.libelle ?? run.chapters[doc.chap]?.onglet ?? null,
    source_url: resolvedUrl || null,
    statut: 'OK',
    document_id: docId,
  })
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'datasheet_run.document_attached',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { run_id: runId, code, doc_index: docIndex, filename, via: sourceLabel },
  })
  revalidateTenderPages(orgSlug)
  revalidatePath(`/${orgSlug}/documents`)
  revalidatePath(`/${orgSlug}/fiches`)
  return { data: { filename } }
}

// ============================ SUPPRESSION ============================

export async function deleteDatasheetRun(
  orgSlug: string,
  tenderId: string,
  runId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'admin')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_datasheet_runs')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', runId)
  if (error) return fail(error)
  // Nettoie les fichiers produits par le run (PDF téléchargés, classeurs,
  // ZIP, livrables importés) — tous stockés sous org_<id>/datasheets/<run>/.
  const { data: files } = await ctx.supabase
    .from('documents')
    .select('id, storage_path')
    .eq('organization_id', ctx.org.id)
    .like('storage_path', `%/datasheets/${runId}/%`)
  const paths = (files ?? []).map((f) => f.storage_path)
  if (paths.length) {
    await ctx.supabase.storage.from('documents').remove(paths)
    await ctx.supabase
      .from('documents')
      .delete()
      .eq('organization_id', ctx.org.id)
      .in('id', (files ?? []).map((f) => f.id))
  }
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'datasheet_run.deleted',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { run_id: runId },
  })
  revalidateTenderPages(orgSlug)
  return { success: true }
}
