import { requireMembership } from '@/lib/dal/auth'
import { notFound } from 'next/navigation'
import { CrmNav } from '@/components/crm/crm-nav'

export default async function CrmLayout({
  children,
  params,
}: LayoutProps<'/[org]/crm'>) {
  const { org: orgSlug } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  return (
    <div className="flex h-full flex-col">
      <CrmNav orgSlug={orgSlug} />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
