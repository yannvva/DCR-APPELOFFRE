import { describe, expect, it, vi } from 'vitest'
import { config } from 'dotenv'

vi.mock('server-only', () => ({}))

import {
  discoverPdfsOnSite,
  resolveManufacturerDomains,
  tokensOf,
} from '@/lib/datasheets/site-discovery'

config({ path: '.env.local' })

const CASES: [string, string, string][] = [
  ['HERAS', 'Clôture Mobile M300', ''],
  ['Layher', 'Échafaudage Allround', ''],
  ['fibrastyrène', 'Coffrage isolant type E', ''],
  ['Soprema', 'Étanchéité bicouche élastomère', ''],
  ['Point.P', 'Gazon synthétique sportif', ''],
  ['Gerflor', 'Sol sportif PVC', ''],
]

describe('sonde crawl fabricants', () => {
  it(
    'mesure le taux de découverte de PDF par site fabricant',
    async () => {
      let ok = 0
      for (const [marque, designation, reference] of CASES) {
        const domains = await resolveManufacturerDomains(marque, designation, reference)
        const tokens = tokensOf(marque, designation)
        let pdfs: string[] = []
        for (const d of domains) {
          pdfs = await discoverPdfsOnSite(d, tokens)
          if (pdfs.length) break
        }
        if (pdfs.length) ok++
        console.log(
          `${pdfs.length ? 'OK ' : '-- '}${marque} | domaines: ${domains.join(', ').slice(0, 70) || '—'}` +
            ` | pdf: ${pdfs.length}` +
            (pdfs[0] ? `\n     ${pdfs[0].slice(0, 110)}` : ''),
        )
      }
      console.log(`\nTaux : ${ok}/${CASES.length}`)
      expect(CASES.length).toBeGreaterThan(0)
    },
    600_000,
  )
})
