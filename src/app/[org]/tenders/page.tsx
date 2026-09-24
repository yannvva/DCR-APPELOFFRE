import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireMembership } from '@/lib/dal/auth'
import { listTenders } from '@/lib/dal/tenders'
import { searchAccounts } from '@/lib/dal/crm'
import { listOrgMembers } from '@/lib/dal/projects'
import { SearchInput, Pagination } from '@/components/list-toolbar'
import { TenderDialog } from '@/components/tenders/tender-dialog'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate, formatEuros, isOverdue, isDueSoon, daysUntil } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TENDER_STATUS_COLORS, TENDER_STATUS_LABELS } from '@/components/tenders/constants'
import type { TenderStatus } from '@/lib/types'
import { FileSignature } from 'lucide-react'
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

  const [{ rows, count, pageSize }, accounts, members] = await Promise.all([
    listTenders(ctx, { q, status, page }),
    searchAccounts(ctx, '', 100),
    listOrgMembers(ctx),
  ])
  const canEdit = ctx.role !== 'viewer'
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
          <TenderDialog orgSlug={orgSlug} accounts={accounts} members={memberOptions} />
        )}
      </div>

      <div className="flex items-center gap-3">
        <Suspense>
          <SearchInput placeholder="Rechercher (intitulé, référence)…" />
          <StatusFilter />
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
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Marché</TableHead>
                <TableHead>Acheteur</TableHead>
                <TableHead>Date limite</TableHead>
                <TableHead>Montant</TableHead>
                <TableHead>Complétude</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => {
                const days = daysUntil(t.response_deadline)
                const closed = ['depose', 'gagne', 'perdu', 'abandonne', 'annule'].includes(t.status)
                const pct = t.completeness?.pct ?? 0
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link
                        href={`/${orgSlug}/tenders/${t.id}`}
                        className="block font-medium hover:underline"
                      >
                        {t.title}
                      </Link>
                      {t.reference && (
                        <span className="text-xs text-muted-foreground">{t.reference}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{t.buyer?.name ?? '—'}</TableCell>
                    <TableCell>
                      <span className="text-sm">{formatDate(t.response_deadline)}</span>
                      {!closed && (
                        <Badge
                          variant="secondary"
                          className={cn(
                            'ml-2 text-[10px]',
                            isOverdue(t.response_deadline) &&
                              'bg-red-500/15 text-red-600 dark:text-red-300',
                            !isOverdue(t.response_deadline) &&
                              isDueSoon(t.response_deadline, 7) &&
                              'bg-amber-500/15 text-amber-600 dark:text-amber-300',
                          )}
                        >
                          {isOverdue(t.response_deadline)
                            ? `J+${Math.abs(days)} dépassé`
                            : `J-${days}`}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {formatEuros(t.estimated_amount_cents)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'text-sm font-medium tabular-nums',
                          pct === 100
                            ? 'text-emerald-600 dark:text-emerald-300'
                            : pct >= 50
                              ? 'text-amber-600 dark:text-amber-300'
                              : 'text-red-600 dark:text-red-300',
                        )}
                      >
                        {pct} %
                      </span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({t.completeness?.validated ?? 0}/{t.completeness?.required ?? 0})
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.responsible?.full_name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={cn('text-[10px]', TENDER_STATUS_COLORS[t.status])}
                      >
                        {TENDER_STATUS_LABELS[t.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Suspense>
        <Pagination count={count} page={page} pageSize={pageSize} />
      </Suspense>
    </div>
  )
}
