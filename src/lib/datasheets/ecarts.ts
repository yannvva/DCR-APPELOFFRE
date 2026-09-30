import type { DatasheetEcart, DatasheetToObtain, EcartCriticite } from './types'

/**
 * Regroupement des écarts d'un dossier de fiches techniques.
 *
 * Chaque chapitre est analysé par un agent indépendant : le même écart
 * (références DTU obsolètes, étude de sol manquante, classement ERP
 * contradictoire…) est donc remonté une fois par chapitre et par lot — un
 * dossier réel produit ainsi 90 à 150 constats pour une quinzaine de sujets.
 * On regroupe par thème (motifs métier) puis par similarité de libellé, en
 * conservant toutes les occurrences pour la traçabilité.
 */

export const CRITICITE_ORDER: EcartCriticite[] = ['BLOQUANT', 'MAJEUR', 'MINEUR']

const CRITICITE_RANK: Record<EcartCriticite, number> = {
  BLOQUANT: 0,
  MAJEUR: 1,
  MINEUR: 2,
}

/**
 * Thèmes récurrents d'un DCE. Testés dans l'ordre : les plus spécifiques
 * d'abord, le thème générique « normes » en dernier (il attrape large).
 */
const THEMES: [RegExp, string][] = [
  [/coprec|compactage|essai à la plaque|essai a la plaque|plaque lcpc|p[ée]n[ée]trom|essais? de (portance|densit)/i, 'Essais de compactage / portance (COPREC)'],
  [/amiante|plomb|crep\b|\brat\b|rep[ée]rage/i, 'Diagnostics amiante / plomb'],
  [/g[ée]otechnique|étude de sol|[ée]tude de sol|rapport de sol|portance du sol|sondage|nf p 94-500|\bg[12]\b/i, 'Étude géotechnique manquante'],
  [/sismi|parasism|ds 69|ps 69|eurocode 8|zone de sismic/i, 'Parasismique (DS 69 → Eurocode 8)'],
  [/thermique|re2020|rt2012|th-k|th k 77/i, 'Thermique (Th-K 77 → RE2020)'],
  [/erp|type l\b|classement.*(incendie|cat[ée]gorie)|d[ée]senfumage/i, 'Classement ERP contradictoire'],
  [/planning|calendrier|date de d[ée]but|phasage|jalon|d[ée]lai de d[ée]marrage/i, 'Planning / calendrier incohérent'],
  [/b[ée]ton arm[ée]|note de calcul|linteau|jambage|[ée]taiement|visa.*contr[ôo]leur|bureau de contr[ôo]le/i, 'Étude béton armé et visa du contrôleur'],
  [/architectonique|enduit|ocre|teinte|nuancier|finition esth|aspect.*(blanc|beige)/i, 'Finition esthétique (béton blanc / enduit ocre)'],
  [/d[ée]chets|bsd|bordereau de suivi|tri s[ée]lectif|fili[èe]re|d[ée]chetterie|exutoire/i, 'Gestion et traçabilité des déchets'],
  [/pmr|accessibilit|largeur de passage|0,90/i, 'Accessibilité PMR'],
  [/cl[ôo]ture|heras|panneau de chantier|installation de chantier|base vie/i, 'Installation de chantier'],
  [/pi[èe]ces? (jointes?|du dce|manquantes?)|documents? (non )?fournis|absents? de l.extrait|non fournies/i, 'Pièces du DCE non fournies'],
  [/fiche technique|documentation produit|non disponible en ligne|fabricant.*(introuvable|indisponible)|pdf officiel/i, 'Documentation fabricant introuvable'],
  [/liant|ciment|\bchf\b|\bcpf\b|\bcem \b|\bbpe\b|bars?\b|mpa|nf en 197|nf en 206|agr[ée]ment afnor/i, 'Désignations produits / normes béton obsolètes'],
  [/s[ée]curit[ée]|epi\b|protection collective|[ée]chafaudage|garde-corps|filet/i, 'Sécurité et protections collectives'],
  [/dtu|bael|eurocode|norme|nf [a-z]? ?\d|r[ée]f[ée]rence.*normat|ccba|nv 65|n 84|obsol[èe]te|renvoi.*norme/i, 'Références normatives obsolètes (DTU, BAEL, Eurocodes)'],
]

