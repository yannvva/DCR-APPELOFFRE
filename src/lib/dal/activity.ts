import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActivityLog } from '@/lib/types'

type Ctx = { supabase: SupabaseClient; org: { id: string } }

export async function listActivity(
  ctx: Ctx,
  opts: { entityType?: string; entityId?: string; limit?: number } = {},
) {
  let q = ctx.supabase
    .from('activity_logs')
    .select('*, actor:profiles!activity_logs_actor_id_fkey(full_name)')
    .eq('organization_id', ctx.org.id)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 20)
  if (opts.entityType) q = q.eq('entity_type', opts.entityType)
  if (opts.entityId) q = q.eq('entity_id', opts.entityId)
  const { data } = await q
  return (data ?? []) as ActivityLog[]
}
