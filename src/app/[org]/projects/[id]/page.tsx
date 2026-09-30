import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Pencil } from 'lucide-react'
import { requireMembership } from '@/lib/dal/auth'
import { getProject, listOrgMembers, listProjectTasks } from '@/lib/dal/projects'
import { searchAccounts } from '@/lib/dal/crm'
import { getEntityTags, listTags } from '@/lib/dal/crm'
import { getEntityDocuments } from '@/lib/dal/documents'
import { ProjectDialog } from '@/components/projects/project-dialog'
import { ProjectStatusSelect } from '@/components/projects/project-status-select'
import { TaskBoard } from '@/components/projects/task-board'
import { TagPicker } from '@/components/tag-picker'
import { EntityDocuments } from '@/components/entity-documents'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/format'

export default async function ProjectDetailPage({
  params,
}: PageProps<'/[org]/projects/[id]'>) {
  const { org: orgSlug, id } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const project = await getProject(ctx, id)
  if (!project) notFound()

  const canEdit = ctx.role !== 'viewer'
  const [tasks, members, accounts, tags, appliedTags, documents] = await Promise.all([
    listProjectTasks(ctx, id),
    listOrgMembers(ctx),
    searchAccounts(ctx, '', 100),
    listTags(ctx),
    getEntityTags(ctx, 'project', id),
    getEntityDocuments(ctx, 'project', id),
  ])

  const memberOptions = members.map((m) => ({
    user_id: m.user_id,
    full_name: m.profiles?.full_name ?? null,
  }))

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href={`/${orgSlug}/projects`} />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-muted-foreground">{project.code}</span>
            <h1 className="truncate text-2xl font-semibold">{project.name}</h1>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {project.account?.name ? `${project.account.name} — ` : ''}
            {project.due_date ? `Échéance ${formatDate(project.due_date)}` : 'Sans échéance'}
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

      <TaskBoard
        orgSlug={orgSlug}
        projectId={id}
        tasks={tasks}
        members={memberOptions}
        canEdit={canEdit}
      />

      <section className="max-w-2xl rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">Documents</h2>
        <EntityDocuments
          orgSlug={orgSlug}
          entityType="project"
          entityId={id}
          documents={documents}
          canEdit={canEdit}
          folder={`Projet ${project.code} — ${project.name}`.slice(0, 90)}
        />
      </section>
    </div>
  )
}
