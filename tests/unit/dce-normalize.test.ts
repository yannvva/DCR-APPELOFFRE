import { describe, expect, it } from 'vitest'
import { normalizeAnalysis, plausiblePublishedAt } from '@/lib/dce/normalize'

describe('normalizeAnalysis', () => {
  it('traite les placeholders « non précisé » comme absents', () => {
    const a = normalizeAnalysis({
      lots: [
        { number: 1, title: 'Gros œuvre', duree: 'non précisé', variantes: 'N/A' },
        { number: 2, title: 'Charpente', duree: '4 mois', variantes: 'interdites' },
      ],
    })
    expect(a.lots[0].duree).toBeUndefined()
    expect(a.lots[0].variantes).toBeUndefined()
    expect(a.lots[1].duree).toBe('4 mois')
    expect(a.lots[1].variantes).toBe('interdites')
  })

  it('conserve la chaîne brute pour les dates non parsables (affichage)', () => {
    const a = normalizeAnalysis({ deadlines: { response_deadline: 'fin octobre' } })
    expect(a.deadlines.response_deadline).toBe('fin octobre')
  })

  it('normalise une analyse complète minimale', () => {
    const a = normalizeAnalysis({
      summary: 'Test',
      identification: { buyer: 'Commune X', estimated_amount_euros: '120 000 €' },
      required_documents: [
        { label: 'DC1', requirement: 'obligatoire', requires_signature: true },
        { label: '' }, // rejeté — sans label
      ],
    })
    expect(a.identification.estimated_amount_euros).toBe(120000)
    expect(a.required_documents).toHaveLength(1)
    expect(a.required_documents[0].requires_signature).toBe(true)
  })
})

describe('plausiblePublishedAt', () => {
  const DAY = 24 * 3600 * 1000
  const rel = (days: number) => new Date(Date.now() + days * DAY).toISOString()
  const deadline = rel(30)

  it('accepte une publication cohérente avec la remise des offres', () => {
    const pub = rel(-60)
    expect(plausiblePublishedAt(pub, deadline)).toBe(pub.slice(0, 10))
  })

  it('écarte une date aberrante bien antérieure au marché (cas « 2020 »)', () => {
    expect(plausiblePublishedAt('2020-01-07', deadline)).toBeUndefined()
    expect(plausiblePublishedAt('2020', deadline)).toBeUndefined()
  })

  it('écarte une date future et une valeur non parsable', () => {
    expect(plausiblePublishedAt(rel(120), deadline)).toBeUndefined()
    expect(plausiblePublishedAt('non précisé', deadline)).toBeUndefined()
    expect(plausiblePublishedAt(undefined, deadline)).toBeUndefined()
  })

  it('sans remise des offres, garde une date passée récente et refuse le futur', () => {
    const recent = rel(-10)
    expect(plausiblePublishedAt(recent)).toBe(recent.slice(0, 10))
    expect(plausiblePublishedAt('2020-01-07')).toBeUndefined()
    expect(plausiblePublishedAt(rel(10))).toBeUndefined()
  })
})
