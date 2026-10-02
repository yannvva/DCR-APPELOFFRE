'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  getMyNotifications,
  markAllRead,
  markNotificationRead,
} from '@/app/actions/notifications'
import { formatRelative } from '@/lib/format'
import type { NotificationItem } from '@/lib/dal/notifications'

function entityHref(orgSlug: string, n: NotificationItem): string | null {
  if (!n.entity_id) return null
  switch (n.entity_type) {
    case 'tender':
      return `/${orgSlug}/tenders/${n.entity_id}`
    case 'project':
      return `/${orgSlug}/projects/${n.entity_id}`
    case 'document':
      return `/${orgSlug}/documents`
    default:
      return null
  }
}

export function NotificationBell({ orgSlug }: { orgSlug: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)

  const refresh = useCallback(async () => {
    const res = await getMyNotifications(orgSlug)
    setItems(res.items)
    setUnread(res.unread)
  }, [orgSlug])

  useEffect(() => {
    // Chargement initial différé (microtâche) puis rafraîchissement
    // périodique : l'état n'est jamais posé pendant le rendu de l'effet.
    const initial = setTimeout(() => void refresh(), 0)
    const t = setInterval(() => void refresh(), 60_000)
    return () => {
      clearTimeout(initial)
      clearInterval(t)
    }
  }, [refresh])

  async function openItem(n: NotificationItem) {
    if (!n.read_at) void markNotificationRead(orgSlug, n.id)
    setOpen(false)
    const href = entityHref(orgSlug, n)
    if (href) router.push(href)
    else void refresh()
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) void refresh()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Notifications${unread > 0 ? ` (${unread} non lues)` : ''}`}
            className="relative"
          />
        }
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 && (
            <button
              type="button"
              onClick={async () => {
                await markAllRead(orgSlug)
                void refresh()
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="size-3.5" /> Tout marquer lu
            </button>
          )}
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              Aucune notification.
            </li>
          ) : (
            items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => void openItem(n)}
                  className="w-full px-3 py-2.5 text-left hover:bg-accent/60"
                >
                  <p
                    className={`flex items-start gap-2 text-sm ${n.read_at ? 'text-muted-foreground' : 'font-medium'}`}
                  >
                    {!n.read_at && (
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                    <span className="min-w-0 flex-1">{n.title}</span>
                  </p>
                  {n.body && (
                    <p className="mt-0.5 line-clamp-2 pl-3.5 text-xs text-muted-foreground">
                      {n.body}
                    </p>
                  )}
                  <p className="mt-0.5 pl-3.5 text-[10px] text-muted-foreground">
                    {formatRelative(n.created_at)}
                  </p>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
