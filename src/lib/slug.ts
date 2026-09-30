/**
 * Slugs lisibles pour les URLs d'appels d'offres.
 *
 * Format : `/<org>/tenders/<titre-slugifié>-<uuid>` — l'UUID complet reste en
 * suffixe, donc la résolution reste exacte et les anciens liens « uuid seul »
 * continuent de fonctionner (l'UUID est recherché n'importe où dans le
 * paramètre).
 */

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/, '')
}

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Chemin canonique d'un dossier : slug du titre + UUID complet. */
export function tenderPath(
  orgSlug: string,
  t: { id: string; title: string },
): string {
  const s = slugify(t.title)
  return `/${orgSlug}/tenders/${s ? `${s}-${t.id}` : t.id}`
}

/** Extrait l'UUID contenu dans le paramètre d'URL ([id] reçoit le slug
 *  complet « titre-uuid », un uuid nu, ou un slug pur sans uuid → null). */
export function tenderIdFromParam(param: string): string | null {
  return param.match(UUID_RE)?.[0] ?? null
}
