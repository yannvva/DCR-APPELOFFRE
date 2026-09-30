'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireMembership } from '@/lib/dal/auth'
import { audit } from '@/lib/audit'
import type { ActionState } from '@/lib/validation/auth'
import type { CompanyProfile } from '@/lib/company'

const s = () => z.string().trim().max(500).optional()
const strList = () => z.array(z.string().trim().max(500)).max(60).optional()

const companyProfileSchema = z.object({
  identite: z
    .object({
      raison_sociale: s(),
      forme_juridique: s(),
      capital_euros: s(),
      siren: s(),
      siret: s(),
      rcs_ville: s(),
      code_ape: s(),
      tva_intracom: s(),
      date_creation: s(),
    })
    .optional(),
  siege: z
    .object({ adresse: s(), telephone: s(), email: s(), site_web: s() })
    .optional(),
  dirigeant: z.object({ nom: s(), qualite: s() }).optional(),
  banque: z
    .object({ titulaire: s(), domiciliation: s(), iban: s(), bic: s() })
    .optional(),
  finance: z
    .object({
      chiffre_affaires: strList(),
      effectif: s(),
      notation_bdf: s(),
      agences_notation: s(),
    })
    .optional(),
  assurances: z.object({ lignes: strList() }).optional(),
  certifications: strList(),
  equipe: strList(),
  implantations: strList(),
  references: strList(),
  presentation: z.string().trim().max(4000).optional(),
})

/** Enregistre le profil société dans organizations.settings.company. */
export async function saveCompanyProfile(
  orgSlug: string,
  profile: CompanyProfile,
): Promise<ActionState> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const { supabase, org } = ctx

  const parsed = companyProfileSchema.safeParse(profile)
  if (!parsed.success) return { error: 'Profil invalide — vérifiez les champs saisis.' }

  const settings = { ...(org.settings ?? {}), company: parsed.data }
  const { error } = await supabase
    .from('organizations')
    .update({ settings, updated_at: new Date().toISOString() })
    .eq('id', org.id)
  if (error) return { error: 'Échec de l’enregistrement du profil.' }

  await audit(supabase, {
    organizationId: org.id,
    action: 'company.profile_updated',
    entityType: 'organization',
    entityId: org.id,
    metadata: {},
  })
  revalidatePath(`/${orgSlug}/societe`)
  return { success: true }
}
