import { requireMembership } from '@/lib/dal/auth'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, FolderKanban, CheckSquare, FileText } from 'lucide-react'

export default async function DashboardPage({
  params,
}: PageProps<'/[org]/dashboard'>) {
  const { org: orgSlug } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()
  const { supabase, org } = ctx

  const [accounts, projects, tasks, documents] = await Promise.all([
    supabase.from('accounts').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
    supabase.from('projects').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).neq('status', 'archived'),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('organization_id', org.id).neq('status', 'done'),
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
  ])

  const stats = [
    { label: 'Entreprises', value: accounts.count ?? 0, icon: Users },
    { label: 'Projets actifs', value: projects.count ?? 0, icon: FolderKanban },
    { label: 'Tâches ouvertes', value: tasks.count ?? 0, icon: CheckSquare },
    { label: 'Documents', value: documents.count ?? 0, icon: FileText },
  ]

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">{org.name}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
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
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="font-medium">Votre espace est prêt</p>
          <p className="text-sm text-muted-foreground">
            Les modules CRM, Projets et Documents arrivent dans les prochaines étapes du plan.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
