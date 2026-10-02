'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireMembership } from '@/lib/dal/auth'
import { audit } from '@/lib/audit'
import {
  changeEmailSchema,
  changePasswordSchema,
  deleteOrganizationSchema,
  updateMyProfileSchema,
  updateOrganizationSchema,
  type ActionState,
} from '@/lib/validation/auth'
import { createClient } from '@/lib/supabase/server'

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

/**
 * Changement de mot de passe : re-authentification obligatoire avec le mot de
 * passe actuel (une session volée ne suffit pas à verrouiller le compte).
 */
export async function changePassword(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'viewer')
  if (!ctx) return { error: 'Accès refusé.' }
  const { org, user } = ctx

  const parsed = changePasswordSchema.safeParse({
    current: formData.get('current'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  })
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const email = user.email
  if (!email) return { error: 'Email du compte introuvable.' }

  const { error: authError } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.current,
  })
  if (authError) return { fieldErrors: { current: ['Mot de passe actuel incorrect'] } }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: 'Échec de la mise à jour du mot de passe.' }

  await audit(supabase, {
    organizationId: org.id,
    action: 'account.password_changed',
    entityType: 'profile',
    entityId: user.id,
  })
  return { success: true }
}

/** Changement d'email : Supabase envoie un lien de confirmation à la nouvelle adresse. */
export async function changeEmail(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'viewer')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, org, user } = ctx

  const parsed = changeEmailSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  if (parsed.data.email === user.email) {
    return { fieldErrors: { email: ['C’est déjà votre adresse actuelle'] } }
  }

  const { error } = await supabase.auth.updateUser({ email: parsed.data.email })
  if (error) return { error: 'Échec de la demande — réessayez plus tard.' }

  await audit(supabase, {
    organizationId: org.id,
    action: 'account.email_change_requested',
    entityType: 'profile',
    entityId: user.id,
    metadata: { new_email: parsed.data.email },
  })
  return { success: true }
}

/** Tables exportées dans le dump RGPD (métadonnées — pas les binaires).
 *  Noms exacts du schéma : les runs DCE/fiches/mémoire/dépôts sont préfixés
 *  `tender_` (un nom approximatif renvoyait une table inexistante et le dump
 *  perdait silencieusement la donnée). */
const EXPORT_TABLES = [
  'accounts',
  'contacts',
  'leads',
  'opportunities',
  'pipelines',
  'pipeline_stages',
  'projects',
  'project_members',
  'tasks',
  'task_assignees',
  'task_comments',
  'interactions',
  'documents',
  'document_links',
  'tags',
  'entity_tags',
  'tenders',
  'tender_lots',
  'tender_members',
  'tender_checklist_items',
  'tender_alerts',
  'tender_results',
  'tender_dce_analyses',
  'tender_datasheet_runs',
  'tender_memoire_runs',
  'tender_submissions',
  'activity_logs',
] as const

/** Plafond par table — au-delà, le dump est partiel et doit le dire. */
const EXPORT_LIMIT = 10_000

/**
 * Export complet des données de l'organisation (JSON) — portabilité RGPD.
 * Réservé owner/admin ; renvoie le JSON en clair, le client le télécharge.
 * Une table en erreur ou tronquée est signalée dans `_meta` : un export
 * incomplet ne doit jamais ressembler à un export complet.
 */
export async function exportOrganizationData(
  orgSlug: string,
): Promise<{ error?: string; json?: string; warning?: string }> {
  const ctx = await requireMembership(orgSlug, 'admin')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, org } = ctx

  const results = await Promise.all(
    EXPORT_TABLES.map(async (table) => {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('organization_id', org.id)
        .limit(EXPORT_LIMIT)
      return { table, data: data ?? [], error: error?.message ?? null }
    }),
  )

  const dump: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    organization: org,
  }
  const failures: Record<string, string> = {}
  const truncated: string[] = []
  for (const r of results) {
    if (r.error) failures[r.table] = r.error
    if (r.data.length >= EXPORT_LIMIT) truncated.push(r.table)
    dump[r.table] = r.data
  }
  dump._meta = {
    tables: EXPORT_TABLES.length,
    ...(truncated.length ? { truncated } : {}),
    ...(Object.keys(failures).length ? { failures } : {}),
  }

  await audit(supabase, {
    organizationId: org.id,
    action: 'organization.exported',
    entityType: 'organization',
    entityId: org.id,
    metadata: {
      tables: EXPORT_TABLES.length,
      truncated,
      failures: Object.keys(failures),
    },
  })

  // Un export partiel reste téléchargeable — le refuser priverait l'utilisateur
  // de ses données pour une table en échec — mais il est signalé.
  const warnings = [
    truncated.length ? `tronquée(s) à ${EXPORT_LIMIT} lignes : ${truncated.join(', ')}` : null,
    Object.keys(failures).length
      ? `en échec : ${Object.keys(failures).join(', ')}`
      : null,
  ].filter(Boolean)

  return {
    json: JSON.stringify(dump, null, 2),
    warning: warnings.length ? `Export partiel — ${warnings.join(' ; ')}.` : undefined,
  }
}

/**
 * Suppression définitive de l'organisation (owner). Cascade sur toutes les
 * tables métier + RLS. Confirmation par saisie du nom exact.
 */
export async function deleteOrganization(
  orgSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'owner')
  if (!ctx) return { error: 'Seul le propriétaire peut supprimer l’organisation.' }
  const { supabase, org } = ctx

  const parsed = deleteOrganizationSchema.safeParse({
    confirmName: formData.get('confirmName'),
  })
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  if (parsed.data.confirmName.trim() !== org.name) {
    return { fieldErrors: { confirmName: ['Le nom saisi ne correspond pas'] } }
  }

  const { error } = await supabase.from('organizations').delete().eq('id', org.id)
  if (error) return { error: 'Suppression impossible — réessayez ou contactez le support.' }

  redirect('/onboarding')
}
