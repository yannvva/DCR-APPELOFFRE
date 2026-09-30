import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeft,
  ClipboardList,
  ExternalLink,
  FileDown,
  FileSignature,
  FileSpreadsheet,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  MapPin,
  NotebookPen,
  Pencil,
  ScanSearch,
  Send,
  Sparkles,
} from 'lucide-react'
import { requireMembership } from '@/lib/dal/auth'
import {
  getTender,
  getTenderReadiness,
  getTenderResult,
  listChecklistItems,
  listDceAnalyses,
  listSubmissions,
  listTenderAlerts,
  listTenderLots,
} from '@/lib/dal/tenders'
import { listDatasheetRuns } from '@/lib/dal/datasheets'
import { listMemoireRuns } from '@/lib/dal/memoire'
import { listOrgMembers } from '@/lib/dal/projects'
import { searchAccounts } from '@/lib/dal/crm'
import { getEntityDocuments } from '@/lib/dal/documents'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TabsContent } from '@/components/ui/tabs'
import { TenderTabs } from '@/components/tenders/tender-tabs'
import { TenderNavList, TenderNavTab } from '@/components/tenders/tender-nav'
import { EntityDocuments } from '@/components/entity-documents'
import { AlertsPanel } from '@/components/tenders/alerts-panel'
import { ChecklistPanel } from '@/components/tenders/checklist-panel'
import { DceAnalysisPanel } from '@/components/tenders/dce-analysis-panel'
import { DceDropzone } from '@/components/tenders/dce-dropzone'
import { DatasheetPanel } from '@/components/tenders/datasheet-panel'
import { DcPanel } from '@/components/tenders/dc-panel'
import { MemoirePanel } from '@/components/tenders/memoire-panel'
import { ARetenirCard } from '@/components/tenders/a-retenir-card'
import { ImportantCard } from '@/components/tenders/important-card'
import { normalizeAnalysis } from '@/lib/dce/normalize'
import { tenderFolderName } from '@/lib/doc-folders'
import { attachCompanyDocsToChecklist } from '@/lib/checklist-attach'
import { dcMissingFields } from '@/lib/dc/data'
import { DepotPanel } from '@/components/tenders/depot-panel'
import { LotsPanel } from '@/components/tenders/lots-panel'
import { TenderDialog } from '@/components/tenders/tender-dialog'
import { TenderStatusSelect } from '@/components/tenders/tender-status-select'
import { SiteVisitButton } from '@/components/tenders/site-visit-button'
import { TENDER_STATUS_COLORS, TENDER_STATUS_LABELS } from '@/components/tenders/constants'
import { formatDate, formatEuros, isOverdue, daysUntil } from '@/lib/format'
import { tenderPath } from '@/lib/slug'
import { cn } from '@/lib/utils'
import type { Document } from '@/lib/types'

