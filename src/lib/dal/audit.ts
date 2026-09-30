import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditLog } from '@/lib/types'

type Ctx = { supabase: SupabaseClient; org: { id: string }; role: string }

/**
 * Journal d'audit — RLS limite déjà la lecture à owner/admin ; le garde-fou
 * de rôle évite la requête pour les autres membres.
 */
export async function listAuditLogs(ctx: Ctx, limit = 30) {
  if (ctx.role !== 'owner' && ctx.role !== 'admin') return []
  const { data } = await ctx.supabase
    .from('audit_logs')
    .select('*, actor:profiles!audit_logs_actor_id_fkey(full_name)')
    .eq('organization_id', ctx.org.id)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as AuditLog[]
}
