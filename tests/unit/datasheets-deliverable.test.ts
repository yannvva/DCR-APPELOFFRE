import { describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'

vi.mock('server-only', () => ({}))

import {
  buildDeliveryZip,
  classeurFilename,
  dedupeFilenames,
  lotShortLabel,
  ZIP_MAX_PATH,
} from '@/lib/datasheets/deliverable'
import { docFilename, normalizeChapterResult } from '@/lib/datasheets/research'
import { PDF_NON_TROUVE, isProductDocument } from '@/lib/datasheets/types'
import type { ChapterDef, ChapterResult } from '@/lib/datasheets/types'

const CHAPITRES: Record<string, ChapterDef> = {
  '01a': {
    onglet: '01a Desamiantage EPC',
    libelle: 'INSTALLATIONS ET PROTECTIONS COLLECTIVES',
    exigences: [
      { code: '2.1.4c', texte: 'dépressiomètre', marques_imposees: [] },
    ],
  },
  '01b': {
    onglet: '01b EPI Air respirable',
    libelle: 'EPI ET AIR RESPIRABLE',
    exigences: [{ code: '2.2.1.3a', texte: 'masque', marques_imposees: [] }],
  },
}

function chapterResult(): ChapterResult {
  return {
    produits: [],
    documents: [
      {
        chap: '01a',
        code: '2.1.4c',
        designation: 'Depressiometre',
        marque: 'DECONTA',
        reference: 'aircontrol connect 822',
        type_document: 'Fiche_technique',
        filename: '2.1.4c DECONTA aircontrol connect 822.pdf',
        url: 'https://example.com/fiche.pdf',
        source: 'site fabricant',
        statut: 'OK',
      },
      {
        chap: '01b',
        code: '2.2.1.3a',
        designation: 'Filtre P3',
        marque: 'SUNDSTROM',
        reference: 'SR 510',
        type_document: 'Notice_de_pose',
        filename: '2.2.1.3a SUNDSTROM SR 510 - Notice_de_pose.pdf',
        url: 'https://distrib.example.com/np.pdf',
        source: 'miroir distributeur (Groupe MB)',
        statut: 'OK',
      },
    ],
    conformite: [],
    ecarts: [],
    a_obtenir: [],
  }
}

function zipEntries(zip: Uint8Array) {
  const files = unzipSync(zip)
  return {
    names: Object.keys(files).sort(),
    read: (name: string) => strFromU8(files[name]),
  }
}

describe('docFilename', () => {
  it('produit le nommage court « Article Marque Référence.pdf »', () => {
    expect(
      docFilename({
        chap: '01a',
        code: '2.1.4c',
        designation: 'Depressiometre',
        marque: 'DECONTA',
        reference: 'aircontrol connect 822',
        type_document: 'Fiche_technique',
      }),
    ).toBe('2.1.4c DECONTA aircontrol connect 822.pdf')
    expect(
      docFilename({
        chap: '01f',
        code: 'Lot 1 Art. 5-5-3',
        designation:
          'Beton a proprietes specifiees (BPS) pour parements courants selon DTU 21',
        marque: 'Cemex',
        reference: 'CXB Voile',
        type_document: 'Fiche_technique',
      }),
    ).toBe('5.5.3 Cemex CXB Voile.pdf')
  })

  it('suffixe le type pour les documents autres que la fiche technique', () => {
    expect(
      docFilename({
        chap: '01i',
        code: 'Art. 3-3',
        designation: 'Caniveaux ACO',
        marque: 'ACO',
        reference: 'ACO Multidrain 100',
        type_document: 'DoP',
      }),
    ).toBe('3.3 ACO Multidrain 100 - DoP.pdf')
    // La référence porte déjà la marque : pas de redite « ACO ACO ».
  })

  it('retombe sur la désignation sans référence, sur chap-code sans article', () => {
    expect(
      docFilename({
        chap: '01a',
        code: '',
        designation: 'Film polyéthylène',
        marque: 'CHOVA',
        reference: '—',
        type_document: 'Fiche_technique',
      }),
    ).toBe('01a CHOVA Film polyethylene.pdf')
    expect(
      docFilename({
        chap: '01a',
        code: 'Generalites Ch. IX',
        designation: 'Cloture Mobile M300',
        marque: 'HERAS',
        reference: 'Leaflet C5107000',
        type_document: 'Fiche_technique',
      }),
    ).toBe('01a HERAS Leaflet C5107000.pdf')
  })
})

describe('normalizeChapterResult', () => {
  it('reconstruit le filename DCR même si l’agent en fournit un mauvais', () => {
    const out = normalizeChapterResult(
      {
        documents: [
          {
            chap: '01a',
            code: '2.1.4c',
            designation: 'Depressiometre',
            marque: 'DECONTA',
            reference: 'S3',
            type_document: 'Fiche_technique',
            filename: 'nimporte-quoi.pdf',
            url: 'https://example.com/x.pdf',
            source: 'site fabricant',
            statut: 'OK',
          },
        ],
      },
      '01a',
    )
    expect(out.documents[0].filename).toBe('2.1.4c DECONTA S3.pdf')
  })

  it('dédoublonne les noms de fichiers identiques', () => {
    const d = {
      chap: '01a',
      code: '2.1.4c',
      designation: 'Depressiometre',
      marque: 'DECONTA',
      reference: 'S3',
      type_document: 'Fiche_technique',
      url: 'https://example.com/x.pdf',
      source: 'site fabricant',
      statut: 'OK',
    }
    const out = normalizeChapterResult({ documents: [d, { ...d }] }, '01a')
    expect(out.documents[0].filename).toMatch(/\.pdf$/)
    expect(out.documents[1].filename).toBe(
      out.documents[0].filename.replace(/\.pdf$/, ' (2).pdf'),
    )
  })

  it('force le statut « PDF non trouvé » quand aucune url', () => {
    const out = normalizeChapterResult(
      {
        documents: [
          {
            chap: '01a',
            code: '2.1.4c',
            designation: 'Depressiometre',
            marque: 'DECONTA',
            reference: 'S3',
            type_document: 'Fiche_technique',
            url: '',
            source: '',
            statut: 'OK',
          },
        ],
      },
      '01a',
    )
    expect(out.documents[0].filename).toBe('—')
    expect(out.documents[0].statut).toBe(`À VALIDER | ${PDF_NON_TROUVE}`)
  })
})

describe('classeurFilename / lotShortLabel', () => {
  it('nom court : « ABEILLE CAMUS - Fiche technique - Lot 01 - ECOLE NORD.xlsx »', () => {
    expect(
      classeurFilename(
        'LOT 01 - DESAMIANTAGE DEMOLITION',
        'ECOLE NORD',
        'ABEILLE CAMUS',
      ),
    ).toBe('ABEILLE CAMUS - Fiche technique - Lot 01 - ECOLE NORD.xlsx')
  })

  it('sans nom court : repli sur « Lot NN » (jamais le libellé entier)', () => {
    // Le libellé de lot complet (liste des corps d'état) donnait un nom de
    // 175 caractères : on ne garde que le numéro de lot.
    expect(
      classeurFilename(
        'LOT 01 - DÉMOLITIONS, TERRASSEMENTS, FONDATIONS, MAÇONNERIE',
        'ECOLE NORD',
      ),
    ).toBe('Fiche technique - Lot 01 - ECOLE NORD.xlsx')
  })

  it('lotShortLabel extrait « Lot 01 »', () => {
    expect(lotShortLabel('LOT 01 - DESAMIANTAGE DEMOLITION')).toBe('Lot 01')
    expect(lotShortLabel('Lot 12 - VRD')).toBe('Lot 12')
    expect(lotShortLabel('DESAMIANTAGE')).toBe('DESAMIANTAGE')
  })
})

describe('buildDeliveryZip', () => {
  const input = () => ({
    dossierLot: 'LOT 01 - DESAMIANTAGE DEMOLITION',
    variante: 'ECOLE NORD',
    operation: [
      'RESTRUCTURATION DU GROUPE SCOLAIRE ABEILLE/CAMUS - LE MEE-SUR-SEINE (77)',
      'MOA : Commune du Mee-sur-Seine - MOE : ATELIER ACONCEPT',
    ],
    classeurFilename:
      'ABEILLE CAMUS - Fiche technique - Lot 01 - ECOLE NORD.xlsx',
    classeur: Buffer.from('xlsx'),
    chapitres: CHAPITRES,
    results: { '01a': chapterResult(), '01b': chapterResult() },
    pdfs: new Map<string, Uint8Array>([
      [
        '2.1.4c DECONTA aircontrol connect 822.pdf',
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      ],
      [
        '2.2.1.3a SUNDSTROM SR 510 - Notice_de_pose.pdf',
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      ],
    ]),
  })

  it('produit l’arborescence de référence (dossiers 00→06, racine lot + variante)', () => {
    const { names } = zipEntries(buildDeliveryZip(input()))
    const root = 'LOT 01 - DESAMIANTAGE DEMOLITION - ECOLE NORD/'
    expect(names).toContain(`${root}_ARBORESCENCE.txt`)
    expect(names).toContain(
      `${root}00 - Liste des marques/ABEILLE CAMUS - Fiche technique - Lot 01 - ECOLE NORD.xlsx`,
    )
    expect(names).toContain(
      `${root}01 - Fiches techniques/2.1.4c DECONTA aircontrol connect 822.pdf`,
    )
    expect(names).toContain(
      `${root}02 - Notices de pose/2.2.1.3a SUNDSTROM SR 510 - Notice_de_pose.pdf`,
    )
    expect(names).toContain(
      `${root}06 - A valider ou documents manquants/_DOCUMENTS A OBTENIR.txt`,
    )
    for (const f of [
      '00 - Liste des marques',
      '01 - Fiches techniques',
      '02 - Notices de pose',
      '03 - PV, avis techniques et certifications',
      '04 - FDES et environnement',
      '05 - FDS',
      '06 - A valider ou documents manquants',
    ]) {
      expect(names).toContain(`${root}${f}/_LISEZ-MOI.txt`)
    }
  })

  it('_ARBORESCENCE.txt contient l’en-tête opération et le style « +-- »', () => {
    const { read } = zipEntries(buildDeliveryZip(input()))
    const arbo = read(
      'LOT 01 - DESAMIANTAGE DEMOLITION - ECOLE NORD/_ARBORESCENCE.txt',
    )
    expect(arbo).toContain('LOT 01 - DESAMIANTAGE DEMOLITION - ECOLE NORD')
    expect(arbo).toContain('RESTRUCTURATION DU GROUPE SCOLAIRE ABEILLE/CAMUS')
    expect(arbo).toContain('MOA : Commune du Mee-sur-Seine')
    expect(arbo).toContain('+-- 00 - Liste des marques')
    expect(arbo).toContain('+-- 06 - A valider ou documents manquants')
  })

  it('_LISEZ-MOI du dossier 00 mentionne « propositions » quand aucune marque imposée', () => {
    const { read } = zipEntries(buildDeliveryZip(input()))
    const lm = read(
      'LOT 01 - DESAMIANTAGE DEMOLITION - ECOLE NORD/00 - Liste des marques/_LISEZ-MOI.txt',
    )
    expect(lm).toContain('Le CCTP ne cite AUCUNE marque')
    expect(lm).toContain(
      'Nommage : [Article CCTP] [Marque] [Reference]',
    )
    expect(lm).toContain('01a = Desamiantage EPC')
    expect(lm).toContain('01b = EPI Air respirable')
  })

  it('_LISEZ-MOI signale les sources distributeur en « Nota »', () => {
    const { read } = zipEntries(buildDeliveryZip(input()))
    const lm = read(
      'LOT 01 - DESAMIANTAGE DEMOLITION - ECOLE NORD/02 - Notices de pose/_LISEZ-MOI.txt',
    )
    expect(lm).toContain('Nota :')
    expect(lm).toContain('miroir distributeur')
  })

  it('pas de mention « AUCUNE marque » quand le CCTP impose des marques', () => {
    const inp = input()
    inp.chapitres['01a'].exigences[0].marques_imposees = ['DECONTA']
    const { read } = zipEntries(buildDeliveryZip(inp))
    const lm = read(
      'LOT 01 - DESAMIANTAGE DEMOLITION - ECOLE NORD/00 - Liste des marques/_LISEZ-MOI.txt',
    )
    expect(lm).not.toContain('ne cite AUCUNE marque')
  })

  it('chemins ASCII purs : tirets cadratins et accents convertis', () => {
    const inp = input()
    inp.results['01a'].documents[0].filename =
      '2.1.4c Dépressiomètre — DECONTA aircontrol.pdf'
    inp.pdfs.set(
      '2.1.4c Dépressiomètre — DECONTA aircontrol.pdf',
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    )
    const { names } = zipEntries(buildDeliveryZip(inp))
    for (const n of names) expect(n).toMatch(/^[\x20-\x7e]+$/)
    expect(names).toContain(
      'LOT 01 - DESAMIANTAGE DEMOLITION - ECOLE NORD/01 - Fiches techniques/2.1.4c Depressiometre - DECONTA aircontrol.pdf',
    )
  })

  it('plafonne chaque chemin d’entrée (extraction Windows ≤ MAX_PATH)', () => {
    const inp = input()
    inp.dossierLot =
      'LOT 01 - DEMOLITIONS, TERRASSEMENTS, FONDATIONS, MACONNERIE, DALLAGE, RAVALEMENT, CANALISATIONS, V.R.D. (AMENAGEMENTS DES ABORDS)'
    inp.classeurFilename = `${inp.dossierLot} - Liste des marques et fiches techniques.xlsx`
    const longName =
      '01g-Lot 1 Art. 5-4-1 - Fibres micro-synthetiques polypropylene pour betons et mortiers (limitation de la fissuration par retrait plastique, substitution possible au treillis anti-fissuration PAF) - SIKA - SikaCem Fibres - Fiche_technique.pdf'
    inp.results['01a'].documents[0].filename = longName
    inp.pdfs.set(longName, new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    const { names } = zipEntries(buildDeliveryZip(inp))
    for (const n of names) {
      expect(n.length, n).toBeLessThanOrEqual(ZIP_MAX_PATH)
    }
    // Le fichier tronqué garde son extension.
    expect(names.some((n) => n.endsWith('.pdf'))).toBe(true)
    expect(names.some((n) => n.endsWith('.xlsx'))).toBe(true)
  })
})

describe('dedupeFilenames', () => {
  it('dédoublonne un même nom produit par deux chapitres différents', () => {
    const a = chapterResult()
    const b = chapterResult()
    const results: Record<string, ChapterResult> = { '01a': a, '01b': b }
    dedupeFilenames(results)
    const names = [...a.documents, ...b.documents].map((d) => d.filename)
    expect(new Set(names).size).toBe(names.length)
    // Le premier garde son nom, le second est suffixé « (2) »
    expect(a.documents[0].filename).toBe(b.documents[0].filename.replace(' (2)', ''))
  })

  it('ne renomme jamais un document déjà téléchargé', () => {
    const a = chapterResult()
    const b = chapterResult()
    b.documents[0].downloaded = true
    b.documents[0].document_id = 'doc-1'
    const results: Record<string, ChapterResult> = { '01a': a, '01b': b }
    dedupeFilenames(results)
    expect(b.documents[0].filename).toBe(a.documents[0].filename.replace(' (2)', '') || a.documents[0].filename)
    expect(b.documents[0].filename).toBe(
      '2.1.4c DECONTA aircontrol connect 822.pdf',
    )
    expect(a.documents[0].filename).toContain('(2)')
  })

  it('est idempotent sur un second passage', () => {
    const a = chapterResult()
    const b = chapterResult()
    const results: Record<string, ChapterResult> = { '01a': a, '01b': b }
    dedupeFilenames(results)
    const first = [...a.documents, ...b.documents].map((d) => d.filename)
    dedupeFilenames(results)
    const second = [...a.documents, ...b.documents].map((d) => d.filename)
    expect(second).toEqual(first)
  })
})

describe('isProductDocument', () => {
  it('reconnaît une fiche fabricant (marque ou référence produit)', () => {
    expect(isProductDocument({ marque: 'HERAS', reference: 'M300' })).toBe(true)
    expect(isProductDocument({ marque: '—', reference: 'C5107000' })).toBe(true)
    expect(
      isProductDocument({ marque: 'fibrastyrène', reference: 'type E' }),
    ).toBe(true)
  })

  it('écarte les prescriptions CCTP et références normatives', () => {
    expect(isProductDocument({ marque: '—', reference: '—' })).toBe(false)
    expect(
      isProductDocument({ marque: '—', reference: 'DTU 13.11 (NF P 11-201)' }),
    ).toBe(false)
    expect(
      isProductDocument({ marque: 'CSTB / U.N.M.', reference: 'NF EN 206/CN' }),
    ).toBe(false)
    expect(
      isProductDocument({ marque: '—', reference: 'Eurocode 2 / BAEL 91' }),
    ).toBe(false)
  })
})
