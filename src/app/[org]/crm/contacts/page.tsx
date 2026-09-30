import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireMembership } from '@/lib/dal/auth'
import { listContacts, searchAccounts } from '@/lib/dal/crm'
import { ContactDialog } from '@/components/crm/contact-dialog'
import { SearchInput, Pagination } from '@/components/list-toolbar'
import { RowActions } from '@/components/row-actions'
import { deleteContact } from '@/app/actions/crm'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default async function ContactsPage({
  params,
  searchParams,
}: PageProps<'/[org]/crm/contacts'>) {
  const { org: orgSlug } = await params
  const sp = await searchParams
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const q = typeof sp.q === 'string' ? sp.q : ''
  const page = Math.max(1, Number(sp.page ?? 1) || 1)
  const [{ rows, count, pageSize }, accounts] = await Promise.all([
    listContacts(ctx, { q, page }),
    searchAccounts(ctx, '', 100),
  ])
  const canEdit = ctx.role !== 'viewer'

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-sm text-muted-foreground">Personnes liées à vos entreprises</p>
        </div>
        {canEdit && (
          <ContactDialog
            key={sp.new === '1' ? 'new' : 'default'}
            orgSlug={orgSlug}
            accounts={accounts}
            defaultOpen={sp.new === '1'}
          />
        )}
      </div>

      <SearchInput placeholder="Rechercher un contact…" />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="font-medium">Aucun contact</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {q ? 'Aucun résultat pour cette recherche.' : 'Créez votre premier contact.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Téléphone</TableHead>
                <TableHead>Entreprise</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/${orgSlug}/crm/contacts/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {[c.first_name, c.last_name].filter(Boolean).join(' ')}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.email ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.phone ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.account?.name ?? '—'}
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <RowActions
                        label={[c.first_name, c.last_name].filter(Boolean).join(' ')}
                        onDelete={async () => {
                          'use server'
                          return deleteContact(orgSlug, c.id)
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
