import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  ensureProductDocRows,
  isProductFiche,
  matchesExigenceCode,
  normalizeChapterResult,
} from '@/lib/datasheets/research'
import { EMPTY_CHAPTER_RESULT } from '@/lib/datasheets/types'
import type { ChapterResult } from '@/lib/datasheets/types'

describe('isProductFiche — périmètre du workflow fiches techniques', () => {
  it('accepte la fiche d’un produit rattachée à une exigence du CCTP', () => {
    expect(
      isProductFiche({
        code: 'Lot 1 Art. 2-7',
        designation: 'Clôture mobile M300',
        marque: 'HERAS',
        reference: 'M300',
      }),
    ).toBe(true)
  })

  it('accepte une référence seule (marque inconnue)', () => {
    expect(
      isProductFiche({
        code: '2.2.1.2a',
        designation: 'Film polyéthylène 200 µm',
        marque: '—',
        reference: 'POLYANE 200',
      }),
    ).toBe(true)
  })

  it('rejette un document sans exigence CCTP', () => {
    expect(
      isProductFiche({
        code: '',
        designation: 'Démolitions et déposes — procédés',
        marque: '—',
        reference: '—',
      }),
    ).toBe(false)
  })

  it('rejette un document générique sans produit (DTU, guide, mode opératoire)', () => {
    expect(
      isProductFiche({
        code: 'Lot 1 Art. 5-4',
        designation: 'DTU 13.3 — Dallages',
        marque: '—',
        reference: '—',
      }),
    ).toBe(false)
  })

  it('rejette une norme même avec un § CCTP et un organisme en « marque »', () => {
    expect(
      isProductFiche({
        code: 'Lot 1 Art. 5-4',
        designation: 'DTU 13.3 — Dallages : conception, mise en œuvre',
        marque: 'CSTB',
        reference: 'DTU 13.3',
      }),
    ).toBe(false)
  })
})

describe('matchesExigenceCode — traçabilité du § CCTP', () => {
  const codes = ['Lot 1 Art. 2-7', 'Lot 1 Ch. II-I Art. 1-3', '2.2.1.2a']

  it('accepte le code exact et ses variantes de ponctuation', () => {
    expect(matchesExigenceCode('Lot 1 Art. 2-7', codes)).toBe(true)
    expect(matchesExigenceCode('lot 1 art 2 7', codes)).toBe(true)
    expect(matchesExigenceCode('2.2.1.2a', codes)).toBe(true)
  })

  it('accepte un code partiel contenu dans une exigence', () => {
    expect(matchesExigenceCode('Art. 1-3', codes)).toBe(true)
  })

  it('rejette un § CCTP absent du dépouillement', () => {
    expect(matchesExigenceCode('Art. 9-99', codes)).toBe(false)
    expect(matchesExigenceCode('', codes)).toBe(false)
  })
})

describe('normalizeChapterResult — filtrage des documents hors périmètre', () => {
  const raw = {
    produits: [],
    documents: [
      {
        chap: '01a',
        code: 'Lot 1 Art. 2-7',
        designation: 'Clôture mobile M300',
        marque: 'HERAS',
        reference: 'M300',
        type_document: 'Fiche_technique',
        url: 'https://fabricant.fr/m300.pdf',
      },
      {
        chap: '01a',
        code: 'Lot 1 Art. 2-7',
        designation: 'Installation de chantier — base vie',
        marque: '—',
        reference: '—',
        type_document: 'Documentation_technique',
        url: 'https://exemple.fr/base-vie.pdf',
      },
      {
        chap: '01a',
        code: '',
        designation: 'Méthodologie de démolition',
        marque: '—',
        reference: '—',
        type_document: 'Guide',
        url: 'https://exemple.fr/demolition.pdf',
      },
    ],
    conformite: [],
    ecarts: [],
    a_obtenir: [],
  }

  it('ne conserve que les fiches produit liées au CCTP', () => {
    const out = normalizeChapterResult(raw, '01a')
    expect(out.documents).toHaveLength(1)
    expect(out.documents[0].marque).toBe('HERAS')
    expect(out.documents[0].filename).toBe('2.7 HERAS M300.pdf')
  })

  it('écarte un document dont le § CCTP n’existe pas dans le dépouillement', () => {
    const out = normalizeChapterResult(
      {
        documents: [
          {
            chap: '01a',
            code: 'Art. 9-99 — exigence inventée',
            designation: 'Clôture mobile inventée',
            marque: 'HERAS',
            reference: 'M999',
            type_document: 'Fiche_technique',
            url: 'https://x.fr/f.pdf',
          },
        ],
      },
      '01a',
      [{ code: 'Lot 1 Art. 2-7', texte: 'clôture de chantier', marques_imposees: ['HERAS'] }],
    )
    expect(out.documents).toHaveLength(0)
  })

  it('conserve un document dont le § CCTP correspond à une exigence', () => {
    const out = normalizeChapterResult(
      {
        documents: [
          {
            chap: '01a',
            code: 'Lot 1 Art. 2-7',
            designation: 'Clôture mobile M300',
            marque: 'HERAS',
            reference: 'M300',
            type_document: 'Fiche_technique',
            url: 'https://x.fr/f.pdf',
          },
        ],
      },
      '01a',
      [{ code: 'Lot 1 Art. 2-7', texte: 'clôture de chantier', marques_imposees: ['HERAS'] }],
    )
    expect(out.documents).toHaveLength(1)
  })

  it('conserve la traçabilité : la conformité et les écarts ne sont pas filtrés', () => {
    const out = normalizeChapterResult(
      {
        ...raw,
        conformite: [
          {
            chap: '01a',
            code: 'Lot 1 Art. 2-7',
            exigence: 'clôture conforme NF EN 13374',
            donnee_fabricant: 'classe A',
            conforme: 'Oui',
            commentaire: '',
          },
        ],
      },
      '01a',
    )
    expect(out.conformite).toHaveLength(1)
  })
})

