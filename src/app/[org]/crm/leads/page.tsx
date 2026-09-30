import { notFound } from 'next/navigation'
import { requireMembership } from '@/lib/dal/auth'
import { listLeads, searchAccounts } from '@/lib/dal/crm'
import { LeadDialog } from '@/components/crm/lead-dialog'
import { LeadStatusActions } from '@/components/crm/lead-status-actions'
import { SearchInput, Pagination } from '@/components/list-toolbar'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatRelative } from '@/lib/format'

const STATUS_LABELS: Record<string, { label: string; variant: 'secondary' | 'default' | 'outline' }> = {
  new: { label: 'Nouveau', variant: 'secondary' },
  contacted: { label: 'Contacté', variant: 'secondary' },
  qualified: { label: 'Qualifié', variant: 'default' },
  converted: { label: 'Converti', variant: 'outline' },
  lost: { label: 'Perdu', variant: 'outline' },
}

export default async function LeadsPage({
  params,
  searchParams,
}: PageProps<'/[org]/crm/leads'>) {
  const { org: orgSlug } = await params
  const sp = await searchParams
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const q = typeof sp.q === 'string' ? sp.q : ''
  const page = Math.max(1, Number(sp.page ?? 1) || 1)
  const [{ rows, count, pageSize }, accounts] = await Promise.all([
    listLeads(ctx, { q, page }),
    searchAccounts(ctx, '', 100),
  ])
  const canEdit = ctx.role !== 'viewer'

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">Prospects entrants à qualifier</p>
        </div>
        {canEdit && (
          <LeadDialog
            key={sp.new === '1' ? 'new' : 'idle'}
            orgSlug={orgSlug}
            accounts={accounts}
            defaultOpen={sp.new === '1'}
          />
        )}
      </div>

      <SearchInput placeholder="Rechercher un lead…" />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="font-medium">Aucun lead</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {q ? 'Aucun résultat pour cette recherche.' : 'Enregistrez vos prospects entrants ici.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titre</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Créé</TableHead>
                {canEdit && <TableHead className="w-56" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((lead) => {
                const s = STATUS_LABELS[lead.status] ?? STATUS_LABELS.new
                return (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium">{lead.title}</TableCell>
                    <TableCell className="text-muted-foreground">{lead.source ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelative(lead.created_at)}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <LeadStatusActions orgSlug={orgSlug} lead={lead} />
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination count={count} page={page} pageSize={pageSize} />
    </div>
  )
}
