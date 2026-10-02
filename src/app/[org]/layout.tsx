import { notFound } from 'next/navigation'
import { requireMembership, getUserOrganizations } from '@/lib/dal/auth'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { CommandPalette } from '@/components/layout/command-palette'

export default async function OrgLayout({
  children,
  params,
}: LayoutProps<'/[org]'>) {
  const { org: orgSlug } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const orgs = await getUserOrganizations()

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <AppSidebar
        org={ctx.org}
        orgs={orgs}
        role={ctx.role}
        user={{
          email: ctx.user.email ?? '',
          fullName: ctx.profile?.full_name ?? '',
        }}
      />
      {/* min-w-0 : sans lui, le flex item refuse de rétrécir sous la largeur
          de son contenu et les pages larges débordent horizontalement. */}
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      <CommandPalette orgSlug={orgSlug} />
    </div>
  )
}
