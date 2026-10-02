/**
 * Documents produits par les pipelines de génération (fiches techniques,
 * mémoire, DC1/DC2, livrables importés dans un run). Ils sont référencés
 * dans le JSONB des runs (`document_id`, listes de livrables) : une
 * suppression ou une déliaison directe laisserait une ligne « livrée »
 * pointant vers un fichier mort. Utilisable côté client et serveur.
 */
const PIPELINE_PATHS = ['/datasheets/', '/memoire/', '/dc/']

/** Types produits par les pipelines — référencés par les runs (JSONB).
 *  Source unique : `source-docs.ts` (corpus DCE) s'appuie sur cette liste. */
export const PIPELINE_DOC_TYPES = new Set([
  'Classeur_DCR',
  'Arborescence_livraison',
  'Livrable_importe',
  'dc1',
  'dc2',
  'memoire_docx',
  'content_py',
])

/** Préfixes de stockage réservés aux sorties de pipelines. */
export const PIPELINE_PATH_PREFIXES = PIPELINE_PATHS

export function isPipelineManagedDoc(d: {
  storage_path: string
  document_type?: string | null
}): boolean {
  return (
    PIPELINE_PATH_PREFIXES.some((p) => d.storage_path.includes(p)) ||
    PIPELINE_DOC_TYPES.has(d.document_type ?? '')
  )
}
