import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Écrit une entrée d'audit via la fonction SECURITY DEFINER `log_audit`.
 * L'échec ne fait jamais échouer l'action métier : on loggue l'erreur.
 */
export async function audit(
  supabase: SupabaseClient,
  params: {
    organizationId: string
    action: string
    entityType?: string
    entityId?: string
    metadata?: Record<string, unknown>
  },
) {
  const { error } = await supabase.rpc('log_audit', {
    p_organization_id: params.organizationId,
    p_action: params.action,
    p_entity_type: params.entityType ?? null,
    p_entity_id: params.entityId ?? null,
    p_metadata: params.metadata ?? {},
  })
  if (error) {
    console.error('[audit] échec écriture', { action: params.action, error: error.message })
  }
}
