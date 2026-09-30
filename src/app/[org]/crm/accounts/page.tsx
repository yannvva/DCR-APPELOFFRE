import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireMembership } from '@/lib/dal/auth'
import { listAccounts } from '@/lib/dal/crm'
import { countTendersByBuyer } from '@/lib/dal/tenders'
import { AccountDialog } from '@/components/crm/account-dialog'
import { SearchInput, Pagination } from '@/components/list-toolbar'
import { RowActions } from '@/components/row-actions'
import { deleteAccount } from '@/app/actions/crm'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatRelative } from '@/lib/format'
import { Badge } from '@/components/ui/badge'

export default async function AccountsPage({
  params,
  searchParams,
}: PageProps<'/[org]/crm/accounts'>) {
  const { org: orgSlug } = await params
  const sp = await searchParams
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const q = typeof sp.q === 'string' ? sp.q : ''
  const page = Math.max(1, Number(sp.page ?? 1) || 1)
  const [{ rows, count, pageSize }, tenderCounts] = await Promise.all([
    listAccounts(ctx, { q, page }),
    countTendersByBuyer(ctx),
  ])
  const canEdit = ctx.role !== 'viewer'

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Entreprises</h1>
          <p className="text-sm text-muted-foreground">Clients, prospects et partenaires</p>
        </div>
        {canEdit && (
          <AccountDialog
            key={sp.new === '1' ? 'new' : 'default'}
            orgSlug={orgSlug}
            defaultOpen={sp.new === '1'}
          />
        )}
      </div>

      <SearchInput placeholder="Rechercher une entreprise…" />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="font-medium">Aucune entreprise</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {q ? 'Aucun résultat pour cette recherche.' : 'Créez votre première entreprise.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Domaine</TableHead>
                <TableHead>Secteur</TableHead>
                <TableHead>AO</TableHead>
                <TableHead>Mis à jour</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link
                      href={`/${orgSlug}/crm/accounts/${a.id}`}
                      className="font-medium hover:underline"
                    >
                      {a.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.domain ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{a.industry ?? '—'}</TableCell>
                  <TableCell>
                    {(() => {
                      const c = tenderCounts.get(a.id)
                      if (!c) return <span className="text-muted-foreground">—</span>
                      return (
                        <Link
                          href={`/${orgSlug}/crm/accounts/${a.id}`}
                          className="inline-flex items-center gap-1.5 hover:underline"
                        >
                          <span className="text-sm tabular-nums">{c.total}</span>
                          {c.open > 0 && (
                            <Badge variant="secondary" className="text-[10px]">
                              {c.open} en cours
                            </Badge>
                          )}
                        </Link>
                      )
                    })()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelative(a.updated_at)}
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <RowActions
                        label={a.name}
                        onDelete={async () => {
                          'use server'
                          return deleteAccount(orgSlug, a.id)
                        }}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination count={count} page={page} pageSize={pageSize} />
    </div>
  )
}
