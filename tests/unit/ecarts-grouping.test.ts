import { describe, expect, it } from 'vitest'
import {
  countByCriticite,
  detectTheme,
  ecartsToText,
  groupEcarts,
  groupToObtain,
  lotsIn,
} from '@/lib/datasheets/ecarts'
import type { DatasheetEcart } from '@/lib/datasheets/types'

/** Écarts tels que produits par les agents : le même sujet revient une fois
 *  par chapitre et par lot, avec des libellés différents. */
const ecart = (
  criticite: DatasheetEcart['criticite'],
  code: string,
  objet: string,
  constat = '',
  action = 'Action générique',
): DatasheetEcart => ({ criticite, code, objet, constat, action })

const FIXTURE: DatasheetEcart[] = [
  ecart(
    'MAJEUR',
    'Généralités (renvois normatifs',
    'Références normatives et DTU obsolètes cités au CCTP',
    'Le CCTP renvoie à des textes anciens (DTU 13, 20, 21…).',
  ),
  ecart(
    'MAJEUR',
    'Lot 1 Ch. II-II (généralités)',
    'Références normatives et DTU obsolètes cités par le CCTP',
    'Le CCTP cite des textes anciens : DTU 13, 20, 21, 23, 26, 27.',
  ),
  ecart(
    'MAJEUR',
    'Lot 1 (général)',
    'Renvois à des DTU et règles de calcul anciens',
    'Le CCTP cite DTU 13, 20, 21, BAEL 91, NV 65, DS 69.',
  ),
  ecart(
    'MAJEUR',
    'Lot 1 Art. 5-4',
    'Références NF anciennes potentiellement obsolètes',
    'Normes NF P 01-001 à 01-101, NF P 18-010 à 18-880.',
  ),
  ecart(
    'MAJEUR',
    'Lot 1 Ch. II-II (généralités)',
    'Règles DS 69 (parasismique) obsolètes',
    'Les règles DS 69 (1969) sont obsolètes. Zonage sismique zone 2.',
  ),
  ecart(
    'MINEUR',
    'Lot 1 Ch. II-II (généralités)',
    'Règles Th-K 77 obsolètes',
    'Les règles Th-K 77 (thermique 1977) sont obsolètes.',
  ),
  ecart(
    'BLOQUANT',
    'Lot 1 Ch. II-III Art. 3-2 / 3-',
    'Absence d’étude géotechnique (mission G2 PRO) pour le dimensionnement des fondations',
    'Aucune étude géotechnique (NF P 94-500, mission G2) n’est fournie.',
  ),
  ecart(
    'MAJEUR',
    'Lot 1 Ch. II-II Art. 2-5 / 2-1',
    'Absence de l’étude géotechnique (rapport de sol) dans l’extrait du DCE',
    'Le CCTP renvoie à un rapport/étude de sol non fourni.',
  ),
  ecart(
    'MAJEUR',
    'Lot 1 Ch. II-I Art. 1-3 à 1-11',
    'Diagnostics amiante et plomb avant démolition/dépose',
    'Diagnostic amiante et diagnostic plomb listés mais non fournis.',
  ),
  ecart(
    'MAJEUR',
    'Chapitre XXXIV / Rapport Apave',
    'Incohérence de classement ERP',
    'CCTP TYPE L 3e et 5e catégorie vs rapport Apave 3e catégorie.',
  ),
  ecart(
    'MAJEUR',
    'Chapitre XXXIV / rapport Apave',
    'Classement ERP incohérent (TYPE L, 3e et 5e catégorie vs 3e catégorie type L uniquement)',
    'Contradiction sur le classement réglementaire.',
  ),
  ecart(
    'MINEUR',
    'Chapitre XXVI',
    '« Essais COPREC » sans précision',
    'Référence ambiguë, possible confusion avec des essais de compactage.',
  ),
  ecart(
    'MAJEUR',
    'Lot 1 Art. 5-3',
    'Essais COPREC non précisés',
    'Possiblement des essais à la plaque NF P 94-117-1.',
  ),
  ecart(
    'MINEUR',
    'Planning prévisionnel / PGC /',
    'Incohérence de dates de planning',
    'Planning octobre 2025 à février 2027 vs DCE décembre 2025.',
  ),
  ecart(
    'MAJEUR',
    'Planning / PGC / rapport Apave',
    'Incohérence de dates de planning',
    'Date de début divergente (octobre 2025 vs 23/05/2025).',
  ),
  ecart(
    'MINEUR',
    'Béton architectonique / Plans',
    'Incohérence esthétique ciment blanc vs enduits ocre beige',
    'Le CCTP prescrit un béton architectonique, les plans des enduits ocre.',
  ),
  ecart(
    'MAJEUR',
    'Lot 1 (étude béton armé)',
    'Responsabilité de l’étude de béton armé / visa du contrôleur technique',
    'Qui fournit l’étude BA et qui supporte le visa du contrôleur ?',
  ),
]

