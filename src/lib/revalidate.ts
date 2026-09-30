import 'server-only'

import { revalidatePath } from 'next/cache'

/**
 * Invalide les pages détail d'appels d'offres de l'org. L'URL canonique est
 * « slug-du-titre-uuid » (l'uuid brut redirige vers elle) — revalider le seul
 * chemin uuid ne toucherait pas l'URL réellement visitée ni les anciens slugs
 * après renommage. Le segment [id] couvre toutes ces variantes.
 */
export function revalidateTenderPages(orgSlug: string) {
  revalidatePath(`/${orgSlug}/tenders/[id]`, 'page')
}
