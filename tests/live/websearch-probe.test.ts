import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { webSearch } from '@/lib/ai/web-tools'

describe('sonde webSearch', () => {
  it('retourne des résultats sur des requêtes DCR réalistes', async () => {
    for (const q of [
      'HERAS M300 clôture mobile fiche technique pdf',
      'Résine sol époxy fiche technique pdf fabricant',
      'géotextile anti-contaminant fiche technique pdf',
    ]) {
      const r = await webSearch(q)
      console.log(`\n=== ${q}\n${r.slice(0, 600)}`)
      expect(r.length).toBeGreaterThan(0)
    }
  }, 120_000)
})
