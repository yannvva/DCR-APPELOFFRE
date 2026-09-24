import Link from 'next/link'
import { requireMembership } from '@/lib/dal/auth'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ActivityFeed } from '@/components/activity-feed'
import { listActivity } from '@/lib/dal/activity'
import { listUpcomingTenders, listExpiringDocuments } from '@/lib/dal/tenders'
import { Users, FolderKanban, CheckSquare, FileText, AlertTriangle, Euro, FileSignature, Clock } from 'lucide-react'
import { formatDate, formatEuros, isOverdue, daysUntil } from '@/lib/format'

export default async function DashboardPage({
  params,
}: PageProps<'/[org]/dashboard'>) {
  const { org: orgSlug } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()
  const { supabase, org, user } = ctx

  const today = new Date().toISOString().slice(0, 10)
  const [
    accounts,
    projects,
    tasks,
    documents,
    overdueTasks,
    myTasks,
    openOpps,
    activity,
    upcomingTenders,
    expiringDocs,
  ] = await Promise.all([
    supabase.from('accounts').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
    supabase.from('projects').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).eq('status', 'active'),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).neq('status', 'done'),
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
    supabase
      .from('tasks')
      .select('id, title, due_date, project:projects(name, code)')
      .eq('organization_id', org.id)
      .neq('status', 'done')
      .lt('due_date', today)
      .order('due_date')
      .limit(8),
    supabase
      .from('task_assignees')
      .select('task:tasks!inner(id, title, due_date, status, project:projects(name, code))')
      .eq('organization_id', org.id)
      .eq('user_id', user.id)
      .neq('task.status', 'done')
      .limit(8),
    supabase
      .from('opportunities')
      .select('id, title, value_cents, expected_close_date, stage:pipeline_stages(name)')
      .eq('organization_id', org.id)
      .eq('status', 'open')
      .order('expected_close_date')
      .limit(8),
    listActivity(ctx, { limit: 12 }),
    listUpcomingTenders(ctx, 7, 8),
    listExpiringDocuments(ctx, 15, 8),
  ])

  type TaskRow = {
    id: string
    title: string
    due_date: string | null
    status?: string
    project: { name: string; code: string } | { name: string; code: string }[] | null
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
  const opps = (openOpps.data ?? []) as OppRow[]

  const pipelineValue = opps.reduce((s, o) => s + (o.value_cents ?? 0), 0)

  const stats = [
    { label: 'Entreprises', value: accounts.count ?? 0, icon: Users, href: `/${orgSlug}/crm/accounts` },
    { label: 'Projets actifs', value: projects.count ?? 0, icon: FolderKanban, href: `/${orgSlug}/projects` },
    { label: 'Tâches ouvertes', value: tasks.count ?? 0, icon: CheckSquare, href: `/${orgSlug}/projects` },
    { label: 'Documents', value: documents.count ?? 0, icon: FileText, href: `/${orgSlug}/documents` },
  ]

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">{org.name}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, href }) => (
          <Link key={label} href={href}>
            <Card className="transition-colors hover:border-foreground/20">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {label}
                </CardTitle>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">{value}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSignature className="size-4 text-destructive" />
              Appels d’offres — deadlines J-7
            </CardTitle>
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
                        href={`/${orgSlug}/tenders/${t.id}`}
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
                          days < 0
                            ? 'ml-3 shrink-0 bg-red-500/15 text-[10px] text-red-600'
                            : days <= 3
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
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="size-4 text-amber-500" />
              Pièces expirées ou à renouveler
            </CardTitle>
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
                      href={`/${orgSlug}/documents`}
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-destructive" />
              Tâches en retard
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overdue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune tâche en retard. 🎉</p>
            ) : (
              <ul className="divide-y divide-border">
                {overdue.map((t) => (
                  <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="min-w-0 truncate">{t.title}</span>
                    <span className="ml-3 shrink-0 text-xs text-destructive">
                      {formatDate(t.due_date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

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
                      <span className="min-w-0 truncate">
                        {proj && (
                          <span className="mr-1.5 text-xs text-muted-foreground">
                            {proj.code}
                          </span>
                        )}
                        {t.title}
                      </span>
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
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Pipeline ouvert</span>
              <span className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
                <Euro className="size-3.5" />
                {formatEuros(pipelineValue)}
              </span>
            </CardTitle>
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
                      <span className="min-w-0 truncate">{o.title}</span>
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
    </div>
  )
}
