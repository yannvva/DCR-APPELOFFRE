'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, GripVertical, MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertsBadge,
  DeadlineBadge,
  VisitBadge,
} from '@/components/tenders/tender-badges'
import { TENDER_STATUS_LABELS } from '@/components/tenders/constants'
import { setTenderStatus } from '@/app/actions/tenders'
import { formatEuros } from '@/lib/format'
import { tenderPath } from '@/lib/slug'
import { cn } from '@/lib/utils'
import type { Tender, TenderStatus } from '@/lib/types'

/**
 * Kanban des dossiers d'AO : une colonne par étape du cycle de réponse.
 * Cartes **déplaçables à la souris** (glisser-déposer) ou par flèches —
 * mise à jour optimiste, rollback si le serveur refuse (checklist
 * incomplète pour « Prêt à déposer »/« Déposé », toast explicite).
 */
const COLUMNS: {
  key: string
  statuses: TenderStatus[]
  label: string
  /** Colonne cible de dépôt : « Clôturé » n'accepte pas de drop (ambigu). */
  droppable: boolean
}[] = [
  { key: 'detecte', statuses: ['detecte'], label: 'Détecté', droppable: true },
  { key: 'analyse', statuses: ['analyse'], label: 'Analyse', droppable: true },
  {
    key: 'en_preparation',
    statuses: ['en_preparation'],
    label: 'En préparation',
    droppable: true,
  },
  {
    key: 'a_deposer',
    statuses: ['a_deposer'],
    label: 'Prêt à déposer',
    droppable: true,
  },
  { key: 'depose', statuses: ['depose'], label: 'Déposé', droppable: true },
  {
    key: 'clos',
    statuses: ['gagne', 'perdu', 'abandonne', 'annule'],
    label: 'Clôturé',
    droppable: false,
  },
]

const ORDER: TenderStatus[] = [
  'detecte',
  'analyse',
  'en_preparation',
  'a_deposer',
  'depose',
]

