// Types applicatifs — remplacés par `supabase gen types` une fois le projet lié.

export type MembershipRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  default_organization_id: string | null
  created_at: string
  updated_at: string
}

export interface Organization {
  id: string
  name: string
  slug: string
  logo_url: string | null
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface OrganizationMember {
  organization_id: string
  user_id: string
  role: MembershipRole
  invited_by: string | null
  joined_at: string
  profile?: Pick<Profile, 'full_name' | 'avatar_url'> | null
}

export interface OrganizationInvitation {
  id: string
  organization_id: string
  email: string
  role: Exclude<MembershipRole, 'owner'>
  token: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  invited_by: string
  expires_at: string
  created_at: string
}
