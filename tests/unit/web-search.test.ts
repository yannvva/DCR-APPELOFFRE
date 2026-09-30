import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  clearSearchCache,
  extractUsefulLinks,
  resetSearchHealth,
  webSearch,
} from '@/lib/ai/web-tools'

const BRAVE_HTML = `
<div class="snippet" data-pos="1" data-type="web">
  <a href="https://www.heras-mobile.fr/clotures/m300" class="svelte-1 l1">heras-mobile.fr</a>
  <div class="title search-snippet-title line-clamp-1">Heras Clôture Mobile M300</div>
</div>
<div class="snippet" data-pos="2" data-type="web">
  <a href="https://heras.blob.core.windows.net/innovadis/Leaflet_C5107000_fr-FR.pdf" class="svelte-1 l1">blob</a>
  <div class="title search-snippet-title line-clamp-1">Clôture Mobile M300 Spécifications</div>
</div>`

const SEARX_HTML = `
<article class="result result-default category-general">
  <a href="https://www.heras-mobile.be/fr/m300" class="url_header" rel="noreferrer"></a>
  <h3><a href="https://www.heras-mobile.be/fr/m300" rel="noreferrer">Heras Clôture Mobile M300</a></h3>
</article>
<article class="result result-default category-general">
  <h3><a href="https://www.pointp.fr/p/cloture-mobile-m300">Clôture mobile M300 Point.P</a></h3>
</article>`

/** Page leurre Bing (résultats sans aucun rapport avec la requête). */
const BING_JUNK_HTML = `
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9jaGF0Z3B0">ChatGPT</a></h2></li>`

const BING_OK_HTML = `
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&u=a1aHR0cHM6Ly93d3cuaGVyYXMtbW9iaWxlLmZyL20zMDA=">Heras M300</a></h2></li>`

function htmlResponse(html: string, ok = true) {
  return {
    ok,
    status: ok ? 200 : 429,
    url: '',
    headers: new Headers({ 'content-type': 'text/html' }),
    arrayBuffer: async () => new TextEncoder().encode(html).buffer as ArrayBuffer,
    text: async () => html,
  }
}

function mockEngines(map: Record<string, () => unknown>) {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input)
    for (const [needle, respond] of Object.entries(map)) {
      if (url.includes(needle)) return respond()
    }
    throw new Error('fetch failed')
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  // Le cache de requêtes est partagé par processus : sans purge, un cas de test
  // hériterait du résultat du précédent (même requête).
  clearSearchCache()
  resetSearchHealth()
  delete process.env.SEARCH_API_URL
  delete process.env.SEARCH_API_KEY
})

describe('webSearch — cascade multi-moteurs', () => {
  it('utilise Brave quand DuckDuckGo est injoignable', async () => {
    mockEngines({
      'duckduckgo': () => {
        throw new Error('fetch failed')
      },
      'search.brave.com': () => htmlResponse(BRAVE_HTML),
    })
    const r = await webSearch('HERAS M300 clôture mobile')
    expect(r).toContain('heras.blob.core.windows.net')
    expect(r).toContain('Heras Clôture Mobile M300')
  })

  it('bascule sur SearXNG quand DuckDuckGo et Brave sont limités (429)', async () => {
    mockEngines({
      'duckduckgo': () => {
        throw new Error('fetch failed')
      },
      'search.brave.com': () => htmlResponse('', false),
      'opnxng.com': () => htmlResponse('', false),
      'paulgo.io': () => htmlResponse(SEARX_HTML),
      'searxng.site': () => htmlResponse('', false),
    })
    const r = await webSearch('HERAS M300 clôture mobile')
    expect(r).toContain('heras-mobile.be/fr/m300')
    expect(r).toContain('pointp.fr')
  })

  it('rejette les résultats leurres de Bing (garde-fou de pertinence)', async () => {
    mockEngines({
      'duckduckgo': () => htmlResponse('', false),
      'search.brave.com': () => htmlResponse('', false),
      'opnxng.com': () => htmlResponse('', false),
      'paulgo.io': () => htmlResponse('', false),
      'searxng.site': () => htmlResponse('', false),
      'bing.com': () => htmlResponse(BING_JUNK_HTML),
    })
    const r = await webSearch('HERAS M300 clôture mobile')
    expect(r).toContain('Aucun résultat')
    expect(r).not.toContain('chatgpt')
  })

  it('accepte Bing quand ses résultats sont réellement pertinents', async () => {
    mockEngines({
      'duckduckgo': () => htmlResponse('', false),
      'search.brave.com': () => htmlResponse('', false),
      'opnxng.com': () => htmlResponse('', false),
      'paulgo.io': () => htmlResponse('', false),
      'searxng.site': () => htmlResponse('', false),
      'bing.com': () => htmlResponse(BING_OK_HTML),
    })
    const r = await webSearch('HERAS M300 clôture mobile')
    // L'URL encapsulée par Bing est décodée (base64 → URL réelle).
    expect(r).toContain('heras-mobile.fr/m300')
  })

  it('ne consomme pas le budget quand la requête est vide', async () => {
    mockEngines({})
    expect(await webSearch('   ')).toBe('Requête vide.')
  })
})

describe('extractUsefulLinks', () => {
  it('remonte les PDF et pages de documentation, ignore le bruit', () => {
    const html = `
      <a href="/mentions-legales">Mentions légales</a>
      <a href="/content/dam/FT_weberdur.pdf">Fiche technique Weberdur</a>
      <a href="https://www.prb.fr/fr/catalogues">Catalogues & brochures</a>
      <a href="//cdn.example.com/notice-pose.pdf?v=2">Notice de pose</a>
      <a href="javascript:void(0)">Menu</a>`
    const links = extractUsefulLinks(html, 'https://www.prb.fr/fr/')
    expect(links.join('\n')).toContain('https://www.prb.fr/content/dam/FT_weberdur.pdf')
    expect(links.join('\n')).toContain('[PDF]')
    expect(links.join('\n')).toContain('https://cdn.example.com/notice-pose.pdf?v=2')
    expect(links.join('\n')).toContain('catalogues')
    expect(links.join('\n')).not.toContain('mentions-legales')
  })
})