describe('detectTheme', () => {
  it('reconnaît les familles récurrentes d’un DCE', () => {
    expect(detectTheme('Références normatives et DTU obsolètes cités au CCTP')).toBe(
      'Références normatives obsolètes (DTU, BAEL, Eurocodes)',
    )
    expect(detectTheme('Règles Th-K 77 obsolètes')).toBe('Thermique (Th-K 77 → RE2020)')
    expect(detectTheme('Règles DS 69 (parasismique) obsolètes')).toBe(
      'Parasismique (DS 69 → Eurocode 8)',
    )
    expect(detectTheme('« Essais COPREC » sans précision')).toContain('COPREC')
    expect(detectTheme('Incohérence de classement ERP')).toBe(
      'Classement ERP contradictoire',
    )
  })

  it('retombe sur le constat quand l’objet ne dit rien', () => {
    expect(detectTheme('Point de vigilance', 'absence d’étude géotechnique G2')).toBe(
      'Étude géotechnique manquante',
    )
    expect(detectTheme('Point divers', 'aucun indice')).toBeNull()
  })
})

describe('lotsIn', () => {
  it('extrait les lots cités', () => {
    expect(lotsIn('Lot 1 Ch. II-II', 'LOT 02 - VRD')).toEqual(['Lot 1', 'Lot 2'])
    expect(lotsIn('Généralités Ch. IX')).toEqual([])
  })
})

describe('groupEcarts', () => {
  const groups = groupEcarts(FIXTURE)

  it('condense les 17 constats en 10 thèmes', () => {
    expect(FIXTURE).toHaveLength(17)
    // normes obsolètes · parasismique · thermique · géotechnique · amiante-plomb
    // · ERP · COPREC · planning · finition · étude BA
    expect([...groups.map((g) => g.theme)].sort((a, b) => a.localeCompare(b, 'fr'))).toEqual(
      [
        'Classement ERP contradictoire',
        'Diagnostics amiante / plomb',
        'Essais de compactage / portance (COPREC)',
        'Finition esthétique (béton blanc / enduit ocre)',
        'Parasismique (DS 69 → Eurocode 8)',
        'Planning / calendrier incohérent',
        'Références normatives obsolètes (DTU, BAEL, Eurocodes)',
        'Thermique (Th-K 77 → RE2020)',
        'Étude béton armé et visa du contrôleur',
        'Étude géotechnique manquante',
      ].sort((a, b) => a.localeCompare(b, 'fr')),
    )
  })

  it('ne perd ni ne duplique aucune occurrence', () => {
    const all = groups.flatMap((g) => g.occurrences)
    expect(all).toHaveLength(FIXTURE.length)
    expect(new Set(all).size).toBe(FIXTURE.length)
  })

  it('regroupe les variantes de « normes obsolètes » malgré des libellés différents', () => {
    const normes = groups.find((g) => g.theme.startsWith('Références normatives'))
    expect(normes).toBeTruthy()
    // Les 4 variantes de libellé + DS 69 + Th-K 77 (même famille)
    expect(normes!.occurrences.length).toBeGreaterThanOrEqual(4)
  })

  it('remonte la criticité la plus grave du groupe', () => {
    const geo = groups.find((g) => g.theme === 'Étude géotechnique manquante')
    expect(geo?.criticite).toBe('BLOQUANT')
    expect(geo?.occurrences).toHaveLength(2)
  })

  it('déduplique les codes et garde le constat le plus complet', () => {
    const erp = groups.find((g) => g.theme === 'Classement ERP contradictoire')
    expect(erp?.occurrences).toHaveLength(2)
    expect(new Set(erp!.codes).size).toBe(erp!.codes.length)
    const longest = Math.max(...erp!.occurrences.map((o) => o.constat.length))
    expect(erp!.constat.length).toBe(longest)
  })

  it('trie par gravité décroissante', () => {
    const rank = { BLOQUANT: 0, MAJEUR: 1, MINEUR: 2 }
    const ranks = groups.map((g) => rank[g.criticite])
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
  })

  it('compte les groupes par criticité', () => {
    const byCrit = countByCriticite(groups)
    expect(byCrit.BLOQUANT + byCrit.MAJEUR + byCrit.MINEUR).toBe(groups.length)
    expect(byCrit.BLOQUANT).toBe(1)
  })

  it('supporte une liste vide', () => {
    expect(groupEcarts([])).toEqual([])
  })
})

