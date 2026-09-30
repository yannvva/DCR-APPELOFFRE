import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { parseApiResults } from '@/lib/ai/web-tools'

describe('parseApiResults — API de recherche', () => {
  it('lit le format SearxNG (results[])', () => {
    const hits = parseApiResults({
      results: [
        { url: 'https://fabricant.fr/fiche.pdf', title: 'Fiche technique' },
        { url: 'https://fabricant.fr/notice.pdf', title: 'Notice' },
      ],
    })
    expect(hits.map((h) => h.url)).toEqual([
      'https://fabricant.fr/fiche.pdf',
      'https://fabricant.fr/notice.pdf',
    ])
    expect(hits[0].title).toBe('Fiche technique')
  })

  it('lit le format Brave Search API (web.results[])', () => {
    const hits = parseApiResults({
      web: { results: [{ url: 'https://a.fr/x.pdf', title: 'A' }] },
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].url).toBe('https://a.fr/x.pdf')
  })

  it('lit le format Serper (organic[] avec link)', () => {
    const hits = parseApiResults({
      organic: [{ link: 'https://b.fr/y.pdf', title: 'B' }],
    })
    expect(hits[0].url).toBe('https://b.fr/y.pdf')
  })

  it('ignore les entrées sans URL http et déduplique', () => {
    const hits = parseApiResults({
      results: [
        { url: 'javascript:void(0)', title: 'pub' },
        { url: 'https://c.fr/z.pdf', title: 'C' },
        { url: 'https://c.fr/z.pdf', title: 'doublon' },
        { title: 'sans url' },
      ],
    })
    expect(hits.map((h) => h.url)).toEqual(['https://c.fr/z.pdf'])
  })

  it('retourne une liste vide sur une charge inattendue', () => {
    expect(parseApiResults(null)).toEqual([])
    expect(parseApiResults({ error: 'quota' })).toEqual([])
  })
})
