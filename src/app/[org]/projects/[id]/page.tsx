import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Pencil } from 'lucide-react'
import { requireMembership } from '@/lib/dal/auth'
import { getProject, listOrgMembers, listProjectTasks } from '@/lib/dal/projects'
import { searchAccounts } from '@/lib/dal/crm'
import { getEntityTags, listTags } from '@/lib/dal/crm'
import { getEntityDocuments } from '@/lib/dal/documents'
import { listActivity } from '@/lib/dal/activity'
import { ActivityFeed } from '@/components/activity-feed'
import { ProjectDialog } from '@/components/projects/project-dialog'
import { ProjectStatusSelect } from '@/components/projects/project-status-select'
import { TaskBoard } from '@/components/projects/task-board'
import { TagPicker } from '@/components/tag-picker'
import { EntityDocuments } from '@/components/entity-documents'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { daysUntil, formatDate, isOverdue } from '@/lib/format'
import type { ProjectStatus } from '@/lib/types'

const STATUS: Record<
  ProjectStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  active: { label: 'Actif', variant: 'default' },
  on_hold: { label: 'En pause', variant: 'secondary' },
  done: { label: 'Terminé', variant: 'outline' },
  archived: { label: 'Archivé', variant: 'outline' },
}

export default async function ProjectDetailPage({
  params,
}: PageProps<'/[org]/projects/[id]'>) {
  const { org: orgSlug, id } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const project = await getProject(ctx, id)
  if (!project) notFound()

  const canEdit = ctx.role !== 'viewer'
  const [tasks, members, accounts, tags, appliedTags, documents, activity] =
    await Promise.all([
      listProjectTasks(ctx, id),
      listOrgMembers(ctx),
      searchAccounts(ctx, '', 100),
      listTags(ctx),
      getEntityTags(ctx, 'project', id),
      getEntityDocuments(ctx, 'project', id),
      listActivity(ctx, { entityType: 'project', entityId: id, limit: 15 }),
    ])

  const memberOptions = members.map((m) => ({
    user_id: m.user_id,
    full_name: m.profiles?.full_name ?? null,
  }))

  const st = STATUS[project.status] ?? STATUS.active
  const late = project.status === 'active' && isOverdue(project.due_date)
  const days = daysUntil(project.due_date)
  const doneTasks = tasks.filter((t) => t.status === 'done').length

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          aria-label="Retour aux projets"
          render={<Link href={`/${orgSlug}/projects`} />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm text-muted-foreground">{project.code}</span>
            <h1 className="truncate text-2xl font-semibold">{project.name}</h1>
            {!canEdit && <Badge variant={st.variant}>{st.label}</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {project.account && (
              <>
                <Link
                  href={`/${orgSlug}/crm/accounts/${project.account.id}`}
                  className="hover:text-foreground hover:underline"
                >
                  {project.account.name}
                </Link>
                {' — '}
              </>
            )}
            {project.due_date ? (
              <span className={late ? 'font-medium text-destructive' : undefined}>
                Échéance {formatDate(project.due_date)}
                {late
                  ? ` — en retard de ${Math.abs(days ?? 0)} j`
                  : days != null && days <= 14
                    ? ` (J-${days})`
                    : ''}
              </span>
            ) : (
              'Sans échéance'
            )}
          </p>
        </div>
        {canEdit && <ProjectStatusSelect orgSlug={orgSlug} project={project} />}
        {canEdit && (
          <ProjectDialog
            orgSlug={orgSlug}
            project={project}
            accounts={accounts}
            trigger={
              <Button variant="outline" size="sm">
                <Pencil className="size-3.5" /> Modifier
              </Button>
            }
          />
        )}
      </div>

      {project.description && (
        <p className="max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground">
          {project.description}
        </p>
      )}

      <TagPicker
        orgSlug={orgSlug}
        entityType="project"
        entityId={id}
        allTags={tags}
        appliedTags={appliedTags}
        canEdit={canEdit}
      />

      {tasks.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
          <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.round((100 * doneTasks) / tasks.length)}%` }}
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {doneTasks}/{tasks.length} tâche{tasks.length > 1 ? 's' : ''} terminée
            {doneTasks > 1 ? 's' : ''}
          </span>
        </div>
      )}

      <TaskBoard
        orgSlug={orgSlug}
        projectId={id}
        tasks={tasks}
        members={memberOptions}
        canEdit={canEdit}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Documents</h2>
          <EntityDocuments
            orgSlug={orgSlug}
            entityType="project"
            entityId={id}
            documents={documents}
            canEdit={canEdit}
            folder={`Société/Projet ${project.code} — ${project.name}`.slice(0, 90)}
          />
        </section>
        <section className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Activité</h2>
          <ActivityFeed entries={activity} />
        </section>
      </div>
    </div>
  )
}
