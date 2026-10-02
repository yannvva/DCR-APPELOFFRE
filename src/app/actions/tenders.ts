'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { revalidateTenderPages } from '@/lib/revalidate'
import type { SupabaseClient } from '@supabase/supabase-js'
import { importTenderFromUrl, normalizeHttpUrl, type TenderImport } from '@/lib/tender-import'
import { analyzeRcDocument, type RcAnalysis } from '@/lib/rc-analysis'
import { requireMembership } from '@/lib/dal/auth'
import { notifyUsers } from '@/lib/dal/notifications'
import { audit } from '@/lib/audit'
import { completeJson } from '@/lib/ai/deepseek'
import { normalizeAnalysis } from '@/lib/dce/normalize'
import {
  attachCompanyDocsToChecklist,
  syncChecklistItems,
} from '@/lib/checklist-attach'
import {
  checklistItemSchema,
  submissionSchema,
  tenderLotSchema,
  tenderResultSchema,
  tenderSchema,
} from '@/lib/validation/domain'
import type { ActionState } from '@/lib/validation/auth'
import type { ChecklistItemStatus, TenderStatus } from '@/lib/types'

function fail(e: unknown, fallback = 'Une erreur est survenue.'): NonNullable<ActionState> {
  const msg = e instanceof Error ? e.message : fallback
  return { error: msg === 'Accès refusé' ? msg : fallback }
}

const toIso = (d: string | undefined | null) => (d ? new Date(d).toISOString() : null)
const toCents = (euros: number | '' | undefined) =>
  euros === '' || euros == null ? null : Math.round(euros * 100)

// ============================ TENDERS ============================

export async function fetchTenderFromUrl(
  orgSlug: string,
  url: string,
): Promise<{ data?: TenderImport; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsedUrl = normalizeHttpUrl(url)
  if (!parsedUrl) return { error: 'URL invalide.' }
  try {
    const data = await importTenderFromUrl(parsedUrl.toString())
    if (!data.title && !data.responseDeadline) {
      return {
        error:
          'Extraction impossible — la page ne contient pas d’informations exploitables (ou nécessite une connexion).',
      }
    }
    return { data }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Échec de la récupération de la page.' }
  }
}

// ============================ ANALYSE RC ============================

export async function analyzeTenderDocument(
  orgSlug: string,
  documentId: string,
): Promise<{ data?: RcAnalysis; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  try {
    const data = await analyzeRcDocument(ctx.supabase, ctx.org.id, documentId)
    return { data }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Échec de l\'analyse.' }
  }
}

// ============================ TENDERS ============================

const normBuyer = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Acheteur : id fourni → compte existant par nom → création du compte.
 *  Les avis importés donnent un nom, pas un id : sans cela l'acheteur
 *  finissait en texte libre dans les notes. */
