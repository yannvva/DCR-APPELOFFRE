import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink, MapPin, Pencil } from 'lucide-react'
import { requireMembership } from '@/lib/dal/auth'
import {
  getTender,
  getTenderReadiness,
  getTenderResult,
  listChecklistItems,
  listSubmissions,
  listTenderAlerts,
  listTenderLots,
} from '@/lib/dal/tenders'
import { listOrgMembers } from '@/lib/dal/projects'
import { searchAccounts } from '@/lib/dal/crm'
import { getEntityDocuments } from '@/lib/dal/documents'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EntityDocuments } from '@/components/entity-documents'
import { AlertsPanel } from '@/components/tenders/alerts-panel'
import { ChecklistPanel } from '@/components/tenders/checklist-panel'
import { DepotPanel } from '@/components/tenders/depot-panel'
import { LotsPanel } from '@/components/tenders/lots-panel'
import { TenderDialog } from '@/components/tenders/tender-dialog'
import { TenderStatusSelect } from '@/components/tenders/tender-status-select'
import { SiteVisitButton } from '@/components/tenders/site-visit-button'
import { TENDER_STATUS_COLORS, TENDER_STATUS_LABELS } from '@/components/tenders/constants'
import { formatDate, formatEuros, isOverdue, daysUntil } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Document } from '@/lib/types'

