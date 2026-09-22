import 'server-only'

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { MembershipRole, Organization, Profile } from '@/lib/types'

export class UnauthorizedError extends Error {
  constructor() {
    super('Authentification requise')
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super('Accès refusé')
  }
}

const ROLE_RANK: Record<MembershipRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
}

export const requireUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw new UnauthorizedError()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return { supabase, user, profile: profile as Profile | null }
})

/**
 * Résout l'org par slug et vérifie la membership. Appelé par chaque page/DAL.
 * @param minRole rôle minimal requis (défaut : viewer = simple membre)
 */
export const requireMembership = cache(
  async (orgSlug: string, minRole: MembershipRole = 'viewer') => {
    const { supabase, user, profile } = await requireUser()

    const { data: org } = await supabase
      .from('organizations')
      .select('*')
      .eq('slug', orgSlug)
      .single()

    // 404 uniforme : ne pas distinguer « org inexistante » de « non membre »
    if (!org) return null

    const { data: member } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', org.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!member) return null

    const role = member.role as MembershipRole
    if (ROLE_RANK[role] < ROLE_RANK[minRole]) return null

    return {
      supabase,
      user,
      profile,
      org: org as Organization,
      role,
    }
  },
)

/** Liste les organisations de l'utilisateur courant. */
export async function getUserOrganizations() {
  const { supabase, user } = await requireUser()
  const { data } = await supabase
    .from('organization_members')
    .select('role, organization:organizations(*)')
    .eq('user_id', user.id)
    .order('joined_at')

  return (data ?? [])
    .filter((m) => m.organization)
    .map((m) => ({ ...(m.organization as unknown as Organization), memberRole: m.role as MembershipRole }))
}
