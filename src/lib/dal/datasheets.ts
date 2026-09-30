import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ChapterDef,
  ChapterResult,
  DatasheetConfig,
  DownloadEntry,
} from '@/lib/datasheets/types'

type Ctx = { supabase: SupabaseClient; org: { id: string } }

export type DatasheetRunStatus =
  | 'draft'
  | 'brief_ready'
  | 'researched'
  | 'downloaded'
  | 'error'

export interface DatasheetRunRow {
  id: string
  tender_id: string
  lot_id: string | null
  lot_label: string
  status: DatasheetRunStatus
  config: DatasheetConfig & {
    doutes?: string[]
    skipped?: { name: string; reason: string }[]
    files?: string[]
    deliverables?: { id: string; name: string }[]
    /** Couverture au moment de l'export (affichée sur la carte Livrables). */
    deliverable_stats?: {
      produits: number
      documents: number
      avecUrl: number
      pdfLivres: number
      sansUrl: number
      pdfsEmbarques: number
      /** Ajoutés après le 1er export : absents sur les runs plus anciens. */
      fichesFabricants?: number
      fichesFabricantsLivrees?: number
      prescriptions?: number
      /** Contrôle d'intégrité : PDF livrés attendus dans le ZIP. */
      pdfsAttendus?: number
      exporteLe: string
    }
  }
  chapters: Record<string, ChapterDef>
  result: Record<string, ChapterResult>
  download_report: Record<string, DownloadEntry>
  deliverable_document_ids: string[]
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  error: string | null
  created_at: string
  updated_at: string
}

export async function listDatasheetRuns(ctx: Ctx, tenderId: string) {
  const { data } = await ctx.supabase
    .from('tender_datasheet_runs')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: false })
    .limit(20)
  return (data ?? []) as DatasheetRunRow[]
}
