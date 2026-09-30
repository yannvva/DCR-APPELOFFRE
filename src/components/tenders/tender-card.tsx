import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TenderDialog } from '@/components/tenders/tender-dialog'
import { RowActions } from '@/components/row-actions'
import { CompletenessCell } from '@/components/tenders/completeness-cell'
import { AlertsBadge, DeadlineBadge, VisitBadge } from '@/components/tenders/tender-badges'
import { deleteTender } from '@/app/actions/tenders'
import { TENDER_STATUS_COLORS, TENDER_STATUS_LABELS } from '@/components/tenders/constants'
import { formatDate, formatEuros, isOverdue } from '@/lib/format'
import { tenderPath } from '@/lib/slug'
import { cn } from '@/lib/utils'
import type { Tender } from '@/lib/types'

const CLOSED = ['depose', 'gagne', 'perdu', 'abandonne', 'annule']

type MemberOption = { user_id: string; full_name: string | null }

/** Vue cartes des AO — informations critiques visibles d'un coup d'œil :
 *  statut, deadline, visite obligatoire, complétude, acheteur, montant. */
export function TenderCard({
  orgSlug,
  tender: t,
  accounts,
  members,
  canEdit,
  canDelete,
}: {
  orgSlug: string
  tender: Tender
  accounts: { id: string; name: string }[]
  members: MemberOption[]
  canEdit: boolean
  canDelete: boolean
}) {
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={tenderPath(orgSlug, t)}
            className="line-clamp-2 font-medium leading-snug hover:underline"
          >
            {t.title}
          </Link>
          {t.reference && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              réf. {t.reference}
            </p>
          )}
        </div>
        <Badge
          variant="secondary"
          className={cn('shrink-0 text-[10px]', TENDER_STATUS_COLORS[t.status])}
        >
          {TENDER_STATUS_LABELS[t.status]}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'text-xs text-muted-foreground',
            isOverdue(t.response_deadline) &&
              !CLOSED.includes(t.status) &&
              'font-medium text-destructive',
          )}
        >
          Limite : {formatDate(t.response_deadline)}
        </span>
        <DeadlineBadge deadline={t.response_deadline} status={t.status} />
        <VisitBadge tender={t} />
        <AlertsBadge orgSlug={orgSlug} tender={t} alerts={t.alerts} />
      </div>

      <dl className="space-y-1 border-t border-border pt-2.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-xs text-muted-foreground">Acheteur</dt>
          <dd className="min-w-0 truncate">
            {t.buyer ? (
              <Link
                href={`/${orgSlug}/crm/accounts/${t.buyer.id}`}
                className="hover:underline"
              >
                {t.buyer.name}
              </Link>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-xs text-muted-foreground">Montant</dt>
          <dd className="tabular-nums">
            {t.estimated_amount_cents ? formatEuros(t.estimated_amount_cents) : '—'}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-xs text-muted-foreground">Responsable</dt>
          <dd className="min-w-0 truncate">{t.responsible?.full_name ?? '—'}</dd>
        </div>
      </dl>

      <div className="mt-auto border-t border-border pt-2.5">
        <p className="mb-1 text-xs text-muted-foreground">Complétude</p>
        <CompletenessCell
          orgSlug={orgSlug}
          tender={t}
          completeness={t.completeness}
        />
      </div>

      {canEdit && (
        <div className="flex justify-end gap-1">
          <TenderDialog
            orgSlug={orgSlug}
            tender={t}
            accounts={accounts}
            members={members}
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label={`Modifier ${t.title}`}>
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
      )}
    </article>
  )
}
