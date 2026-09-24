import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveListParams, toPaged } from '@/lib/dal/list'
import type { Document, DocumentLink, ListParams } from '@/lib/types'

type Ctx = { supabase: SupabaseClient; org: { id: string } }

export async function listDocuments(ctx: Ctx, params: ListParams & { folder?: string } = {}) {
  const { page, pageSize, from, to } = resolveListParams(params)
  let q = ctx.supabase
    .from('documents')
    .select('*', { count: 'exact' })
    .eq('organization_id', ctx.org.id)
    .order('created_at', { ascending: false })
    .range(from, to)
  if (params.folder) q = q.eq('folder_path', params.folder)
  if (params.q) q = q.ilike('name', `%${params.q}%`)
  const { data, count, error } = await q
  if (error) throw error
  return toPaged((data ?? []) as Document[], count, page, pageSize)
}

export async function listFolders(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from('documents')
    .select('folder_path')
    .eq('organization_id', ctx.org.id)
  const folders = new Set<string>(['/'])
  for (const d of data ?? []) folders.add(d.folder_path)
  return [...folders].sort()
}

export async function getDocument(ctx: Ctx, id: string) {
  const { data } = await ctx.supabase
    .from('documents')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
    .maybeSingle()
  return data as Document | null
}

export async function getDocumentLinks(ctx: Ctx, documentId: string) {
  const { data } = await ctx.supabase
    .from('document_links')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .eq('document_id', documentId)
  return (data ?? []) as DocumentLink[]
}

export async function getEntityDocuments(ctx: Ctx, entityType: string, entityId: string) {
  const { data } = await ctx.supabase
    .from('document_links')
    .select('document:documents(*)')
    .eq('organization_id', ctx.org.id)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
  return (data ?? [])
    .map((r: { document: Document | Document[] }) =>
      Array.isArray(r.document) ? r.document[0] : r.document,
    )
    .filter(Boolean) as Document[]
}
