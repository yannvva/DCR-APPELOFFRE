import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { slugify, tenderIdFromParam } from '@/lib/slug'
import { resolveListParams, toPaged } from '@/lib/dal/list'
import type {
  AlertSeverity,
  ChecklistItemStatus,
  ListParams,
  Tender,
  TenderAlert,
  TenderChecklistItem,
  TenderLot,
  TenderReadiness,
  TenderResult,
  TenderStatus,
  TenderSubmission,
} from '@/lib/types'

type Ctx = { supabase: SupabaseClient; org: { id: string } }

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

// ---- Tenders ----

const SORTABLE_TENDER_FIELDS = new Set([
  'title',
  'response_deadline',
  'estimated_amount_cents',
  'status',
  'created_at',
])

export async function listTenders(
  ctx: Ctx,
  params: ListParams & {
    status?: TenderStatus
    responsibleId?: string
    buyerId?: string
    preset?: 'open' | 'due_soon' | 'overdue' | 'visit' | 'incomplete'
  } = {},
) {
  const { page, pageSize, from, to } = resolveListParams(params)
  const sort = SORTABLE_TENDER_FIELDS.has(params.sort ?? '')
    ? params.sort!
    : 'response_deadline'
  let q = ctx.supabase
    .from('tenders')
    .select('*, buyer:accounts!buyer_account_id(id, name), responsible:profiles!responsible_id(id, full_name)', {
      count: 'exact',
    })
    .eq('organization_id', ctx.org.id)
    .order(sort, { ascending: params.order !== 'desc' })
    .range(from, to)

  const qText = params.q?.trim()
  if (qText) {
    // Recherche étendue à l'acheteur : résolution des comptes puis OR sur
    // buyer_account_id (un filtre embedded exigerait une jointure inner qui
    // éliminerait les AO sans acheteur).
    const pat = qText.replace(/[(),'"]/g, ' ').trim()
    const { data: buyers } = await ctx.supabase
      .from('accounts')
      .select('id')
      .eq('organization_id', ctx.org.id)
      .ilike('name', `%${qText}%`)
      .limit(50)
    const ors = [`title.ilike.%${pat}%`, `reference.ilike.%${pat}%`]
    const ids = (buyers ?? []).map((b) => b.id)
    if (ids.length) ors.push(`buyer_account_id.in.(${ids.join(',')})`)
    q = q.or(ors.join(','))
  }

  if (params.preset) {
    const nowIso = new Date().toISOString()
    const soonIso = new Date(Date.now() + 7 * 86_400_000).toISOString()
    switch (params.preset) {
      case 'open':
        q = q.in('status', [...OPEN_STATUSES])
        break
      case 'due_soon':
        q = q
          .in('status', [...OPEN_STATUSES])
          .gte('response_deadline', nowIso)
          .lte('response_deadline', soonIso)
        break
      case 'overdue':
        q = q.in('status', [...OPEN_STATUSES]).lt('response_deadline', nowIso)
        break
      case 'visit':
        // Visite obligatoire ni faite ni justifiée — vrai risque d'irrecevabilité.
        q = q
          .in('status', [...OPEN_STATUSES])
          .eq('site_visit_mandatory', true)
          .eq('site_visit_justified', false)
        break
      case 'incomplete': {
        // AO ayant au moins une pièce obligatoire non validée — même périmètre
        // que le calcul de complétude ci-dessous.
        const { data: missing } = await ctx.supabase
          .from('tender_checklist_items')
          .select('tender_id')
          .eq('organization_id', ctx.org.id)
          .eq('requirement', 'obligatoire')
          .neq('category', 'depot')
          .not('status', 'in', '("valide","non_requis")')
        const ids = [...new Set((missing ?? []).map((m) => m.tender_id))]
        if (!ids.length) return toPaged([], 0, page, pageSize)
        q = q.in('id', ids)
        break
      }
    }
  }

  if (params.status) q = q.eq('status', params.status)
  if (params.responsibleId) q = q.eq('responsible_id', params.responsibleId)
  if (params.buyerId) q = q.eq('buyer_account_id', params.buyerId)
  const { data, count, error } = await q
  if (error) throw error

  const tenders = (data ?? []).map((t) => ({
    ...t,
    buyer: one(t.buyer),
    responsible: one(t.responsible),
  })) as Tender[]

  // Complétude en une requête groupée sur les items obligatoires —
  // détail des pièces non validées pour l'infobulle de la liste.
  if (tenders.length) {
    const ids = tenders.map((t) => t.id)
    const { data: items } = await ctx.supabase
      .from('tender_checklist_items')
      .select('tender_id, label, requirement, status')
      .eq('organization_id', ctx.org.id)
      .in('tender_id', ids)
      .eq('requirement', 'obligatoire')
      .neq('status', 'non_requis')
      // Catégorie 'depot' exclue comme dans tender_readiness() : lignes
      // post-dépôt (« dossier téléversé », « récépissé »).
      .neq('category', 'depot')
    const stats = new Map<
      string,
      {
        required: number
        validated: number
        missing: { label: string; status: ChecklistItemStatus }[]
      }
    >()
    // Les plus bloquantes d'abord dans l'infobulle
    const ORDER: ChecklistItemStatus[] = [
      'bloque',
      'a_verifier',
      'en_cours',
      'non_commence',
      'valide',
    ]
    for (const i of items ?? []) {
      const s =
        stats.get(i.tender_id) ?? { required: 0, validated: 0, missing: [] }
      s.required += 1
      if (i.status === 'valide') {
        s.validated += 1
      } else {
        s.missing.push({ label: i.label, status: i.status })
      }
      stats.set(i.tender_id, s)
    }
    for (const t of tenders) {
      const s = stats.get(t.id) ?? { required: 0, validated: 0, missing: [] }
      s.missing.sort(
        (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status),
      )
      const pct = s.required === 0 ? 100 : Math.round((100 * s.validated) / s.required)
      t.completeness = { ...s, pct, ready: pct === 100 }
    }

    // Alertes de conformité ouvertes par AO — pastille dans la liste.
    const { data: alerts } = await ctx.supabase
      .from('tender_alerts')
      .select('tender_id, severity')
      .eq('organization_id', ctx.org.id)
      .in('tender_id', ids)
      .is('resolved_at', null)
    const SEV: AlertSeverity[] = ['bloquante', 'critique', 'importante', 'info']
    const amap = new Map<string, { count: number; worst: AlertSeverity }>()
    for (const a of alerts ?? []) {
      const s = amap.get(a.tender_id) ?? { count: 0, worst: 'info' as AlertSeverity }
      s.count += 1
      if (SEV.indexOf(a.severity) < SEV.indexOf(s.worst)) s.worst = a.severity
      amap.set(a.tender_id, s)
    }
    for (const t of tenders) t.alerts = amap.get(t.id) ?? null
  }

  return toPaged(tenders, count, page, pageSize)
}

const OPEN_STATUSES = new Set(['detecte', 'analyse', 'en_preparation', 'a_deposer'])

export interface TenderStats {
  total: number
  open: number
  /** Deadline dépassée (AO non clôturés). */
  overdue: number
  /** Deadline dans les 7 prochains jours. */
  dueSoon: number
  /** Somme des montants estimés des AO ouverts. */
  openAmountCents: number
}

/** Compteurs de synthèse pour le bandeau de la liste — volumes faibles,
 *  aggrégation en mémoire sur les colonnes minimales. */
export async function listTenderStats(ctx: Ctx): Promise<TenderStats> {
  const { data } = await ctx.supabase
    .from('tenders')
    .select('status, response_deadline, estimated_amount_cents')
    .eq('organization_id', ctx.org.id)
  const now = Date.now()
  const soon = now + 7 * 86_400_000
  const stats: TenderStats = {
    total: data?.length ?? 0,
    open: 0,
    overdue: 0,
    dueSoon: 0,
    openAmountCents: 0,
  }
  for (const t of data ?? []) {
    if (!OPEN_STATUSES.has(t.status)) continue
    stats.open++
    stats.openAmountCents += t.estimated_amount_cents ?? 0
    const d = t.response_deadline ? new Date(t.response_deadline).getTime() : null
    if (d == null) continue
    if (d < now) stats.overdue++
    else if (d <= soon) stats.dueSoon++
  }
  return stats
}

export async function getTender(ctx: Ctx, idOrSlug: string) {
  // Le segment d'URL peut être l'UUID seul, « slug-uuid » (liens lisibles)
  // ou un slug pur. L'UUID est prioritaire ; à défaut on matche le titre
  // slugifié (périmètre organisation — volumes faibles).
  let id = tenderIdFromParam(idOrSlug)
  if (!id) {
    const { data: all } = await ctx.supabase
      .from('tenders')
      .select('id, title')
      .eq('organization_id', ctx.org.id)
    id = (all ?? []).find((t) => slugify(t.title) === idOrSlug)?.id ?? null
    if (!id) return null
  }
  const { data } = await ctx.supabase
    .from('tenders')
    .select('*, buyer:accounts!buyer_account_id(id, name), responsible:profiles!responsible_id(id, full_name)')
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  return { ...data, buyer: one(data.buyer), responsible: one(data.responsible) } as Tender
}

export async function getTenderReadiness(ctx: Ctx, tenderId: string): Promise<TenderReadiness> {
  const { data, error } = await ctx.supabase.rpc('tender_readiness', { p_tender_id: tenderId })
  if (error) throw error
  const row = one(data as TenderReadiness[] | TenderReadiness | null)
  return row ?? { required: 0, validated: 0, pct: 100, ready: true, blockers: [] }
}

// ---- Tableau « À faire » : vue transverse tous dossiers ----

export const OPEN_TENDER_STATUSES: TenderStatus[] = [
  'detecte',
  'analyse',
  'en_preparation',
  'a_deposer',
]

export const CLOSED_TENDER_STATUSES: TenderStatus[] = [
  'depose',
  'gagne',
  'perdu',
  'abandonne',
  'annule',
]

export interface TodoChecklistItem extends TenderChecklistItem {
  tender: Pick<Tender, 'id' | 'title' | 'status' | 'response_deadline'>
}

/**
 * Données de la page « À faire » : tous les dossiers (avec complétude et
 * alertes, via listTenders) + les lignes de checklist des dossiers encore
 * ouverts — chaque ligne porte son AO pour le contexte dans le kanban.
 */
export async function listTodoBoard(ctx: Ctx): Promise<{
  tenders: Tender[]
  items: TodoChecklistItem[]
}> {
  const { rows: tenders } = await listTenders(ctx, {
    pageSize: 200,
    sort: 'response_deadline',
  })
  const openIds = tenders
    .filter((t) => OPEN_TENDER_STATUSES.includes(t.status))
    .map((t) => t.id)

  if (!openIds.length) return { tenders, items: [] }

  const { data } = await ctx.supabase
    .from('tender_checklist_items')
    .select(
      '*, tender:tenders!tender_id(id, title, status, response_deadline), document:documents(id, name, valid_until, is_signed, status), assignee:profiles!assignee_id(id, full_name)',
    )
    .eq('organization_id', ctx.org.id)
    .in('tender_id', openIds)
    .order('position')

  const items = ((data ?? []).map((i) => ({
    ...i,
    tender: one(i.tender),
    document: one(i.document),
    assignee: one(i.assignee),
  })) ?? []) as TodoChecklistItem[]

  return { tenders, items }
}

// ---- Lots ----

export async function listTenderLots(ctx: Ctx, tenderId: string) {
  const { data } = await ctx.supabase
    .from('tender_lots')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .eq('tender_id', tenderId)
    .order('number')
  return (data ?? []) as TenderLot[]
}

/** Crée le lot s'il n'existe pas encore (dédup par numéro) — utilisé quand
 *  l'utilisateur choisit un lot issu de l'analyse DCE avant de l'avoir
 *  appliquée au dossier. Retourne l'id de la ligne ou null en cas d'échec. */
export async function ensureTenderLot(
  supabase: SupabaseClient,
  orgId: string,
  tenderId: string,
  lot: { number: number; title: string; amount_cents?: number | null },
): Promise<string | null> {
  // Le numéro vient parfois d'une extraction IA → tronquer un éventuel float.
  const number = Math.trunc(lot.number)
  const { data: existing } = await supabase
    .from('tender_lots')
    .select('id')
    .eq('organization_id', orgId)
    .eq('tender_id', tenderId)
    .eq('number', number)
    .maybeSingle()
  if (existing) return existing.id as string
  const { data } = await supabase
    .from('tender_lots')
    .insert({
      organization_id: orgId,
      tender_id: tenderId,
      number,
      title: lot.title,
      amount_cents: lot.amount_cents ?? null,
    })
    .select('id')
    .single()
  return (data?.id as string) ?? null
}

// ---- Checklist ----

export async function listChecklistItems(ctx: Ctx, tenderId: string) {
  const { data } = await ctx.supabase
    .from('tender_checklist_items')
    .select(
      '*, document:documents(id, name, valid_until, is_signed, status), assignee:profiles!assignee_id(id, full_name)',
    )
    .eq('organization_id', ctx.org.id)
    .eq('tender_id', tenderId)
    .order('position')
  return ((data ?? []).map((i) => ({
    ...i,
    document: one(i.document),
    assignee: one(i.assignee),
  })) ?? []) as TenderChecklistItem[]
}

// ---- Analyses DCE (IA) ----

export interface DceAnalysisRow {
  id: string
  status: 'done' | 'error'
  model: string | null
  files: { name: string; type: string; chars: number }[]
  skipped: { name: string; reason: string }[]
  result: unknown
  error: string | null
  applied_at: string | null
  created_at: string
}

export async function listDceAnalyses(ctx: Ctx, tenderId: string, limit = 5) {
  const { data } = await ctx.supabase
    .from('tender_dce_analyses')
    .select('id, status, model, files, skipped, result, error, applied_at, created_at')
    .eq('organization_id', ctx.org.id)
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as DceAnalysisRow[]
}

// ---- Alertes ----

export async function listTenderAlerts(ctx: Ctx, tenderId: string, includeResolved = false) {
  let q = ctx.supabase
    .from('tender_alerts')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: false })
  if (!includeResolved) q = q.is('resolved_at', null)
  const { data } = await q
  return (data ?? []) as TenderAlert[]
}

