'use server'

import { revalidatePath } from 'next/cache'
import { requireMembership } from '@/lib/dal/auth'
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  unreadNotificationCount,
} from '@/lib/dal/notifications'

/** Données pour la cloche — appelée depuis le client (polling/ouverture). */
export async function getMyNotifications(orgSlug: string) {
  const ctx = await requireMembership(orgSlug)
  if (!ctx) return { items: [], unread: 0 }
  const [items, unread] = await Promise.all([
    listMyNotifications(ctx),
    unreadNotificationCount(ctx),
  ])
  return { items, unread }
}

export async function markNotificationRead(orgSlug: string, id: string) {
  const ctx = await requireMembership(orgSlug)
  if (!ctx) return
  await markNotificationsRead(ctx, [id])
  revalidatePath(`/${orgSlug}`, 'layout')
}

export async function markAllRead(orgSlug: string) {
  const ctx = await requireMembership(orgSlug)
  if (!ctx) return
  await markAllNotificationsRead(ctx)
  revalidatePath(`/${orgSlug}`, 'layout')
}