describe('ensureProductDocRows — complétion « 1 produit = 1 fiche »', () => {
  const produit = {
    code: 'Lot 1 Art. 5-8',
    designation: 'Ciment multi-usages pour béton et mortier',
    marque: 'Lafarge',
    reference: 'Le Classic ECOPlanet',
    statut: 'À VALIDER' as const,
  }

  it('crée une ligne fiche pour un produit proposé sans document', () => {
    const res: ChapterResult = {
      ...EMPTY_CHAPTER_RESULT,
      produits: [produit],
      documents: [],
      a_obtenir: [],
    }
    const added = ensureProductDocRows(res, '01e')
    expect(added).toBe(1)
    expect(res.documents[0]).toMatchObject({
      chap: '01e',
      code: 'Lot 1 Art. 5-8',
      marque: 'Lafarge',
      reference: 'Le Classic ECOPlanet',
      type_document: 'Fiche_technique',
      url: '',
      filename: '—',
    })
    expect(res.documents[0].statut).toContain('non trouvée')
    expect(res.a_obtenir).toHaveLength(1)
    expect(res.a_obtenir[0]).toMatchObject({ origine: 'fabricant', fabricant: 'Lafarge' })
  })

  it('ne duplique pas un produit déjà couvert par une fiche', () => {
    const res = {
      ...EMPTY_CHAPTER_RESULT,
      produits: [produit],
      documents: [
        {
          chap: '01e',
          code: 'Lot 1 Art. 5-8',
          designation: 'Ciment multi-usages pour béton et mortier',
          marque: 'Lafarge',
          reference: 'Le Classic ECOPlanet',
          type_document: 'Fiche_technique' as const,
          filename: '5.8 Lafarge Le Classic ECOPlanet.pdf',
          url: 'https://x.fr/f.pdf',
          source: '',
          statut: 'À VALIDER',
        },
      ],
      a_obtenir: [],
    }
    expect(ensureProductDocRows(res, '01e')).toBe(0)
    expect(res.documents).toHaveLength(1)
    expect(res.a_obtenir).toHaveLength(0)
  })

  it('ignore les produits non conformes, normatifs et hors périmètre', () => {
    const res = {
      ...EMPTY_CHAPTER_RESULT,
      produits: [
        { ...produit, statut: 'NON CONFORME' as const },
        {
          code: 'Lot 1 Art. 5-4',
          designation: 'DTU 13.3 — Dallages',
          marque: '—',
          reference: 'DTU 13.3',
          statut: 'À VALIDER' as const,
        },
        {
          code: '',
          designation: 'Sous-titre sans § CCTP',
          marque: 'HERAS',
          reference: 'M300',
          statut: 'À VALIDER' as const,
        },
        {
          code: 'Art. 9-99',
          designation: 'Produit hors exigences du chapitre',
          marque: 'SIKA',
          reference: 'X-1',
          statut: 'À VALIDER' as const,
        },
      ],
      documents: [],
      a_obtenir: [],
    }
    const added = ensureProductDocRows(res, '01e', ['Lot 1 Art. 5-8', 'Lot 1 Art. 5-4'])
    expect(added).toBe(0)
    expect(res.documents).toHaveLength(0)
  })

  it('accepte un code qui cite le chapitre sans découpage en articles', () => {
    const res: ChapterResult = {
      ...EMPTY_CHAPTER_RESULT,
      produits: [
        {
          code: 'Lot 1 Ch. 01i — Canalisations',
          designation: 'Gamme assainissement Nicoll — raccords PVC à joint',
          marque: 'Nicoll',
          reference: 'Gamme assainissement',
          statut: 'À VALIDER' as const,
        },
      ],
      documents: [],
      a_obtenir: [],
    }
    const added = ensureProductDocRows(res, '01i', ['Lot 1 Ch. II-II Art. 2-6', 'Lot 1 Art. 2-4'])
    expect(added).toBe(1)
    expect(res.documents[0].marque).toBe('Nicoll')
  })

  it('déduplique le même produit proposé sous deux exigences', () => {
    const res = {
      ...EMPTY_CHAPTER_RESULT,
      produits: [produit, { ...produit, code: 'Lot 1 Art. 5-9' }],
      documents: [],
      a_obtenir: [],
    }
    ensureProductDocRows(res, '01e')
    expect(res.documents).toHaveLength(1)
  })

  it('la normalisation complète produit les lignes fiches des produits', () => {
    const out = normalizeChapterResult(
      {
        produits: [produit],
        documents: [],
      },
      '01e',
      [{ code: 'Lot 1 Art. 5-8', texte: 'ciment', marques_imposees: [] }],
    )
    expect(out.documents).toHaveLength(1)
    expect(out.documents[0].type_document).toBe('Fiche_technique')
    expect(out.a_obtenir).toHaveLength(1)
  })
})
