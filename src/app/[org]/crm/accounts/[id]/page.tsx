import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Globe, MapPin, Pencil, Phone, Plus } from 'lucide-react'
import { requireMembership } from '@/lib/dal/auth'
import { getAccount, getEntityTags, listContacts, listOpportunities, listTags } from '@/lib/dal/crm'
import { listTenders } from '@/lib/dal/tenders'
import { getEntityDocuments } from '@/lib/dal/documents'
import { listActivity } from '@/lib/dal/activity'
import { AccountDialog } from '@/components/crm/account-dialog'
import { ContactDialog } from '@/components/crm/contact-dialog'
import { OpportunityDialog } from '@/components/crm/opportunity-dialog'
import { CopyButton } from '@/components/copy-button'
import { TagPicker } from '@/components/tag-picker'
import { EntityDocuments } from '@/components/entity-documents'
import { ActivityFeed } from '@/components/activity-feed'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatEuros, formatDate, formatRelative, isOverdue } from '@/lib/format'
import { tenderPath } from '@/lib/slug'
import { TENDER_STATUS_COLORS, TENDER_STATUS_LABELS } from '@/components/tenders/constants'
import { cn } from '@/lib/utils'

export default async function AccountDetailPage({
  params,
}: PageProps<'/[org]/crm/accounts/[id]'>) {
  const { org: orgSlug, id } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const account = await getAccount(ctx, id)
  if (!account) notFound()

  const canEdit = ctx.role !== 'viewer'
  const [contacts, opportunities, tags, appliedTags, documents, activity, tenders] =
    await Promise.all([
      listContacts(ctx, { accountId: id, pageSize: 50 }),
      listOpportunities(ctx, { accountId: id }),
      listTags(ctx),
      getEntityTags(ctx, 'account', id),
      getEntityDocuments(ctx, 'account', id),
      listActivity(ctx, { entityType: 'account', entityId: id, limit: 15 }),
      listTenders(ctx, { buyerId: id, pageSize: 50 }),
    ])

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          aria-label="Retour aux entreprises"
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
            <h2 className="mb-3 flex items-center justify-between text-sm font-semibold">
              <span>
                Contacts{' '}
                <span className="font-normal text-muted-foreground">
                  ({contacts.count})
                </span>
              </span>
              {canEdit && (
                <ContactDialog
                  orgSlug={orgSlug}
                  accounts={[{ id: account.id, name: account.name }]}
                  defaultAccountId={account.id}
                  trigger={
                    <Button variant="ghost" size="xs">
                      <Plus className="size-3.5" /> Ajouter
                    </Button>
                  }
                />
              )}
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
            <h2 className="mb-3 flex items-center justify-between text-sm font-semibold">
              <span>
                Opportunités{' '}
                <span className="font-normal text-muted-foreground">
                  ({opportunities.length})
                </span>
              </span>
              {canEdit && (
                <OpportunityDialog
                  orgSlug={orgSlug}
                  accounts={[{ id: account.id, name: account.name }]}
                  contacts={contacts.rows.map((c) => ({
                    id: c.id,
                    name:
                      [c.first_name, c.last_name].filter(Boolean).join(' ') ||
                      c.id,
                    accountId: c.account_id,
                  }))}
                  defaultAccountId={account.id}
                  trigger={
                    <Button variant="ghost" size="xs">
                      <Plus className="size-3.5" /> Ajouter
                    </Button>
                  }
                />
              )}
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
            <h2 className="mb-3 flex items-center justify-between text-sm font-semibold">
              <span>
                Appels d’offres{' '}
                <span className="font-normal text-muted-foreground">
                  ({tenders.count})
                </span>
              </span>
              {tenders.count > 0 && (
                <Link
                  href={`/${orgSlug}/tenders?acheteur=${id}`}
                  className="text-xs font-normal text-muted-foreground hover:text-foreground"
                >
                  Tout voir →
                </Link>
              )}
            </h2>
            {tenders.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun dossier pour cet acheteur.</p>
            ) : (
              <ul className="divide-y divide-border">
                {tenders.rows.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link
                      href={tenderPath(orgSlug, t)}
                      className="min-w-0 truncate font-medium hover:underline"
                    >
                      {t.title}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className={cn(
                          'text-xs tabular-nums',
                          isOverdue(t.response_deadline) &&
                            ['detecte', 'analyse', 'en_preparation', 'a_deposer'].includes(t.status)
                            ? 'font-medium text-destructive'
                            : 'text-muted-foreground',
                        )}
                      >
                        {formatDate(t.response_deadline)}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn('text-[10px]', TENDER_STATUS_COLORS[t.status])}
                      >
                        {TENDER_STATUS_LABELS[t.status]}
                      </Badge>
                    </span>
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
              folder={`Société/CRM — ${account.name}`.slice(0, 90)}
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
                  <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                  <a href={`tel:${account.phone}`} className="min-w-0 truncate text-primary hover:underline">
                    {account.phone}
                  </a>
                  <CopyButton value={account.phone} label="le téléphone" />
                </div>
              )}
              {account.address &&
                (() => {
                  const a = account.address
                  const line = [
                    [a.street, a.complement].filter(Boolean).join(', '),
                    [a.postal_code ?? a.zip, a.city].filter(Boolean).join(' '),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                  return line ? (
                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 text-muted-foreground" title="Reprise dans les DC1/DC2 générés">
                        {line}
                      </span>
                    </div>
                  ) : null
                })()}
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
