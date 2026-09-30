import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { clearSearchCache, resetSearchHealth, searchHealth, webSearch } from '@/lib/ai/web-tools'

/**
 * Vérifications réseau du provider SEARCH_API_URL (réelles, non hermétiques) :
 * `npm run test:live`. On valide surtout les CHEMINS D'ERREUR — une clé absente
 * ou un SearxNG sans JSON doivent être signalés, pas confondus avec « aucun
 * document trouvé ».
 */
afterEach(() => {
  clearSearchCache()
  resetSearchHealth()
  delete process.env.SEARCH_API_URL
  delete process.env.SEARCH_API_KEY
})

describe('SEARCH_API_URL (live)', () => {
  it('Brave sans clé : 401 remonté explicitement', async () => {
    process.env.SEARCH_API_URL = 'https://api.search.brave.com/res/v1/web/search'
    delete process.env.SEARCH_API_KEY
    const r = await webSearch('HERAS M300 fiche technique')
    console.log('\nBrave sans clé →', r.slice(0, 260))
    expect(searchHealth().apiError).not.toBe('')
  }, 120_000)

  it('SearxNG public sans JSON : échec signalé ou résultats', async () => {
    process.env.SEARCH_API_URL = 'https://searx.be/search?q={query}&format=json'
    const r = await webSearch('PRB enduit façade fiche technique')
    console.log('\nSearxNG public →', r.slice(0, 260))
    const health = searchHealth()
    expect(health.successes > 0 || health.apiError !== '').toBe(true)
  }, 120_000)
})
