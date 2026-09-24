'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireMembership } from '@/lib/dal/auth'
import { audit } from '@/lib/audit'
import {
  checklistItemSchema,
  submissionSchema,
  tenderLotSchema,
  tenderResultSchema,
  tenderSchema,
} from '@/lib/validation/domain'
import type { ActionState } from '@/lib/validation/auth'
import type { ChecklistItemStatus, TenderStatus } from '@/lib/types'

function fail(e: unknown, fallback = 'Une erreur est survenue.'): NonNullable<ActionState> {
  const msg = e instanceof Error ? e.message : fallback
  return { error: msg === 'Accès refusé' ? msg : fallback }
}

const toIso = (d: string | undefined | null) => (d ? new Date(d).toISOString() : null)
const toCents = (euros: number | '' | undefined) =>
  euros === '' || euros == null ? null : Math.round(euros * 100)

// ============================ TENDERS ============================

export async function createTender(orgSlug: string, input: unknown): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = tenderSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { data, error } = await ctx.supabase.rpc('create_tender', {
    p_payload: {
      organization_id: ctx.org.id,
      title: d.title,
      reference: d.reference || null,
      buyer_account_id: d.buyerAccountId || null,
      platform: d.platform || null,
      dce_url: d.dceUrl || null,
      published_at: d.publishedAt || null,
      response_deadline: toIso(d.responseDeadline),
      questions_deadline: toIso(d.questionsDeadline),
      site_visit_at: toIso(d.siteVisitAt),
      site_visit_mandatory: d.siteVisitMandatory,
      procedure_type: d.procedureType || null,
      market_type: d.marketType || null,
      duration_months: d.durationMonths || null,
      estimated_amount_cents: toCents(d.estimatedAmountEuros),
      region: d.region || null,
      award_criteria: {
        ...(d.priceWeight !== '' && d.priceWeight != null ? { prix: d.priceWeight } : {}),
        ...(d.technicalWeight !== '' && d.technicalWeight != null
          ? { technique: d.technicalWeight }
          : {}),
      },
      deposit_mode: d.depositMode || null,
      responsible_id: d.responsibleId || null,
      notes: d.notes || null,
      lots: d.lots.map((l) => ({
        number: l.number,
        title: l.title,
        amount_cents: toCents(l.amountEuros),
      })),
    },
  })

  if (error) return fail(error, 'Erreur lors de la création de l’appel d’offres.')
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'tender.created',
    entityType: 'tender',
    entityId: data as string,
    metadata: { title: d.title, reference: d.reference },
  })
  revalidatePath(`/${orgSlug}/tenders`)
  return { success: true, id: data as string }
}

export async function updateTender(
  orgSlug: string,
  id: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = tenderSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { error } = await ctx.supabase
    .from('tenders')
    .update({
      title: d.title,
      reference: d.reference || null,
      buyer_account_id: d.buyerAccountId || null,
      platform: d.platform || null,
      dce_url: d.dceUrl || null,
      published_at: d.publishedAt || null,
      response_deadline: toIso(d.responseDeadline),
      questions_deadline: toIso(d.questionsDeadline),
      site_visit_at: toIso(d.siteVisitAt),
      site_visit_mandatory: d.siteVisitMandatory,
      procedure_type: d.procedureType || null,
      market_type: d.marketType || null,
      duration_months: d.durationMonths || null,
      estimated_amount_cents: toCents(d.estimatedAmountEuros),
      region: d.region || null,
      award_criteria: {
        ...(d.priceWeight !== '' && d.priceWeight != null ? { prix: d.priceWeight } : {}),
        ...(d.technicalWeight !== '' && d.technicalWeight != null
          ? { technique: d.technicalWeight }
          : {}),
      },
      deposit_mode: d.depositMode || null,
      responsible_id: d.responsibleId || null,
      notes: d.notes || null,
    })
    .eq('organization_id', ctx.org.id)
    .eq('id', id)

  if (error) return fail(error)
  revalidatePath(`/${orgSlug}/tenders`)
  revalidatePath(`/${orgSlug}/tenders/${id}`)
  return { success: true }
}

const TENDER_STATUSES: TenderStatus[] = [
  'detecte',
  'analyse',
  'en_preparation',
  'a_deposer',
  'depose',
  'gagne',
  'perdu',
  'abandonne',
  'annule',
]

export async function setTenderStatus(
  orgSlug: string,
  id: string,
  status: TenderStatus,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!TENDER_STATUSES.includes(status)) return { error: 'Statut invalide.' }

  // Règle métier : « prêt à déposer » exige une checklist conforme
  if (status === 'a_deposer' || status === 'depose') {
    const { data } = await ctx.supabase.rpc('tender_readiness', { p_tender_id: id })
    const r = Array.isArray(data) ? data[0] : data
    if (r && !r.ready) {
      const blockers = (r.blockers as string[]) ?? []
      return {
        error: `Dossier incomplet : ${blockers.slice(0, 3).join(' ; ')}${blockers.length > 3 ? '…' : ''}`,
      }
    }
  }

  const { error } = await ctx.supabase
    .from('tenders')
    .update({ status })
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
  if (error) return fail(error)

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'tender.status_changed',
    entityType: 'tender',
    entityId: id,
    metadata: { status },
  })
  revalidatePath(`/${orgSlug}/tenders/${id}`)
  revalidatePath(`/${orgSlug}/tenders`)
  return { success: true }
}