/** Mots trop fréquents pour discriminer un écart d'un autre. */
const STOP = new Set([
  'pour', 'avec', 'dans', 'sans', 'cette', 'leur', 'sont', 'etre', 'être', 'plus',
  'tous', 'toute', 'toutes', 'lors', 'donc', 'ainsi', 'dont', 'entre', 'chez',
  'faire', 'afin', 'notamment', 'egalement', 'également', 'lorsque', 'aupres',
  'auprès', 'selon', 'cctp', 'dce', 'moe', 'moa', 'lot', 'lots', 'art', 'article',
  'chapitre', 'generalites', 'généralités', 'exigence', 'exigences', 'demande',
  'demander', 'precision', 'précision', 'precise', 'précisé', 'preciser',
  'preciser', 'fourni', 'fournie', 'fournis', 'fournies', 'aucune', 'aucun',
  'partie', 'pieces', 'pièces', 'document', 'documents', 'extrait', 'liste',
  'vers', 'celle', 'celui', 'meme', 'même', 'autre', 'autres', 'doit', 'doivent',
  'peut', 'peuvent', 'etre', 'fait', 'faites', 'rendre', 'avant', 'apres',
  'après', 'contrat', 'contractuel', 'marche', 'marché', 'offre', 'offres',
])

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function tokens(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(' ')
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

/** Thème métier détecté sur l'objet (et le constat en secours). */
export function detectTheme(objet: string, constat = ''): string | null {
  for (const [re, label] of THEMES) {
    if (re.test(objet)) return label
  }
  for (const [re, label] of THEMES) {
    if (re.test(constat)) return label
  }
  return null
}

/** Lots cités dans un code ou un libellé (« Lot 1 », « LOT 02 »). */
export function lotsIn(...parts: string[]): string[] {
  const found = new Set<string>()
  for (const p of parts) {
    for (const m of p.matchAll(/\blot\s*0*(\d{1,2})\b/gi)) {
      found.add(`Lot ${Number(m[1])}`)
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
}

export interface EcartGroup {
  /** Clé stable de regroupement (thème détecté, sinon libellé normalisé). */
  key: string
  /** Libellé du groupe : thème détecté ou objet le plus représentatif. */
  theme: string
  /** Criticité la plus grave du groupe. */
  criticite: EcartCriticite
  /** Toutes les occurrences, la plus complète d'abord. */
  occurrences: DatasheetEcart[]
  /** Codes § / chapitres concernés (dédupliqués). */
  codes: string[]
  /** Lots concernés. */
  lots: string[]
  /** Constat le plus complet du groupe. */
  constat: string
  /** Action la plus complète du groupe. */
  action: string
}

const byCompleteness = (a: DatasheetEcart, b: DatasheetEcart) =>
  b.constat.length + b.action.length - (a.constat.length + a.action.length)

/**
 * Regroupe les écarts : thème métier identique, ou libellés suffisamment
 * proches (similarité de Jaccard ≥ 0,42 sur les mots significatifs).
 */
export function groupEcarts(ecarts: DatasheetEcart[]): EcartGroup[] {
  interface Draft {
    key: string
    theme: string | null
    items: DatasheetEcart[]
    tokens: Set<string>
  }
  const clusters: Draft[] = []

  for (const e of ecarts) {
    const objet = e.objet?.trim() || e.constat.slice(0, 80) || 'Écart'
    const theme = detectTheme(objet, e.constat)
    const t = tokens(`${objet} ${e.constat}`.slice(0, 400))
    const hit = clusters.find((c) => {
      if (theme && c.theme && theme === c.theme) return true
      return jaccard(c.tokens, t) >= 0.42
    })
    if (hit) {
      hit.items.push(e)
      if (!hit.theme && theme) hit.theme = theme
      for (const w of t) hit.tokens.add(w)
    } else {
      clusters.push({
        key: theme ?? norm(objet),
        theme,
        items: [e],
        tokens: t,
      })
    }
  }

  return clusters
    .map<EcartGroup>((c) => {
      const sorted = [...c.items].sort(byCompleteness)
      const best = sorted[0]
      const criticite = c.items.reduce<EcartCriticite>(
        (worst, e) =>
          CRITICITE_RANK[e.criticite] < CRITICITE_RANK[worst] ? e.criticite : worst,
        'MINEUR',
      )
      const codes = [...new Set(c.items.map((e) => e.code).filter(Boolean))]
      return {
        key: c.key,
        theme: c.theme ?? best.objet,
        criticite,
        occurrences: sorted,
        codes,
        lots: lotsIn(...codes, ...c.items.map((e) => e.objet)),
        constat: best.constat,
        action: best.action,
      }
    })
    .sort(
      (a, b) =>
        CRITICITE_RANK[a.criticite] - CRITICITE_RANK[b.criticite] ||
        b.occurrences.length - a.occurrences.length ||
        a.theme.localeCompare(b.theme, 'fr'),
    )
}

export function countByCriticite(groups: EcartGroup[]): Record<EcartCriticite, number> {
  const out: Record<EcartCriticite, number> = { BLOQUANT: 0, MAJEUR: 0, MINEUR: 0 }
  for (const g of groups) out[g.criticite]++
  return out
}

/** Version texte (courrier / Q&R à la MOE) des groupes affichés. */
export function ecartsToText(
  groups: EcartGroup[],
  total: number,
  options?: { title?: string },
): string {
  const head = options?.title ?? 'ÉCARTS ET RÉSERVES'
  const lines = [
    `${head} — ${total} constat(s) regroupé(s) en ${groups.length} thème(s)`,
    '',
  ]
  groups.forEach((g, i) => {
    lines.push(`${i + 1}. [${g.criticite}] ${g.theme} — ${g.occurrences.length} occurrence(s)`)
    if (g.codes.length) lines.push(`   Codes : ${g.codes.join(' · ')}`)
    if (g.lots.length) lines.push(`   Lots : ${g.lots.join(', ')}`)
    if (g.constat) lines.push(`   Constat : ${g.constat}`)
    if (g.action) lines.push(`   Action : ${g.action}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

/* ---------------------------------------------- documents à obtenir */

export interface ToObtainGroup {
  /** Libellé représentatif du groupe (le plus complet). */
  document: string
  /** Thème métier détecté côté MOE (affiché en titre quand présent). */
  theme: string | null
  origine: DatasheetToObtain['origine']
  fabricants: string[]
  raisons: string[]
  /** Chapitres du dépouillement ayant remonté la demande (traçabilité). */
  chaps: string[]
  count: number
}

/** Boilerplate des intitulés « fiche à obtenir » — retiré avant similarité,
 *  sinon tous les documents fabricants se ressemblent sans jamais être
 *  identiques. */
const OBTAIN_STOP = new Set([
  'fiche', 'technique', 'techniques', 'pdf', 'officiel', 'officielle',
  'officiels', 'officielles', 'documentation', 'produit', 'obtenir',
  'document', 'dop', 'avis', 'declaration', 'notice', 'certificat',
  'attestation', 'telecharger', 'documentheque', 'valider', 'validation',
  'confirmer', 'confirmation', 'reel', 'reelle', 'identifie', 'identifiee',
  'confirme', 'confirmee', 'page', 'site', 'lien', 'url', 'ouvert', 'ouverte',
  'verifier', 'verifie', 'verifiee', 'stade', 'recherche', 'quota', 'epuise',
  'epuisee', 'indisponible', 'jointe', 'joint', 'annonce', 'annoncee',
  'annoncees', 'cite', 'citee', 'fournir', 'fournie', 'obtenu', 'obtenue',
  'manquant', 'manquante', 'specifique', 'specifiques', 'applicable',
  'applicables', 'referentiel', 'groupe', 'gamme', 'demande', 'demandee',
  'exacte', 'precise', 'aupres', 'editeur', 'version', 'prescrit',
  'prescrite', 'complement', 'exemple', 'type', 'obtenue', 'normalisee',
  'normalise', 'ouvertes', 'ouverts', 'trouve', 'trouvee', 'trouvees',
])

function obtainTokens(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(' ')
      .filter((w) => w.length >= 3 && !STOP.has(w) && !OBTAIN_STOP.has(w)),
  )
}

/** Famille de fabricant pour le regroupement : premier token signifiant du
 *  champ (« PAREXLANKO (groupe Sika) » → « parexlanko »). */
function fabricantKey(fabricant: string): string {
  return (
    norm(fabricant)
      .split(' ')
      .find((w) => w.length >= 4) ?? ''
  )
}

/**
 * Regroupe les documents à obtenir. Deux granularités distinctes :
 *
 * - `moe` : la même demande (« étude de sol », « essais COPREC »…) revient
 *   une fois par chapitre avec des libellés variables — on fusionne par
 *   thème métier détecté + similarité (Jaccard ≥ 0,22 avec thème commun,
 *   ≥ 0,45 sinon). Les documents réellement différents (plan de géomètre vs
 *   diagnostics) restent séparés : ce sont des demandes distinctes.
 * - `fabricant` : chaque produit est une demande distincte — on ne fusionne
 *   que les réécritures du MÊME document (tokens identiques, ou Jaccard
 *   ≥ 0,55 au sein de la même famille de fabricant). « 151 MORTIER
 *   UNIVERSEL » et « 152 MORTIER FIN » ne fusionnent pas.
 */
export function groupToObtain(items: DatasheetToObtain[]): ToObtainGroup[] {
  interface Draft {
    origine: 'moe' | 'fabricant'
    theme: string | null
    fam: string
    docNorm: string
    /** Tokens par item : la similarité se mesure à chaque membre (liaison
     *  simple) — l'union diluerait le score et bloquerait les variantes. */
    memberTokens: Set<string>[]
    items: DatasheetToObtain[]
  }
  const clusters: Draft[] = []

  for (const it of items) {
    const origine = it.origine === 'fabricant' ? 'fabricant' : 'moe'
    const doc = it.document?.trim() || 'Document non précisé'
    const theme = origine === 'moe' ? detectTheme(doc, it.raison ?? '') : null
    const fam = origine === 'fabricant' ? fabricantKey(it.fabricant ?? '') : ''
    const docNorm = norm(doc)
    const t = obtainTokens(origine === 'moe' ? `${doc} ${it.raison ?? ''}` : doc)

    const hit = clusters.find((c) => {
      if (c.origine !== origine) return false
      if (c.docNorm === docNorm) return true
      const j = Math.max(...c.memberTokens.map((m) => jaccard(m, t)))
      if (origine === 'moe') {
        if (theme && c.theme && theme === c.theme && j >= 0.22) return true
        return j >= 0.45
      }
      return c.fam === fam && j >= 0.55
    })

    if (hit) {
      hit.items.push(it)
      hit.memberTokens.push(t)
      if (!hit.theme && theme) hit.theme = theme
    } else {
      clusters.push({
        origine,
        theme,
        fam,
        docNorm,
        memberTokens: [t],
        items: [it],
      })
    }
  }

  return clusters
    .map<ToObtainGroup>((c) => {
      const docs = c.items.map((i) => i.document?.trim() || 'Document non précisé')
      const document = docs.reduce((a, b) => (b.length > a.length ? b : a))
      const raisons = [...new Set(c.items.map((i) => i.raison).filter(Boolean))]
      const chaps = [...new Set(c.items.map((i) => i.chap).filter(Boolean))] as string[]
      return {
        document,
        theme: c.theme,
        origine: c.origine,
        fabricants: [
          ...new Set(c.items.map((i) => i.fabricant).filter(Boolean)),
        ] as string[],
        raisons: raisons.sort((a, b) => b.length - a.length),
        chaps: chaps.sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })),
        count: c.items.length,
      }
    })
    .sort(
      (a, b) =>
        a.origine.localeCompare(b.origine) ||
        b.count - a.count ||
        a.document.localeCompare(b.document, 'fr'),
    )
}