async function resolveBuyerAccountId(
  ctx: { supabase: SupabaseClient; org: { id: string }; user: { id: string } },
  buyerAccountId: string | '' | undefined,
  buyerName: string | '' | undefined,
): Promise<string | null> {
  if (buyerAccountId) return buyerAccountId
  const name = buyerName?.trim()
  if (!name) return null
  const { data: accounts } = await ctx.supabase
    .from('accounts')
    .select('id, name')
    .eq('organization_id', ctx.org.id)
    .limit(200)
  const n = normBuyer(name)
  const match = (accounts ?? []).find(
    (a) => normBuyer(a.name).includes(n) || n.includes(normBuyer(a.name)),
  )
  if (match) return match.id
  const { data: created } = await ctx.supabase
    .from('accounts')
    .insert({
      organization_id: ctx.org.id,
      name: name.slice(0, 200),
      created_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (created) {
    await audit(ctx.supabase, {
      organizationId: ctx.org.id,
      action: 'account.created',
      entityType: 'account',
      entityId: created.id,
      metadata: { name: name.slice(0, 200), origin: 'tender_import' },
    })
  }
  return created?.id ?? null
}

export async function createTender(orgSlug: string, input: unknown): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = tenderSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data
  const buyerAccountId = await resolveBuyerAccountId(ctx, d.buyerAccountId, d.buyerName)

  const { data, error } = await ctx.supabase.rpc('create_tender', {
    p_payload: {
      organization_id: ctx.org.id,
      title: d.title,
      reference: d.reference || null,
      buyer_account_id: buyerAccountId,
      platform: d.platform || null,
      dce_url: d.dceUrl || null,
      published_at: d.publishedAt || null,
      response_deadline: toIso(d.responseDeadline),
      questions_deadline: toIso(d.questionsDeadline),
      site_visit_at: toIso(d.siteVisitAt),
      site_visit_mandatory: d.siteVisitMandatory,
      procedure_type: d.procedureType || null,
      market_type: d.marketType || null,
      duration_months: d.durationMonths || null,
      estimated_amount_cents: toCents(d.estimatedAmountEuros),
      region: d.region || null,
      award_criteria: {
        ...(d.priceWeight !== '' && d.priceWeight != null ? { prix: d.priceWeight } : {}),
        ...(d.technicalWeight !== '' && d.technicalWeight != null
          ? { technique: d.technicalWeight }
          : {}),
      },
      deposit_mode: d.depositMode || null,
      responsible_id: d.responsibleId || null,
      notes: d.notes || null,
      lots: d.lots.map((l) => ({
        number: l.number,
        title: l.title,
        amount_cents: toCents(l.amountEuros),
      })),
    },
  })

  if (error) return fail(error, 'Erreur lors de la création de l’appel d’offres.')
  // Rattache d'emblée les pièces du kit candidature société (Kbis, URSSAF,
  // attestations, DC1/DC2…) aux lignes de checklist correspondantes.
  // Best-effort : une erreur ici ne doit pas masquer la création du dossier.
  let attached = 0
  try {
    ;({ attached } = await attachCompanyDocsToChecklist(
      ctx.supabase,
      ctx.org.id,
      data as string,
      ctx.user.id,
    ))
  } catch {
    // noop — le bouton « Rattacher les pièces société » permet de rejouer
  }
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'tender.created',
    entityType: 'tender',
    entityId: data as string,
    metadata: { title: d.title, reference: d.reference, kit_docs_attached: attached },
  })
  revalidatePath(`/${orgSlug}/tenders`)
  return { success: true, id: data as string }
}

export async function updateTender(
  orgSlug: string,
  id: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = tenderSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data
  const buyerAccountId = await resolveBuyerAccountId(ctx, d.buyerAccountId, d.buyerName)

  const { error } = await ctx.supabase
    .from('tenders')
    .update({
      title: d.title,
      reference: d.reference || null,
      buyer_account_id: buyerAccountId,
      platform: d.platform || null,
      dce_url: d.dceUrl || null,
      published_at: d.publishedAt || null,
      response_deadline: toIso(d.responseDeadline),
      questions_deadline: toIso(d.questionsDeadline),
      site_visit_at: toIso(d.siteVisitAt),
      site_visit_mandatory: d.siteVisitMandatory,
      procedure_type: d.procedureType || null,
      market_type: d.marketType || null,
      duration_months: d.durationMonths || null,
      estimated_amount_cents: toCents(d.estimatedAmountEuros),
      region: d.region || null,
      award_criteria: {
        ...(d.priceWeight !== '' && d.priceWeight != null ? { prix: d.priceWeight } : {}),
        ...(d.technicalWeight !== '' && d.technicalWeight != null
          ? { technique: d.technicalWeight }
          : {}),
      },
      deposit_mode: d.depositMode || null,
      responsible_id: d.responsibleId || null,
      notes: d.notes || null,
    })
    .eq('organization_id', ctx.org.id)
    .eq('id', id)

  if (error) return fail(error)
  revalidatePath(`/${orgSlug}/tenders`)
  revalidateTenderPages(orgSlug)
  return { success: true }
}

const TENDER_STATUSES: TenderStatus[] = [
  'detecte',
  'analyse',
  'en_preparation',
  'a_deposer',
  'depose',
  'gagne',
  'perdu',
  'abandonne',
  'annule',
]

