import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

type Ctx = { supabase: SupabaseClient; org: { id: string } }

export interface SearchResult {
  type: 'account' | 'contact' | 'opportunity' | 'project' | 'task' | 'document' | 'tender'
  id: string
  label: string
  sub?: string
}

export async function globalSearch(ctx: Ctx, q: string): Promise<SearchResult[]> {
  const term = `%${q}%`
  const orgId = ctx.org.id

  const [accounts, contacts, opps, projects, tasks, docs, tenders] = await Promise.all([
    ctx.supabase.from('accounts').select('id, name').eq('organization_id', orgId).ilike('name', term).limit(6),
    ctx.supabase
      .from('contacts')
      .select('id, first_name, last_name, email')
      .eq('organization_id', orgId)
      .or(`last_name.ilike.${term},first_name.ilike.${term},email.ilike.${term}`)
      .limit(6),
    ctx.supabase.from('opportunities').select('id, title').eq('organization_id', orgId).ilike('title', term).limit(6),
    ctx.supabase.from('projects').select('id, name, code').eq('organization_id', orgId).or(`name.ilike.${term},code.ilike.${term}`).limit(6),
    ctx.supabase.from('tasks').select('id, title').eq('organization_id', orgId).ilike('title', term).limit(6),
    ctx.supabase.from('documents').select('id, name').eq('organization_id', orgId).ilike('name', term).limit(6),
    ctx.supabase
      .from('tenders')
      .select('id, title, reference')
      .eq('organization_id', orgId)
      .or(`title.ilike.${term},reference.ilike.${term}`)
      .limit(6),
  ])

  const results: SearchResult[] = []
  for (const r of accounts.data ?? []) results.push({ type: 'account', id: r.id, label: r.name })
  for (const r of contacts.data ?? [])
    results.push({
      type: 'contact',
      id: r.id,
      label: [r.first_name, r.last_name].filter(Boolean).join(' '),
      sub: r.email ?? undefined,
    })
  for (const r of opps.data ?? []) results.push({ type: 'opportunity', id: r.id, label: r.title })
  for (const r of projects.data ?? [])
    results.push({ type: 'project', id: r.id, label: r.name, sub: r.code })
  for (const r of tasks.data ?? []) results.push({ type: 'task', id: r.id, label: r.title })
  for (const r of docs.data ?? []) results.push({ type: 'document', id: r.id, label: r.name })
  for (const r of tenders.data ?? [])
    results.push({ type: 'tender', id: r.id, label: r.title, sub: r.reference ?? undefined })
  return results
}

/** Recherche d'entités ciblables pour lier un document. */
export async function searchLinkableEntities(
  ctx: Ctx,
  entityType: string,
  q: string,
): Promise<{ id: string; label: string }[]> {
  const term = `%${q}%`
  const orgId = ctx.org.id
  const limit = 8

  switch (entityType) {
    case 'account': {
      const { data } = await ctx.supabase
        .from('accounts').select('id, name').eq('organization_id', orgId).ilike('name', term).limit(limit)
      return (data ?? []).map((r: { id: string; name: string }) => ({ id: r.id, label: r.name }))
    }
    case 'contact': {
      const { data } = await ctx.supabase
        .from('contacts').select('id, first_name, last_name').eq('organization_id', orgId)
        .or(`last_name.ilike.${term},first_name.ilike.${term}`).limit(limit)
      return (data ?? []).map((r: { id: string; first_name: string | null; last_name: string }) => ({
        id: r.id,
        label: [r.first_name, r.last_name].filter(Boolean).join(' '),
      }))
    }
    case 'lead': {
      const { data } = await ctx.supabase
        .from('leads').select('id, title').eq('organization_id', orgId).ilike('title', term).limit(limit)
      return (data ?? []).map((r: { id: string; title: string }) => ({ id: r.id, label: r.title }))
    }
    case 'opportunity': {
      const { data } = await ctx.supabase
        .from('opportunities').select('id, title').eq('organization_id', orgId).ilike('title', term).limit(limit)
      return (data ?? []).map((r: { id: string; title: string }) => ({ id: r.id, label: r.title }))
    }
    case 'project': {
      const { data } = await ctx.supabase
        .from('projects').select('id, name, code').eq('organization_id', orgId)
        .or(`name.ilike.${term},code.ilike.${term}`).limit(limit)
      return (data ?? []).map((r: { id: string; name: string; code: string }) => ({
        id: r.id,
        label: `${r.code} — ${r.name}`,
      }))
    }
    case 'task': {
      const { data } = await ctx.supabase
        .from('tasks').select('id, title').eq('organization_id', orgId).ilike('title', term).limit(limit)
      return (data ?? []).map((r: { id: string; title: string }) => ({ id: r.id, label: r.title }))
    }
    case 'tender': {
      const { data } = await ctx.supabase
        .from('tenders').select('id, title, reference').eq('organization_id', orgId)
        .or(`title.ilike.${term},reference.ilike.${term}`).limit(limit)
      return (data ?? []).map((r: { id: string; title: string; reference: string | null }) => ({
        id: r.id,
        label: r.reference ? `${r.reference} — ${r.title}` : r.title,
      }))
    }
    default:
      return []
  }
}
