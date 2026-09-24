import { notFound } from 'next/navigation'
import { requireMembership } from '@/lib/dal/auth'
import { getDefaultPipeline, listOpportunities, listContacts, searchAccounts } from '@/lib/dal/crm'
import { OpportunitiesKanban } from '@/components/crm/opportunities-kanban'
import { OpportunityDialog } from '@/components/crm/opportunity-dialog'

export default async function OpportunitiesPage({
  params,
  searchParams,
}: PageProps<'/[org]/crm/opportunities'>) {
  const { org: orgSlug } = await params
  const { new: isNew } = await searchParams
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const [pipelineData, opportunities, accounts, contacts] = await Promise.all([
    getDefaultPipeline(ctx),
    listOpportunities(ctx),
    searchAccounts(ctx, '', 100),
    listContacts(ctx, { pageSize: 100 }),
  ])

  if (!pipelineData) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Aucun pipeline configuré pour cette organisation.</p>
      </div>
    )
  }

  const canEdit = ctx.role !== 'viewer'

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-6 pt-5">
        <div>
          <h1 className="text-2xl font-semibold">Opportunités</h1>
          <p className="text-sm text-muted-foreground">{pipelineData.pipeline.name}</p>
        </div>
        {canEdit && (
          <OpportunityDialog
            orgSlug={orgSlug}
            accounts={accounts}
            contacts={contacts.rows.map((c) => ({
              id: c.id,
              name: [c.first_name, c.last_name].filter(Boolean).join(' '),
            }))}
            defaultOpen={isNew === '1'}
          />
        )}
      </div>
      <OpportunitiesKanban
        orgSlug={orgSlug}
        stages={pipelineData.stages}
        opportunities={opportunities}
        canEdit={canEdit}
      />
    </div>
  )
}
