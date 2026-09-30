import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveListParams, toPaged } from '@/lib/dal/list'
import { normalizeFolderPath } from '@/lib/folder-tree'
import type { Document, DocumentLink, ListParams } from '@/lib/types'

type Ctx = { supabase: SupabaseClient; org: { id: string } }

export interface DocumentListParams extends ListParams {
  folder?: string
  /** Recherche dans le sous-arbre du dossier (exact + descendants). */
  subtree?: boolean
  /** Filtre par extension de fichier (« pdf », « zip »…). */
  ext?: string
  /** Filtre par `document_type` métier (Fiche_technique, DoP…). */
  dtype?: string
  sort?: 'recent' | 'name' | 'size'
}

export async function listDocuments(ctx: Ctx, params: DocumentListParams = {}) {
  const { page, pageSize, from, to } = resolveListParams(params)
  let q = ctx.supabase
    .from('documents')
    .select('*', { count: 'exact' })
    .eq('organization_id', ctx.org.id)
  if (params.folder && params.subtree) {
    // Dossier courant + descendants — les guillemets protègent les virgules
    // des noms de dossier dans la syntaxe `or()` de PostgREST.
    const f = params.folder.replaceAll('"', '')
    q = q.or(`folder_path.eq."${f}",folder_path.like."${f}/%"`)
  } else if (params.folder) {
    q = q.eq('folder_path', params.folder)
  }
  if (params.q) q = q.ilike('name', `%${params.q}%`)
  if (params.dtype) q = q.eq('document_type', params.dtype)
  if (params.ext) {
    const e = params.ext.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (e) q = q.ilike('name', `%.${e}`)
  }
  q =
    params.sort === 'name'
      ? q.order('name')
      : params.sort === 'size'
        ? q.order('size_bytes', { ascending: false })
        : q.order('created_at', { ascending: false })
  const { data, count, error } = await q.range(from, to)
  if (error) throw error
  return toPaged((data ?? []) as Document[], count, page, pageSize)
}

/** Facettes du dossier courant (types de pièces + extensions présentes) —
 *  alimente les filtres de la page Documents. */
export async function listDocumentFacets(ctx: Ctx, folder: string) {
  let q = ctx.supabase
    .from('documents')
    .select('name, document_type')
    .eq('organization_id', ctx.org.id)
  if (folder !== '/') q = q.eq('folder_path', folder)
  const { data } = await q
  const types = new Set<string>()
  const exts = new Set<string>()
  for (const d of data ?? []) {
    if (d.document_type) types.add(d.document_type)
    const m = (d.name ?? '').match(/\.([a-z0-9]{2,6})$/i)
    if (m) exts.add(m[1].toLowerCase())
  }
  return { types: [...types].sort(), exts: [...exts].sort() }
}

/** Dossiers de l'organisation et nombre de documents rangés dedans.
 *  Les chemins sont normalisés (pas de slash initial) : les liens et les
 *  valeurs historiques restent exploitables. */
export async function listFolders(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from('documents')
    .select('folder_path')
    .eq('organization_id', ctx.org.id)
  const counts = new Map<string, number>()
  for (const d of data ?? []) {
    const path = normalizeFolderPath(d.folder_path)
    counts.set(path, (counts.get(path) ?? 0) + 1)
  }
  return [...counts].map(([path, count]) => ({ path, count }))
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

/** Compteur d'usage par document (entités liées) — liste Documents. */
export async function countDocumentUsage(ctx: Ctx, documentIds: string[]) {
  const map = new Map<string, number>()
  if (!documentIds.length) return map
  const { data } = await ctx.supabase
    .from('document_links')
    .select('document_id')
    .eq('organization_id', ctx.org.id)
    .in('document_id', documentIds)
  for (const l of data ?? []) {
    map.set(l.document_id, (map.get(l.document_id) ?? 0) + 1)
  }
  return map
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