export async function justifySiteVisit(orgSlug: string, id: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tenders')
    .update({ site_visit_justified: true })
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
  if (error) return fail(error)
  await runChecks(ctx.supabase, id)
  revalidatePath(`/${orgSlug}/tenders/${id}`)
  return { success: true }
}

export async function deleteTender(orgSlug: string, id: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'admin')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tenders')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
  if (error) return fail(error)
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'tender.deleted',
    entityType: 'tender',
    entityId: id,
  })
  revalidatePath(`/${orgSlug}/tenders`)
  return { success: true }
}

// ============================ LOTS ============================

export async function addLot(
  orgSlug: string,
  tenderId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = tenderLotSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data
  const { error } = await ctx.supabase.from('tender_lots').insert({
    organization_id: ctx.org.id,
    tender_id: tenderId,
    number: d.number,
    title: d.title,
    amount_cents: toCents(d.amountEuros),
  })
  if (error) return fail(error)
  await runChecks(ctx.supabase, tenderId)
  revalidatePath(`/${orgSlug}/tenders/${tenderId}`)
  return { success: true }
}

export async function toggleLotSelected(
  orgSlug: string,
  lotId: string,
  tenderId: string,
  selected: boolean,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_lots')
    .update({ selected })
    .eq('organization_id', ctx.org.id)
    .eq('id', lotId)
  if (error) return fail(error)
  await runChecks(ctx.supabase, tenderId)
  revalidatePath(`/${orgSlug}/tenders/${tenderId}`)
  return { success: true }
}

export async function deleteLot(
  orgSlug: string,
  lotId: string,
  tenderId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_lots')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', lotId)
  if (error) return fail(error)
  await runChecks(ctx.supabase, tenderId)
  revalidatePath(`/${orgSlug}/tenders/${tenderId}`)
  return { success: true }
}

// ============================ CHECKLIST ============================

export async function addChecklistItem(
  orgSlug: string,
  tenderId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = checklistItemSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { error } = await ctx.supabase.from('tender_checklist_items').insert({
    organization_id: ctx.org.id,
    tender_id: tenderId,
    label: d.label,
    category: d.category,
    requirement: d.requirement,
    assignee_id: d.assigneeId || null,
    internal_deadline: d.internalDeadline || null,
    requires_signature: d.requiresSignature,
    requires_chiffrage: d.requiresChiffrage,
    risk_level: d.riskLevel,
    comment: d.comment || null,
    position: 999,
  })
  if (error) return fail(error)
  await runChecks(ctx.supabase, tenderId)
  revalidatePath(`/${orgSlug}/tenders/${tenderId}`)
  return { success: true }
}

const ITEM_STATUSES: ChecklistItemStatus[] = [
  'non_commence',
  'en_cours',
  'a_verifier',
  'valide',
  'bloque',
  'non_requis',
]

export async function setChecklistItemStatus(
  orgSlug: string,
  itemId: string,
  tenderId: string,
  status: ChecklistItemStatus,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  if (!ITEM_STATUSES.includes(status)) return { error: 'Statut invalide.' }

  // Une ligne à signature exigée ne peut être validée sans pièce signée
  if (status === 'valide') {
    const { data: item } = await ctx.supabase
      .from('tender_checklist_items')
      .select('requires_signature, document:documents(is_signed)')
      .eq('id', itemId)
      .single()
    const doc = Array.isArray(item?.document) ? item.document[0] : item?.document
    if (item?.requires_signature && !doc?.is_signed) {
      return { error: 'Impossible de valider : la pièce doit être signée.' }
    }
  }

  const { error } = await ctx.supabase
    .from('tender_checklist_items')
    .update({
      status,
      ...(status === 'valide'
        ? { validated_by: ctx.user.id, validated_at: new Date().toISOString() }
        : {}),
    })
    .eq('organization_id', ctx.org.id)
    .eq('id', itemId)
  if (error) return fail(error)

  await runChecks(ctx.supabase, tenderId)
  if (status === 'valide') {
    await audit(ctx.supabase, {
      organizationId: ctx.org.id,
      action: 'checklist.validated',
      entityType: 'tender_checklist_item',
      entityId: itemId,
      metadata: { tender_id: tenderId },
    })
  }
  revalidatePath(`/${orgSlug}/tenders/${tenderId}`)
  return { success: true }
}

export async function assignChecklistItem(
  orgSlug: string,
  itemId: string,
  tenderId: string,
  assigneeId: string | null,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_checklist_items')
    .update({ assignee_id: assigneeId })
    .eq('organization_id', ctx.org.id)
    .eq('id', itemId)
  if (error) return fail(error)
  revalidatePath(`/${orgSlug}/tenders/${tenderId}`)
  return { success: true }
}

