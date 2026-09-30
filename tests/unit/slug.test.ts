import { describe, expect, it } from 'vitest'
import { slugify, tenderIdFromParam, tenderPath } from '@/lib/slug'

describe('slugify', () => {
  it('slugifie un titre français typique', () => {
    expect(
      slugify(
        "Aménagement de 3 terrains synthétiques de football à Laval, L'Huisserie et Saint Berthevin",
      ),
    ).toBe(
      'amenagement-de-3-terrains-synthetiques-de-football-a-laval-l-huisserie-et-saint-berthevin',
    )
  })

  it('retire les diacritiques et la ponctuation', () => {
    expect(slugify('Équipement électrique — rénovation (lot 2)')).toBe(
      'equipement-electrique-renovation-lot-2',
    )
  })

  it('normalise les espaces, apostrophes et séparateurs multiples', () => {
    expect(slugify('  Lycée   Jean—Moulin : bâtiment B  ')).toBe(
      'lycee-jean-moulin-batiment-b',
    )
  })

  it('borne la longueur sans laisser de tiret final', () => {
    const long = `Travaux ${'très '.repeat(30)}longs`
    const s = slugify(long)
    expect(s.length).toBeLessThanOrEqual(120)
    expect(s.endsWith('-')).toBe(false)
  })

  it('retourne une chaîne vide pour un titre sans caractères latin', () => {
    expect(slugify('— — —')).toBe('')
  })
})

const ID = '8ea38978-1a5f-4d3b-9e09-7af97b17e504'

describe('tenderPath', () => {
  it('génère le chemin slug + uuid', () => {
    expect(tenderPath('dcr', { id: ID, title: 'Lycée A' })).toBe(
      `/dcr/tenders/lycee-a-${ID}`,
    )
  })

  it('retombe sur l’uuid seul si le titre ne produit pas de slug', () => {
    expect(tenderPath('dcr', { id: ID, title: '---' })).toBe(
      `/dcr/tenders/${ID}`,
    )
  })
})

describe('tenderIdFromParam', () => {
  it('extrait l’uuid d’un slug complet', () => {
    expect(tenderIdFromParam(`lycee-a-${ID}`)).toBe(ID)
  })

  it('accepte un uuid nu (anciens liens)', () => {
    expect(tenderIdFromParam(ID)).toBe(ID)
  })

  it('retourne null pour un slug pur', () => {
    expect(tenderIdFromParam('amenagement-terrains')).toBeNull()
  })
})
