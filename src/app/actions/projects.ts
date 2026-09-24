'use server'

import { revalidatePath } from 'next/cache'
import { requireMembership } from '@/lib/dal/auth'
import { audit } from '@/lib/audit'
import { commentSchema, projectSchema, taskSchema } from '@/lib/validation/domain'
import type { ActionState } from '@/lib/validation/auth'

function fail(): NonNullable<ActionState> {
  return { error: 'Une erreur est survenue.' }
}

// ============================ PROJETS ============================

export async function createProject(orgSlug: string, input: unknown): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = projectSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { data, error } = await ctx.supabase
    .from('projects')
    .insert({
      organization_id: ctx.org.id,
      name: d.name,
      description: d.description || null,
      account_id: d.accountId || null,
      start_date: d.startDate || null,
      due_date: d.dueDate || null,
      created_by: ctx.user.id,
    })
    .select('id, code')
    .single()

  if (error) return fail()

  // Le créateur devient manager du projet
  await ctx.supabase.from('project_members').insert({
    organization_id: ctx.org.id,
    project_id: data.id,
    user_id: ctx.user.id,
    role: 'manager',
  })

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'project.created',
    entityType: 'project',
    entityId: data.id,
    metadata: { name: d.name, code: data.code },
  })
  revalidatePath(`/${orgSlug}/projects`)
  return { success: true }
}

export async function updateProjectStatus(
  orgSlug: string,
  projectId: string,
  status: 'active' | 'on_hold' | 'done' | 'archived',
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('projects')
    .update({ status })
    .eq('organization_id', ctx.org.id)
    .eq('id', projectId)
  if (error) return fail()
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: `project.${status}`,
    entityType: 'project',
    entityId: projectId,
  })
  revalidatePath(`/${orgSlug}/projects`)
  return { success: true }
}

export async function updateProject(
  orgSlug: string,
  projectId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = projectSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { error } = await ctx.supabase
    .from('projects')
    .update({
      name: d.name,
      description: d.description || null,
      account_id: d.accountId || null,
      start_date: d.startDate || null,
      due_date: d.dueDate || null,
    })
    .eq('organization_id', ctx.org.id)
    .eq('id', projectId)
  if (error) return fail()
  revalidatePath(`/${orgSlug}/projects/${projectId}`)
  return { success: true }
}

export async function deleteProject(orgSlug: string, projectId: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'admin')
  if (!ctx) return { error: 'Accès refusé.' }
  const { error } = await ctx.supabase
    .from('projects')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', projectId)
  if (error) return fail()
  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'project.deleted',
    entityType: 'project',
    entityId: projectId,
  })
  revalidatePath(`/${orgSlug}/projects`)
  return { success: true }
}

// Opportunité gagnée → projet (atomique côté séquence : opp vérifiée + projet créé)
export async function convertOpportunityToProject(
  orgSlug: string,
  opportunityId: string,
): Promise<ActionState & { projectId?: string }> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }

  const { data: opp } = await ctx.supabase
    .from('opportunities')
    .select('id, title, account_id, status, won_project_id')
    .eq('organization_id', ctx.org.id)
    .eq('id', opportunityId)
    .single()
  if (!opp) return { error: 'Opportunité introuvable.' }
  if (opp.won_project_id) return { success: true, projectId: opp.won_project_id }
  if (opp.status !== 'won') return { error: 'L’opportunité doit être marquée « gagnée ».' }

  const { data: project, error } = await ctx.supabase
    .from('projects')
    .insert({
      organization_id: ctx.org.id,
      name: opp.title,
      account_id: opp.account_id,
      opportunity_id: opp.id,
      created_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (error) return fail()

  await ctx.supabase.from('project_members').insert({
    organization_id: ctx.org.id,
    project_id: project.id,
    user_id: ctx.user.id,
    role: 'manager',
  })

  const { error: linkErr } = await ctx.supabase
    .from('opportunities')
    .update({ won_project_id: project.id })
    .eq('organization_id', ctx.org.id)
    .eq('id', opp.id)
    .is('won_project_id', null)
  if (linkErr) {
    await ctx.supabase.from('projects').delete().eq('id', project.id)
    return fail()
  }

  // Re-lie les documents de l'opportunité au projet (liens additionnels)
  const { data: docLinks } = await ctx.supabase
    .from('document_links')
    .select('document_id')
    .eq('organization_id', ctx.org.id)
    .eq('entity_type', 'opportunity')
    .eq('entity_id', opp.id)
  for (const l of docLinks ?? []) {
    await ctx.supabase.from('document_links').upsert(
      {
        organization_id: ctx.org.id,
        document_id: l.document_id,
        entity_type: 'project',
        entity_id: project.id,
      },
      { onConflict: 'document_id,entity_type,entity_id' },
    )
  }

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'opportunity.converted_to_project',
    entityType: 'opportunity',
    entityId: opp.id,
    metadata: { project_id: project.id },
  })
  revalidatePath(`/${orgSlug}`)
  return { success: true, projectId: project.id }
}

