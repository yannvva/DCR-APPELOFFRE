'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  AlarmClock,
  ChevronDown,
  ClipboardList,
  MapPin,
  ShieldAlert,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { daysUntil, formatDate } from '@/lib/format'
import { tenderPath } from '@/lib/slug'
import type { Tender, TenderAlert } from '@/lib/types'

export interface AgendaChecklistItem {
  id: string
  label: string
  status: string
  internal_deadline: string
  tender_id: string
  tender: { id: string; title: string } | null
  assignee: { full_name: string } | null
}

export interface AgendaAlert {
  id: string
  severity: TenderAlert['severity']
  message: string
  tender_id: string
  tender: { title: string } | null
}

/**
 * Bandeau repliable « événements à faire » issus des dossiers d'AO :
 * deadlines de dépôt, deadline questions, visites de site, pièces de
 * checklist à échéance interne et alertes de conformité ouvertes.
 */
export function TenderAgenda({
  orgSlug,
  deadlines,
  visits,
  checklist,
  alerts,
}: {
  orgSlug: string
  deadlines: Tender[]
  visits: Tender[]
  checklist: AgendaChecklistItem[]
  alerts: AgendaAlert[]
}) {
  const [open, setOpen] = useState(false)
  const total =
    deadlines.length + visits.length + checklist.length + alerts.length

  return (
    <div className="px-6 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5 text-left transition-colors hover:border-foreground/20"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <AlarmClock className="size-4 text-muted-foreground" />
          Agenda appels d’offres
          <Badge variant="secondary" className="tabular-nums">
            {total}
          </Badge>
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {!open && total > 0 && (
            <span className="hidden sm:block">
              {[
                deadlines.length && `${deadlines.length} deadline${deadlines.length > 1 ? 's' : ''}`,
                visits.length && `${visits.length} visite${visits.length > 1 ? 's' : ''}`,
                checklist.length && `${checklist.length} pièce${checklist.length > 1 ? 's' : ''} à produire`,
                alerts.length && `${alerts.length} alerte${alerts.length > 1 ? 's' : ''}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
          <ChevronDown
            className={cn('size-4 transition-transform', open && 'rotate-180')}
          />
        </span>
      </button>

      {open && (
        <div className="mt-3 grid gap-3 pb-1 md:grid-cols-2 xl:grid-cols-4">
          <AgendaCard
            icon={AlarmClock}
            title="Deadlines de dépôt"
            empty="Aucune deadline proche."
            count={deadlines.length}
          >
            {deadlines.map((t) => {
              const days = daysUntil(t.response_deadline)
              const qDays = t.questions_deadline
                ? daysUntil(t.questions_deadline)
                : null
              return (
                <li key={t.id} className="py-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={tenderPath(orgSlug, t)}
                      className="min-w-0 truncate hover:underline"
                    >
                      {t.title}
                    </Link>
                    <Badge
                      variant="secondary"
                      className={cn(
                        'shrink-0 text-[10px]',
                        days <= 3
                          ? 'bg-red-500/15 text-red-600 dark:text-red-300'
                          : 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
                      )}
                    >
                      {days < 0 ? `J+${Math.abs(days)}` : `J-${days}`}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Dépôt {formatDate(t.response_deadline)}
                    {qDays != null &&
                      ` · Questions ${formatDate(t.questions_deadline)}${qDays < 0 ? ' (dépassée)' : ` (J-${qDays})`}`}
                  </p>
                </li>
              )
            })}
          </AgendaCard>

          <AgendaCard
            icon={MapPin}
            title="Visites de site"
            empty="Aucune visite planifiée."
            count={visits.length}
          >
            {visits.map((t) => {
              const days = daysUntil(t.site_visit_at)
              return (
                <li key={t.id} className="py-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={tenderPath(orgSlug, t)}
                      className="min-w-0 truncate hover:underline"
                    >
                      {t.title}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatDate(t.site_visit_at)}
                      {days >= 0 && ` (J-${days})`}
                    </span>
                  </div>
                  {t.site_visit_mandatory && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        'mt-0.5 text-[10px]',
                        t.site_visit_justified
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                          : 'bg-red-500/15 text-red-600 dark:text-red-300',
                      )}
                    >
                      {t.site_visit_justified
                        ? 'Obligatoire — justifiée'
                        : 'Obligatoire — à justifier'}
                    </Badge>
                  )}
                </li>
              )
            })}
          </AgendaCard>

          <AgendaCard
            icon={ClipboardList}
            title="Pièces à produire"
            empty="Aucune pièce à échéance proche."
            count={checklist.length}
          >
            {checklist.map((i) => {
              const days = daysUntil(i.internal_deadline)
              return (
                <li key={i.id} className="py-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={tenderPath(orgSlug, {
                        id: i.tender_id,
                        title: i.tender?.title ?? '',
                      })}
                      className="min-w-0 truncate hover:underline"
                    >
                      {i.label}
                    </Link>
                    <span
                      className={cn(
                        'shrink-0 text-xs tabular-nums',
                        days < 0
                          ? 'text-destructive'
                          : 'text-muted-foreground',
                      )}
                    >
                      {days < 0 ? `J+${Math.abs(days)}` : `J-${days}`}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {i.tender?.title}
                    {i.assignee?.full_name && ` · ${i.assignee.full_name}`}
                  </p>
                </li>
              )
            })}
          </AgendaCard>

          <AgendaCard
            icon={ShieldAlert}
            title="Alertes de conformité"
            empty="Aucune alerte ouverte."
            count={alerts.length}
          >
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-2 py-1.5 text-sm">
                <Badge
                  variant="secondary"
                  className={cn(
                    'mt-0.5 shrink-0 text-[10px]',
                    a.severity === 'bloquante' &&
                      'bg-red-500/15 text-red-600 dark:text-red-300',
                    a.severity === 'critique' &&
                      'bg-orange-500/15 text-orange-600 dark:text-orange-300',
                    a.severity === 'importante' &&
                      'bg-amber-500/15 text-amber-600 dark:text-amber-300',
                    a.severity === 'info' &&
                      'bg-sky-500/15 text-sky-600 dark:text-sky-300',
                  )}
                >
                  {a.severity}
                </Badge>
                <Link
                  href={tenderPath(orgSlug, {
                    id: a.tender_id,
                    title: a.tender?.title ?? '',
                  })}
                  className="min-w-0 hover:underline"
                >
                  {a.message}
                  {a.tender?.title && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {a.tender.title}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </AgendaCard>
        </div>
      )}
    </div>
  )
}

function AgendaCard({
  icon: Icon,
  title,
  empty,
  count,
  children,
}: {
  icon: typeof AlarmClock
  title: string
  empty: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
        {count > 0 && (
          <Badge variant="secondary" className="ml-auto text-[10px] tabular-nums">
            {count}
          </Badge>
        )}
      </p>
      {count === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">{children}</ul>
      )}
    </div>
  )
}
