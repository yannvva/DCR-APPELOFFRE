/**
 * Rangement des documents : normalisation de chemin et arborescence.
 *
 * Convention unique (aucun slash initial, aucun slash final) :
 *   Société
 *   Société/Administratif
 *   AO 20-2026 — Laval/DCE/02 - CCTP
 *   AO 20-2026 — Laval/Fiches techniques/LOT 01 - …
 *   AO 20-2026 — Laval/DC1-DC2
 *   AO 20-2026 — Laval/Mémoire technique
 *
 * Deux racines seulement : « Société » (kit candidature, commun à tous les
 * marchés) et un dossier par appel d'offres. Aucun document ne doit vivre
 * directement à la racine — d'où `ROOT_FOLDERS` et le blocage côté UI.
 */

export const SOCIETE_FOLDER = 'Société'

/** Racines autorisées — tout le reste est un dossier d'appel d'offres. */
export const ROOT_FOLDERS = [SOCIETE_FOLDER] as const

/** Chemin de dossier canonique : pas de slash initial/final, séparateurs uniques. */
export function normalizeFolderPath(path: string | null | undefined): string {
  const clean = (path ?? '')
    .replace(/\\/g, '/')
    // Segments relatifs retirés AVANT de recoller les séparateurs.
    .replace(/(^|\/)\.\.?(?=\/|$)/g, '$1')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim()
  return clean || '/'
}

/** Un chemin est-il à la racine (ou vide) ? */
export function isRootFolder(path: string): boolean {
  return normalizeFolderPath(path) === '/'
}

/** Segments d'un chemin normalisé. */
export function folderSegments(path: string): string[] {
  const n = normalizeFolderPath(path)
  return n === '/' ? [] : n.split('/')
}

/** Libellé court (dernier segment) d'un chemin. */
export function folderLabel(path: string): string {
  const segs = folderSegments(path)
  return segs.length ? segs[segs.length - 1] : 'Racine'
}

/** Dossier parent d'un chemin (ou null si racine). */
export function parentFolder(path: string): string | null {
  const segs = folderSegments(path)
  if (!segs.length) return null
  return segs.length === 1 ? '/' : segs.slice(0, -1).join('/')
}

export interface FolderNode {
  /** Libellé court affiché dans l'arborescence. */
  name: string
  /** Chemin complet (valeur de `folder_path`). */
  path: string
  /** Documents rangés directement dans ce dossier. */
  count: number
  /** Documents du dossier et de tous ses sous-dossiers. */
  total: number
  children: FolderNode[]
}

interface Draft {
  name: string
  path: string
  count: number
  children: Map<string, Draft>
}

/** Ordre d'affichage : Société d'abord, puis les AO, puis le reste. */
function rank(node: FolderNode): number {
  if (node.name === SOCIETE_FOLDER) return 0
  return 1
}

function toNode(d: Draft): FolderNode {
  const children = [...d.children.values()]
    .map(toNode)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr'))
  const total = d.count + children.reduce((n, c) => n + c.total, 0)
  return { name: d.name, path: d.path, count: d.count, total, children }
}

/**
 * Construit l'arborescence à partir des dossiers existants et de leur nombre
 * de documents. Les dossiers intermédiaires sans document direct existent
 * quand un sous-dossier est peuplé (ex. « AO …/DCE » si seul « DCE/02 - CCTP »
 * contient des pièces).
 */
export function buildFolderTree(
  rows: { path: string; count: number }[],
): FolderNode[] {
  const root: Draft = { name: '', path: '', count: 0, children: new Map() }
  for (const r of rows) {
    const segs = folderSegments(r.path)
    if (!segs.length) {
      root.count += r.count
      continue
    }
    let cur = root
    const acc: string[] = []
    for (const seg of segs) {
      acc.push(seg)
      let next = cur.children.get(seg)
      if (!next) {
        next = { name: seg, path: acc.join('/'), count: 0, children: new Map() }
        cur.children.set(seg, next)
      }
      cur = next
    }
    cur.count += r.count
  }
  return toNode(root).children
}

/** Ancêtres d'un chemin, du plus haut au plus bas (pour déplier l'arbre). */
export function ancestorFolders(path: string): string[] {
  const segs = folderSegments(path)
  return segs.map((_, i) => segs.slice(0, i + 1).join('/'))
}

/** Aplatit l'arborescence en liste (chemins) — recherche et comptage. */
export function flattenFolders(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((n) => [n, ...flattenFolders(n.children)])
}