// ============================ TÂCHES ============================

export async function createTask(
  orgSlug: string,
  projectId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = taskSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  // Position = fin de colonne
  const { data: last } = await ctx.supabase
    .from('tasks')
    .select('position')
    .eq('organization_id', ctx.org.id)
    .eq('project_id', projectId)
    .eq('status', d.status)
    .is('parent_task_id', null)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: task, error } = await ctx.supabase
    .from('tasks')
    .insert({
      organization_id: ctx.org.id,
      project_id: projectId,
      parent_task_id: d.parentTaskId || null,
      title: d.title,
      description: d.description || null,
      status: d.status,
      priority: d.priority,
      due_date: d.dueDate || null,
      position: (last?.position ?? -1) + 1,
      created_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (error) return fail()

  if (d.assigneeIds.length > 0) {
    const { data: members } = await ctx.supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', ctx.org.id)
      .in('user_id', d.assigneeIds)
    const valid = new Set((members ?? []).map((m: { user_id: string }) => m.user_id))
    const rows = d.assigneeIds
      .filter((id) => valid.has(id))
      .map((uid) => ({
        organization_id: ctx.org.id,
        task_id: task.id,
        user_id: uid,
      }))
    if (rows.length) await ctx.supabase.from('task_assignees').insert(rows)
  }

  await ctx.supabase.from('activity_logs').insert({
    organization_id: ctx.org.id,
    actor_id: ctx.user.id,
    entity_type: 'task',
    entity_id: task.id,
    action: 'created',
    metadata: { title: d.title, project_id: projectId },
  })

  revalidatePath(`/${orgSlug}/projects/${projectId}`)
  return { success: true }
}

export async function updateTask(
  orgSlug: string,
  taskId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = taskSchema.partial().safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }
  const d = parsed.data

  const { data: current } = await ctx.supabase
    .from('tasks')
    .select('project_id')
    .eq('organization_id', ctx.org.id)
    .eq('id', taskId)
    .single()
  if (!current) return { error: 'Tâche introuvable.' }

  const patch: Record<string, unknown> = {}
  if (d.title !== undefined) patch.title = d.title
  if (d.description !== undefined) patch.description = d.description || null
  if (d.status !== undefined) patch.status = d.status
  if (d.priority !== undefined) patch.priority = d.priority
  if (d.dueDate !== undefined) patch.due_date = d.dueDate || null

  const { error } = await ctx.supabase
    .from('tasks')
    .update(patch)
    .eq('organization_id', ctx.org.id)
    .eq('id', taskId)
  if (error) return fail()

  if (d.assigneeIds !== undefined) {
    const { data: members } = await ctx.supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', ctx.org.id)
      .in('user_id', d.assigneeIds)
    const valid = new Set((members ?? []).map((m: { user_id: string }) => m.user_id))
    await ctx.supabase
      .from('task_assignees')
      .delete()
      .eq('organization_id', ctx.org.id)
      .eq('task_id', taskId)
    const rows = d.assigneeIds.filter((id) => valid.has(id)).map((uid) => ({
      organization_id: ctx.org.id,
      task_id: taskId,
      user_id: uid,
    }))
    if (rows.length) await ctx.supabase.from('task_assignees').insert(rows)
  }

  await ctx.supabase.from('activity_logs').insert({
    organization_id: ctx.org.id,
    actor_id: ctx.user.id,
    entity_type: 'task',
    entity_id: taskId,
    action: 'updated',
    metadata: patch,
  })

  revalidatePath(`/${orgSlug}/projects/${current.project_id}`)
  return { success: true }
}

