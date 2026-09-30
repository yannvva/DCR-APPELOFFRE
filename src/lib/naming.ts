/**
 * Politique de nommage : tout nom produit (dossier, classeur, ZIP, fiche,
 * mémoire, DC) reste court et lisible.
 *
 * Les titres d'appels d'offres et de lots sont des phrases entières
 * (« Aménagement de 3 terrains synthétiques de football à Laval, … »,
 * « LOT 01 - DÉMOLITIONS, TERRASSEMENTS, FONDATIONS, … ») : repris tels quels
 * ils donnaient des chemins de 238 caractères, illisibles dans un
 * explorateur et proches de la limite Windows de 260.
 *
 * Règle : on garde ce qui identifie (référence, numéro de lot, premiers
 * termes signifiants), on retire les mots de liaison et on tronque aux
 * frontières de mots — jamais au milieu.
 */

export const LIMITS = {
  /** Libellé d'affaire (dossier d'AO). */
  title: 40,
  /** Libellé de lot « LOT 01 - Démolitions, terrassements +6 ». */
  lot: 40,
  /** Désignation produit dans un nom de fiche technique. */
  product: 45,
  /** Marque dans un nom de fiche technique. */
  brand: 22,
  /** Référence produit dans un nom de fiche technique. */
  reference: 26,
  /** Base du nom de fichier mémoire. */
  memoire: 34,
} as const

/** Mots de liaison sans valeur d'identification. */
const FILLER = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'a', 'au', 'aux', 'et',
  'en', 'sur', 'pour', 'dans', 'un', 'une', 'par', 'avec', 'ou', 'the', 'of',
])

/** Tronque à une frontière de mot, avec points de suspension si nécessaire. */
export function shortText(s: string, max: number): string {
  const clean = (s ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const at = cut.lastIndexOf(' ')
  const head = (at > max * 0.45 ? cut.slice(0, at) : cut).replace(
    /[\s,;:.–—-]+$/,
    '',
  )
  return head ? `${head}…` : `${clean.slice(0, max - 1)}…`
}

/**
 * Retire les mots de liaison puis tronque — « Travaux de rénovation de la
 * maison des associations » → « Travaux rénovation maison associations ».
 */
export function condense(s: string, max: number): string {
  const words = (s ?? '').replace(/\s+/g, ' ').trim().split(' ')
  const kept = words.filter(
    (w, i) => i === 0 || !FILLER.has(w.toLowerCase().replace(/[’']/g, "'")),
  )
  return shortText(kept.join(' '), max)
}

/** Libellé d'affaire court : « AO 20-2026 — Aménagement 3 terrains… ». */
export function shortAffaire(
  title: string | null | undefined,
  reference?: string | null,
  max = LIMITS.title,
): string {
  const ref = reference?.trim()
  const prefix = ref ? `AO ${ref} — ` : 'AO — '
  const label = condense(title?.trim() || 'Sans titre', max)
  return `${prefix}${label}`
}

/** « LOT 01 - DÉMOLITIONS, TERRASSEMENTS, … » → { number: 1, title: 'DÉMOLITIONS, …' }. */
export function parseLotLabel(label: string): {
  number: number | null
  title: string
} {
  const m = label.trim().match(/^lot\s*0*(\d{1,3})\s*[-–—:.]?\s*(.*)$/i)
  if (!m) return { number: null, title: label.trim() }
  return { number: Number(m[1]), title: m[2].trim() }
}

/**
 * Libellé de lot court. Un intitulé de lot est souvent une liste de corps
 * d'état : on garde les premiers et on résume le reste en « +N » —
 * « LOT 01 - DÉMOLITIONS, TERRASSEMENTS +6 » plutôt que 153 caractères.
 */
export function shortLotLabel(
  number: number | null,
  title: string,
  max = LIMITS.lot,
): string {
  const prefix = number != null ? `LOT ${String(number).padStart(2, '0')} - ` : ''
  const budget = Math.max(12, max - prefix.length)
  const segs = title
    .split(/\s*[,;/]\s*|\s+[–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (segs.length >= 3) {
    const kept: string[] = []
    for (const s of segs) {
      // Réserve 4 caractères pour le suffixe « +N ».
      if ([...kept, s].join(', ').length <= budget - 4) kept.push(s)
      else break
    }
    if (kept.length) {
      const rest = segs.length - kept.length
      return `${prefix}${kept.join(', ')}${rest > 0 ? ` +${rest}` : ''}`
    }
  }
  return `${prefix}${condense(title, budget)}`
}

/** Libellé de lot court directement depuis le libellé stocké en base. */
export function shortenLotLabel(label: string): string {
  const { number, title } = parseLotLabel(label)
  return shortLotLabel(number, title)
}

/** Nom de produit : coupe à la première précision (« — », « ( », virgule).
 *  « Cloture Mobile M300 — cloture de chantier type HERAS (panneau …) »
 *  → « Cloture Mobile M300 ». */
export function productName(designation: string, max = LIMITS.product): string {
  const head = (designation ?? '')
    .split(/\s+[–—]\s+|\s*\(|\s*,\s|\s*:\s|\s+\|\s+/)[0]
    .replace(/\s+/g, ' ')
    .trim()
  return shortText(head || designation, max)
}

/** Référence produit : coupe aussi aux précisions (« Leaflet C5107000 — … »). */
export function shortReference(reference: string, max = LIMITS.reference): string {
  const head = (reference ?? '')
    .split(/\s+[–—]\s+|\s*\(|\s*:\s/)[0]
    .replace(/\s+/g, ' ')
    .trim()
  return shortText(head || reference, max)
}

/**
 * Numéro d'article CCTP normalisé en points : « Lot 1 Art. 5-5-3 » → « 5.5.3 »,
 * « Ch. II-III Art. 3-3 » → « 3.3 », « 2-13 » → « 2.13 ».
 * C'est la clé de nommage des fiches (« 5.5.3 Cemex CXB Voile.pdf ») — le § du
 * CCTP identifie l'exigence sans le verbiage « Lot 1 Art. ».
 * Retourne null quand le code ne contient pas de numérotation (ex. « Ch. IX »).
 */
export function articleNumber(code: string): string | null {
  const m =
    // Priorité à ce qui suit « Art. » : « Lot 1 Art. 5-5-3 » → 5-5-3, pas « 1 ».
    code.match(/\bart(?:icle)?\s*[.:]?\s*(\d+(?:[\s.-]+\d+)*[a-zA-Z]?)/i) ??
    // Sinon un numéro composé (« 5-5-3 », « 2.1.4c ») n'importe où dans le code.
    code.match(/(\d+(?:[-.]\d+)+[a-zA-Z]?)/)
  if (!m) return null
  const num = m[1]
    .replace(/[\s-]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.|\.$/g, '')
  return num || null
}

/** Nom de fichier mémoire : « LOT01_DEMOLITIONS_TERRASSEMENTS » (≤ 34). */
export function memoireFilenameBase(lotLabel: string, max = LIMITS.memoire): string {
  const { number, title } = parseLotLabel(lotLabel)
  const words = condense(title, 200)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const head = number != null ? `LOT${String(number).padStart(2, '0')}_` : ''
  const room = Math.max(6, max - head.length)
  // Le « _ » de liaison disparaît si le titre est vide (pas de « LOT01_ »).
  const out = `${head}${words.slice(0, room)}`.replace(/_+$/, '')
  return out.toUpperCase() || 'AFFAIRE'
}
