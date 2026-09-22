import { notFound } from 'next/navigation'
import { requireMembership, getUserOrganizations } from '@/lib/dal/auth'
import { AppSidebar } from '@/components/layout/app-sidebar'

export default async function OrgLayout({
  children,
  params,
}: LayoutProps<'/[org]'>) {
  const { org: orgSlug } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const orgs = await getUserOrganizations()

  return (
    <div className="flex min-h-svh">
      <AppSidebar
        org={ctx.org}
        orgs={orgs}
        role={ctx.role}
        user={{
          email: ctx.user.email ?? '',
          fullName: ctx.profile?.full_name ?? '',
        }}
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
