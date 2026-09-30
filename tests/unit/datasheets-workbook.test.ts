import { describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'

vi.mock('server-only', () => ({}))

import { buildWorkbook } from '@/lib/datasheets/workbook'
import type { ChapterDef, ChapterResult } from '@/lib/datasheets/types'

const CHAPITRES: Record<string, ChapterDef> = {
  '01a': {
    onglet: '01a Installations',
    libelle: 'INSTALLATIONS DE CHANTIER',
    exigences: [],
  },
}

function result(): ChapterResult {
  return {
    produits: [
      {
        code: '2.1',
        designation: 'Terrassement courant',
        marque: '—',
        reference: '—',
        statut: 'À VALIDER',
      },
      {
        code: '2.2',
        designation: 'Clôture mobile',
        marque: 'HERAS',
        reference: 'M300',
        statut: 'OK',
      },
    ],
    documents: [
      {
        chap: '01a',
        code: '2.1',
        designation: 'Terrassement courant',
        marque: '—',
        reference: '—',
        type_document: 'Fiche_technique',
        filename: '—',
        url: '',
        source: '',
        statut: 'À VALIDER | non trouvé',
      },
    ],
    conformite: [],
    ecarts: [],
    a_obtenir: [
      {
        origine: 'moe',
        document: 'Plan de phasage',
        fabricant: undefined,
        raison: 'Non fourni dans le DCE',
      },
    ],
  }
}

function sheetsOf(buf: Buffer) {
  const files = unzipSync(new Uint8Array(buf))
  const wb = strFromU8(files['xl/workbook.xml'])
  const names = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map(
    (m) => m[1],
  )
  const shared = files['xl/sharedStrings.xml']
    ? strFromU8(files['xl/sharedStrings.xml'])
    : ''
  return { names, shared }
}

describe('buildWorkbook', () => {
  it('conserve les produits sans marque proposée (feuilles non vides)', async () => {
    const buf = await buildWorkbook({
      operation: ['RESTRUCTURATION ECOLE'],
      variante: '',
      lotLabel: 'LOT 01 - TEST',
      chapitres: CHAPITRES,
      results: { '01a': result() },
      downloaded: new Set(),
    })
    const { names, shared } = sheetsOf(buf)
    expect(names[0]).toBe('01a Installations')
    // Les deux produits doivent figurer, y compris celui sans marque.
    expect(shared).toContain('Terrassement courant')
    expect(shared).toContain('Clôture mobile')
    expect(shared).toContain('HERAS')
  })

  it('colonne « Fiche technique » : nom du PDF + repli marque depuis le document', async () => {
    const res = result()
    // La ligne « produits » reste à « — » mais la fiche porte la marque réelle.
    res.produits[1].marque = '—'
    res.produits[1].reference = '—'
    res.documents.push({
      chap: '01a',
      code: '2.2',
      designation: 'Clôture mobile',
      marque: 'HERAS',
      reference: 'M300',
      type_document: 'Fiche_technique',
      filename: '2.2 HERAS M300.pdf',
      url: 'https://example.com/m300.pdf',
      source: 'fabricant',
      statut: 'OK',
    })
    const buf = await buildWorkbook({
      operation: ['RESTRUCTURATION ECOLE'],
      variante: '',
      lotLabel: 'LOT 01 - TEST',
      chapitres: CHAPITRES,
      results: { '01a': res },
      downloaded: new Set(['2.2 HERAS M300.pdf']),
    })
    const { shared } = sheetsOf(buf)
    expect(shared).toContain('Fiche technique')
    expect(shared).toContain('2.2 HERAS M300.pdf')
    expect(shared).toContain('HERAS')
    expect(shared).toContain('M300')
  })

  it('génère la feuille « Documents a obtenir » avec les manquants', async () => {
    const buf = await buildWorkbook({
      operation: ['RESTRUCTURATION ECOLE'],
      variante: '',
      lotLabel: 'LOT 01 - TEST',
      chapitres: CHAPITRES,
      results: { '01a': result() },
      downloaded: new Set(),
    })
    const { names, shared } = sheetsOf(buf)
    expect(names).toContain('Documents a obtenir')
    expect(shared).toContain('Plan de phasage')
  })
})