export async function setTenderStatus(
  orgSlug: string,
  id: string,
  status: TenderStatus,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!TENDER_STATUSES.includes(status)) return { error: 'Statut invalide.' }

  // Règle métier : « prêt à déposer » exige une checklist conforme
  if (status === 'a_deposer' || status === 'depose') {
    const { data } = await ctx.supabase.rpc('tender_readiness', { p_tender_id: id })
    const r = Array.isArray(data) ? data[0] : data
    if (r && !r.ready) {
      const blockers = (r.blockers as string[]) ?? []
      return {
        error: `Dossier incomplet : ${blockers.slice(0, 3).join(' ; ')}${blockers.length > 3 ? '…' : ''}`,
      }
    }
  }

  const { error } = await ctx.supabase
    .from('tenders')
    .update({ status })
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
  if (error) return fail(error)

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'tender.status_changed',
    entityType: 'tender',
    entityId: id,
    metadata: { status },
  })
  revalidateTenderPages(orgSlug)
  revalidatePath(`/${orgSlug}/tenders`)
  return { success: true }
}

export async function justifySiteVisit(orgSlug: string, id: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tenders')
    .update({ site_visit_justified: true })
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
  if (error) return fail(error)
  await runChecks(ctx.supabase, id)
  revalidateTenderPages(orgSlug)
  return { success: true }
}

export async function deleteTender(orgSlug: string, id: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'admin')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!z.uuid().safeParse(id).success) return { error: 'Dossier invalide.' }
  const { supabase, org } = ctx

  const { data: tender } = await supabase
    .from('tenders')
    .select('id, title, reference')
    .eq('organization_id', org.id)
    .eq('id', id)
    .single()
  if (!tender) return fail('Dossier introuvable.')

  // Les lignes tender_* sont supprimées en cascade. En revanche les
  // documents (liens polymorphes document_links.entity_id, fichiers générés
  // sous org_<org>/datasheets|memoire/<run>/, ids référencés par les runs)
  // ne cascadent pas : on collecte leurs ids + chemins storage avant.
  const [{ data: links }, { data: memRuns }, { data: dsRuns }] = await Promise.all([
    supabase
      .from('document_links')
      .select('id, document_id')
      .eq('organization_id', org.id)
      .eq('entity_type', 'tender')
      .eq('entity_id', id),
    supabase
      .from('tender_memoire_runs')
      .select('id, content_document_id, docx_document_id, docx_full_document_id')
      .eq('organization_id', org.id)
      .eq('tender_id', id),
    supabase
      .from('tender_datasheet_runs')
      .select('id, deliverable_document_ids')
      .eq('organization_id', org.id)
      .eq('tender_id', id),
  ])

  const linkedDocIds = (links ?? []).map((l) => l.document_id)
  const refDocIds = [
    ...(memRuns ?? []).flatMap((r) => [
      r.content_document_id,
      r.docx_document_id,
      r.docx_full_document_id,
    ]),
    ...(dsRuns ?? []).flatMap((r) => r.deliverable_document_ids ?? []),
  ].filter((x): x is string => typeof x === 'string')

  const orFilters = [
    ...(memRuns ?? []).map((r) => `storage_path.like.%/memoire/${r.id}/%`),
    ...(dsRuns ?? []).map((r) => `storage_path.like.%/datasheets/${r.id}/%`),
  ]
  const { data: runDocs } = orFilters.length
    ? await supabase
        .from('documents')
        .select('id, storage_path')
        .eq('organization_id', org.id)
        .or(orFilters.join(','))
    : { data: [] }

  const { data: refDocs } = refDocIds.length
    ? await supabase
        .from('documents')
        .select('id, storage_path')
        .eq('organization_id', org.id)
        .in('id', refDocIds)
    : { data: [] }

  // Un document lié à une autre entité (projet, compte…) est seulement
  // détaché du dossier ; les autres sont supprimés avec leur fichier.
  const { data: allLinks } = linkedDocIds.length
    ? await supabase
        .from('document_links')
        .select('document_id, entity_id')
        .eq('organization_id', org.id)
        .in('document_id', linkedDocIds)
    : { data: [] }
  const shared = new Set(
    (allLinks ?? [])
      .filter((l) => l.entity_id !== id)
      .map((l) => l.document_id),
  )
  const removableLinked = linkedDocIds.filter((d) => !shared.has(d))

  const { data: removable } = removableLinked.length
    ? await supabase
        .from('documents')
        .select('id, storage_path')
        .eq('organization_id', org.id)
        .in('id', removableLinked)
    : { data: [] }

  const docs = new Map(
    [...(runDocs ?? []), ...(refDocs ?? []), ...(removable ?? [])].map((d) => [
      d.id,
      d.storage_path,
    ]),
  )

  const { error } = await supabase
    .from('tenders')
    .delete()
    .eq('organization_id', org.id)
    .eq('id', id)
  if (error) return fail(error)

  // Nettoyage best-effort : liens orphelins + fichiers storage + lignes documents.
  if (links?.length) {
    await supabase
      .from('document_links')
      .delete()
      .eq('organization_id', org.id)
      .eq('entity_type', 'tender')
      .eq('entity_id', id)
  }
  const paths = [...docs.values()]
  if (paths.length) {
    await supabase.storage.from('documents').remove(paths)
    await supabase
      .from('documents')
      .delete()
      .eq('organization_id', org.id)
      .in('id', [...docs.keys()])
  }

  await audit(supabase, {
    organizationId: org.id,
    action: 'tender.deleted',
    entityType: 'tender',
    entityId: id,
    metadata: {
      title: tender.title,
      reference: tender.reference,
      documents_removed: docs.size,
    },
  })
  revalidatePath(`/${orgSlug}/tenders`)
  revalidatePath(`/${orgSlug}/documents`)
  return { success: true }
}

