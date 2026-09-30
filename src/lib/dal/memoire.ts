import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MemoireAnalysis } from '@/lib/memoire/types'

type Ctx = { supabase: SupabaseClient; org: { id: string } }

export type MemoireRunStatus =
  | 'draft'
  | 'analyzed'
  | 'generated'
  | 'built'
  | 'built_full'
  | 'error'

export interface MemoireRunRow {
  id: string
  tender_id: string
  lot_id: string | null
  lot_label: string
  status: MemoireRunStatus
  analysis: MemoireAnalysis & { skipped?: { name: string; reason: string }[] }
  content_document_id: string | null
  content_filename: string | null
  docx_document_id: string | null
  docx_filename: string | null
  docx_full_document_id: string | null
  docx_full_filename: string | null
  warnings: string[]
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  error: string | null
  created_at: string
  updated_at: string
}

export async function listMemoireRuns(ctx: Ctx, tenderId: string) {
  const { data } = await ctx.supabase
    .from('tender_memoire_runs')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: false })
    .limit(10)
  return (data ?? []) as MemoireRunRow[]
}
