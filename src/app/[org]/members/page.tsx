import { notFound } from 'next/navigation'
import { requireMembership } from '@/lib/dal/auth'
import { MembersClient } from '@/components/members/members-client'
import type { OrganizationInvitation, OrganizationMember } from '@/lib/types'

export default async function MembersPage({
  params,
}: PageProps<'/[org]/members'>) {
  const { org: orgSlug } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()
  const { supabase, org, role, user } = ctx

  const canManage = role === 'owner' || role === 'admin'

  const { data: members } = await supabase
    .from('organization_members')
    .select('user_id, role, joined_at, profiles(full_name, avatar_url)')
    .eq('organization_id', org.id)
    .order('joined_at')

  const { data: invitations } = canManage
    ? await supabase
        .from('organization_invitations')
        .select('*')
        .eq('organization_id', org.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
    : { data: [] }

  return (
    <MembersClient
      orgSlug={orgSlug}
      canManage={canManage}
      currentUserId={user.id}
      members={(members ?? []) as unknown as OrganizationMember[]}
      invitations={(invitations ?? []) as OrganizationInvitation[]}
    />
  )
}
