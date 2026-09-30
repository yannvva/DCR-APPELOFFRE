import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { detectLotNumbers } from '@/lib/dce/extract'
import { normalizeAnalysis } from '@/lib/dce/normalize'

describe('detectLotNumbers — rattachement des pièces aux lots', () => {
  it('détecte le lot depuis le dossier du ZIP', () => {
    expect(detectLotNumbers('LOT 3/DPGF.xlsx')).toEqual([3])
    expect(detectLotNumbers('DCE/LOT 01 - Gros oeuvre/CCTP.pdf')).toEqual([1])
  })

  it('détecte le lot dans le nom de fichier', () => {
    expect(detectLotNumbers('DPGF_lot_2.xlsx')).toEqual([2])
    expect(detectLotNumbers('BPU-LOT4.xlsx')).toEqual([4])
    expect(detectLotNumbers('CCTP_Lot_12.pdf')).toEqual([12])
  })

  it('détecte les plages et listes de lots', () => {
    expect(detectLotNumbers('CCTP lots 1 et 3.pdf')).toEqual([1, 3])
    expect(detectLotNumbers('DPGF lot 1-3.pdf')).toEqual([1, 3])
  })

  it('ignore les faux positifs', () => {
    expect(detectLotNumbers('pilotage_chantier.pdf')).toEqual([])
    expect(detectLotNumbers('ilot_2.pdf')).toEqual([])
    expect(detectLotNumbers('planning.pdf')).toEqual([])
    expect(detectLotNumbers('RC.pdf')).toEqual([])
  })
})

describe('normalizeAnalysis — champs par lot', () => {
  it('normalise lot sur les pièces exigées et duree/variantes sur les lots', () => {
    const a = normalizeAnalysis({
      lots: [
        { number: 1, title: 'Gros œuvre', amount_euros: 150000, duree: '10 mois', variantes: 'interdites' },
        { number: '2', title: 'CVC' },
      ],
      required_documents: [
        { label: 'DPGF chiffrée', requirement: 'obligatoire', lot: 2 },
        { label: 'DC1', requirement: 'obligatoire', lot: 'abc' },
      ],
    })
    expect(a.lots[0].duree).toBe('10 mois')
    expect(a.lots[0].variantes).toBe('interdites')
    expect(a.lots[1].number).toBe(2)
    expect(a.required_documents[0].lot).toBe(2)
    expect(a.required_documents[1].lot).toBeUndefined()
  })
})
