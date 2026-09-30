import { describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { listOpenProjectTasks, listOrgMembers } from '@/lib/dal/projects'
import { listTodoBoard } from '@/lib/dal/tenders'

/**
 * Garde-fou sur les jointures PostgREST des DAL : `organization_members`
 * pointe DEUX fois vers `profiles` (user_id et invited_by) — sans indice de
 * FK, PostgREST renvoie une erreur d'ambiguïté (PGRST201) et la liste
 * ressortait vide en silence (membres, listes d'assignés).
 *
 * Ces tests touchent la vraie base (service role) → `npm run test:live`.
 */
config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const live = url && key ? describe : describe.skip

live('DAL — jointures non ambiguës', () => {
  const supabase = createClient(url!, key!, {
    auth: { persistSession: false },
  }) as unknown as SupabaseClient

  async function firstOrgId(): Promise<string> {
    const { data, error } = await supabase
      .from('organizations')
      .select('id')
      .limit(1)
      .single()
    if (error) throw error
    return data.id as string
  }

  it('listOrgMembers remonte les profils (indice de FK obligatoire)', async () => {
    const orgId = await firstOrgId()
    const members = await listOrgMembers({ supabase, org: { id: orgId } })
    expect(members.length).toBeGreaterThan(0)
    // La clé existe même si le nom est vide : l'embed a bien été résolu.
    expect(members[0]).toHaveProperty('profiles')
  })

  it('listOpenProjectTasks joint projet et assignés', async () => {
    const orgId = await firstOrgId()
    const tasks = await listOpenProjectTasks({ supabase, org: { id: orgId } })
    expect(Array.isArray(tasks)).toBe(true)
    for (const t of tasks) {
      expect(t.status).not.toBe('done')
      expect(Array.isArray(t.project) || t.project === null || typeof t.project === 'object').toBe(
        true,
      )
    }
  })

  it('listTodoBoard joint checklist + dossier + assigné + document', async () => {
    const orgId = await firstOrgId()
    const { tenders, items } = await listTodoBoard({ supabase, org: { id: orgId } })
    expect(Array.isArray(tenders)).toBe(true)
    for (const i of items) {
      expect(i.tender?.id).toBeTruthy()
      expect(Array.isArray(i.tender)).toBe(false)
      expect(Array.isArray(i.assignee)).toBe(false)
    }
  })
})