export function AoKanban({
  orgSlug,
  tenders,
  canEdit,
}: {
  orgSlug: string
  tenders: Tender[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  // Statut affiché immédiatement après un dépôt, en attendant le refresh.
  // L'override ne vaut que tant que le statut serveur n'a pas bougé : dès que
  // les données rafraîchies arrivent, il devient caduc sans effet de bord.
  const [overrides, setOverrides] = useState<
    Record<string, { from: TenderStatus; to: TenderStatus }>
  >({})

  const statusOf = (t: Tender) => {
    const o = overrides[t.id]
    return o && o.from === t.status ? o.to : t.status
  }
  const byColumn = useMemo(() => {
    const map = new Map<string, Tender[]>()
    const effective = (t: Tender) => {
      const o = overrides[t.id]
      return o && o.from === t.status ? o.to : t.status
    }
    for (const col of COLUMNS) {
      map.set(
        col.key,
        tenders.filter((t) => col.statuses.includes(effective(t))),
      )
    }
    return map
  }, [tenders, overrides])

  function applyMove(t: Tender, next: TenderStatus) {
    if (statusOf(t) === next) return
    setOverrides((o) => ({ ...o, [t.id]: { from: t.status, to: next } }))
    start(async () => {
      const res = await setTenderStatus(orgSlug, t.id, next)
      if (res?.error) {
        toast.error(res.error)
        setOverrides((o) => {
          const n = { ...o }
          delete n[t.id]
          return n
        })
      } else {
        toast.success(`« ${t.title} » → ${TENDER_STATUS_LABELS[next]}`)
        router.refresh()
      }
    })
  }

  function move(t: Tender, dir: -1 | 1) {
    const i = ORDER.indexOf(statusOf(t))
    // Dossier clôturé : la flèche « précédent » le rouvre sur « Déposé »
    // (dernière étape ouverte) — utile en cas de clôture par erreur.
    const next = i === -1 && dir === -1 ? 'depose' : ORDER[i + dir]
    if (!next) return
    applyMove(t, next)
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {COLUMNS.map((col) => {
        const rows = byColumn.get(col.key) ?? []
        const isTarget = col.droppable && overCol === col.key
        return (
          <section
            key={col.key}
            onDragOver={(e) => {
              if (!col.droppable || !dragId) return
              e.preventDefault()
              setOverCol(col.key)
            }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={(e) => {
              e.preventDefault()
              setOverCol(null)
              if (!col.droppable) return
              const t = tenders.find((x) => x.id === dragId)
              setDragId(null)
              if (t) applyMove(t, col.statuses[0])
            }}
            className={cn(
              'flex min-h-32 flex-col rounded-lg border border-border bg-muted/30 p-2 transition-colors',
              isTarget && 'border-primary/60 bg-primary/5 ring-1 ring-primary/30',
            )}
          >
            <header className="mb-2 flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {col.label}
              </h3>
              <Badge variant="secondary" className="text-[10px] tabular-nums">
                {rows.length}
              </Badge>
            </header>
            <div className="space-y-2">
              {rows.map((t) => (
                <article
                  key={t.id}
                  draggable={canEdit}
                  onDragStart={(e) => {
                    setDragId(t.id)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', t.id)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setOverCol(null)
                  }}
                  className={cn(
                    'rounded-md border border-border bg-card p-2.5 text-sm shadow-sm',
                    canEdit && 'cursor-grab active:cursor-grabbing',
                    dragId === t.id && 'opacity-40',
                  )}
                >
                  <div className="flex items-start gap-1">
                    {canEdit && (
                      <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
                    )}
                    <div className="min-w-0 flex-1">
                      <Link
                        href={tenderPath(orgSlug, t)}
                        className="line-clamp-2 font-medium leading-snug hover:underline"
                      >
                        {t.title}
                      </Link>
                      {t.reference && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{t.reference}</p>
                      )}
                      {t.buyer?.name && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {t.buyer.name}
                        </p>
                      )}
                      {t.estimated_amount_cents != null && t.estimated_amount_cents > 0 && (
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                          {formatEuros(t.estimated_amount_cents)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <DeadlineBadge deadline={t.response_deadline} status={t.status} />
                    <VisitBadge tender={t} />
                    <AlertsBadge orgSlug={orgSlug} tender={t} alerts={t.alerts} />
                  </div>
                  {t.completeness && t.completeness.required > 0 && (
                    <div className="mt-1.5">
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            t.completeness.pct === 100
                              ? 'bg-emerald-500'
                              : t.completeness.pct >= 50
                                ? 'bg-amber-500'
                                : 'bg-red-500',
                          )}
                          style={{ width: `${t.completeness.pct}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                        {t.completeness.validated}/{t.completeness.required} pièces validées
                      </p>
                    </div>
                  )}
                  {canEdit && (
                    <div className="mt-1.5 flex items-center justify-between">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={pending || ORDER.indexOf(statusOf(t)) === 0}
                        onClick={() => move(t, -1)}
                        aria-label="Étape précédente"
                        title={
                          ORDER.indexOf(statusOf(t)) === -1
                            ? 'Rouvrir (→ Déposé)'
                            : undefined
                        }
                      >
                        <ChevronLeft className="size-3.5" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              disabled={pending}
                              aria-label={`Clôturer ${t.title}`}
                            >
                              <MoreHorizontal className="size-3.5" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={statusOf(t) === 'gagne'}
                            onClick={() => applyMove(t, 'gagne')}
                          >
                            Gagné
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={statusOf(t) === 'perdu'}
                            onClick={() => applyMove(t, 'perdu')}
                          >
                            Perdu
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={statusOf(t) === 'abandonne'}
                            onClick={() => applyMove(t, 'abandonne')}
                          >
                            Abandonné
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={statusOf(t) === 'annule'}
                            onClick={() => applyMove(t, 'annule')}
                          >
                            Annulé
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={
                          pending ||
                          ORDER.indexOf(statusOf(t)) === -1 ||
                          ORDER.indexOf(statusOf(t)) === ORDER.length - 1
                        }
                        onClick={() => move(t, 1)}
                        aria-label="Étape suivante"
                      >
                        <ChevronRight className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </article>
              ))}
              {rows.length === 0 && (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                  {isTarget ? 'Déposer ici' : '—'}
                </p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