// ============================ DEMANDE DE VISITE (IA) ============================

const visitEmailInput = z.object({
  visitDate: z.string().min(4, 'Date de visite requise'),
  visitTime: z.string().min(1, 'Heure de visite requise'),
  lotNumber: z.string().max(30).optional().or(z.literal('')),
  contactEmail: z.email('Email invalide').optional().or(z.literal('')),
  contactName: z.string().max(200).optional().or(z.literal('')),
})

/**
 * Rédige par IA (DeepSeek) un e-mail de demande de visite de site pour le
 * dossier. Ne fait que générer un brouillon — l'envoi reste manuel (mailto).
 */
export async function draftSiteVisitEmail(
  orgSlug: string,
  tenderId: string,
  input: unknown,
): Promise<{ data?: { subject: string; body: string }; error?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!z.uuid().safeParse(tenderId).success) return { error: 'Dossier invalide.' }
  const parsed = visitEmailInput.safeParse(input)
  if (!parsed.success) return { error: 'Paramètres invalides.' }
  const d = parsed.data

  const { data: tender } = await ctx.supabase
    .from('tenders')
    .select(
      'title, reference, site_visit_mandatory, site_visit_at, buyer:accounts!buyer_account_id(name)',
    )
    .eq('organization_id', ctx.org.id)
    .eq('id', tenderId)
    .single()
  if (!tender) return { error: 'Dossier introuvable.' }

  // Modalités d'accès extraites de la dernière analyse DCE (si présente).
  const { data: ana } = await ctx.supabase
    .from('tender_dce_analyses')
    .select('result')
    .eq('organization_id', ctx.org.id)
    .eq('tender_id', tenderId)
    .eq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const visit = ana?.result
    ? normalizeAnalysis(ana.result).deadlines.site_visit
    : undefined

  const buyerJoin = tender.buyer as { name: string } | { name: string }[] | null
  const buyer = Array.isArray(buyerJoin) ? buyerJoin[0]?.name : buyerJoin?.name
  const dateStr = `${d.visitDate} à ${d.visitTime}`
  const sender = ctx.profile?.full_name ?? ctx.user.email ?? ''

  try {
    const { data } = await completeJson<{ subject: string; body: string }>({
      system:
        'Tu rédiges des e-mails professionnels en français au nom d\'une entreprise ' +
        'candidate à un marché public. Ton : courtois, précis, concis. ' +
        'Réponds uniquement en JSON {"subject": string, "body": string}. ' +
        'Le corps est du texte brut avec sauts de ligne, signé par l\'expéditeur.',
      prompt:
        `Rédige une demande de rendez-vous pour la visite de site ` +
        `${tender.site_visit_mandatory ? '(obligatoire)' : ''} du marché suivant :\n` +
        `- Appel d'offres : ${tender.title}\n` +
        (tender.reference ? `- Référence : ${tender.reference}\n` : '') +
        (buyer ? `- Acheteur : ${buyer}\n` : '') +
        (d.lotNumber ? `- Lot(s) concerné(s) : ${d.lotNumber}\n` : '') +
        `- Date de visite souhaitée : ${dateStr}\n` +
        (visit?.access ? `- Modalités d'accès indiquées dans le RC : ${visit.access}\n` : '') +
        (d.contactName ? `- Destinataire : ${d.contactName}\n` : '') +
        `- Expéditeur : ${sender} (${ctx.org.name})\n` +
        'L\'e-mail doit confirmer la participation de l\'entreprise à la visite, ' +
        'demander la confirmation du créneau et les modalités pratiques (lieu de RDV, ' +
        'pièces/EPI à apporter, inscription préalable si requise).',
      maxTokens: 1200,
    })
    if (!data?.subject || !data?.body) return { error: 'Réponse IA incomplète.' }
    return { data }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Échec de la génération.' }
  }
}

