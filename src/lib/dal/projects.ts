import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveListParams, toPaged } from '@/lib/dal/list'
import type { ListParams, Project, Task, TaskComment } from '@/lib/types'

type Ctx = { supabase: SupabaseClient; org: { id: string } }

export async function listProjects(ctx: Ctx, params: ListParams = {}) {
  const { page, pageSize, from, to } = resolveListParams(params)
  let q = ctx.supabase
    .from('projects')
    .select('*, account:accounts(id, name)', { count: 'exact' })
    .eq('organization_id', ctx.org.id)
    .order('created_at', { ascending: false })
    .range(from, to)
  if (params.q) q = q.ilike('name', `%${params.q}%`)
  if (params.status) q = q.eq('status', params.status)
  const { data, count, error } = await q
  if (error) throw error
  return toPaged((data ?? []) as Project[], count, page, pageSize)
}

export async function getProject(ctx: Ctx, id: string) {
  const { data } = await ctx.supabase
    .from('projects')
    .select('*, account:accounts(id, name)')
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
    .maybeSingle()
  return data as Project | null
}

export async function listProjectTasks(ctx: Ctx, projectId: string) {
  const { data, error } = await ctx.supabase
    .from('tasks')
    .select('*, assignees:task_assignees(user_id, profile:profiles(full_name, avatar_url))')
    .eq('organization_id', ctx.org.id)
    .eq('project_id', projectId)
    .order('position')
  if (error) throw error
  return (data ?? []) as Task[]
}

export interface TodoTask extends Task {
  project?: { id: string; name: string } | null
}

/**
 * Tâches de projet non terminées — alimentent la page « À faire »
 * (échéancier transverse, en plus des pièces de dossier). Triées par
 * échéance ; les tâches sans échéance ferment la marche.
 */
export async function listOpenProjectTasks(ctx: Ctx): Promise<TodoTask[]> {
  const { data, error } = await ctx.supabase
    .from('tasks')
    .select(
      '*, project:projects!project_id(id, name), assignees:task_assignees(user_id, profile:profiles(full_name, avatar_url))',
    )
    .eq('organization_id', ctx.org.id)
    .neq('status', 'done')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(500)
  if (error) throw error
  return ((data ?? []) as unknown as TodoTask[]).map((t) => ({
    ...t,
    project: Array.isArray(t.project) ? t.project[0] : t.project,
  }))
}

export async function getTask(ctx: Ctx, id: string) {
  const { data } = await ctx.supabase
    .from('tasks')
    .select('*, assignees:task_assignees(user_id, profile:profiles(full_name, avatar_url))')
    .eq('organization_id', ctx.org.id)
    .eq('id', id)
    .maybeSingle()
  return data as Task | null
}

export async function listTaskComments(ctx: Ctx, taskId: string) {
  const { data } = await ctx.supabase
    .from('task_comments')
    .select('*, author:profiles!task_comments_author_id_fkey(full_name, avatar_url)')
    .eq('organization_id', ctx.org.id)
    .eq('task_id', taskId)
    .order('created_at')
  return (data ?? []) as TaskComment[]
}

export async function listOrgMembers(ctx: Ctx) {
  // FK explicite : organization_members pointe deux fois vers profiles
  // (user_id et invited_by) — sans indice PostgREST renvoie une erreur
  // d'ambiguïté et la liste ressortait vide en silence.
  const { data, error } = await ctx.supabase
    .from('organization_members')
    .select('user_id, role, profiles!organization_members_user_id_fkey(full_name, avatar_url)')
    .eq('organization_id', ctx.org.id)
    .order('joined_at')
  if (error) throw error
  return (data ?? []).map(
    (m: {
      user_id: string
      role: string
      profiles: { full_name: string | null; avatar_url: string | null } | { full_name: string | null; avatar_url: string | null }[] | null
    }) => ({
      user_id: m.user_id,
      role: m.role,
      profiles: Array.isArray(m.profiles) ? (m.profiles[0] ?? null) : m.profiles,
    }),
  ) as {
    user_id: string
    role: string
    profiles: { full_name: string | null; avatar_url: string | null } | null
  }[]
}
