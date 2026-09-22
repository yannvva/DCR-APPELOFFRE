import { notFound } from 'next/navigation'
import { requireMembership } from '@/lib/dal/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
  viewer: 'Observateur',
}

export default async function SettingsPage({
  params,
}: PageProps<'/[org]/settings'>) {
  const { org: orgSlug } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()
  const { org, role } = ctx

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Paramètres</h1>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Organisation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Nom</span>
            <span className="font-medium">{org.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Identifiant</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{org.slug}</code>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Votre rôle</span>
            <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
