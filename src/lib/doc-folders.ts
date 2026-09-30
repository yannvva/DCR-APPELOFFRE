import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeFolderPath } from './folder-tree'
import { shortAffaire } from './naming'

/**
 * Dossier de rangement par appel d'offres : les pièces importées (DCE) et
 * les documents générés (fiches techniques, mémoire, DC1/DC2) vivent sous
 * « AO — <référence> — <titre>/… » pour que /documents reste organisé par
 * marché plutôt que par type de pièce.
 */
export function tenderFolderName(
  tender: { title: string | null; reference?: string | null },
  sub?: string,
): string {
  // Libellé court (référence + premiers termes signifiants) : le titre complet
  // d'un AO dépasse souvent 90 caractères et donnait des chemins illisibles,
  // tronqués au milieu d'un mot.
  const base = shortAffaire(tender.title, tender.reference)
  return normalizeFolderPath(sub ? `${base}/${sub}` : base)
}

/** Résout le nom de dossier de l'AO (titre + référence depuis la base). */
export async function tenderFolderOf(
  supabase: SupabaseClient,
  orgId: string,
  tenderId: string,
  sub?: string,
): Promise<string> {
  const { data } = await supabase
    .from('tenders')
    .select('title, reference')
    .eq('organization_id', orgId)
    .eq('id', tenderId)
    .single()
  if (!data) return normalizeFolderPath(sub ?? 'AO')
  return tenderFolderName(data, sub)
}
