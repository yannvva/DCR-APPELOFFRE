import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireMembership } from '@/lib/dal/auth'
import { listTenders, listTenderStats } from '@/lib/dal/tenders'
import { searchAccounts } from '@/lib/dal/crm'
import { listOrgMembers } from '@/lib/dal/projects'
import { SearchInput, Pagination } from '@/components/list-toolbar'
import { TenderDialog } from '@/components/tenders/tender-dialog'
import { CompletenessCell } from '@/components/tenders/completeness-cell'
import { AlertsBadge, DeadlineBadge, VisitBadge } from '@/components/tenders/tender-badges'
import { TenderCard } from '@/components/tenders/tender-card'
import { ViewToggle } from '@/components/tenders/view-toggle'
import { SortButton } from '@/components/tenders/sortable-head'
import { RowActions } from '@/components/row-actions'
import { deleteTender } from '@/app/actions/tenders'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatEuros, isOverdue, isDueSoon } from '@/lib/format'
import { tenderPath } from '@/lib/slug'
import { cn } from '@/lib/utils'
import { TENDER_STATUS_COLORS, TENDER_STATUS_LABELS } from '@/components/tenders/constants'
import { Button } from '@/components/ui/button'
import type { TenderStatus } from '@/lib/types'
import { FileSignature, Pencil } from 'lucide-react'
import { Suspense } from 'react'
import { StatusFilter } from './status-filter'

