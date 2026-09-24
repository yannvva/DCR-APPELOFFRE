import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FolderKanban } from 'lucide-react'
import { requireMembership } from '@/lib/dal/auth'
import { listProjects } from '@/lib/dal/projects'
import { searchAccounts } from '@/lib/dal/crm'
import { ProjectDialog } from '@/components/projects/project-dialog'
import { RowActions } from '@/components/row-actions'
import { deleteProject } from '@/app/actions/projects'
import { SearchInput, Pagination } from '@/components/list-toolbar'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format'
import type { ProjectStatus } from '@/lib/types'

const STATUS: Record<ProjectStatus, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  active: { label: 'Actif', variant: 'default' },
  on_hold: { label: 'En pause', variant: 'secondary' },
  done: { label: 'Terminé', variant: 'outline' },
  archived: { label: 'Archivé', variant: 'outline' },
}

export default async function ProjectsPage({
  params,
  searchParams,
}: PageProps<'/[org]/projects'>) {
  const { org: orgSlug } = await params
  const sp = await searchParams
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const q = typeof sp.q === 'string' ? sp.q : ''
  const status = typeof sp.status === 'string' ? sp.status : undefined
  const page = Math.max(1, Number(sp.page ?? 1) || 1)
  const [{ rows, count, pageSize }, accounts] = await Promise.all([
    listProjects(ctx, { q, page, status }),
    searchAccounts(ctx, '', 100),
  ])
  const canEdit = ctx.role !== 'viewer'

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projets</h1>
          <p className="text-sm text-muted-foreground">Exécution opérationnelle</p>
        </div>
        {canEdit && (
          <ProjectDialog orgSlug={orgSlug} accounts={accounts} defaultOpen={sp.new === '1'} />
        )}
      </div>

      <SearchInput placeholder="Rechercher un projet…" />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <FolderKanban className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Aucun projet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {q ? 'Aucun résultat.' : 'Créez un projet ou convertissez une opportunité gagnée.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((p) => {
              const s = STATUS[p.status]
              return (
                <div
                  key={p.id}
                  className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/${orgSlug}/projects/${p.id}`}
                      className="min-w-0 flex-1 font-medium leading-snug hover:underline"
                    >
                      <span className="mr-2 text-xs text-muted-foreground">{p.code}</span>
                      {p.name}
                    </Link>
                    {canEdit && (
                      <RowActions
                        label={p.name}
                        onDelete={async () => {
                          'use server'
                          return deleteProject(orgSlug, p.id)
                        }}
                      />
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <Badge variant={s.variant}>{s.label}</Badge>
                    <span>
                      {p.account?.name ?? ''}
                      {p.due_date ? ` — ${formatDate(p.due_date)}` : ''}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          <Pagination count={count} page={page} pageSize={pageSize} />
        </>
      )}
    </div>
  )
}
