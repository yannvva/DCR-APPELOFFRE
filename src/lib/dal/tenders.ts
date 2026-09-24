import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveListParams, toPaged } from '@/lib/dal/list'
import type {
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

export async function listTenders(
  ctx: Ctx,
  params: ListParams & { status?: TenderStatus; responsibleId?: string } = {},
) {
  const { page, pageSize, from, to } = resolveListParams(params)
  let q = ctx.supabase
    .from('tenders')
    .select('*, buyer:accounts!buyer_account_id(id, name), responsible:profiles!responsible_id(id, full_name)', {
      count: 'exact',
    })
    .eq('organization_id', ctx.org.id)
    .order(params.sort ?? 'response_deadline', { ascending: params.order !== 'desc' })
    .range(from, to)
  if (params.q) {
    q = q.or(`title.ilike.%${params.q}%,reference.ilike.%${params.q}%`)
  }
  if (params.status) q = q.eq('status', params.status)
  if (params.responsibleId) q = q.eq('responsible_id', params.responsibleId)
  const { data, count, error } = await q
  if (error) throw error

  const tenders = (data ?? []).map((t) => ({
    ...t,
    buyer: one(t.buyer),
    responsible: one(t.responsible),
  })) as Tender[]

  // Complétude en une requête groupée sur les items obligatoires
  if (tenders.length) {
    const ids = tenders.map((t) => t.id)
    const { data: items } = await ctx.supabase
      .from('tender_checklist_items')
      .select('tender_id, requirement, status')
      .eq('organization_id', ctx.org.id)
      .in('tender_id', ids)
      .eq('requirement', 'obligatoire')
      .neq('status', 'non_requis')
    const stats = new Map<string, { required: number; validated: number }>()
    for (const i of items ?? []) {
      const s = stats.get(i.tender_id) ?? { required: 0, validated: 0 }
      s.required += 1
      if (i.status === 'valide') s.validated += 1
      stats.set(i.tender_id, s)
    }
    for (const t of tenders) {
      const s = stats.get(t.id) ?? { required: 0, validated: 0 }
      const pct = s.required === 0 ? 100 : Math.round((100 * s.validated) / s.required)
      t.completeness = { ...s, pct, ready: pct === 100 }
    }
  }

  return toPaged(tenders, count, page, pageSize)
}

export async function getTender(ctx: Ctx, id: string) {
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

export async function listUpcomingTenders(ctx: Ctx, days = 7, limit = 8) {
  const end = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()
  const { data } = await ctx.supabase
    .from('tenders')
    .select('id, title, reference, response_deadline, status, buyer:accounts!buyer_account_id(name)')
    .eq('organization_id', ctx.org.id)
    .not('status', 'in', '("depose","gagne","perdu","abandonne","annule")')
    .lte('response_deadline', end)
    .order('response_deadline')
    .limit(limit)
  return ((data ?? []).map((t) => ({ ...t, buyer: one(t.buyer) })) ?? []) as Tender[]
}

export async function listExpiringDocuments(ctx: Ctx, days = 15, limit = 8) {
  const end = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const { data } = await ctx.supabase
    .from('documents')
    .select('id, name, document_type, valid_until')
    .eq('organization_id', ctx.org.id)
    .lte('valid_until', end)
    .order('valid_until')
    .limit(limit)
  return (data ?? []) as { id: string; name: string; document_type: string | null; valid_until: string }[]
}
