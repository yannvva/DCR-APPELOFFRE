import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { listCompanyDocuments } from '@/lib/company'
import { matchCompanyDocument } from '@/lib/checklist-company-match'
import type { ChecklistItemStatus } from '@/lib/types'

/**
 * Rattache les pièces du kit candidature société (Kbis, URSSAF,
 * attestations, DC1/DC2…) aux lignes de checklist d'un dossier qui n'ont
 * pas encore de document lié.
 *
 * La pièce est validée si elle est en règle ; sinon « à vérifier »
 * (expirée, ou signature requise non présente). Le document est aussi
 * lié au dossier via document_links pour l'onglet Documents.
 *
 * Appelée automatiquement à la création du dossier et à l'application de
 * l'analyse DCE — et manuellement via l'action autoAttachCompanyDocs.
 */
export async function attachCompanyDocsToChecklist(
  supabase: SupabaseClient,
  orgId: string,
  tenderId: string,
  userId: string,
): Promise<{ attached: number; validated: number }> {
  const { data: items } = await supabase
    .from('tender_checklist_items')
    .select('id, label, status, requires_signature, document_id')
    .eq('organization_id', orgId)
    .eq('tender_id', tenderId)
    .is('document_id', null)
    .neq('status', 'non_requis')

  const docs = await listCompanyDocuments(supabase, orgId)
  let attached = 0
  let validated = 0

  for (const item of items ?? []) {
    const doc = matchCompanyDocument(item.label, docs)
    if (!doc) continue
    const needsReview = doc.expired || (item.requires_signature && !doc.is_signed)
    const status: ChecklistItemStatus = needsReview ? 'a_verifier' : 'valide'
    const { error } = await supabase
      .from('tender_checklist_items')
      .update({
        document_id: doc.id,
        status,
        ...(status === 'valide'
          ? { validated_by: userId, validated_at: new Date().toISOString() }
          : {}),
      })
      .eq('organization_id', orgId)
      .eq('id', item.id)
    if (error) continue

    // Le document apparaît aussi dans l'onglet Documents du dossier
    await supabase.from('document_links').upsert(
      {
        organization_id: orgId,
        document_id: doc.id,
        entity_type: 'tender',
        entity_id: tenderId,
      },
      { onConflict: 'document_id,entity_type,entity_id' },
    )
    attached += 1
    if (status === 'valide') validated += 1
  }

  return { attached, validated }
}

// ============================ LIVRABLES GÉNÉRÉS ============================

/**
 * Filtre pur (testable) : la ligne de checklist cible-t-elle ce livrable ?
 * Une ligne préfixée « [Lot N] » n'accepte que le livrable de son lot ;
 * sans numéro de lot connu on ne prend pas le risque de l'écraser.
 */
export function checklistItemMatches(
  label: string,
  patterns: RegExp[],
  lotNumber?: number | null,
): boolean {
  if (!patterns.some((p) => p.test(label))) return false
  const lotTag = /^\s*\[lot\s*(\d+)\s*\]/i.exec(label)
  return lotTag ? lotNumber != null && Number(lotTag[1]) === lotNumber : true
}

/**
 * Synchronise les lignes de checklist avec un fait du pipeline :
 * - livrable généré (DC1/DC2, mémoire) → `document_id` + « à vérifier »
 *   (la validation humaine reste requise — un DOCX généré n'est pas signé)
 * - fait post-dépôt (« dossier téléversé ») → « validé »
 *
 * Les lignes `valide`, `non_requis` et `forced_valid` ne sont jamais
 * réécrites : une validation humaine n'est pas écrasée par un pipeline.
 */
export async function syncChecklistItems(
  supabase: SupabaseClient,
  orgId: string,
  tenderId: string,
  labelPatterns: RegExp[],
  patch: {
    document_id?: string
    status?: ChecklistItemStatus
    validated_by?: string | null
    validated_at?: string | null
  },
  opts?: { lotNumber?: number | null },
): Promise<number> {
  const { data: items } = await supabase
    .from('tender_checklist_items')
    .select('id, label')
    .eq('organization_id', orgId)
    .eq('tender_id', tenderId)
    .eq('forced_valid', false)
    .not('status', 'in', '("valide","non_requis")')
  const targets = (items ?? []).filter((i) =>
    checklistItemMatches(i.label, labelPatterns, opts?.lotNumber),
  )
  let updated = 0
  for (const item of targets) {
    const { error } = await supabase
      .from('tender_checklist_items')
      .update(patch)
      .eq('organization_id', orgId)
      .eq('id', item.id)
    if (!error) updated += 1
  }
  return updated
}
