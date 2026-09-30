import Link from 'next/link'
import { requireMembership } from '@/lib/dal/auth'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ActivityFeed } from '@/components/activity-feed'
import { listActivity } from '@/lib/dal/activity'
import {
  OPEN_TENDER_STATUSES,
  listUpcomingTenders,
  listUpcomingSiteVisits,
  listUpcomingChecklistItems,
  listOpenTenderAlerts,
  listExpiringDocuments,
} from '@/lib/dal/tenders'
import {
  FileSignature,
  FolderKanban,
  CheckSquare,
  FileText,
  AlertTriangle,
  Euro,
  Clock,
  MapPin,
  AlarmClock,
  ShieldAlert,
  ListChecks,
  ListTodo,
  ArrowRight,
} from 'lucide-react'
import { formatDate, formatEuros, formatEurosCompact, isOverdue, daysUntil } from '@/lib/format'
import { tenderPath } from '@/lib/slug'
import { cn } from '@/lib/utils'
import type { ChecklistItemStatus, TenderStatus } from '@/lib/types'

const CLOSED_STATUSES = '("depose","gagne","perdu","abandonne","annule")'

/** Ordre métier des étapes d'un AO ouvert — sert à la barre segmentée. */
const PIPELINE_STEPS: { status: TenderStatus; label: string; bar: string; dot: string }[] = [
  { status: 'detecte', label: 'Détecté', bar: 'bg-slate-400/70', dot: 'bg-slate-400' },
  { status: 'analyse', label: 'Analyse', bar: 'bg-sky-500/80', dot: 'bg-sky-500' },
  { status: 'en_preparation', label: 'En préparation', bar: 'bg-amber-500/80', dot: 'bg-amber-500' },
  { status: 'a_deposer', label: 'À déposer', bar: 'bg-violet-500/80', dot: 'bg-violet-500' },
]

const CHECKLIST_BADGE: Record<ChecklistItemStatus, { label: string; cls: string }> = {
  non_commence: { label: 'À faire', cls: 'bg-muted text-muted-foreground' },
  en_cours: { label: 'En cours', cls: 'bg-sky-500/15 text-sky-600' },
  a_verifier: { label: 'À vérifier', cls: 'bg-amber-500/15 text-amber-600' },
  bloque: { label: 'Bloqué', cls: 'bg-red-500/15 text-red-600' },
  valide: { label: 'Validé', cls: 'bg-emerald-500/15 text-emerald-600' },
  non_requis: { label: 'Non requis', cls: 'bg-muted text-muted-foreground' },
}

