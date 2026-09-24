'use server'

import { revalidatePath } from 'next/cache'
import { requireMembership } from '@/lib/dal/auth'
import { audit } from '@/lib/audit'
import {
  accountSchema,
  contactSchema,
  leadSchema,
  opportunitySchema,
  tagSchema,
} from '@/lib/validation/domain'
import type { ActionState } from '@/lib/validation/auth'

function fail(e: unknown, fallback = 'Une erreur est survenue.'): NonNullable<ActionState> {
  const msg = e instanceof Error ? e.message : fallback
  return { error: msg === 'Accès refusé' ? msg : fallback }
}

// ============================ ACCOUNTS ============================

export async function createAccount(orgSlug: string, input: unknown): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = accountSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { data, error } = await ctx.supabase
    .from('accounts')
    .insert({
      organization_id: ctx.org.id,
      name: d.name,
      domain: d.domain || null,
      industry: d.industry || null,
      website: d.website || null,
      phone: d.phone || null,
      notes: d.notes || null,
      created_by: ctx.user.id,
    })
    .select('id')
    .single()

  if (error) return fail(error)
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'account.created',
    entityType: 'account',
    entityId: data.id,
    metadata: { name: d.name },
  })
  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

export async function updateAccount(orgSlug: string, id: string, input: unknown): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = accountSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { error } = await ctx.supabase
    .from('accounts')
    .update({
      name: d.name,
      domain: d.domain || null,
      industry: d.industry || null,
      website: d.website || null,
      phone: d.phone || null,
      notes: d.notes || null,
    })
    .eq('organization_id', ctx.org.id)
    .eq('id', id)

  if (error) return fail(error)
  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

export async function deleteAccount(orgSlug: string, id: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'admin')
  if (!ctx) return { error: 'Accès refusé.' }

  const { error } = await ctx.supabase
    .from('accounts')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
  if (error) return fail(error)

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'account.deleted',
    entityType: 'account',
    entityId: id,
  })
  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

// ============================ CONTACTS ============================

export async function createContact(orgSlug: string, input: unknown): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { data, error } = await ctx.supabase
    .from('contacts')
    .insert({
      organization_id: ctx.org.id,
      account_id: d.accountId || null,
      first_name: d.firstName || null,
      last_name: d.lastName,
      email: d.email || null,
      phone: d.phone || null,
      role: d.role || null,
      notes: d.notes || null,
      created_by: ctx.user.id,
    })
    .select('id')
    .single()

  if (error) return fail(error)
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'contact.created',
    entityType: 'contact',
    entityId: data.id,
  })
  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

export async function updateContact(orgSlug: string, id: string, input: unknown): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { error } = await ctx.supabase
    .from('contacts')
    .update({
      account_id: d.accountId || null,
      first_name: d.firstName || null,
      last_name: d.lastName,
      email: d.email || null,
      phone: d.phone || null,
      role: d.role || null,
      notes: d.notes || null,
    })
    .eq('organization_id', ctx.org.id)
    .eq('id', id)

  if (error) return fail(error)
  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

export async function deleteContact(orgSlug: string, id: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'admin')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('contacts')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
  if (error) return fail(error)
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'contact.deleted',
    entityType: 'contact',
    entityId: id,
  })
  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

// ============================ OPPORTUNITÉS ============================

export async function createOpportunity(orgSlug: string, input: unknown): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = opportunitySchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  // Pipeline + premier stage par défaut
  const { data: pipeline } = await ctx.supabase
    .from('pipelines')
    .select('id')
    .eq('organization_id', ctx.org.id)
    .eq('is_default', true)
    .single()
  if (!pipeline) return { error: 'Aucun pipeline configuré.' }

  const { data: firstStage } = await ctx.supabase
    .from('pipeline_stages')
    .select('id')
    .eq('organization_id', ctx.org.id)
    .eq('pipeline_id', pipeline.id)
    .eq('is_won', false)
    .eq('is_lost', false)
    .order('position')
    .limit(1)
    .single()
  if (!firstStage) return { error: 'Pipeline sans étape utilisable.' }

  const { data, error } = await ctx.supabase
    .from('opportunities')
    .insert({
      organization_id: ctx.org.id,
      pipeline_id: pipeline.id,
      stage_id: firstStage.id,
      account_id: d.accountId || null,
      primary_contact_id: d.primaryContactId || null,
      title: d.title,
      value_cents: d.valueEuros != null ? Math.round(d.valueEuros * 100) : null,
      expected_close_date: d.expectedCloseDate || null,
      created_by: ctx.user.id,
    })
    .select('id')
    .single()

  if (error) return fail(error)
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'opportunity.created',
    entityType: 'opportunity',
    entityId: data.id,
    metadata: { title: d.title },
  })
  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