export default async function TenderDetailPage({
  params,
  searchParams,
}: PageProps<'/[org]/tenders/[id]'>) {
  const { org: orgSlug, id: rawId } = await params
  const sp = await searchParams
  // Liens profonds (?tab=checklist, ?tab=documents…) depuis la liste des AO
  const TABS = [
    'overview',
    'checklist',
    'dce',
    'documents',
    'fiches',
    'dc',
    'memoire',
    'depot',
  ] as const
  const defaultTab = TABS.find((t) => t === sp.tab) ?? 'overview'
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const tender = await getTender(ctx, rawId)
  if (!tender) notFound()

  // URL canonique : « slug-du-titre-<uuid> ». Les anciens liens uuid-only et
  // les slugs obsolètes (titre renommé) sont redirigés en conservant la query.
  const canonical = tenderPath(orgSlug, tender)
  if (rawId !== canonical.slice(canonical.lastIndexOf('/') + 1)) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === 'string') qs.set(k, v)
      else if (Array.isArray(v)) v.forEach((x) => qs.append(k, x))
    }
    redirect(qs.size ? `${canonical}?${qs}` : canonical)
  }
  const id = tender.id

  const canEdit = ctx.role !== 'viewer'
  // Rafraîchir les contrôles à chaque affichage : les alertes liées au temps
  // (deadline dépassée, J-3, J-7) resteraient sinon figées jusqu'à la prochaine mutation.
  await ctx.supabase.rpc('run_compliance_checks', { p_tender_id: id })
  // Auto-réparation : si des lignes de checklist n'ont pas de pièce alors que
  // le kit société la contient (dossier créé avant cette fonctionnalité ou
  // pièce ajoutée depuis), on rattache — idempotent (document_id IS NULL).
  if (canEdit) {
    try {
      await attachCompanyDocsToChecklist(ctx.supabase, ctx.org.id, id, ctx.user.id)
    } catch {
      // best-effort — l'onglet Checklist permet de rejouer manuellement
    }
  }
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
    dceAnalyses,
    datasheetRuns,
    memoireRuns,
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
    listDceAnalyses(ctx, id),
    listDatasheetRuns(ctx, id),
    listMemoireRuns(ctx, id),
  ])

  const memberOptions = members.map((m) => ({
    user_id: m.user_id,
    full_name: m.profiles?.full_name ?? null,
  }))
  const openAlerts = alerts.length
  const closed = ['depose', 'gagne', 'perdu', 'abandonne', 'annule'].includes(tender.status)
  const daysLeft = daysUntil(tender.response_deadline)
  const overdue = isOverdue(tender.response_deadline)

  // Alertes checklist regroupées : elles doublonnent l'onglet Checklist —
  // on garde visibles les alertes transverses (deadline, visite, lots…).
  const checklistAlerts = alerts.filter((a) => a.check_key.startsWith('checklist_'))
  const otherAlerts = alerts.filter((a) => !a.check_key.startsWith('checklist_'))

  // Prochaine étape la plus utile, par ordre de criticité
  const hasDceDocs = documents.some((d) => d.category === 'dce')
  const doneAnalysis = dceAnalyses.find((a) => a.status === 'done')
  const analysisApplied = dceAnalyses.some((a) => a.applied_at)
  // Lots détectés par l'analyse mais pas encore appliqués : ils restent
  // proposables dans les panneaux fiches/DC/mémoire (créés à la volée).
  const analysisLots = doneAnalysis?.result
    ? normalizeAnalysis(doneAnalysis.result).lots.map((l) => ({
        number: l.number,
        title: l.title,
        amount_euros: l.amount_euros,
      }))
    : []
  const nextStep = closed
    ? null
    : overdue
      ? {
          label: 'Délai de dépôt dépassé',
          hint: 'Confirmez un dépôt manuel dans l’onglet Dépôt ou passez le dossier en abandonné.',
          tone: 'destructive' as const,
          tab: 'depot',
        }
      : readiness.ready
        ? {
            label: 'Dossier conforme',
            hint: 'Toutes les pièces obligatoires sont validées — préparez le dépôt (onglet Dépôt).',
            tone: 'ok' as const,
            tab: 'depot',
          }
        : doneAnalysis && !analysisApplied
          ? {
              label: 'Analyse DCE disponible',
              hint: 'Appliquez-la pour pré-remplir champs, lots et checklist (onglet Analyse DCE).',
              tone: 'accent' as const,
              tab: 'dce',
            }
          : !hasDceDocs
            ? {
                label: 'DCE non importé',
                hint: 'Déposez le DCE dans l’onglet Analyse DCE : les pièces seront classées et rangées automatiquement.',
                tone: 'accent' as const,
                tab: 'dce',
              }
            : !doneAnalysis
              ? {
                  label: 'Analyse IA du DCE',
                  hint: 'Lancez l’analyse pour extraire exigences, échéances et pièces à fournir.',
                  tone: 'accent' as const,
                  tab: 'dce',
                }
              : {
                  label: 'Compléter la checklist',
                  hint: `${readiness.validated}/${readiness.required} pièces obligatoires validées.`,
                  tone: 'default' as const,
                  tab: 'checklist',
                }

  const criteriaEntries = Object.entries(tender.award_criteria ?? {}).filter(
    ([, v]) => typeof v === 'number' && v > 0,
  )
  const dcDocs = documents.filter(
    (d) => d.document_type === 'dc1' || d.document_type === 'dc2',
  )

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
            {tender.buyer?.name && (
              <Link
                href={`/${orgSlug}/crm/accounts/${tender.buyer.id}`}
                className="hover:text-foreground hover:underline"
              >
                {tender.buyer.name}
              </Link>
            )}
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
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={`/print${tenderPath(orgSlug, tender)}?auto=1`} target="_blank" />}
        >
          <FileDown className="size-3.5" /> Export dossier (PDF)
        </Button>
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

      <TenderTabs initial={defaultTab} tabs={TABS}>
        <TenderNavList>
          <TenderNavTab
            value="overview"
            icon={<LayoutDashboard />}
            label="Vue d’ensemble"
            stat={`${readiness.pct} %`}
            sub="conforme"
            tone={readiness.ready ? 'ok' : 'default'}
          />
          <TenderNavTab
            value="checklist"
            icon={<ListChecks />}
            label="Checklist"
            stat={`${readiness.validated}/${readiness.required}`}
            sub="pièces validées"
            progress={readiness.pct}
            tone={readiness.ready ? 'ok' : readiness.pct > 0 ? 'accent' : 'default'}
          />
          <TenderNavTab
            value="dce"
            icon={<ScanSearch />}
            label="Analyse DCE"
            stat={analysisApplied ? 'Appliquée' : doneAnalysis ? 'Terminée' : '—'}
            sub="IA"
            tone={doneAnalysis ? 'accent' : 'default'}
          />
          <TenderNavTab
            value="documents"
            icon={<FolderOpen />}
            label="Documents"
            stat={documents.length}
            sub="fichiers"
          />
          <TenderNavTab
            value="fiches"
            icon={<FileSpreadsheet />}
            label="Fiches techniques"
            stat={datasheetRuns.length}
            sub={datasheetRuns.length > 1 ? 'générations' : 'génération'}
          />
          <TenderNavTab
            value="dc"
            icon={<FileSignature />}
            label="DC1 / DC2"
            stat={dcDocs.length}
            sub="documents"
          />
          <TenderNavTab
            value="memoire"
            icon={<NotebookPen />}
            label="Mémoire"
            stat={memoireRuns.length}
            sub={memoireRuns.length > 1 ? 'versions' : 'version'}
          />
          <TenderNavTab
            value="depot"
            icon={<Send />}
            label="Dépôt"
            stat={submissions.length}
            sub={submissions.length > 1 ? 'dépôts' : 'dépôt'}
            tone={openAlerts > 0 ? 'danger' : 'default'}
            badge={
              openAlerts > 0 ? (
                <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
                  {openAlerts}
                </span>
              ) : undefined
            }
          />
        </TenderNavList>

        <TabsContent value="overview" className="mt-4 space-y-5">
          {nextStep && (
            <div
              className={cn(
                'flex items-start gap-3 rounded-lg border px-4 py-3',
                nextStep.tone === 'destructive' &&
                  'border-destructive/50 bg-destructive/10 text-destructive',
                nextStep.tone === 'ok' &&
                  'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                nextStep.tone === 'accent' && 'border-primary/40 bg-primary/5',
                nextStep.tone === 'default' && 'border-border bg-muted/40',
              )}
            >
              <Sparkles
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  nextStep.tone === 'default' && 'text-muted-foreground',
                )}
              />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">Prochaine étape : {nextStep.label}</p>
                <p
                  className={cn(
                    'mt-0.5',
                    nextStep.tone === 'destructive' ? 'opacity-90' : 'text-muted-foreground',
                  )}
                >
                  {nextStep.hint}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 bg-background"
                nativeButton={false}
                render={
                  <Link href={`${tenderPath(orgSlug, tender)}?tab=${nextStep.tab}`} />
                }
              >
                Y aller
              </Button>
            </div>
          )}
          {/* À retenir — éléments indispensables issus de l'analyse du DCE */}
          {doneAnalysis?.result ? (
            <ARetenirCard
              analysis={normalizeAnalysis(doneAnalysis.result)}
              exportHref={`/print${tenderPath(orgSlug, tender)}?auto=1`}
            />
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Informations du marché</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {/* Champs absents masqués : une ligne « — » n'apporte rien et
                    noie les informations réellement renseignées. */}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {(
                    [
                      ['Publication', tender.published_at ? formatDate(tender.published_at) : null],
                      [
                        'Questions avant le',
                        tender.questions_deadline ? formatDate(tender.questions_deadline) : null,
                      ],
                      ['Procédure', tender.procedure_type],
                      ['Type de marché', tender.market_type],
                      [
                        'Durée',
                        tender.duration_months ? `${tender.duration_months} mois` : null,
                      ],
                      [
                        'Montant estimé',
                        tender.estimated_amount_cents
                          ? formatEuros(tender.estimated_amount_cents)
                          : null,
                      ],
                      ['Localisation', tender.region],
                      ['Mode de dépôt', tender.deposit_mode],
                      [
                        'Critères',
                        criteriaEntries.length
                          ? criteriaEntries.map(([k, v]) => `${k} ${v} %`).join(' / ')
                          : null,
                      ],
                      ['Plateforme', tender.platform],
                    ] as [string, string | null][]
                  )
                    .filter((entry): entry is [string, string] => entry[1] != null)
                    .map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="tabular-nums first-letter:uppercase">{value}</dd>
                      </div>
                    ))}
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
              <ImportantCard
                orgSlug={orgSlug}
                tenderId={id}
                tenderTitle={tender.title}
                lots={lots}
                analysis={doneAnalysis?.result ? normalizeAnalysis(doneAnalysis.result) : null}
                siteVisitJustified={tender.site_visit_justified}
                canEdit={canEdit}
              />
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

          {/* Livrables — synthèse de ce qui a été produit pour ce dossier */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Livrables produits</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
              {(
                [
                  {
                    tab: 'dce',
                    label: 'Analyses DCE',
                    value: dceAnalyses.filter((x) => x.status === 'done').length,
                    hint: analysisApplied
                      ? 'appliquée au dossier'
                      : doneAnalysis
                        ? 'à appliquer'
                        : null,
                  },
                  {
                    tab: 'fiches',
                    label: 'Fiches techniques',
                    value: datasheetRuns.length,
                    hint: datasheetRuns.length
                      ? datasheetRuns.map((r) => r.lot_label).join(', ')
                      : null,
                  },
                  {
                    tab: 'memoire',
                    label: 'Mémoires',
                    value: memoireRuns.length,
                    hint: memoireRuns.some((r) => r.docx_full_document_id || r.docx_document_id)
                      ? 'DOCX généré'
                      : null,
                  },
                  {
                    tab: 'dc',
                    label: 'DC1 / DC2',
                    value: documents.filter(
                      (d) => d.document_type === 'dc1' || d.document_type === 'dc2',
                    ).length,
                    hint: null,
                  },
                  {
                    tab: 'depot',
                    label: 'Dépôts',
                    value: submissions.length,
                    hint: result ? `Résultat : ${result.outcome}` : null,
                  },
                ] as const
              ).map((l) => (
                <Link
                  key={l.tab}
                  href={`${tenderPath(orgSlug, tender)}?tab=${l.tab}`}
                  className="rounded-lg border border-border px-3 py-2 transition-colors hover:bg-muted/50"
                >
                  <p className="text-muted-foreground text-xs">{l.label}</p>
                  <p
                    className={cn(
                      'mt-0.5 font-semibold tabular-nums',
                      l.value > 0 ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {l.value > 0 ? l.value : '—'}
                  </p>
                  {l.hint && (
                    <p className="truncate text-xs text-muted-foreground">{l.hint}</p>
                  )}
                </Link>
              ))}
            </CardContent>
          </Card>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Alertes de conformité</h2>
            <div className="space-y-3">
              {checklistAlerts.length > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
                  <ClipboardList className="size-4 shrink-0 text-muted-foreground" />
                  <span>
                    {checklistAlerts.length} pièce
                    {checklistAlerts.length > 1 ? 's' : ''} obligatoire
                    {checklistAlerts.length > 1 ? 's' : ''} à traiter — voir
                    l’onglet <strong>Checklist</strong>.
                  </span>
                </div>
              )}
              <AlertsPanel orgSlug={orgSlug} tenderId={id} alerts={otherAlerts} canEdit={canEdit} />
            </div>
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

        <TabsContent value="dce" className="mt-4 space-y-5">
          <DceDropzone
            orgSlug={orgSlug}
            orgId={ctx.org.id}
            tenderId={id}
            canEdit={canEdit}
          />
          <DceAnalysisPanel
            orgSlug={orgSlug}
            tenderId={id}
            analyses={dceAnalyses}
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
            folder={tenderFolderName(tender, 'Pièces jointes')}
            folderRoot={tenderFolderName(tender)}
          />
        </TabsContent>

        <TabsContent value="fiches" className="mt-4">
          <DatasheetPanel
            orgSlug={orgSlug}
            tenderId={id}
            runs={datasheetRuns}
            lots={lots}
            analysisLots={analysisLots}
            canEdit={canEdit}
          />
        </TabsContent>

        <TabsContent value="dc" className="mt-4">
          <DcPanel
            orgSlug={orgSlug}
            tenderId={id}
            lots={lots}
            analysisLots={analysisLots}
            documents={documents}
            missingFields={dcMissingFields(ctx.org.settings)}
            canEdit={canEdit}
          />
        </TabsContent>

        <TabsContent value="memoire" className="mt-4">
          <MemoirePanel
            orgSlug={orgSlug}
            tenderId={id}
            runs={memoireRuns}
            lots={lots}
            analysisLots={analysisLots}
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
      </TenderTabs>
    </div>
  )
}