// ============================ LOTS ============================

export async function addLot(
  orgSlug: string,
  tenderId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = tenderLotSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data
  const { error } = await ctx.supabase.from('tender_lots').insert({
    organization_id: ctx.org.id,
    tender_id: tenderId,
    number: d.number,
    title: d.title,
    amount_cents: toCents(d.amountEuros),
  })
  if (error) return fail(error)
  await runChecks(ctx.supabase, tenderId)
  revalidateTenderPages(orgSlug)
  return { success: true }
}

export async function toggleLotSelected(
  orgSlug: string,
  lotId: string,
  tenderId: string,
  selected: boolean,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_lots')
    .update({ selected })
    .eq('organization_id', ctx.org.id)
    .eq('id', lotId)
  if (error) return fail(error)
  await runChecks(ctx.supabase, tenderId)
  revalidateTenderPages(orgSlug)
  return { success: true }
}

export async function deleteLot(
  orgSlug: string,
  lotId: string,
  tenderId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_lots')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', lotId)
  if (error) return fail(error)
  await runChecks(ctx.supabase, tenderId)
  revalidateTenderPages(orgSlug)
  return { success: true }
}

// ============================ CHECKLIST ============================

export async function addChecklistItem(
  orgSlug: string,
  tenderId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = checklistItemSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { error } = await ctx.supabase.from('tender_checklist_items').insert({
    organization_id: ctx.org.id,
    tender_id: tenderId,
    label: d.label,
    category: d.category,
    requirement: d.requirement,
    assignee_id: d.assigneeId || null,
    internal_deadline: d.internalDeadline || null,
    requires_signature: d.requiresSignature,
    requires_chiffrage: d.requiresChiffrage,
    risk_level: d.riskLevel,
    comment: d.comment || null,
    position: 999,
  })
  if (error) return fail(error)
  // Rattache la pièce du kit société si le libellé correspond (Kbis,
  // URSSAF…) — best-effort, ne bloque pas l'ajout de la ligne.
  try {
    await attachCompanyDocsToChecklist(ctx.supabase, ctx.org.id, tenderId, ctx.user.id)
  } catch {
    // noop — rejouable via « Rattacher les pièces société »
  }
  await runChecks(ctx.supabase, tenderId)
  revalidateTenderPages(orgSlug)
  return { success: true }
}

const ITEM_STATUSES: ChecklistItemStatus[] = [
  'non_commence',
  'en_cours',
  'a_verifier',
  'valide',
  'bloque',
  'non_requis',
]

