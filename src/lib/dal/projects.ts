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
  const { data } = await ctx.supabase
    .from('organization_members')
    .select('user_id, role, profiles(full_name, avatar_url)')
    .eq('organization_id', ctx.org.id)
    .order('joined_at')
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
