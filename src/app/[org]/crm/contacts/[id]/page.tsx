import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Building2, Mail, Pencil, Phone } from 'lucide-react'
import { requireMembership } from '@/lib/dal/auth'
import { getContact, getEntityTags, listTags, searchAccounts } from '@/lib/dal/crm'
import { getEntityDocuments } from '@/lib/dal/documents'
import { listActivity } from '@/lib/dal/activity'
import { ContactDialog } from '@/components/crm/contact-dialog'
import { TagPicker } from '@/components/tag-picker'
import { EntityDocuments } from '@/components/entity-documents'
import { ActivityFeed } from '@/components/activity-feed'
import { Button } from '@/components/ui/button'
import { formatDate, formatRelative } from '@/lib/format'

export default async function ContactDetailPage({
  params,
}: PageProps<'/[org]/crm/contacts/[id]'>) {
  const { org: orgSlug, id } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const contact = await getContact(ctx, id)
  if (!contact) notFound()

  const canEdit = ctx.role !== 'viewer'
  const [accounts, tags, appliedTags, documents, activity] = await Promise.all([
    searchAccounts(ctx, '', 100),
    listTags(ctx),
    getEntityTags(ctx, 'contact', id),
    getEntityDocuments(ctx, 'contact', id),
    listActivity(ctx, { entityType: 'contact', entityId: id, limit: 15 }),
  ])

  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ')

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href={`/${orgSlug}/crm/contacts`} />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">{fullName}</h1>
          <div className="mt-0.5 flex items-center gap-3 text-sm text-muted-foreground">
            {contact.role && <span>{contact.role}</span>}
            {contact.account && (
              <Link
                href={`/${orgSlug}/crm/accounts/${contact.account.id}`}
                className="inline-flex items-center gap-1 hover:underline"
              >
                <Building2 className="size-3.5" /> {contact.account.name}
              </Link>
            )}
          </div>
        </div>
        {canEdit && (
          <ContactDialog
            orgSlug={orgSlug}
            contact={contact}
            accounts={accounts}
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
        entityType="contact"
        entityId={id}
        allTags={tags}
        appliedTags={appliedTags}
        canEdit={canEdit}
      />

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold">Documents</h2>
            <EntityDocuments
              orgSlug={orgSlug}
              entityType="contact"
              entityId={id}
              documents={documents}
              canEdit={canEdit}
              folder={`CRM — ${fullName || 'Contact'}`.slice(0, 90)}
            />
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border border-border p-4 text-sm">
            <h2 className="mb-3 text-sm font-semibold">Informations</h2>
            <dl className="space-y-2">
              {contact.email && (
                <div className="flex items-center gap-2">
                  <Mail className="size-3.5 text-muted-foreground" />
                  <a href={`mailto:${contact.email}`} className="truncate text-primary hover:underline">
                    {contact.email}
                  </a>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="size-3.5 text-muted-foreground" />
                  <span>{contact.phone}</span>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Créé le {formatDate(contact.created_at)} — mis à jour{' '}
                {formatRelative(contact.updated_at)}
              </div>
            </dl>
            {contact.notes && (
              <p className="mt-3 whitespace-pre-wrap border-t border-border pt-3 text-muted-foreground">
                {contact.notes}
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
