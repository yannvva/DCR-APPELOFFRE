import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  clearSearchCache,
  resetSearchHealth,
  searchHealth,
  webSearch,
} from '@/lib/ai/web-tools'

interface Call {
  url: string
  init: RequestInit
}

let calls: Call[] = []

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    url: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    arrayBuffer: async () =>
      new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer,
  }
}

function installFetch(apiResponder: (call: Call) => unknown) {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const call = { url, init: init ?? {} }
    calls.push(call)
    // Tout ce qui n'est pas l'API échoue : on isole le comportement de l'API.
    const isApi = /serper\.dev|tavily\.com|api\.search\.brave\.com|search\.mon-domaine\.fr/.test(url)
    if (!isApi) throw new Error('fetch failed')
    return apiResponder(call)
  })
}

beforeEach(() => {
  calls = []
  clearSearchCache()
  resetSearchHealth()
  delete process.env.SEARCH_API_URL
  delete process.env.SEARCH_API_KEY
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.SEARCH_API_URL
  delete process.env.SEARCH_API_KEY
})

describe('SEARCH_API_URL — fournisseurs', () => {
  it('Serper : POST avec corps JSON et en-tête X-API-KEY', async () => {
    process.env.SEARCH_API_URL = 'https://google.serper.dev/search'
    process.env.SEARCH_API_KEY = 'cle-serper'
    installFetch(() =>
      jsonResponse({ organic: [{ link: 'https://fabricant.fr/ft.pdf', title: 'Fiche' }] }),
    )
    const r = await webSearch('HERAS M300 fiche technique')
    expect(r).toContain('https://fabricant.fr/ft.pdf')
    const call = calls[0]
    expect(call.init.method).toBe('POST')
    const headers = call.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('cle-serper')
    expect(String(call.init.body)).toContain('HERAS M300 fiche technique')
  })

  it('Brave : GET avec count et en-tête X-Subscription-Token', async () => {
    process.env.SEARCH_API_URL = 'https://api.search.brave.com/res/v1/web/search'
    process.env.SEARCH_API_KEY = 'cle-brave'
    installFetch(() =>
      jsonResponse({ web: { results: [{ url: 'https://a.fr/x.pdf', title: 'A' }] } }),
    )
    const r = await webSearch('PRB enduit fiche technique')
    expect(r).toContain('https://a.fr/x.pdf')
    expect(calls[0].url).toContain('count=10')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['x-subscription-token']).toBe('cle-brave')
    expect(calls[0].init.method).toBeUndefined()
  })

  it('SearxNG : gabarit {query} respecté', async () => {
    process.env.SEARCH_API_URL =
      'https://search.mon-domaine.fr/search?q={query}&format=json'
    installFetch(() => jsonResponse({ results: [{ url: 'https://b.fr/y.pdf', title: 'B' }] }))
    const r = await webSearch('ACO Multidrain 100')
    expect(r).toContain('https://b.fr/y.pdf')
    expect(calls[0].url).toContain('q=ACO%20Multidrain%20100')
    expect(calls[0].url).toContain('format=json')
  })

  it('Tavily : POST avec query dans le corps', async () => {
    process.env.SEARCH_API_URL = 'https://api.tavily.com/search'
    process.env.SEARCH_API_KEY = 'cle-tavily'
    installFetch(() => jsonResponse({ results: [{ url: 'https://c.fr/z.pdf', title: 'C' }] }))
    const r = await webSearch('KP1 longrine')
    expect(r).toContain('https://c.fr/z.pdf')
    expect(calls[0].init.method).toBe('POST')
    expect(String(calls[0].init.body)).toContain('"query":"KP1 longrine"')
  })

  it('clé invalide : l’erreur est remontée, pas masquée', async () => {
    process.env.SEARCH_API_URL = 'https://google.serper.dev/search'
    process.env.SEARCH_API_KEY = 'mauvaise-cle'
    installFetch(() => jsonResponse({ message: 'Unauthorized' }, false, 401))
    const r = await webSearch('SIKA Sikaflex 11 FC')
    expect(r).toContain('Aucun résultat')
    expect(r).toContain('HTTP 401')
    expect(searchHealth().apiError).toContain('401')
  })

  it('met en cache les requêtes identiques (économie de quota)', async () => {
    process.env.SEARCH_API_URL = 'https://google.serper.dev/search'
    process.env.SEARCH_API_KEY = 'k'
    installFetch(() => jsonResponse({ organic: [{ link: 'https://d.fr/w.pdf', title: 'D' }] }))
    await webSearch('ACO Hexaline')
    await webSearch('ACO Hexaline')
    expect(calls.filter((c) => c.url.includes('serper'))).toHaveLength(1)
  })

  it('sans API configurée, aucun appel API n’est tenté', async () => {
    installFetch(() => jsonResponse({}))
    await webSearch('Knauf fibrastyrène')
    expect(calls.some((c) => /serper|tavily|brave\.com\/res/.test(c.url))).toBe(false)
  })
})