export default async function DashboardPage({
  params,
}: PageProps<'/[org]/dashboard'>) {
  const { org: orgSlug } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()
  const { supabase, org, user } = ctx

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const in7d = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString()
  const ago30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()
  const in15d = new Date(now.getTime() + 15 * 24 * 3600 * 1000).toISOString().slice(0, 10)

  const [
    openTenders,
    deadlines7d,
    visitsToJustify,
    expiringCount,
    missingMandatory,
    overdueCount,
    projects,
    allOpenOpps,
    overdueTasks,
    myTasks,
    openOpps,
    activity,
    upcomingTenders,
    siteVisits,
    tenderAlerts,
    expiringDocs,
    allTenderRows,
    checklistDue,
  ] = await Promise.all([
    supabase
      .from('tenders')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .not('status', 'in', CLOSED_STATUSES),
    supabase
      .from('tenders')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .not('status', 'in', CLOSED_STATUSES)
      .gte('response_deadline', ago30d)
      .lte('response_deadline', in7d),
    supabase
      .from('tenders')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .not('status', 'in', CLOSED_STATUSES)
      .eq('site_visit_mandatory', true)
      .eq('site_visit_justified', false),
    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .lte('valid_until', in15d),
    // Pièces obligatoires non validées sur les AO ouverts (complétude globale)
    supabase
      .from('tender_checklist_items')
      .select('id, tenders!inner(status)', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .eq('requirement', 'obligatoire')
      .not('status', 'in', '("valide","non_requis")')
      .not('tenders.status', 'in', CLOSED_STATUSES),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .neq('status', 'done')
      .lt('due_date', today),
    supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .eq('status', 'active'),
    // Total réel du pipeline : on somme tous les montants, pas seulement
    // les 8 lignes affichées.
    supabase
      .from('opportunities')
      .select('value_cents')
      .eq('organization_id', org.id)
      .eq('status', 'open'),
    supabase
      .from('tasks')
      .select('id, title, due_date, project:projects(id, name, code)')
      .eq('organization_id', org.id)
      .neq('status', 'done')
      .lt('due_date', today)
      .order('due_date')
      .limit(8),
    supabase
      .from('task_assignees')
      .select('task:tasks!inner(id, title, due_date, status, project:projects(id, name, code))')
      .eq('organization_id', org.id)
      .eq('user_id', user.id)
      .neq('task.status', 'done')
      .limit(20),
    supabase
      .from('opportunities')
      .select('id, title, value_cents, expected_close_date, stage:pipeline_stages(name)')
      .eq('organization_id', org.id)
      .eq('status', 'open')
      .order('expected_close_date')
      .limit(8),
    listActivity(ctx, { limit: 12 }),
    listUpcomingTenders(ctx, 7, 8),
    listUpcomingSiteVisits(ctx, 30, 8),
    listOpenTenderAlerts(ctx, 8),
    listExpiringDocuments(ctx, 15, 8),
    // Agrégats pipeline : statuts + montants estimés de tous les AO.
    supabase
      .from('tenders')
      .select('status, estimated_amount_cents')
      .eq('organization_id', org.id),
    listUpcomingChecklistItems(ctx, 14, 8),
  ])

  type TaskRow = {
    id: string
    title: string
    due_date: string | null
    status?: string
    project: { id: string; name: string; code: string } | { id: string; name: string; code: string }[] | null
  }
  type OppRow = {
    id: string
    title: string
    value_cents: number | null
    expected_close_date: string | null
    stage: { name: string } | { name: string }[] | null
  }
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  const overdue = (overdueTasks.data ?? []) as TaskRow[]
  const mine = ((myTasks.data ?? []) as { task: TaskRow | TaskRow[] | null }[])
    .map((r) => one(r.task))
    .filter((t): t is TaskRow => !!t)
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    .slice(0, 8)
  const opps = (openOpps.data ?? []) as OppRow[]
  const pipelineValue = (allOpenOpps.data ?? []).reduce(
    (s: number, o: { value_cents: number | null }) => s + (o.value_cents ?? 0),
    0,
  )

  // ---- Agrégats pipeline AO (statuts + montants estimés) ----
  const tenderRows = (allTenderRows.data ?? []) as {
    status: TenderStatus
    estimated_amount_cents: number | null
  }[]
  const countOf = (s: TenderStatus) => tenderRows.filter((t) => t.status === s).length
  const sumOf = (s: TenderStatus) =>
    tenderRows
      .filter((t) => t.status === s)
      .reduce((acc, t) => acc + (t.estimated_amount_cents ?? 0), 0)
  const openAmount = OPEN_TENDER_STATUSES.reduce((acc, s) => acc + sumOf(s), 0)
  const openCount = OPEN_TENDER_STATUSES.reduce((acc, s) => acc + countOf(s), 0)
  const deposeCount = countOf('depose')
  const wonCount = countOf('gagne')
  const lostCount = countOf('perdu')
  const droppedCount = countOf('abandonne') + countOf('annule')
  const wonAmount = sumOf('gagne')
  const winRate =
    wonCount + lostCount > 0 ? Math.round((100 * wonCount) / (wonCount + lostCount)) : null

  const stats = [
    {
      label: 'AO en cours',
      value: openTenders.count ?? 0,
      icon: FileSignature,
      href: `/${orgSlug}/tenders`,
    },
    {
      label: 'Montant AO en cours',
      value: formatEurosCompact(openAmount),
      icon: Euro,
      href: `/${orgSlug}/tenders`,
    },
    {
      label: 'Deadlines ≤ 7 j',
      value: deadlines7d.count ?? 0,
      icon: AlarmClock,
      href: `/${orgSlug}/tenders`,
      tone: (deadlines7d.count ?? 0) > 0 ? ('danger' as const) : undefined,
    },
    {
      label: 'Pièces obligatoires à produire',
      value: missingMandatory.count ?? 0,
      icon: ListChecks,
      href: `/${orgSlug}/todo`,
      tone: (missingMandatory.count ?? 0) > 0 ? ('danger' as const) : undefined,
    },
    {
      label: 'Visites à justifier',
      value: visitsToJustify.count ?? 0,
      icon: MapPin,
      href: `/${orgSlug}/tenders`,
      tone: (visitsToJustify.count ?? 0) > 0 ? ('warn' as const) : undefined,
    },
    {
      label: 'Pièces à renouveler',
      value: expiringCount.count ?? 0,
      icon: FileText,
      href: `/${orgSlug}/documents`,
      tone: (expiringCount.count ?? 0) > 0 ? ('warn' as const) : undefined,
    },
    {
      label: 'Tâches en retard',
      value: overdueCount.count ?? 0,
      icon: CheckSquare,
      href: `/${orgSlug}/todo`,
      tone: (overdueCount.count ?? 0) > 0 ? ('danger' as const) : undefined,
    },
    {
      label: 'Projets actifs',
      value: projects.count ?? 0,
      icon: FolderKanban,
      href: `/${orgSlug}/projects`,
    },
  ]

  const dateLabel = now.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground capitalize">
            {org.name} — {dateLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/${orgSlug}/todo`} />}
          >
            <ListTodo className="size-4" />
            À faire
          </Button>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href={`/${orgSlug}/tenders`} />}
          >
            <FileSignature className="size-4" />
            Appels d’offres
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        {stats.map(({ label, value, icon: Icon, href, tone }) => (
          <Link key={label} href={href}>
            <Card className="h-full transition-colors hover:border-foreground/20">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {label}
                </CardTitle>
                <Icon
                  className={cn(
                    'size-4',
                    tone === 'danger'
                      ? 'text-destructive'
                      : tone === 'warn'
                        ? 'text-amber-500'
                        : 'text-muted-foreground',
                  )}
                />
              </CardHeader>
              <CardContent>
                <p
                  className={cn(
                    'text-2xl font-semibold tabular-nums',
                    tone === 'danger' && 'text-destructive',
                    tone === 'warn' && 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  {value}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Pipeline des AO : répartition par étape + résultats */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Pipeline des appels d’offres</CardTitle>
          <Link
            href={`/${orgSlug}/tenders`}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Tout voir
            <ArrowRight className="size-3" />
          </Link>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-[2fr_1fr]">
          <div className="space-y-3">
            <div className="flex h-3 overflow-hidden rounded-full bg-muted">
              {PIPELINE_STEPS.map((s) => {
                const n = countOf(s.status)
                if (n === 0 || openCount === 0) return null
                return (
                  <div
                    key={s.status}
                    className={cn('h-full', s.bar)}
                    style={{ width: `${(100 * n) / openCount}%` }}
                    title={`${s.label} : ${n}`}
                  />
                )
              })}
              {openCount === 0 && <div className="h-full w-full bg-muted" />}
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {PIPELINE_STEPS.map((s) => (
                <li key={s.status} className="flex items-center gap-1.5">
                  <span className={cn('size-2 rounded-full', s.dot)} />
                  {s.label}
                  <span className="font-medium text-foreground tabular-nums">
                    {countOf(s.status)}
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-blue-600" />
                Déposé en attente
                <span className="font-medium text-foreground tabular-nums">{deposeCount}</span>
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Montant estimé cumulé (AO ouverts) :{' '}
              <span className="font-medium text-foreground">{formatEuros(openAmount)}</span>
            </p>
          </div>
          <div className="space-y-2 border-t pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Résultats
            </p>
            <p className="text-3xl font-semibold tabular-nums">
              {winRate == null ? '—' : `${winRate} %`}
            </p>
            <p className="text-xs text-muted-foreground">de réussite (gagné / perdu)</p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500" />
                Gagné <span className="font-medium text-foreground">{wonCount}</span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-red-500" />
                Perdu <span className="font-medium text-foreground">{lostCount}</span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-muted-foreground/40" />
                Sans suite <span className="font-medium text-foreground">{droppedCount}</span>
              </li>
            </ul>
            {wonAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                Montant gagné :{' '}
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {formatEuros(wonAmount)}
                </span>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---- Pilotage des AO ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pilotage des AO
        </h2>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSignature className="size-4 text-destructive" />
                Deadlines AO
              </CardTitle>
              <Link
                href={`/${orgSlug}/tenders`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Tout voir →
              </Link>
            </CardHeader>
            <CardContent>
              {upcomingTenders.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucune deadline d’appel d’offres sous 7 jours.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {upcomingTenders.map((t) => {
                    const days = daysUntil(t.response_deadline)
                    return (
                      <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                        <Link
                          href={tenderPath(orgSlug, t)}
                          className="min-w-0 truncate hover:underline"
                        >
                          {t.title}
                          {t.buyer?.name && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {t.buyer.name}
                            </span>
                          )}
                        </Link>
                        <Badge
                          variant="secondary"
                          className={
                            days <= 3
                              ? 'ml-3 shrink-0 bg-red-500/15 text-[10px] text-red-600'
                              : 'ml-3 shrink-0 bg-amber-500/15 text-[10px] text-amber-600'
                          }
                        >
                          {days < 0 ? `Dépassée J+${Math.abs(days)}` : `J-${days}`}
                        </Badge>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <ListChecks className="size-4 text-amber-500" />
                Pièces à produire ≤ 14 j
              </CardTitle>
              <Link
                href={`/${orgSlug}/todo`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Tout voir →
              </Link>
            </CardHeader>
            <CardContent>
              {checklistDue.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucune pièce de checklist à échéance proche.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {checklistDue.map((i) => {
                    const days = daysUntil(i.internal_deadline)
                    const badge = CHECKLIST_BADGE[i.status] ?? CHECKLIST_BADGE.non_commence
                    return (
                      <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                        <Link
                          href={`${tenderPath(orgSlug, {
                            id: i.tender_id,
                            title: i.tender?.title ?? '',
                          })}?tab=checklist`}
                          className="min-w-0 truncate hover:underline"
                        >
                          {i.label}
                          {i.tender?.title && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {i.tender.title}
                            </span>
                          )}
                        </Link>
                        <span className="ml-3 flex shrink-0 items-center gap-1.5">
                          <Badge variant="secondary" className={cn('text-[10px]', badge.cls)}>
                            {badge.label}
                          </Badge>
                          <span
                            className={cn(
                              'text-xs tabular-nums',
                              days < 0 ? 'text-destructive' : 'text-muted-foreground',
                            )}
                          >
                            {days < 0 ? `J+${Math.abs(days)}` : `J-${days}`}
                          </span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="size-4 text-destructive" />
                Visites de site à venir
              </CardTitle>
              <Link
                href={`/${orgSlug}/tenders`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Tout voir →
              </Link>
            </CardHeader>
            <CardContent>
              {siteVisits.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucune visite de site planifiée sous 30 jours.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {siteVisits.map((t) => {
                    const days = daysUntil(t.site_visit_at)
                    return (
                      <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                        <Link
                          href={tenderPath(orgSlug, t)}
                          className="min-w-0 truncate hover:underline"
                        >
                          {t.title}
                        </Link>
                        <span className="ml-3 flex shrink-0 items-center gap-1.5">
                          {t.site_visit_mandatory && (
                            <Badge
                              variant="secondary"
                              className={cn(
                                'text-[10px]',
                                t.site_visit_justified
                                  ? 'bg-emerald-500/15 text-emerald-600'
                                  : 'bg-red-500/15 text-red-600',
                              )}
                            >
                              {t.site_visit_justified ? 'Justifiée' : 'Obligatoire'}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {formatDate(t.site_visit_at)}
                            {days >= 0 ? ` (J-${days})` : ''}
                          </span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ---- Points de vigilance ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Points de vigilance
        </h2>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="size-4 text-amber-500" />
                Alertes de conformité AO
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tenderAlerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune alerte de conformité ouverte.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {tenderAlerts.map((al) => (
                    <li key={al.id} className="flex items-start gap-2 py-2 text-sm">
                      <Badge
                        variant="secondary"
                        className={cn(
                          'mt-0.5 shrink-0 text-[10px]',
                          al.severity === 'bloquante' && 'bg-red-500/15 text-red-600',
                          al.severity === 'critique' && 'bg-orange-500/15 text-orange-600',
                          al.severity === 'importante' && 'bg-amber-500/15 text-amber-600',
                          al.severity === 'info' && 'bg-sky-500/15 text-sky-600',
                        )}
                      >
                        {al.severity}
                      </Badge>
                      <Link
                        href={tenderPath(orgSlug, {
                          id: al.tender_id,
                          title: al.tender?.title ?? '',
                        })}
                        className="min-w-0 hover:underline"
                      >
                        {al.message}
                        {al.tender?.title && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {al.tender.title}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="size-4 text-destructive" />
                Tâches en retard
              </CardTitle>
              <Link
                href={`/${orgSlug}/todo`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Tout voir →
              </Link>
            </CardHeader>
            <CardContent>
              {overdue.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune tâche en retard.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {overdue.map((t) => {
                    const proj = one(t.project)
                    return (
                      <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                        {proj ? (
                          <Link
                            href={`/${orgSlug}/projects/${proj.id}`}
                            className="min-w-0 truncate hover:underline"
                          >
                            <span className="mr-1.5 text-xs text-muted-foreground">
                              {proj.code}
                            </span>
                            {t.title}
                          </Link>
                        ) : (
                          <span className="min-w-0 truncate">{t.title}</span>
                        )}
                        <span className="ml-3 shrink-0 text-xs text-destructive">
                          {formatDate(t.due_date)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-4 text-amber-500" />
                Pièces expirées ou à renouveler
              </CardTitle>
              <Link
                href={`/${orgSlug}/documents`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Tout voir →
              </Link>
            </CardHeader>
            <CardContent>
              {expiringDocs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucune pièce n’expire sous 15 jours.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {expiringDocs.map((d) => (
                    <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                      <Link
                        href={
                          d.category === 'societe'
                            ? `/${orgSlug}/societe`
                            : `/${orgSlug}/documents`
                        }
                        className="min-w-0 truncate hover:underline"
                      >
                        {d.name}
                      </Link>
                      <span
                        className={
                          new Date(d.valid_until) < new Date()
                            ? 'ml-3 shrink-0 text-xs text-destructive'
                            : 'ml-3 shrink-0 text-xs text-amber-600'
                        }
                      >
                        {new Date(d.valid_until) < new Date() ? 'Expiré ' : ''}
                        {formatDate(d.valid_until)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ---- Suivi & activité ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Suivi &amp; activité
        </h2>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mes tâches</CardTitle>
            </CardHeader>
            <CardContent>
              {mine.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune tâche assignée.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {mine.map((t) => {
                    const proj = one(t.project)
                    return (
                      <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                        {proj ? (
                          <Link
                            href={`/${orgSlug}/projects/${proj.id}`}
                            className="min-w-0 truncate hover:underline"
                          >
                            <span className="mr-1.5 text-xs text-muted-foreground">
                              {proj.code}
                            </span>
                            {t.title}
                          </Link>
                        ) : (
                          <span className="min-w-0 truncate">{t.title}</span>
                        )}
                        <span
                          className={
                            isOverdue(t.due_date)
                              ? 'ml-3 shrink-0 text-xs text-destructive'
                              : 'ml-3 shrink-0 text-xs text-muted-foreground'
                          }
                        >
                          {formatDate(t.due_date)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Pipeline commercial</CardTitle>
              <span className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
                <Euro className="size-3.5" />
                {formatEuros(pipelineValue)}
              </span>
            </CardHeader>
            <CardContent>
              {opps.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune opportunité ouverte.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {opps.map((o) => {
                    const stage = one(o.stage)
                    return (
                      <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                        <Link
                          href={`/${orgSlug}/crm/opportunities`}
                          className="min-w-0 truncate hover:underline"
                        >
                          {o.title}
                        </Link>
                        <span className="ml-3 flex shrink-0 items-center gap-2">
                          {stage && (
                            <Badge variant="secondary" className="text-[10px]">
                              {stage.name}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {formatEuros(o.value_cents)}
                          </span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activité récente</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed entries={activity} />
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}