export async function setChecklistItemStatus(
  orgSlug: string,
  itemId: string,
  tenderId: string,
  status: ChecklistItemStatus,
  force = false,
  forceReason = '',
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!ITEM_STATUSES.includes(status)) return { error: 'Statut invalide.' }

  // Une ligne à signature exigée ne peut être validée sans pièce signée,
  // sauf si l'utilisateur force explicitement la validation.
  if (status === 'valide' && !force) {
    const { data: item } = await ctx.supabase
      .from('tender_checklist_items')
      .select('requires_signature, document:documents(is_signed)')
      .eq('id', itemId)
      .single()
    const doc = Array.isArray(item?.document) ? item.document[0] : item?.document
    if (item?.requires_signature && !doc?.is_signed) {
      return {
        error:
          'Impossible de valider : la pièce exige une signature. Marquez-la ' +
          '« signée » (bouton sur la pièce) ou cochez « Forcer la validation ».',
      }
    }
  }

  const { error } = await ctx.supabase
    .from('tender_checklist_items')
    .update({
      status,
      forced_valid: status === 'valide' && force,
      force_reason: status === 'valide' && force ? forceReason || null : null,
      ...(status === 'valide'
        ? { validated_by: ctx.user.id, validated_at: new Date().toISOString() }
        : { forced_valid: false, force_reason: null }),
    })
    .eq('organization_id', ctx.org.id)
    .eq('id', itemId)
  if (error) return fail(error)

  await runChecks(ctx.supabase, tenderId)
  if (status === 'valide') {
    await audit(ctx.supabase, {
      organizationId: ctx.org.id,
      action: force ? 'checklist.force_validated' : 'checklist.validated',
      entityType: 'tender_checklist_item',
      entityId: itemId,
      metadata: { tender_id: tenderId, force_reason: forceReason || null },
    })
  }
  revalidateTenderPages(orgSlug)
  return { success: true }
}

export async function updateChecklistItem(
  orgSlug: string,
  itemId: string,
  tenderId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = checklistItemSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { error } = await ctx.supabase
    .from('tender_checklist_items')
    .update({
      label: d.label,
      category: d.category,
      requirement: d.requirement,
      internal_deadline: d.internalDeadline || null,
      requires_signature: d.requiresSignature,
      requires_chiffrage: d.requiresChiffrage,
      risk_level: d.riskLevel,
      comment: d.comment || null,
    })
    .eq('organization_id', ctx.org.id)
    .eq('id', itemId)
  if (error) return fail(error)

  await runChecks(ctx.supabase, tenderId)
  revalidateTenderPages(orgSlug)
  return { success: true }
}

export async function assignChecklistItem(
  orgSlug: string,
  itemId: string,
  tenderId: string,
  assigneeId: string | null,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_checklist_items')
    .update({ assignee_id: assigneeId })
    .eq('organization_id', ctx.org.id)
    .eq('id', itemId)
  if (error) return fail(error)

  if (assigneeId && assigneeId !== ctx.user.id) {
    const { data: item } = await ctx.supabase
      .from('tender_checklist_items')
      .select('label, tender:tenders(title)')
      .eq('organization_id', ctx.org.id)
      .eq('id', itemId)
      .maybeSingle()
    const tenderTitle = (item?.tender as { title?: string } | null)?.title
    await notifyUsers({
      organizationId: ctx.org.id,
      userIds: [assigneeId],
      type: 'checklist_assigned',
      title: `Pièce assignée : ${item?.label ?? 'pièce du dossier'}`,
      body: tenderTitle ? `Dossier ${tenderTitle}` : undefined,
      entityType: 'tender',
      entityId: tenderId,
    })
  }

  revalidateTenderPages(orgSlug)
  return { success: true }
}