export async function moveOpportunity(
  orgSlug: string,
  opportunityId: string,
  stageId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }

  // Vérifie que le stage appartient au pipeline de l'org
  const { data: stage } = await ctx.supabase
    .from('pipeline_stages')
    .select('id, is_won, is_lost, probability')
    .eq('organization_id', ctx.org.id)
    .eq('id', stageId)
    .maybeSingle()
  if (!stage) return { error: 'Étape invalide.' }

  const status = stage.is_won ? 'won' : stage.is_lost ? 'lost' : 'open'

  const { error } = await ctx.supabase
    .from('opportunities')
    .update({
      stage_id: stageId,
      probability: stage.probability,
      status,
    })
    .eq('organization_id', ctx.org.id)
    .eq('id', opportunityId)

  if (error) return fail(error)
  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

export async function updateOpportunity(
  orgSlug: string,
  id: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = opportunitySchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { error } = await ctx.supabase
    .from('opportunities')
    .update({
      title: d.title,
      account_id: d.accountId || null,
      primary_contact_id: d.primaryContactId || null,
      value_cents: d.valueEuros != null ? Math.round(d.valueEuros * 100) : null,
      expected_close_date: d.expectedCloseDate || null,
    })
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
    .eq('status', 'open')

  if (error) return fail(error)
  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

export async function setOpportunityLost(
  orgSlug: string,
  id: string,
  lostReason: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }

  const { data: lostStage } = await ctx.supabase
    .from('pipeline_stages')
    .select('id')
    .eq('organization_id', ctx.org.id)
    .eq('is_lost', true)
    .limit(1)
    .single()
  if (!lostStage) return { error: 'Étape « perdu » introuvable.' }

  const { error } = await ctx.supabase
    .from('opportunities')
    .update({ status: 'lost', stage_id: lostStage.id, lost_reason: lostReason || null })
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
  if (error) return fail(error)

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'opportunity.lost',
    entityType: 'opportunity',
    entityId: id,
    metadata: { reason: lostReason },
  })
  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

// ============================ LEADS ============================

export async function createLead(orgSlug: string, input: unknown): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = leadSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { error } = await ctx.supabase
    .from('leads')
    .insert({
      organization_id: ctx.org.id,
      title: d.title,
      source: d.source || null,
      notes: d.notes || null,
      contact_id: d.contactId || null,
      account_id: d.accountId || null,
      created_by: ctx.user.id,
    })

  if (error) return fail(error)
  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

export async function updateLeadStatus(
  orgSlug: string,
  id: string,
  status: 'new' | 'contacted' | 'qualified' | 'lost',
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('leads')
    .update({ status })
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
    .neq('status', 'converted')
  if (error) return fail(error)
  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

export async function convertLead(orgSlug: string, leadId: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }

  const { data: lead } = await ctx.supabase
    .from('leads')
    .select('*')
    .eq('organization_id', ctx.org.id)
    .eq('id', leadId)
    .single()
  if (!lead) return { error: 'Lead introuvable.' }
  if (lead.converted_opportunity_id) return { error: 'Lead déjà converti.' }

  const res = await createOpportunity(orgSlug, {
    title: lead.title ?? 'Opportunité',
    accountId: lead.account_id ?? '',
    primaryContactId: lead.contact_id ?? '',
  })
  if (res?.error) return res

  // Récupère l'opportunité créée (la plus récente de l'utilisateur)
  const { data: opp } = await ctx.supabase
    .from('opportunities')
    .select('id')
    .eq('organization_id', ctx.org.id)
    .eq('created_by', ctx.user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (opp) {
    await ctx.supabase
      .from('leads')
      .update({ status: 'converted', converted_opportunity_id: opp.id })
      .eq('organization_id', ctx.org.id)
      .eq('id', leadId)
  }

  revalidatePath(`/${orgSlug}/crm`)
  return { success: true }
}

// ============================ TAGS ============================

export async function createTag(orgSlug: string, input: unknown): Promise<ActionState & { tagId?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = tagSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }

  const { data, error } = await ctx.supabase
    .from('tags')
    .upsert(
      { organization_id: ctx.org.id, name: parsed.data.name, color: parsed.data.color },
      { onConflict: 'organization_id,name_lower' },
    )
    .select('id')
    .single()

  if (error) return fail(error)
  return { success: true, tagId: data.id }
}

export async function applyTag(
  orgSlug: string,
  tagId: string,
  entityType: string,
  entityId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const allowed = ['account', 'contact', 'lead', 'opportunity', 'project', 'task', 'document']
  if (!allowed.includes(entityType)) return { error: 'Type invalide.' }

  const { error } = await ctx.supabase
    .from('entity_tags')
    .upsert(
      { organization_id: ctx.org.id, tag_id: tagId, entity_type: entityType, entity_id: entityId },
      { onConflict: 'tag_id,entity_type,entity_id' },
    )
  if (error) return fail(error)
  revalidatePath(`/${orgSlug}`)
  return { success: true }
}

export async function removeTag(
  orgSlug: string,
  tagId: string,
  entityType: string,
  entityId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('entity_tags')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('tag_id', tagId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
  if (error) return fail(error)
  revalidatePath(`/${orgSlug}`)
  return { success: true }
}
