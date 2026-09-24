'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { resolveAlert } from '@/app/actions/tenders'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SEVERITY_COLORS, SEVERITY_LABELS } from './constants'
import type { TenderAlert } from '@/lib/types'

const ORDER = { bloquante: 0, critique: 1, importante: 2, info: 3 } as const

export function AlertsPanel({
  orgSlug,
  tenderId,
  alerts,
  canEdit,
}: {
  orgSlug: string
  tenderId: string
  alerts: TenderAlert[]
  canEdit: boolean
}) {
  const [pending, startTransition] = useTransition()
  const sorted = [...alerts].sort((a, b) => ORDER[a.severity] - ORDER[b.severity])

  if (sorted.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-4" />
        Aucune alerte — le dossier est conforme aux contrôles automatiques.
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {sorted.map((a) => (
        <li
          key={a.id}
          className="flex items-start gap-3 rounded-lg border border-border px-4 py-3"
        >
          <AlertTriangle
            className={cn(
              'mt-0.5 size-4 shrink-0',
              a.severity === 'bloquante' || a.severity === 'critique'
                ? 'text-destructive'
                : 'text-amber-500',
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className={cn('text-[10px]', SEVERITY_COLORS[a.severity])}
              >
                {SEVERITY_LABELS[a.severity]}
              </Badge>
              <span className="text-sm font-medium">{a.message}</span>
            </div>
            {a.recommended_action && (
              <p className="mt-1 text-xs text-muted-foreground">
                Action recommandée : {a.recommended_action}
              </p>
            )}
            {a.due_date && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Échéance interne : {formatDate(a.due_date)}
              </p>
            )}
          </div>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await resolveAlert(orgSlug, a.id, tenderId)
                  if (res?.error) toast.error(res.error)
                  else toast.success('Alerte résolue')
                })
              }
            >
              Résoudre
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