export async function moveTask(
  orgSlug: string,
  taskId: string,
  status: string,
  position: number,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const allowed = ['backlog', 'todo', 'in_progress', 'in_review', 'done']
  if (!allowed.includes(status)) return { error: 'Statut invalide.' }

  const { data: task } = await ctx.supabase
    .from('tasks')
    .select('project_id')
    .eq('organization_id', ctx.org.id)
    .eq('id', taskId)
    .single()
  if (!task) return { error: 'Tâche introuvable.' }

  const { error } = await ctx.supabase
    .from('tasks')
    .update({ status, position: Math.round(position) })
    .eq('organization_id', ctx.org.id)
    .eq('id', taskId)
  if (error) return fail()

  revalidatePath(`/${orgSlug}/projects/${task.project_id}`)
  return { success: true }
}

export async function deleteTask(orgSlug: string, taskId: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { data: task } = await ctx.supabase
    .from('tasks')
    .select('project_id')
    .eq('organization_id', ctx.org.id)
    .eq('id', taskId)
    .single()
  if (!task) return { error: 'Tâche introuvable.' }

  const { error } = await ctx.supabase
    .from('tasks')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', taskId)
  if (error) return fail()

  await audit(ctx.supabase, {
    organizationId: ctx.org.id,
    action: 'task.deleted',
    entityType: 'task',
    entityId: taskId,
  })
  revalidatePath(`/${orgSlug}/projects/${task.project_id}`)
  return { success: true }
}

// ============================ COMMENTAIRES ============================

export async function getTaskComments(orgSlug: string, taskId: string) {
  const ctx = await requireMembership(orgSlug)
  if (!ctx) return { error: 'Accès refusé.' as const, comments: [] }
  const { data } = await ctx.supabase
    .from('task_comments')
    .select('*, author:profiles!task_comments_author_id_fkey(full_name, avatar_url)')
    .eq('organization_id', ctx.org.id)
    .eq('task_id', taskId)
    .order('created_at')
  return { comments: data ?? [] }
}

export async function addComment(
  orgSlug: string,
  taskId: string,
  input: unknown,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = commentSchema.safeParse(input)
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors }

  const { data: task } = await ctx.supabase
    .from('tasks')
    .select('project_id')
    .eq('organization_id', ctx.org.id)
    .eq('id', taskId)
    .single()
  if (!task) return { error: 'Tâche introuvable.' }

  const { data, error } = await ctx.supabase
    .from('task_comments')
    .insert({
      organization_id: ctx.org.id,
      task_id: taskId,
      author_id: ctx.user.id,
      body: parsed.data.body,
    })
    .select('id')
    .single()
  if (error) return fail()

  await ctx.supabase.from('activity_logs').insert({
    organization_id: ctx.org.id,
    actor_id: ctx.user.id,
    entity_type: 'task',
    entity_id: taskId,
    action: 'commented',
    metadata: { comment_id: data.id },
  })

  revalidatePath(`/${orgSlug}/projects/${task.project_id}`)
  return { success: true }
}

export async function deleteComment(orgSlug: string, commentId: string): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  // RLS : auteur ou admin+
  const { error } = await ctx.supabase
    .from('task_comments')
    .delete()
    .eq('organization_id', ctx.org.id)
    .eq('id', commentId)
  if (error) return fail()
  revalidatePath(`/${orgSlug}/projects`)
  return { success: true }
}
