import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocType } from '@/lib/datasheets/types'

type Ctx = { supabase: SupabaseClient; org: { id: string } }

export interface DatasheetLibraryItem {
  id: string
  organization_id: string
  designation: string
  brand: string
  reference: string
  doc_type: DocType | string
  theme: string | null
  source_url: string | null
  statut: string
  document_id: string | null
  dedup_key: string
  created_at: string
  updated_at: string
  /** Nombre de dossiers d'AO qui utilisent ce document (document_links). */
  usage_count: number
  /** Document lié (nom/taille) — null si le document a été supprimé. */
  document?: { name: string; size_bytes: number } | null
}

export interface LibraryFilters {
  brand?: string
  theme?: string
  docType?: string
  q?: string
}

const norm = (s: string | null | undefined) =>
  (s ?? '')
    // Qualificatifs entre parenthèses ignorés (« Knauf (marque citée au
    // CCTP… ) », « dB35 Feu E (panneau composite…) ») : la même fiche
    // produit doit être réutilisée quelle que soit l'annotation agent.
    .replace(/\([^)]*\)/g, ' ')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')

/** Clé de dédup « marque|référence|type » — même produit entre plusieurs AO. */
export function datasheetDedupKey(
  brand: string,
  reference: string,
  docType: string,
): string {
  return `${norm(brand)}|${norm(reference)}|${norm(docType)}`
}

/**
 * Liste la bibliothèque produits + nombre de dossiers utilisant chaque
 * document. Les filtres s'appliquent côté SQL pour les colonnes, la
 * recherche `q` couvre désignation/marque/référence via `or`.
 */
export async function listDatasheetLibrary(
  ctx: Ctx,
  filters: LibraryFilters = {},
): Promise<DatasheetLibraryItem[]> {
  let q = ctx.supabase
    .from('datasheet_library')
    .select('*, document:documents(name, size_bytes)')
    .eq('organization_id', ctx.org.id)
    .order('brand')
    .order('designation')
    .limit(500)
  if (filters.brand) q = q.eq('brand', filters.brand)
  if (filters.theme) q = q.eq('theme', filters.theme)
  if (filters.docType) q = q.eq('doc_type', filters.docType)
  if (filters.q) {
    const v = filters.q.replace(/[%_]/g, '\\$&').trim()
    if (v)
      q = q.or(
        `designation.ilike.%${v}%,brand.ilike.%${v}%,reference.ilike.%${v}%`,
      )
  }
  const { data } = await q
  const rows = (data ?? []) as Omit<DatasheetLibraryItem, 'usage_count'>[]

  // Comptage d'usage par document : liens vers des dossiers d'AO.
  const docIds = [...new Set(rows.map((r) => r.document_id).filter(Boolean))] as string[]
  const usage = new Map<string, number>()
  if (docIds.length) {
    const { data: links } = await ctx.supabase
      .from('document_links')
      .select('document_id, entity_id')
      .eq('organization_id', ctx.org.id)
      .eq('entity_type', 'tender')
      .in('document_id', docIds)
    for (const l of links ?? [])
      usage.set(l.document_id, (usage.get(l.document_id) ?? 0) + 1)
  }
  return rows.map((r) => ({ ...r, usage_count: usage.get(r.document_id ?? '') ?? 0 }))
}

/** Facettes pour les filtres : marques, thèmes et types distincts. */
export async function listDatasheetLibraryFacets(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from('datasheet_library')
    .select('brand, theme, doc_type')
    .eq('organization_id', ctx.org.id)
    .limit(2000)
  const brands = new Set<string>()
  const themes = new Set<string>()
  const docTypes = new Set<string>()
  for (const r of data ?? []) {
    if (r.brand) brands.add(r.brand)
    if (r.theme) themes.add(r.theme)
    if (r.doc_type) docTypes.add(r.doc_type)
  }
  return {
    brands: [...brands].sort((a, b) => a.localeCompare(b, 'fr')),
    themes: [...themes].sort((a, b) => a.localeCompare(b, 'fr')),
    docTypes: [...docTypes].sort((a, b) => a.localeCompare(b, 'fr')),
  }
}

/**
 * Recherche un document déjà téléchargé pour ce produit/type — permet de
 * réutiliser le PDF officiel au lieu de re-télécharger entre AO.
 */
export async function findLibraryDocument(
  ctx: Ctx,
  dedupKey: string,
): Promise<{ id: string; document_id: string | null } | null> {
  const { data } = await ctx.supabase
    .from('datasheet_library')
    .select('id, document_id')
    .eq('organization_id', ctx.org.id)
    .eq('dedup_key', dedupKey)
    .maybeSingle()
  return data as { id: string; document_id: string | null } | null
}

export interface LibraryUpsert {
  designation: string
  brand: string
  reference: string
  doc_type: string
  theme?: string | null
  source_url?: string | null
  statut?: string
  document_id?: string | null
}

/** Crée ou complète l'entrée bibliothèque — un document_id frais gagne. */
export async function upsertLibraryEntry(
  supabase: SupabaseClient,
  orgId: string,
  userId: string | null,
  entry: LibraryUpsert,
): Promise<void> {
  const dedupKey = datasheetDedupKey(entry.brand, entry.reference, entry.doc_type)
  const { data: existing } = await supabase
    .from('datasheet_library')
    .select('id, document_id, designation')
    .eq('organization_id', orgId)
    .eq('dedup_key', dedupKey)
    .maybeSingle()
  if (existing) {
    await supabase
      .from('datasheet_library')
      .update({
        document_id: entry.document_id ?? existing.document_id,
        designation: existing.designation || entry.designation,
        theme: entry.theme ?? undefined,
        source_url: entry.source_url ?? undefined,
        statut: entry.statut ?? undefined,
      })
      .eq('id', existing.id)
    return
  }
  await supabase.from('datasheet_library').insert({
    organization_id: orgId,
    designation: entry.designation.slice(0, 300),
    brand: entry.brand.slice(0, 200),
    reference: entry.reference.slice(0, 200),
    doc_type: entry.doc_type,
    theme: entry.theme ?? null,
    source_url: entry.source_url ?? null,
    statut: entry.statut ?? 'OK',
    document_id: entry.document_id ?? null,
    dedup_key: dedupKey,
    created_by: userId,
  })
}
