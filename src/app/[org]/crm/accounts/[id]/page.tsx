import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Globe, Pencil, Phone } from 'lucide-react'
import { requireMembership } from '@/lib/dal/auth'
import { getAccount, getEntityTags, listContacts, listOpportunities, listTags } from '@/lib/dal/crm'
import { getEntityDocuments } from '@/lib/dal/documents'
import { listActivity } from '@/lib/dal/activity'
import { AccountDialog } from '@/components/crm/account-dialog'
import { TagPicker } from '@/components/tag-picker'
import { EntityDocuments } from '@/components/entity-documents'
import { ActivityFeed } from '@/components/activity-feed'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatEuros, formatDate, formatRelative } from '@/lib/format'

export default async function AccountDetailPage({
  params,
}: PageProps<'/[org]/crm/accounts/[id]'>) {
  const { org: orgSlug, id } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const account = await getAccount(ctx, id)
  if (!account) notFound()

  const canEdit = ctx.role !== 'viewer'
  const [contacts, opportunities, tags, appliedTags, documents, activity] = await Promise.all([
    listContacts(ctx, { accountId: id, pageSize: 50 }),
    listOpportunities(ctx).then((all) => all.filter((o) => o.account_id === id)),
    listTags(ctx),
    getEntityTags(ctx, 'account', id),
    getEntityDocuments(ctx, 'account', id),
    listActivity(ctx, { entityType: 'account', entityId: id, limit: 15 }),
  ])

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href={`/${orgSlug}/crm/accounts`} />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">{account.name}</h1>
          <div className="mt-0.5 flex items-center gap-3 text-sm text-muted-foreground">
            {account.industry && <span>{account.industry}</span>}
            {account.domain && <span>{account.domain}</span>}
          </div>
        </div>
        {canEdit && (
          <AccountDialog
            orgSlug={orgSlug}
            account={account}
            trigger={
              <Button variant="outline" size="sm">
                <Pencil className="size-3.5" /> Modifier
              </Button>
            }
          />
        )}
      </div>

      <TagPicker
        orgSlug={orgSlug}
        entityType="account"
        entityId={id}
        allTags={tags}
        appliedTags={appliedTags}
        canEdit={canEdit}
      />

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Contacts <span className="text-muted-foreground">({contacts.count})</span>
            </h2>
            {contacts.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun contact lié.</p>
            ) : (
              <ul className="divide-y divide-border">
                {contacts.rows.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                    <Link
                      href={`/${orgSlug}/crm/contacts/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {[c.first_name, c.last_name].filter(Boolean).join(' ')}
                    </Link>
                    <span className="text-muted-foreground">{c.role ?? c.email ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Opportunités <span className="text-muted-foreground">({opportunities.length})</span>
            </h2>
            {opportunities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune opportunité.</p>
            ) : (
              <ul className="divide-y divide-border">
                {opportunities.map((o) => (
                  <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <span className="font-medium">{o.title}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {o.stage?.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {o.status !== 'open' && (
                        <Badge variant={o.status === 'won' ? 'default' : 'outline'}>
                          {o.status === 'won' ? 'Gagnée' : 'Perdue'}
                        </Badge>
                      )}
                      <span className="tabular-nums text-muted-foreground">
                        {formatEuros(o.value_cents)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold">Documents</h2>
            <EntityDocuments
              orgSlug={orgSlug}
              entityType="account"
              entityId={id}
              documents={documents}
              canEdit={canEdit}
            />
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border border-border p-4 text-sm">
            <h2 className="mb-3 text-sm font-semibold">Informations</h2>
            <dl className="space-y-2">
              {account.website && (
                <div className="flex items-center gap-2">
                  <Globe className="size-3.5 text-muted-foreground" />
                  <a
                    href={account.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-primary hover:underline"
                  >
                    {account.website.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              )}
              {account.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="size-3.5 text-muted-foreground" />
                  <span>{account.phone}</span>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Créée le {formatDate(account.created_at)} — mise à jour{' '}
                {formatRelative(account.updated_at)}
              </div>
            </dl>
            {account.notes && (
              <p className="mt-3 whitespace-pre-wrap border-t border-border pt-3 text-muted-foreground">
                {account.notes}
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold">Activité</h2>
            <ActivityFeed entries={activity} />
          </section>
        </div>
      </div>
    </div>
  )
}