export default async function TenderDetailPage({
  params,
}: PageProps<'/[org]/tenders/[id]'>) {
  const { org: orgSlug, id } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const tender = await getTender(ctx, id)
  if (!tender) notFound()

  const canEdit = ctx.role !== 'viewer'
  const [
    lots,
    checklist,
    alerts,
    submissions,
    result,
    readiness,
    documents,
    orgDocs,
    members,
    accounts,
  ] = await Promise.all([
    listTenderLots(ctx, id),
    listChecklistItems(ctx, id),
    listTenderAlerts(ctx, id),
    listSubmissions(ctx, id),
    getTenderResult(ctx, id),
    getTenderReadiness(ctx, id),
    getEntityDocuments(ctx, 'tender', id),
    ctx.supabase
      .from('documents')
      .select('id, name, valid_until, is_signed')
      .eq('organization_id', ctx.org.id)
      .order('name')
      .limit(200)
      .then((r) => (r.data ?? []) as Pick<Document, 'id' | 'name' | 'valid_until' | 'is_signed'>[]),
    listOrgMembers(ctx),
    searchAccounts(ctx, '', 100),
  ])

  const memberOptions = members.map((m) => ({
    user_id: m.user_id,
    full_name: m.profiles?.full_name ?? null,
  }))
  const openAlerts = alerts.length
  const closed = ['depose', 'gagne', 'perdu', 'abandonne', 'annule'].includes(tender.status)
  const daysLeft = daysUntil(tender.response_deadline)

  return (
    <div className="space-y-5 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href={`/${orgSlug}/tenders`} />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="truncate text-2xl font-semibold">{tender.title}</h1>
            {tender.reference && (
              <span className="text-sm text-muted-foreground">réf. {tender.reference}</span>
            )}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            {tender.buyer?.name && <span>{tender.buyer.name}</span>}
            <span
              className={cn(
                isOverdue(tender.response_deadline) && !closed && 'text-destructive',
                'font-medium',
              )}
            >
              Limite : {formatDate(tender.response_deadline)}
              {!closed && (daysLeft >= 0 ? ` (J-${daysLeft})` : ' — dépassée')}
            </span>
            {tender.site_visit_mandatory && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" />
                Visite obligatoire
                {tender.site_visit_justified ? ' (justifiée)' : ''}
              </span>
            )}
          </p>
        </div>
        <Badge
          variant="secondary"
          className={cn('text-xs', TENDER_STATUS_COLORS[tender.status])}
        >
          {TENDER_STATUS_LABELS[tender.status]}
        </Badge>
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            readiness.ready
              ? 'text-emerald-600 dark:text-emerald-300'
              : 'text-amber-600 dark:text-amber-300',
          )}
        >
          {readiness.pct} % conforme
        </span>
        {canEdit && <TenderStatusSelect orgSlug={orgSlug} tenderId={id} status={tender.status} />}
        {canEdit && (
          <TenderDialog
            orgSlug={orgSlug}
            tender={tender}
            lots={lots}
            accounts={accounts}
            members={memberOptions}
            trigger={
              <Button variant="outline" size="sm">
                <Pencil className="size-3.5" /> Modifier
              </Button>
            }
          />
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Vue d’ensemble</TabsTrigger>
          <TabsTrigger value="checklist">
            Checklist
            {readiness.ready ? null : (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {readiness.validated}/{readiness.required}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="documents">
            Documents
            {documents.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {documents.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="depot">
            Dépôt
            {openAlerts > 0 && (
              <Badge variant="secondary" className="ml-1.5 bg-red-500/15 text-[10px] text-red-600">
                {openAlerts}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Informations du marché</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <dt className="text-muted-foreground">Publication</dt>
                  <dd>{formatDate(tender.published_at)}</dd>
                  <dt className="text-muted-foreground">Questions avant le</dt>
                  <dd>{tender.questions_deadline ? formatDate(tender.questions_deadline) : '—'}</dd>
                  <dt className="text-muted-foreground">Procédure</dt>
                  <dd>{tender.procedure_type ?? '—'}</dd>
                  <dt className="text-muted-foreground">Type de marché</dt>
                  <dd className="capitalize">{tender.market_type ?? '—'}</dd>
                  <dt className="text-muted-foreground">Durée</dt>
                  <dd>{tender.duration_months ? `${tender.duration_months} mois` : '—'}</dd>
                  <dt className="text-muted-foreground">Montant estimé</dt>
                  <dd className="tabular-nums">{formatEuros(tender.estimated_amount_cents)}</dd>
                  <dt className="text-muted-foreground">Localisation</dt>
                  <dd>{tender.region ?? '—'}</dd>
                  <dt className="text-muted-foreground">Mode de dépôt</dt>
                  <dd className="capitalize">{tender.deposit_mode ?? '—'}</dd>
                  <dt className="text-muted-foreground">Critères</dt>
                  <dd>
                    {tender.award_criteria?.prix != null ||
                    tender.award_criteria?.technique != null
                      ? `Prix ${tender.award_criteria.prix ?? '—'} % / Technique ${tender.award_criteria.technique ?? '—'} %`
                      : '—'}
                  </dd>
                  <dt className="text-muted-foreground">Plateforme</dt>
                  <dd>{tender.platform ?? '—'}</dd>
                </dl>
                {tender.dce_url && (
                  <a
                    href={tender.dce_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="size-3.5" /> Dossier de consultation (DCE)
                  </a>
                )}
                {tender.notes && (
                  <p className="whitespace-pre-wrap border-t border-border pt-2 text-muted-foreground">
                    {tender.notes}
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Lots</CardTitle>
                </CardHeader>
                <CardContent>
                  <LotsPanel orgSlug={orgSlug} tenderId={id} lots={lots} canEdit={canEdit} />
                </CardContent>
              </Card>
              {tender.site_visit_mandatory && !tender.site_visit_justified && canEdit && (
                <SiteVisitButton orgSlug={orgSlug} tenderId={id} />
              )}
            </div>
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Alertes de conformité</h2>
            <AlertsPanel orgSlug={orgSlug} tenderId={id} alerts={alerts} canEdit={canEdit} />
          </section>
        </TabsContent>

        <TabsContent value="checklist" className="mt-4">
          <ChecklistPanel
            orgSlug={orgSlug}
            tenderId={id}
            items={checklist}
            documents={orgDocs}
            members={memberOptions}
            canEdit={canEdit}
          />
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <EntityDocuments
            orgSlug={orgSlug}
            entityType="tender"
            entityId={id}
            documents={documents}
            canEdit={canEdit}
          />
        </TabsContent>

        <TabsContent value="depot" className="mt-4">
          <DepotPanel
            orgSlug={orgSlug}
            tenderId={id}
            readiness={readiness}
            submissions={submissions}
            result={result}
            canEdit={canEdit}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
