import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { webSearch } from '@/lib/ai/web-tools'

describe('sonde webSearch multi-moteurs', () => {
  it('trouve des fiches fabricants malgré DuckDuckGo injoignable', async () => {
    for (const q of [
      'HERAS M300 clôture mobile fiche technique pdf',
      'géotextile anti-contaminant fiche technique pdf',
    ]) {
      const t0 = Date.now()
      const r = await webSearch(q)
      console.log(`\n=== ${q} (${Date.now() - t0} ms)\n${r.slice(0, 500)}`)
      expect(r).not.toContain('Aucun résultat')
    }
  }, 120_000)
})