export default async function TendersPage({
  params,
  searchParams,
}: PageProps<'/[org]/tenders'>) {
  const { org: orgSlug } = await params
  const sp = await searchParams
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const q = typeof sp.q === 'string' ? sp.q : ''
  const status = typeof sp.status === 'string' ? (sp.status as TenderStatus) : undefined
  const page = Math.max(1, Number(sp.page ?? 1) || 1)
  const view = sp.view === 'cards' ? 'cards' : 'list'
  const sort = typeof sp.sort === 'string' ? sp.sort : undefined
  const order = sp.order === 'desc' ? 'desc' : 'asc'

  const [{ rows, count, pageSize }, accounts, members, stats] = await Promise.all([
    listTenders(ctx, { q, status, page, sort, order }),
    searchAccounts(ctx, '', 100),
    listOrgMembers(ctx),
    listTenderStats(ctx),
  ])
  const canEdit = ctx.role !== 'viewer'
  const canDelete = ctx.role === 'owner' || ctx.role === 'admin'
  const memberOptions = members.map((m) => ({
    user_id: m.user_id,
    full_name: m.profiles?.full_name ?? null,
  }))

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Appels d’offres</h1>
          <p className="text-sm text-muted-foreground">
            Dossiers de réponse aux marchés publics
          </p>
        </div>
        {canEdit && (
          <TenderDialog
            key={sp.new === '1' ? 'new' : 'default'}
            orgSlug={orgSlug}
            accounts={accounts}
            members={memberOptions}
            defaultOpen={sp.new === '1'}
          />
        )}
      </div>

      {/* Synthèse du portefeuille — l'essentiel en un coup d'œil */}
      {stats.total > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">En cours</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">{stats.open}<span className="ml-1 text-xs font-normal text-muted-foreground">/ {stats.total}</span></p>
          </div>
          <div className={cn('rounded-lg border px-3 py-2', stats.dueSoon ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-card')}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Urgents ≤ 7 j</p>
            <p className={cn('mt-0.5 text-lg font-bold tabular-nums', stats.dueSoon && 'text-amber-600 dark:text-amber-300')}>{stats.dueSoon}</p>
          </div>
          <div className={cn('rounded-lg border px-3 py-2', stats.overdue ? 'border-red-500/40 bg-red-500/10' : 'border-border bg-card')}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Dépassés</p>
            <p className={cn('mt-0.5 text-lg font-bold tabular-nums', stats.overdue && 'text-destructive')}>{stats.overdue}</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Montant en cours</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums">{stats.openAmountCents ? formatEuros(stats.openAmountCents) : '—'}</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Suspense>
          <SearchInput placeholder="Rechercher (intitulé, référence)…" />
          <StatusFilter />
          <ViewToggle />
        </Suspense>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <FileSignature className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Aucun appel d’offres</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {q || status
              ? 'Aucun résultat pour ces filtres.'
              : 'Créez votre premier dossier de réponse pour commencer.'}
          </p>
        </div>
      ) : view === 'cards' ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => (
            <TenderCard
              key={t.id}
              orgSlug={orgSlug}
              tender={t}
              accounts={accounts}
              members={memberOptions}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {/* En-tête compact — triable sur les colonnes clés */}
          <div className="hidden items-center gap-x-4 border-b border-border bg-muted/40 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:grid lg:grid-cols-[minmax(0,1fr)_7.5rem_6.5rem_9rem_8rem_7rem_4.5rem]">
            <Suspense fallback={<span>Marché</span>}>
              <SortButton field="title">Marché</SortButton>
            </Suspense>
            <Suspense fallback={<span>Date limite</span>}>
              <SortButton field="response_deadline">Date limite</SortButton>
            </Suspense>
            <Suspense fallback={<span>Montant</span>}>
              <SortButton field="estimated_amount_cents">Montant</SortButton>
            </Suspense>
            <span>Complétude</span>
            <span>Responsable</span>
            <Suspense fallback={<span>Statut</span>}>
              <SortButton field="status">Statut</SortButton>
            </Suspense>
            <span className="sr-only">Actions</span>
          </div>
          <ul>
            {rows.map((t) => {
              const closed = ['depose', 'gagne', 'perdu', 'abandonne', 'annule'].includes(t.status)
              const overdue = !closed && isOverdue(t.response_deadline)
              const soon = !closed && !overdue && isDueSoon(t.response_deadline, 7)
              const initials = (t.responsible?.full_name ?? '')
                .split(' ')
                .map((w) => w[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('')
                .toUpperCase()
              return (
                <li
                  key={t.id}
                  className={cn(
                    'group relative border-b border-border border-l-[3px] transition-colors last:border-b-0 hover:bg-muted/40',
                    overdue
                      ? 'border-l-red-500'
                      : soon
                        ? 'border-l-amber-500'
                        : 'border-l-transparent',
                    closed && 'opacity-70',
                  )}
                >
                  {/* Ligne entière cliquable (lien étendu) — les éléments
                      interactifs internes portent `relative` pour rester
                      cliquables au-dessus. */}
                  <Link
                    href={tenderPath(orgSlug, t)}
                    aria-label={t.title}
                    className="absolute inset-0 z-0"
                  />
                  <div className="grid items-center gap-x-4 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_7.5rem_6.5rem_9rem_8rem_7rem_4.5rem]">
                    {/* Marché : titre, référence, acheteur, alertes */}
                    <div className="min-w-0">
                      <p className="truncate font-medium leading-snug">
                        <span className="group-hover:underline">{t.title}</span>
                      </p>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {t.reference && (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium">
                            {t.reference}
                          </span>
                        )}
                        {t.buyer ? (
                          <Link
                            href={`/${orgSlug}/crm/accounts/${t.buyer.id}`}
                            className="relative z-10 truncate hover:text-foreground hover:underline"
                          >
                            {t.buyer.name}
                          </Link>
                        ) : (
                          <span className="truncate">Acheteur non renseigné</span>
                        )}
                        {t.site_visit_mandatory && !closed && (
                          <span className="relative z-10">
                            <VisitBadge tender={t} />
                          </span>
                        )}
                        {t.alerts && !closed && (
                          <span className="relative z-10">
                            <AlertsBadge orgSlug={orgSlug} tender={t} alerts={t.alerts} />
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Date limite */}
                    <div>
                      <p
                        className={cn(
                          'whitespace-nowrap text-xs font-medium tabular-nums',
                          overdue && 'text-destructive',
                        )}
                      >
                        {formatDate(t.response_deadline)}
                      </p>
                      <DeadlineBadge deadline={t.response_deadline} status={t.status} />
                    </div>

                    {/* Montant */}
                    <p className="text-xs font-medium tabular-nums">
                      {t.estimated_amount_cents ? formatEuros(t.estimated_amount_cents) : '—'}
                    </p>

                    {/* Complétude */}
                    <div className="relative z-10">
                      <CompletenessCell
                        orgSlug={orgSlug}
                        tender={t}
                        completeness={t.completeness}
                      />
                    </div>

                    {/* Responsable */}
                    <p className="flex min-w-0 items-center gap-1.5">
                      {t.responsible ? (
                        <>
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                            {initials || '?'}
                          </span>
                          <span className="truncate text-xs">
                            {t.responsible.full_name}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </p>

                    {/* Statut */}
                    <div>
                      <Badge
                        variant="secondary"
                        className={cn('text-[10px]', TENDER_STATUS_COLORS[t.status])}
                      >
                        {TENDER_STATUS_LABELS[t.status]}
                      </Badge>
                    </div>

                    {/* Actions */}
                    {canEdit ? (
                      <div className="relative z-10 flex items-center justify-end gap-0.5">
                        <TenderDialog
                          orgSlug={orgSlug}
                          tender={t}
                          accounts={accounts}
                          members={memberOptions}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Modifier ${t.title}`}
                              className="opacity-60 transition-opacity group-hover:opacity-100"
                            >
                              <Pencil className="size-4" />
                            </Button>
                          }
                        />
                        {canDelete && (
                          <RowActions
                            label={t.title}
                            onDelete={async () => {
                              'use server'
                              return deleteTender(orgSlug, t.id)
                            }}
                          />
                        )}
                      </div>
                    ) : (
                      <span />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <Suspense>
        <Pagination count={count} page={page} pageSize={pageSize} />
      </Suspense>
    </div>
  )
}