export async function attachItemDocument(
  orgSlug: string,
  itemId: string,
  tenderId: string,
  documentId: string | null,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_checklist_items')
    .update({
      document_id: documentId,
      ...(documentId ? { status: 'a_verifier' } : {}),
    })
    .eq('organization_id', ctx.org.id)
    .eq('id', itemId)
  if (error) return fail(error)

  if (documentId) {
    // Lier le document au tender pour le retrouver dans l'onglet Documents
    await ctx.supabase.from('document_links').upsert(
      {
        organization_id: ctx.org.id,
        document_id: documentId,
        entity_type: 'tender',
        entity_id: tenderId,
      },
      { onConflict: 'document_id,entity_type,entity_id' },
    )
  }
  await runChecks(ctx.supabase, tenderId)
  revalidateTenderPages(orgSlug)
  return { success: true }
}

/**
 * Rattache automatiquement les pièces du kit candidature société (Kbis,
 * URSSAF, attestations, DC1/DC2…) aux lignes de checklist sans document.
 * La pièce est validée si elle est en règle ; sinon « à vérifier »
 * (expirée, ou signature requise non présente).
 */
export async function autoAttachCompanyDocs(
  orgSlug: string,
  tenderId: string,
): Promise<{ error?: string; success?: boolean; attached?: number; validated?: number }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!z.uuid().safeParse(tenderId).success) return { error: 'Dossier invalide.' }
  const { attached, validated } = await attachCompanyDocsToChecklist(
    ctx.supabase,
    ctx.org.id,
    tenderId,
    ctx.user.id,
  )

  await runChecks(ctx.supabase, tenderId)
  if (attached > 0) {
    await audit(ctx.supabase, {
      organizationId: ctx.org.id,
      action: 'checklist.company_docs_attached',
      entityType: 'tender',
      entityId: tenderId,
      metadata: { attached, validated },
    })
  }
  revalidateTenderPages(orgSlug)
  return { success: true, attached, validated }
}

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/zip',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

/** Upload un fichier et l'attache à une ligne de checklist en une seule étape. */
export async function uploadAndAttachToChecklistItem(
  orgSlug: string,
  itemId: string,
  tenderId: string,
  formData: FormData,
): Promise<ActionState & { documentId?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, org, user } = ctx

  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'Fichier manquant.' }
  if (file.size <= 0 || file.size > 25 * 1024 * 1024) return { error: 'Taille maximale : 25 Mo.' }
  if (!ALLOWED_MIME.has(file.type)) return { error: 'Type de fichier non autorisé.' }

  const category = (formData.get('category') as string) || 'autre'
  const docId = crypto.randomUUID()
  const storagePath = `org_${org.id}/${docId}/${file.name.replace(/[^\w.()-]/g, '_')}`

  const { error: upErr } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, { contentType: file.type })
  if (upErr) return { error: 'Échec de l’envoi du fichier.' }

  const { data: doc, error: dbErr } = await supabase
    .from('documents')
    .insert({
      id: docId,
      organization_id: org.id,
      name: file.name,
      storage_path: storagePath,
      mime_type: file.type,
      size_bytes: file.size,
      category,
      uploaded_by: user.id,
    })
    .select('id, name')
    .single()
  if (dbErr) {
    await supabase.storage.from('documents').remove([storagePath])
    return { error: 'Échec de l’enregistrement du document.' }
  }

  // Lier au tender + attacher à la ligne de checklist
  await supabase.from('document_links').upsert(
    {
      organization_id: org.id,
      document_id: doc.id,
      entity_type: 'tender',
      entity_id: tenderId,
    },
    { onConflict: 'document_id,entity_type,entity_id' },
  )
  const { error: attachErr } = await supabase
    .from('tender_checklist_items')
    .update({ document_id: doc.id, status: 'a_verifier' })
    .eq('organization_id', org.id)
    .eq('id', itemId)
  if (attachErr) return fail(attachErr)

  await runChecks(supabase, tenderId)
  await audit(supabase, {
    organizationId: org.id,
    action: 'document.uploaded',
    entityType: 'document',
    entityId: doc.id,
    metadata: { name: file.name, checklist_item: itemId },
  })
  revalidateTenderPages(orgSlug)
  return { success: true, documentId: doc.id }
}

export async function deleteChecklistItem(
  orgSlug: string,
  itemId: string,
  tenderId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_checklist_items')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', itemId)
  if (error) return fail(error)
  await runChecks(ctx.supabase, tenderId)
  revalidateTenderPages(orgSlug)
  return { success: true }
}

