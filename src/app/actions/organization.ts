'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireMembership, requireUser } from '@/lib/dal/auth'
import { audit } from '@/lib/audit'
import {
  createOrganizationSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
  type ActionState,
} from '@/lib/validation/auth'

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || 'org'
}

export async function createOrganization(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser()

  const parsed = createOrganizationSchema.safeParse({ name: formData.get('name') })
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()

  // Backfill : comptes créés avant la migration n'ont pas de profil
  await supabase.from('profiles').upsert(
    {
      id: user.id,
      full_name: (user.user_metadata?.full_name as string) ?? '',
      avatar_url: (user.user_metadata?.avatar_url as string) ?? null,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  )

  const base = slugify(parsed.data.name)

  // Retry sur collision de slug (unique constraint)
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`
    const { data, error } = await supabase.rpc('create_organization', {
      p_name: parsed.data.name,
      p_slug: slug,
    })
    if (!error && data) {
      redirect(`/${slug}/dashboard`)
    }
    if (error && error.code !== '23505') {
      console.error('create_organization failed:', error.code, error.message, error.details)
      return { error: 'Erreur lors de la création de l’organisation.' }
    }
  }
  return { error: 'Impossible de générer un identifiant unique. Réessayez.' }
}

export async function inviteMember(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'admin')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, user, org } = ctx

  const parsed = inviteMemberSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  })
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const { email, role } = parsed.data

  const { data: invitation, error } = await supabase
    .from('organization_invitations')
    .upsert(
      {
        organization_id: org.id,
        email: email.toLowerCase(),
        role,
        invited_by: user.id,
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      },
      { onConflict: 'organization_id,email' },
    )
    .select('token')
    .single()

  if (error || !invitation) {
    return { error: 'Impossible de créer l’invitation.' }
  }

  await audit(supabase, {
    organizationId: org.id,
    action: 'invitation.created',
    entityType: 'organization_invitation',
    metadata: { email, role },
  })

  revalidatePath(`/${orgSlug}/members`)
  return { success: true, inviteUrl: `/invite/${invitation.token}` }
}

export async function updateMemberRole(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'admin')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, user, org, role: actorRole } = ctx

  const parsed = updateMemberRoleSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  })
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const { userId, role } = parsed.data

  // Seul un owner peut attribuer le rôle owner ou modifier son propre rôle
  if ((role === 'owner' || userId === user.id) && actorRole !== 'owner') {
    return { error: 'Seul un propriétaire peut effectuer cette action.' }
  }

  const { error } = await supabase
    .from('organization_members')
    .update({ role })
    .eq('organization_id', org.id)
    .eq('user_id', userId)

  if (error) {
    return { error: error.message.includes('dernier propriétaire')
      ? 'Impossible : dernier propriétaire de l’organisation.'
      : 'Erreur lors de la mise à jour du rôle.' }
  }

  await audit(supabase, {
    organizationId: org.id,
    action: 'member.role_updated',
    entityType: 'organization_member',
    entityId: undefined,
    metadata: { user_id: userId, role },
  })

  revalidatePath(`/${orgSlug}/members`)
  return { success: true }
}

export async function removeMember(orgSlug: string, userId: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'admin')
  const selfCtx = await requireMembership(orgSlug, 'member')
  if (!selfCtx) return { error: 'Accès refusé.' }

  const isSelf = selfCtx.user.id === userId
  if (!isSelf && !ctx) return { error: 'Accès refusé.' }

  const { supabase, org } = selfCtx
  const { error } = await supabase
    .from('organization_members')
    .delete()
    .eq('organization_id', org.id)
    .eq('user_id', userId)

  if (error) {
    return { error: error.message.includes('dernier propriétaire')
      ? 'Impossible : dernier propriétaire de l’organisation.'
      : 'Erreur lors de la suppression du membre.' }
  }

  await audit(supabase, {
    organizationId: org.id,
    action: 'member.removed',
    entityType: 'organization_member',
    metadata: { user_id: userId },
  })

  revalidatePath(`/${orgSlug}/members`)
  return { success: true }
}

export async function revokeInvitation(orgSlug: string, invitationId: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'admin')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, org } = ctx

  const { error } = await supabase
    .from('organization_invitations')
    .update({ status: 'revoked' })
    .eq('organization_id', org.id)
    .eq('id', invitationId)
    .eq('status', 'pending')

  if (error) return { error: 'Erreur lors de la révocation.' }

  await audit(supabase, {
    organizationId: org.id,
    action: 'invitation.revoked',
    entityType: 'organization_invitation',
    entityId: invitationId,
  })

  revalidatePath(`/${orgSlug}/members`)
  return { success: true }
}

export async function acceptInvitation(token: string) {
  const { supabase } = await requireUser()
  const { data, error } = await supabase.rpc('accept_invitation', { p_token: token })
  if (error) {
    return { error: error.message }
  }
  return { organizationId: data as string }
}
