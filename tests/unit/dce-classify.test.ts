import { describe, expect, it } from 'vitest'
import { classifyDoc } from '@/lib/dce/classify'

describe('classifyDoc — nom de fichier', () => {
  it('reconnaît un RC par son nom', () => {
    expect(classifyDoc('RC_marche_2026.pdf', '')).toBe('rc')
    expect(classifyDoc('reglement_consultation.pdf', '')).toBe('rc')
  })

  it('reconnaît les pièces techniques et administratives', () => {
    expect(classifyDoc('CCTP_travaux.pdf', '')).toBe('cctp')
    expect(classifyDoc('CCAP-signé.pdf', '')).toBe('ccap')
    expect(classifyDoc('acte_engagement.pdf', '')).toBe('ae')
    expect(classifyDoc('BPU.xlsx', '')).toBe('bpu')
    expect(classifyDoc('DPGF-lot2.pdf', '')).toBe('dpgf')
  })

  it('classe les annexes et le reste', () => {
    expect(classifyDoc('annexe_3_plan.pdf', '')).toBe('annexe')
    expect(classifyDoc('document.pdf', '')).toBe('autre')
  })
})

describe('classifyDoc — contenu', () => {
  it('détecte un RC sans indice dans le nom', () => {
    const text =
      "RÈGLEMENT DE LA CONSULTATION. Article 1 : objet. " +
      'Critères d’attribution : prix 60 %. Date limite de remise des offres : 15/10/2026.'
    expect(classifyDoc('piece_1.pdf', text)).toBe('rc')
  })

  it('détecte un CCTP par son titre', () => {
    const text = 'CAHIER DES CLAUSES TECHNIQUES PARTICULIÈRES — Lot 1 : gros œuvre.'
    expect(classifyDoc('doc.pdf', text)).toBe('cctp')
  })

  it("détecte un acte d'engagement", () => {
    expect(classifyDoc('formulaire.pdf', "ACTE D'ENGAGEMENT — Article …")).toBe('ae')
  })
})