export async function attachItemDocument(
  orgSlug: string,
  itemId: string,
  tenderId: string,
  documentId: string | null,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_checklist_items')
    .update({
      document_id: documentId,
      ...(documentId ? { status: 'a_verifier' } : {}),
    })
    .eq('organization_id', ctx.org.id)
    .eq('id', itemId)
  if (error) return fail(error)

  if (documentId) {
    // Lier le document au tender pour le retrouver dans l'onglet Documents
    await ctx.supabase.from('document_links').upsert(
      {
        organization_id: ctx.org.id,
        document_id: documentId,
        entity_type: 'tender',
        entity_id: tenderId,
      },
      { onConflict: 'document_id,entity_type,entity_id' },
    )
  }
  await runChecks(ctx.supabase, tenderId)
  revalidatePath(`/${orgSlug}/tenders/${tenderId}`)
  return { success: true }
}

export async function deleteChecklistItem(
  orgSlug: string,
  itemId: string,
  tenderId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_checklist_items')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', itemId)
  if (error) return fail(error)
  await runChecks(ctx.supabase, tenderId)
  revalidatePath(`/${orgSlug}/tenders/${tenderId}`)
  return { success: true }
}

// ============================ CONTRÔLES ============================

async function runChecks(supabase: SupabaseClient, tenderId: string) {
  await supabase.rpc('run_compliance_checks', { p_tender_id: tenderId })
}

export async function runComplianceChecks(
  orgSlug: string,
  tenderId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase.rpc('run_compliance_checks', { p_tender_id: tenderId })
  if (error) return fail(error)
  revalidatePath(`/${orgSlug}/tenders/${tenderId}`)
  return { success: true }
}

export async function resolveAlert(
  orgSlug: string,
  alertId: string,
  tenderId: string,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('tender_alerts')
    .update({ resolved_at: new Date().toISOString(), resolved_by: ctx.user.id })
    .eq('organization_id', ctx.org.id)
    .eq('id', alertId)
  if (error) return fail(error)
  revalidatePath(`/${orgSlug}/tenders/${tenderId}`)
  return { success: true }
}

// ============================ DÉPÔT & RÉSULTAT ============================

export async function submitTender(
  orgSlug: string,
  tenderId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = submissionSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  // Barrière métier : jamais de dépôt si checklist incomplète
  const { data: readiness } = await ctx.supabase.rpc('tender_readiness', {
    p_tender_id: tenderId,
  })
  const r = Array.isArray(readiness) ? readiness[0] : readiness
  if (r && !r.ready) {
    return { error: 'Dépôt impossible : des pièces obligatoires sont incomplètes.' }
  }

  const { data: last } = await ctx.supabase
    .from('tender_submissions')
    .select('version')
    .eq('organization_id', ctx.org.id)
    .eq('tender_id', tenderId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await ctx.supabase.from('tender_submissions').insert({
    organization_id: ctx.org.id,
    tender_id: tenderId,
    version: (last?.version ?? 0) + 1,
    platform: d.platform || null,
    submission_ref: d.submissionRef || null,
    notes: d.notes || null,
    validated_by: ctx.user.id,
    validated_at: new Date().toISOString(),
    created_by: ctx.user.id,
  })
  if (error) return fail(error)

  await ctx.supabase
    .from('tenders')
    .update({ status: 'depose' })
    .eq('organization_id', ctx.org.id)
    .eq('id', tenderId)

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'tender.submitted',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { platform: d.platform, ref: d.submissionRef },
  })
  revalidatePath(`/${orgSlug}/tenders/${tenderId}`)
  revalidatePath(`/${orgSlug}/tenders`)
  return { success: true }
}

export async function recordTenderResult(
  orgSlug: string,
  tenderId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = tenderResultSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { error } = await ctx.supabase.from('tender_results').upsert(
    {
      tender_id: tenderId,
      organization_id: ctx.org.id,
      outcome: d.outcome,
      awarded_amount_cents: toCents(d.awardedAmountEuros),
      awarded_to: d.awardedTo || null,
      decided_at: d.decidedAt || null,
      loss_reason: d.lossReason || null,
      created_by: ctx.user.id,
    },
    { onConflict: 'tender_id' },
  )
  if (error) return fail(error)

  const status =
    d.outcome === 'gagne' ? 'gagne' : d.outcome === 'perdu' ? 'perdu' : d.outcome === 'annule' ? 'annule' : 'depose'
  await ctx.supabase
    .from('tenders')
    .update({ status })
    .eq('organization_id', ctx.org.id)
    .eq('id', tenderId)

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'tender.result_recorded',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { outcome: d.outcome },
  })
  revalidatePath(`/${orgSlug}/tenders/${tenderId}`)
  revalidatePath(`/${orgSlug}/tenders`)
  return { success: true }
}
