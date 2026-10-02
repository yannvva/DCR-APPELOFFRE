import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { requireMembership } from '@/lib/dal/auth'

type DalContext = NonNullable<Awaited<ReturnType<typeof requireMembership>>>

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string | null
  entity_type: string | null
  entity_id: string | null
  read_at: string | null
  created_at: string
}

/**
 * Crée des notifications pour des utilisateurs. INSERT réservé au service
 * role — la policy `notifications_insert` n'existe pas (écriture système
 * uniquement, jamais côté client). Dédupliqué : une notification non lue
 * identique (même user + type + entité + titre) n'est pas recréée.
 * @returns le nombre de notifications réellement créées.
 */
export async function notifyUsers({
  organizationId,
  userIds,
  type,
  title,
  body,
  entityType,
  entityId,
}: {
  organizationId: string
  userIds: string[]
  type: string
  title: string
  body?: string
  entityType?: string
  entityId?: string
}): Promise<number> {
  const targets = [...new Set(userIds)].filter(Boolean)
  if (targets.length === 0) return 0

  // Une notification est un effet de bord : elle ne doit JAMAIS faire échouer
  // l'action métier qui la déclenche (clé service absente, RLS, réseau…).
  try {
    const admin = createAdminClient()

    // Dedup : on saute les users ayant déjà cette notif non lue.
    let query = admin
      .from('notifications')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('type', type)
      .eq('title', title)
      .is('read_at', null)
      .in('user_id', targets)
    if (entityType) query = query.eq('entity_type', entityType)
    if (entityId) query = query.eq('entity_id', entityId)
    const { data: existing } = await query
    const skip = new Set((existing ?? []).map((r) => r.user_id as string))

    const rows = targets
      .filter((uid) => !skip.has(uid))
      .map((uid) => ({
        organization_id: organizationId,
        user_id: uid,
        type,
        title,
        body: body ?? null,
        entity_type: entityType ?? null,
        entity_id: entityId ?? null,
      }))
    if (rows.length) await admin.from('notifications').insert(rows)
    return rows.length
  } catch {
    return 0
  }
}

export async function listMyNotifications(
  ctx: DalContext,
  limit = 20,
): Promise<NotificationItem[]> {
  const { data } = await ctx.supabase
    .from('notifications')
    .select('id, type, title, body, entity_type, entity_id, read_at, created_at')
    .eq('organization_id', ctx.org.id)
    .eq('user_id', ctx.user.id)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as NotificationItem[]
}

export async function unreadNotificationCount(ctx: DalContext): Promise<number> {
  const { count } = await ctx.supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', ctx.org.id)
    .eq('user_id', ctx.user.id)
    .is('read_at', null)
  return count ?? 0
}

export async function markNotificationsRead(ctx: DalContext, ids: string[]) {
  if (!ids.length) return
  await ctx.supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('organization_id', ctx.org.id)
    .eq('user_id', ctx.user.id)
    .in('id', ids)
    .is('read_at', null)
}

export async function markAllNotificationsRead(ctx: DalContext) {
  await ctx.supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('organization_id', ctx.org.id)
    .eq('user_id', ctx.user.id)
    .is('read_at', null)
}