describe('ecartsToText', () => {
  const groups = groupEcarts(FIXTURE)
  const text = ecartsToText(groups, FIXTURE.length)

  it('produit une liste numérotée exploitable en Q&R', () => {
    expect(text).toContain(`17 constat(s) regroupé(s) en ${groups.length} thème(s)`)
    expect(text.split('\n').filter((l) => /^\d+\.\s\[/.test(l))).toHaveLength(
      groups.length,
    )
    expect(text).toContain('Action :')
  })

  it('mentionne les occurrences et les codes', () => {
    expect(text).toMatch(/\d+ occurrence\(s\)/)
    expect(text).toContain('Codes :')
  })
})

describe('groupToObtain', () => {
  it('regroupe le même document demandé par plusieurs chapitres', () => {
    const groups = groupToObtain([
      { origine: 'moe', document: 'Étude de sol', raison: 'Dimensionnement fondations' },
      { origine: 'moe', document: 'etude de sol', raison: 'Portance inconnue' },
      { origine: 'moe', document: 'Diagnostic amiante', raison: 'Avant démolition' },
      {
        origine: 'fabricant',
        document: 'Fiche technique HERAS',
        fabricant: 'Heras',
        raison: 'Non disponible en ligne',
      },
    ])
    expect(groups).toHaveLength(3)
    const sol = groups.find((g) => g.document === 'Étude de sol')
    expect(sol?.count).toBe(2)
    expect(sol?.raisons).toHaveLength(2)
    expect(groups[0].origine).toBe('fabricant')
  })

  it('fusionne les variantes de libellé MOE (COPREC, géotechnique…) sans fusionner des demandes distinctes', () => {
    const groups = groupToObtain([
      { origine: 'moe', document: 'Clarification des « essais COPREC » et des normes d’essai applicables', raison: 'Référence non normée', chap: '01a' },
      { origine: 'moe', document: 'Définition précise des « essais COPREC » (nature, fréquence, norme)', raison: 'Référence non précisée', chap: '01c' },
      { origine: 'moe', document: 'Précision sur les « essais COPREC » (Chapitre XXVI)', raison: 'Référence ambiguë', chap: '01g' },
      { origine: 'moe', document: 'Étude géotechnique (G2 AVP/PRO) et rapport de sol', raison: 'Non fournie dans le DCE', chap: '01d' },
      { origine: 'moe', document: 'Rapport de sol / étude géotechnique (G2)', raison: 'Pièce listée mais absente', chap: '01e' },
      { origine: 'moe', document: 'Plan de géomètre / plan topographique', raison: 'Pièce listée mais absente', chap: '01c' },
      { origine: 'moe', document: 'Rapport de repérage amiante (RAT) et plomb (CREP)', raison: 'Avant démolition', chap: '01a' },
      { origine: 'moe', document: 'Diagnostics amiante et plomb', raison: 'Obligatoires avant démolition', chap: '01b' },
    ])
    // COPREC ×3 → 1 · géotechnique ×2 → 1 · géomètre → 1 · amiante/plomb ×2 → 1 = 4 groupes
    expect(groups).toHaveLength(4)
    const coprec = groups.find((g) => g.theme?.includes('COPREC'))
    expect(coprec?.count).toBe(3)
    expect(coprec?.chaps).toEqual(['01a', '01c', '01g'])
    const amiante = groups.find((g) => g.theme === 'Diagnostics amiante / plomb')
    expect(amiante?.count).toBe(2)
    // Le plan de géomètre reste une demande séparée de la géotechnique.
    expect(groups.some((g) => /géomètre/i.test(g.document))).toBe(true)
  })

  it('fusionne les réécritures d’un même document fabricant mais pas deux produits distincts', () => {
    const groups = groupToObtain([
      { origine: 'fabricant', document: 'Fiche technique PDF officielle — 151 MORTIER UNIVERSEL 25KG', fabricant: 'PAREXLANKO (groupe Sika)', raison: 'x' },
      { origine: 'fabricant', document: 'Fiche technique PDF officielle — 152 MORTIER FIN 25KG', fabricant: 'PAREXLANKO (groupe Sika)', raison: 'x' },
      { origine: 'fabricant', document: '151 MORTIER UNIVERSEL 25KG — fiche technique officielle', fabricant: 'Parexlanko', raison: 'x' },
    ])
    expect(groups).toHaveLength(2)
    const m151 = groups.find((g) => g.document.includes('151'))
    expect(m151?.count).toBe(2)
    expect(m151?.fabricants.length).toBe(2)
  })
})