// ============================ CONTRÔLES ============================

async function runChecks(supabase: SupabaseClient, tenderId: string) {
  await supabase.rpc('run_compliance_checks', { p_tender_id: tenderId })
}

export async function runComplianceChecks(
  orgSlug: string,
  tenderId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase.rpc('run_compliance_checks', { p_tender_id: tenderId })
  if (error) return fail(error)
  revalidateTenderPages(orgSlug)
  return { success: true }
}

export async function resolveAlert(
  orgSlug: string,
  alertId: string,
  tenderId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_alerts')
    .update({ resolved_at: new Date().toISOString(), resolved_by: ctx.user.id })
    .eq('organization_id', ctx.org.id)
    .eq('tender_id', tenderId)
    .eq('id', alertId)
  if (error) return fail(error)
  revalidateTenderPages(orgSlug)
  return { success: true }
}

// ============================ DÉPÔT & RÉSULTAT ============================

export async function submitTender(
  orgSlug: string,
  tenderId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = submissionSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  // Barrière métier : jamais de dépôt si checklist incomplète
  const { data: readiness } = await ctx.supabase.rpc('tender_readiness', {
    p_tender_id: tenderId,
  })
  const r = Array.isArray(readiness) ? readiness[0] : readiness
  if (r && !r.ready) {
    return { error: 'Dépôt impossible : des pièces obligatoires sont incomplètes.' }
  }

  const { data: last } = await ctx.supabase
    .from('tender_submissions')
    .select('version')
    .eq('organization_id', ctx.org.id)
    .eq('tender_id', tenderId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await ctx.supabase.from('tender_submissions').insert({
    organization_id: ctx.org.id,
    tender_id: tenderId,
    version: (last?.version ?? 0) + 1,
    platform: d.platform || null,
    submission_ref: d.submissionRef || null,
    notes: d.notes || null,
    validated_by: ctx.user.id,
    validated_at: new Date().toISOString(),
    created_by: ctx.user.id,
  })
  if (error) return fail(error)

  // « Dossier téléversé sur la plateforme » devient un fait dès le dépôt
  // enregistré (catégorie depot — hors barrière readiness). Le récépissé
  // reste à archiver manuellement dans la checklist.
  await syncChecklistItems(
    ctx.supabase,
    ctx.org.id,
    tenderId,
    [/t[ée]l[ée]vers/i],
    {
      status: 'valide',
      validated_by: ctx.user.id,
      validated_at: new Date().toISOString(),
    },
  )

  await ctx.supabase
    .from('tenders')
    .update({ status: 'depose' })
    .eq('organization_id', ctx.org.id)
    .eq('id', tenderId)

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'tender.submitted',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { platform: d.platform, ref: d.submissionRef },
  })
  revalidateTenderPages(orgSlug)
  revalidatePath(`/${orgSlug}/tenders`)
  return { success: true }
}

export async function recordTenderResult(
  orgSlug: string,
  tenderId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = tenderResultSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { error } = await ctx.supabase.from('tender_results').upsert(
    {
      tender_id: tenderId,
      organization_id: ctx.org.id,
      outcome: d.outcome,
      awarded_amount_cents: toCents(d.awardedAmountEuros),
      awarded_to: d.awardedTo || null,
      decided_at: d.decidedAt || null,
      loss_reason: d.lossReason || null,
      created_by: ctx.user.id,
    },
    { onConflict: 'tender_id' },
  )
  if (error) return fail(error)

  const status =
    d.outcome === 'gagne' ? 'gagne' : d.outcome === 'perdu' ? 'perdu' : d.outcome === 'annule' ? 'annule' : 'depose'
  await ctx.supabase
    .from('tenders')
    .update({ status })
    .eq('organization_id', ctx.org.id)
    .eq('id', tenderId)

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'tender.result_recorded',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { outcome: d.outcome },
  })
  revalidateTenderPages(orgSlug)
  revalidatePath(`/${orgSlug}/tenders`)
  return { success: true }
}
