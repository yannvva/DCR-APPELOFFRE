'use server'

import { revalidatePath } from 'next/cache'
import { requireMembership } from '@/lib/dal/auth'
import { audit } from '@/lib/audit'
import {
  updateMyProfileSchema,
  updateOrganizationSchema,
  type ActionState,
} from '@/lib/validation/auth'

/**
 * Profil courant : nom affiché, fonction métier dans l'org (job_role) et
 * organisation par défaut à la connexion. Réservé au membre lui-même —
 * job_role passe par la RPC set_my_job_role (members_update exige admin).
 */
export async function updateMyProfile(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'viewer')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, user, org } = ctx

  const jobRoleRaw = (formData.get('jobRole') as string) || null
  const defaultOrgRaw = (formData.get('defaultOrganizationId') as string) || null

  const parsed = updateMyProfileSchema.safeParse({
    fullName: formData.get('fullName'),
    jobRole: jobRoleRaw,
    defaultOrganizationId: defaultOrgRaw,
  })
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const { fullName, jobRole, defaultOrganizationId } = parsed.data

  // L'org par défaut doit être une org dont l'utilisateur est membre
  if (defaultOrganizationId && defaultOrganizationId !== org.id) {
    const { data: target } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('organization_id', defaultOrganizationId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!target) return { error: 'Organisation inconnue.' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: fullName,
      default_organization_id: defaultOrganizationId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
  if (error) return { error: 'Échec de l’enregistrement du profil.' }

  const { error: jrError } = await supabase.rpc('set_my_job_role', {
    p_org_id: org.id,
    p_job_role: jobRole,
  })
  if (jrError) return { error: 'Échec de l’enregistrement de la fonction.' }

  await audit(supabase, {
    organizationId: org.id,
    action: 'profile.updated',
    entityType: 'profile',
    entityId: user.id,
    metadata: { job_role: jobRole },
  })

  revalidatePath(`/${orgSlug}`, 'layout')
  return { success: true }
}

/** Renomme l'organisation (owner/admin — le slug, lui, reste stable). */
export async function updateOrganizationName(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'admin')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, org } = ctx

  const parsed = updateOrganizationSchema.safeParse({ name: formData.get('name') })
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }

  const { error } = await supabase
    .from('organizations')
    .update({ name: parsed.data.name, updated_at: new Date().toISOString() })
    .eq('id', org.id)
  if (error) return { error: 'Échec du renommage.' }

  await audit(supabase, {
    organizationId: org.id,
    action: 'organization.renamed',
    entityType: 'organization',
    entityId: org.id,
    metadata: { name: parsed.data.name },
  })

  revalidatePath(`/${orgSlug}`, 'layout')
  return { success: true }
}
