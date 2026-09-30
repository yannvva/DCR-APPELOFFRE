import { HardHat, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { formatDate, isOverdue, isDueSoon, daysUntil } from '@/lib/format'
import { tenderPath } from '@/lib/slug'
import { cn } from '@/lib/utils'
import type { AlertSeverity, Tender } from '@/lib/types'

const CLOSED = ['depose', 'gagne', 'perdu', 'abandonne', 'annule']

/** Badge J-x / dépassé sur la date limite de réponse (liste + cartes). */
export function DeadlineBadge({
  deadline,
  status,
}: {
  deadline: string
  status: string
}) {
  if (CLOSED.includes(status)) return null
  const days = daysUntil(deadline)
  const overdue = isOverdue(deadline)
  return (
    <Badge
      variant="secondary"
      className={cn(
        'text-[10px]',
        overdue && 'bg-red-500/15 text-red-600 dark:text-red-300',
        !overdue &&
          isDueSoon(deadline, 7) &&
          'bg-amber-500/15 text-amber-600 dark:text-amber-300',
      )}
    >
      {overdue ? `J+${Math.abs(days)} dépassé` : `J-${days}`}
    </Badge>
  )
}

/** Badge visite obligatoire : rouge si à planifier/dépassée, ambre si
 *  planifiée, vert une fois justifiée. */
export function VisitBadge({ tender }: { tender: Tender }) {
  if (!tender.site_visit_mandatory || CLOSED.includes(tender.status)) return null
  const missed =
    !tender.site_visit_justified &&
    (tender.site_visit_at ? isOverdue(tender.site_visit_at) : true)
  return (
    <Badge
      variant="secondary"
      className={cn(
        'gap-1 text-[10px]',
        missed
          ? 'bg-red-500/15 text-red-600 dark:text-red-300'
          : tender.site_visit_justified
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
            : 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
      )}
    >
      <HardHat className="size-3" />
      {tender.site_visit_justified
        ? 'Visite faite'
        : tender.site_visit_at
          ? `Visite obligatoire — ${formatDate(tender.site_visit_at)}`
          : 'Visite obligatoire — date à planifier'}
    </Badge>
  )
}

const SEV_COLOR: Record<AlertSeverity, string> = {
  bloquante: 'bg-red-500/15 text-red-600 dark:text-red-300',
  critique: 'bg-orange-500/15 text-orange-600 dark:text-orange-300',
  importante: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  info: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
}

/** Pastille « N alerte(s) » colorée par la pire sévérité — liste et cartes. */
export function AlertsBadge({
  orgSlug,
  tender,
  alerts,
}: {
  orgSlug: string
  tender: { id: string; title: string }
  alerts: { count: number; worst: AlertSeverity } | null | undefined
}) {
  if (!alerts?.count) return null
  return (
    <Link href={tenderPath(orgSlug, tender)}>
      <Badge
        variant="secondary"
        className={cn('gap-0.5 px-1.5 text-[10px]', SEV_COLOR[alerts.worst])}
        title={`${alerts.count} alerte${alerts.count > 1 ? 's' : ''} de conformité non résolue${alerts.count > 1 ? 's' : ''} — la plus grave : ${alerts.worst}`}
        aria-label={`${alerts.count} alertes de conformité, ouvrir le dossier`}
      >
        <ShieldAlert className="size-3" />
        <span className="tabular-nums">{alerts.count}</span>
      </Badge>
    </Link>
  )
}
