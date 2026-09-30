import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  internalLinks,
  pdfLinksIn,
  tokensOf,
} from '@/lib/datasheets/site-discovery'

describe('tokensOf', () => {
  it('garde les jetons significatifs et écarte les mots génériques', () => {
    const tokens = tokensOf('HERAS', 'Clôture mobile M300', 'fiche technique pdf')
    expect(tokens).toContain('heras')
    expect(tokens).toContain('cloture')
    expect(tokens).toContain('m300')
    expect(tokens).not.toContain('fiche')
    expect(tokens).not.toContain('technique')
    expect(tokens).not.toContain('pdf')
  })

  it('déduplique et ignore les jetons trop courts', () => {
    expect(tokensOf('HERAS heras', 'M3')).toEqual(['heras'])
  })
})

describe('pdfLinksIn', () => {
  it('extrait les PDF absolus (href, data-src) résolus sur la base', () => {
    const html = `
      <a href="/docs/fiche-m300.pdf">Fiche</a>
      <a data-src="https://cdn.fabricant.fr/notice.pdf">Notice</a>
      <a href="/page.html">Page</a>`
    const pdfs = pdfLinksIn(html, 'https://www.fabricant.fr/produit')
    expect(pdfs).toEqual([
      'https://www.fabricant.fr/docs/fiche-m300.pdf',
      'https://cdn.fabricant.fr/notice.pdf',
    ])
  })

  it('ignore les schémas dangereux et les faux PDF', () => {
    const html = `
      <a href="javascript:open('x.pdf')">JS</a>
      <a href="file:///etc/passwd.pdf">local</a>
      <a href="/doc.pdf">ok</a>`
    const pdfs = pdfLinksIn(html, 'https://fabricant.fr/')
    expect(pdfs).toEqual(['https://fabricant.fr/doc.pdf'])
  })
})

describe('internalLinks', () => {
  it('priorise les pages du site contenant les jetons du produit', () => {
    const html = `
      <a href="/produits/cloture-mobile-m300">Clôture mobile M300</a>
      <a href="/a-propos">À propos</a>
      <a href="/catalogue">Catalogue</a>
      <a href="https://autre-site.fr/m300">Partenaire</a>`
    const links = internalLinks(html, 'https://fabricant.fr/', ['m300'])
    expect(links[0]).toBe('https://fabricant.fr/produits/cloture-mobile-m300')
    expect(links).not.toContain('https://fabricant.fr/a-propos')
    expect(links.some((l) => l.includes('autre-site.fr'))).toBe(false)
  })

  it('retient les pages « fiche technique » même sans jeton', () => {
    const links = internalLinks(
      '<a href="/documentation">Documentation technique</a>',
      'https://fabricant.fr/',
      ['zzz'],
    )
    expect(links).toEqual(['https://fabricant.fr/documentation'])
  })

  it('écarte les fichiers non HTML', () => {
    const links = internalLinks(
      '<a href="/fiche.pdf">Fiche technique PDF</a>',
      'https://fabricant.fr/',
      ['fiche'],
    )
    expect(links).toEqual([])
  })
})