// ---- Dépôts & résultat ----

export async function listSubmissions(ctx: Ctx, tenderId: string) {
  const { data } = await ctx.supabase
    .from('tender_submissions')
    .select('*, validator:profiles!validated_by(full_name), receipt:documents!receipt_document_id(id, name)')
    .eq('organization_id', ctx.org.id)
    .eq('tender_id', tenderId)
    .order('version', { ascending: false })
  return ((data ?? []).map((s) => ({
    ...s,
    validator: one(s.validator),
    receipt: one(s.receipt),
  })) ?? []) as TenderSubmission[]
}

export async function getTenderResult(ctx: Ctx, tenderId: string) {
  const { data } = await ctx.supabase
    .from('tender_results')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .eq('tender_id', tenderId)
    .maybeSingle()
  return data as TenderResult | null
}

// ---- Dashboard ----

/**
 * AO dont la deadline approche : fenêtre [aujourd'hui -30 j ; +`days` j].
 * La borne basse évite que des AO échus depuis des mois (à clore, pas à
 * déposer) masquent de vraies urgences J-7 dans la limite.
 */
export async function listUpcomingTenders(ctx: Ctx, days = 7, limit = 8) {
  const now = Date.now()
  const start = new Date(now - 30 * 24 * 3600 * 1000).toISOString()
  const end = new Date(now + days * 24 * 3600 * 1000).toISOString()
  const { data } = await ctx.supabase
    .from('tenders')
    .select('id, title, reference, response_deadline, questions_deadline, status, buyer:accounts!buyer_account_id(name)')
    .eq('organization_id', ctx.org.id)
    .not('status', 'in', '("depose","gagne","perdu","abandonne","annule")')
    .gte('response_deadline', start)
    .lte('response_deadline', end)
    .order('response_deadline')
    .limit(limit)
  return ((data ?? []).map((t) => ({ ...t, buyer: one(t.buyer) })) ?? []) as Tender[]
}

