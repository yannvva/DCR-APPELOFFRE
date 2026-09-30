import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  AlertTriangle,
  CalendarClock,
  CheckSquare,
  FileSignature,
  UserCheck,
} from 'lucide-react'
import { requireMembership } from '@/lib/dal/auth'
import { listTodoBoard, OPEN_TENDER_STATUSES } from '@/lib/dal/tenders'
import { listOpenProjectTasks, listOrgMembers } from '@/lib/dal/projects'
import { AoKanban } from '@/components/tenders/ao-kanban'
import {
  TodoBoard,
  type DeadlineFilter,
  type TodoFilters,
  type TodoSort,
  type TodoSource,
  type TodoView,
} from '@/components/tenders/todo-board'
import { Card, CardContent } from '@/components/ui/card'
import { daysUntil, isOverdue } from '@/lib/format'

const VIEWS: TodoView[] = ['kanban', 'liste', 'echeancier']
const DEADLINES: DeadlineFilter[] = ['all', 'late', 'week', 'none']
const SORTS: TodoSort[] = ['deadline', 'context', 'status', 'label']
const SOURCES: TodoSource[] = ['all', 'pieces', 'taches']

const pick = <T extends string>(v: unknown, allowed: T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback

export default async function TodoPage({
  params,
  searchParams,
}: PageProps<'/[org]/todo'>) {
  const { org: orgSlug } = await params
  const sp = await searchParams
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const [{ tenders, items }, tasks, members] = await Promise.all([
    listTodoBoard(ctx),
    listOpenProjectTasks(ctx),
    listOrgMembers(ctx),
  ])
  const canEdit = ctx.role !== 'viewer'

  // Filtres portés par l'URL : un lien partagé (ou un KPI cliqué) rouvre
  // exactement la même vue. « ?retard=1 » reste accepté (ancien lien profond).
  const initial: TodoFilters = {
    view: pick(sp.vue, VIEWS, 'kanban'),
    q: typeof sp.q === 'string' ? sp.q : '',
    tender: typeof sp.dossier === 'string' ? sp.dossier : 'all',
    assignee: typeof sp.assigne === 'string' ? sp.assigne : 'all',
    deadline: pick(sp.echeance, DEADLINES, sp.retard === '1' ? 'late' : 'all'),
    sort: pick(sp.tri, SORTS, 'deadline'),
    source: pick(sp.source, SOURCES, 'all'),
    showDone: sp.faites === '1',
  }

  const openTenders = tenders.filter((t) =>
    OPEN_TENDER_STATUSES.includes(t.status),
  )
  const todo = items.filter((i) => !['valide', 'non_requis'].includes(i.status))
  const lateItems = todo.filter(
    (i) => i.internal_deadline && isOverdue(i.internal_deadline),
  )
  const mine = todo.filter((i) => i.assignee_id === ctx.user.id)
  const hotDeadlines = openTenders.filter(
    (t) => t.response_deadline && (daysUntil(t.response_deadline) ?? 99) <= 7,
  )
  const alertCount = openTenders.reduce((n, t) => n + (t.alerts?.count ?? 0), 0)
  const myTasks = tasks.filter((t) =>
    (t.assignees ?? []).some((a) => a.user_id === ctx.user.id),
  )

  const stats: {
    label: string
    value: number
    icon: typeof FileSignature
    tone: string
    href?: string
    hint?: string
  }[] = [
    {
      label: 'AO en cours',
      value: openTenders.length,
      icon: FileSignature,
      tone: 'text-primary',
      href: `/${orgSlug}/tenders`,
      hint: 'Dossiers ouverts',
    },
    {
      label: 'Pièces à produire',
      value: todo.length,
      icon: CheckSquare,
      tone: 'text-foreground',
      href: `/${orgSlug}/todo?source=pieces`,
      hint: 'Tous dossiers ouverts',
    },
    {
      label: 'Mes pièces',
      value: mine.length,
      icon: UserCheck,
      tone: mine.length ? 'text-primary' : 'text-muted-foreground',
      href: `/${orgSlug}/todo?assigne=me&source=pieces`,
      hint: `${myTasks.length} tâche(s) projet`,
    },
    {
      label: 'En retard',
      value: lateItems.length,
      icon: CalendarClock,
      tone: lateItems.length ? 'text-destructive' : 'text-muted-foreground',
      href: `/${orgSlug}/todo?echeance=late`,
      hint: 'Échéance interne dépassée',
    },
    {
      // Inclut volontairement les deadlines passées : un dossier ouvert dont
      // la date est dépassée demande une action (déposer/clore) — il n'est
      // pas « moins urgent » qu'un J-7.
      label: 'Dépôts ≤ 7 j ou échus',
      value: hotDeadlines.length,
      icon: CalendarClock,
      tone: hotDeadlines.length ? 'text-amber-500' : 'text-muted-foreground',
      href: `/${orgSlug}/todo?echeance=week`,
      hint: 'Date de remise proche',
    },
    {
      label: 'Alertes ouvertes',
      value: alertCount,
      icon: AlertTriangle,
      tone: alertCount ? 'text-orange-500' : 'text-muted-foreground',
      hint: 'Contrôles de conformité',
    },
  ]

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">À faire</h1>
        <p className="text-sm text-muted-foreground">
          Vue transverse de vos dossiers et projets — ce qui reste à produire,
          par urgence.
        </p>
      </div>

      {/* Bandeau de pilotage — chaque carte ouvre la vue filtrée correspondante */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => {
          const body = (
            <CardContent className="flex items-center gap-3 py-3">
              <s.icon className={`size-5 shrink-0 ${s.tone}`} />
              <div className="min-w-0">
                <p className="text-xl font-semibold tabular-nums">{s.value}</p>
                <p className="truncate text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          )
          return (
            <Card
              key={s.label}
              className="transition-colors hover:border-primary/50"
            >
              {s.href ? (
                <Link href={s.href} title={s.hint} className="block">
                  {body}
                </Link>
              ) : (
                <span title={s.hint}>{body}</span>
              )}
            </Card>
          )
        })}
      </div>

      <section>
        <TodoBoard
          orgSlug={orgSlug}
          items={items}
          tasks={tasks}
          members={members.map((m) => ({
            user_id: m.user_id,
            full_name: m.profiles?.full_name ?? null,
          }))}
          meId={ctx.user.id}
          canEdit={canEdit}
          initial={initial}
        />
      </section>

      <section className="scroll-mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Dossiers — avancement
        </h2>
        <AoKanban orgSlug={orgSlug} tenders={tenders} canEdit={canEdit} />
      </section>
    </div>
  )
}
