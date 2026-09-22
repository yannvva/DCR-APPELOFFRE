import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getEnv } from '@/env'

/**
 * Client service-role : bypass RLS. Usage strictement limité aux opérations
 * privilégiées (invitations, tâches système). Jamais importé côté client.
 */
export function createAdminClient() {
  const env = getEnv()
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante')
  }
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