/**
 * Pièces de checklist à échéance interne proche (ou dépassée), tous AO
 * ouverts confondus — les « choses à faire » remontées en transverse.
 */
export async function listUpcomingChecklistItems(ctx: Ctx, days = 14, limit = 12) {
  const end = new Date(Date.now() + days * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
  const { data } = await ctx.supabase
    .from('tender_checklist_items')
    .select(
      'id, label, status, internal_deadline, tender_id, assignee:profiles!assignee_id(full_name), tender:tenders!tender_id!inner(id, title, status)',
    )
    .eq('organization_id', ctx.org.id)
    .not('tender.status', 'in', '("depose","gagne","perdu","abandonne","annule")')
    .not('internal_deadline', 'is', null)
    .lte('internal_deadline', end)
    .not('status', 'in', '("valide","non_requis")')
    .order('internal_deadline')
    .limit(limit)
  return (data ?? []).map((i) => ({
    ...i,
    tender: one(i.tender),
    assignee: one(i.assignee),
  })) as {
    id: string
    label: string
    status: ChecklistItemStatus
    internal_deadline: string
    tender_id: string
    tender: { id: string; title: string; status: TenderStatus } | null
    assignee: { full_name: string } | null
  }[]
}

/** Visites de site à venir sur les AO ouverts (hier → +`days` j, marge fuseau). */
export async function listUpcomingSiteVisits(ctx: Ctx, days = 30, limit = 8) {
  const start = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const end = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()
  const { data } = await ctx.supabase
    .from('tenders')
    .select(
      'id, title, site_visit_at, site_visit_mandatory, site_visit_justified, buyer:accounts!buyer_account_id(name)',
    )
    .eq('organization_id', ctx.org.id)
    .not('status', 'in', '("depose","gagne","perdu","abandonne","annule")')
    .not('site_visit_at', 'is', null)
    .gte('site_visit_at', start)
    .lte('site_visit_at', end)
    .order('site_visit_at')
    .limit(limit)
  return ((data ?? []).map((t) => ({ ...t, buyer: one(t.buyer) })) ?? []) as Tender[]
}

/** Alertes de conformité ouvertes, tous AO confondus (plus graves d'abord). */
export async function listOpenTenderAlerts(ctx: Ctx, limit = 8) {
  const { data } = await ctx.supabase
    .from('tender_alerts')
    .select('id, severity, message, tender_id, tender:tenders!tender_id(title)')
    .eq('organization_id', ctx.org.id)
    .is('resolved_at', null)
    .order('severity')
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []).map((a) => ({ ...a, tender: one(a.tender) })) as {
    id: string
    severity: TenderAlert['severity']
    message: string
    tender_id: string
    tender: { title: string } | null
  }[]
}

export async function listExpiringDocuments(ctx: Ctx, days = 15, limit = 8) {
  const end = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const { data } = await ctx.supabase
    .from('documents')
    .select('id, name, document_type, valid_until, category')
    .eq('organization_id', ctx.org.id)
    .lte('valid_until', end)
    .order('valid_until')
    .limit(limit)
  return (data ?? []) as {
    id: string
    name: string
    document_type: string | null
    valid_until: string
    category: string
  }[]
}

/** Nombre d'AO par acheteur { total, ouverts } — liste des entreprises. */
export async function countTendersByBuyer(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from('tenders')
    .select('buyer_account_id, status')
    .eq('organization_id', ctx.org.id)
    .not('buyer_account_id', 'is', null)
  const map = new Map<string, { total: number; open: number }>()
  for (const t of data ?? []) {
    const s = map.get(t.buyer_account_id) ?? { total: 0, open: 0 }
    s.total += 1
    if (!['depose', 'gagne', 'perdu', 'abandonne', 'annule'].includes(t.status)) s.open += 1
    map.set(t.buyer_account_id, s)
  }
  return map
}
