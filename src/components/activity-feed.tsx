import { formatRelative } from '@/lib/format'
import type { ActivityLog } from '@/lib/types'

const ACTION_LABELS: Record<string, string> = {
  created: 'a créé',
  updated: 'a modifié',
  commented: 'a commenté',
}

export function ActivityFeed({ entries }: { entries: ActivityLog[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune activité.</p>
  }
  return (
    <ul className="space-y-3">
      {entries.map((e) => (
        <li key={e.id} className="flex items-start gap-2.5 text-sm">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
          <div>
            <span className="font-medium">{e.actor?.full_name ?? 'Utilisateur'}</span>{' '}
            <span className="text-muted-foreground">
              {ACTION_LABELS[e.action] ?? e.action} — {e.entity_type}
            </span>
            <p className="text-xs text-muted-foreground">{formatRelative(e.created_at)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
