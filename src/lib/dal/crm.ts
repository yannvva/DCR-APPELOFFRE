import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveListParams, toPaged } from '@/lib/dal/list'
import type {
  Account,
  Contact,
  Lead,
  ListParams,
  Opportunity,
  Pipeline,
  PipelineStage,
  Tag,
} from '@/lib/types'

type Ctx = { supabase: SupabaseClient; org: { id: string } }

// ---- Accounts ----

export async function listAccounts(ctx: Ctx, params: ListParams = {}) {
  const { page, pageSize, from, to } = resolveListParams(params)
  let q = ctx.supabase
    .from('accounts')
    .select('*', { count: 'exact' })
    .eq('organization_id', ctx.org.id)
    .order(params.sort ?? 'name', { ascending: params.order !== 'desc' })
    .range(from, to)
  if (params.q) q = q.ilike('name', `%${params.q}%`)
  const { data, count, error } = await q
  if (error) throw error
  return toPaged((data ?? []) as Account[], count, page, pageSize)
}

export async function getAccount(ctx: Ctx, id: string) {
  const { data } = await ctx.supabase
    .from('accounts')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
    .maybeSingle()
  return data as Account | null
}

export async function searchAccounts(ctx: Ctx, q: string, limit = 8) {
  const { data } = await ctx.supabase
    .from('accounts')
    .select('id, name')
    .eq('organization_id', ctx.org.id)
    .ilike('name', `%${q}%`)
    .order('name')
    .limit(limit)
  return (data ?? []) as Pick<Account, 'id' | 'name'>[]
}

// ---- Contacts ----

export async function listContacts(ctx: Ctx, params: ListParams & { accountId?: string } = {}) {
  const { page, pageSize, from, to } = resolveListParams(params)
  let q = ctx.supabase
    .from('contacts')
    .select('*, account:accounts(id, name)', { count: 'exact' })
    .eq('organization_id', ctx.org.id)
    .order('last_name')
    .range(from, to)
  if (params.q) q = q.or(`last_name.ilike.%${params.q}%,first_name.ilike.%${params.q}%,email.ilike.%${params.q}%`)
  if (params.accountId) q = q.eq('account_id', params.accountId)
  const { data, count, error } = await q
  if (error) throw error
  return toPaged((data ?? []) as Contact[], count, page, pageSize)
}

export async function getContact(ctx: Ctx, id: string) {
  const { data } = await ctx.supabase
    .from('contacts')
    .select('*, account:accounts(id, name)')
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
    .maybeSingle()
  return data as (Contact & { account?: Pick<Account, 'id' | 'name'> | null }) | null
}

// ---- Pipeline & opportunités ----

export async function getDefaultPipeline(ctx: Ctx) {
  const { data: pipeline } = await ctx.supabase
    .from('pipelines')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .eq('is_default', true)
    .maybeSingle()
  if (!pipeline) return null

  const { data: stages } = await ctx.supabase
    .from('pipeline_stages')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .eq('pipeline_id', pipeline.id)
    .order('position')

  return {
    pipeline: pipeline as Pipeline,
    stages: (stages ?? []) as PipelineStage[],
  }
}

export async function listOpportunities(ctx: Ctx, params: ListParams & { pipelineId?: string } = {}) {
  let q = ctx.supabase
    .from('opportunities')
    .select('*, account:accounts(id, name), stage:pipeline_stages(id, name)')
    .eq('organization_id', ctx.org.id)
    .order('updated_at', { ascending: false })
  if (params.pipelineId) q = q.eq('pipeline_id', params.pipelineId)
  if (params.status) q = q.eq('status', params.status)
  if (params.q) q = q.ilike('title', `%${params.q}%`)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Opportunity[]
}

export async function getOpportunity(ctx: Ctx, id: string) {
  const { data } = await ctx.supabase
    .from('opportunities')
    .select('*, account:accounts(id, name), stage:pipeline_stages(id, name)')
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
    .maybeSingle()
  return data as Opportunity | null
}

// ---- Leads ----

export async function listLeads(ctx: Ctx, params: ListParams = {}) {
  const { page, pageSize, from, to } = resolveListParams(params)
  let q = ctx.supabase
    .from('leads')
    .select('*', { count: 'exact' })
    .eq('organization_id', ctx.org.id)
    .order('created_at', { ascending: false })
    .range(from, to)
  if (params.q) q = q.ilike('title', `%${params.q}%`)
  if (params.status) q = q.eq('status', params.status)
  const { data, count, error } = await q
  if (error) throw error
  return toPaged((data ?? []) as Lead[], count, page, pageSize)
}

// ---- Tags ----

export async function listTags(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from('tags')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .order('name')
  return (data ?? []) as Tag[]
}

export async function getEntityTags(ctx: Ctx, entityType: string, entityId: string) {
  const { data } = await ctx.supabase
    .from('entity_tags')
    .select('tag:tags(*)')
    .eq('organization_id', ctx.org.id)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
  return (data ?? [])
    .map((r: { tag: Tag | Tag[] }) => (Array.isArray(r.tag) ? r.tag[0] : r.tag))
    .filter(Boolean) as Tag[]
}
