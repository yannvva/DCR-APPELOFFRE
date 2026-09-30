import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

vi.mock('server-only', () => ({}))

import {
  discoverPdfsOnSite,
  resolveManufacturerDomains,
  tokensOf,
} from '@/lib/datasheets/site-discovery'
import { EMPTY_CHAPTER_RESULT } from '@/lib/datasheets/types'
import type { ChapterResult } from '@/lib/datasheets/types'

config({ path: '.env.local' })

const RUN_ID = 'b804bbb5-4d79-4fbb-813c-1dca27fed44c'
const LIMIT = Number(process.env.DISCOVERY_LIMIT ?? 10)

describe('découverte PDF par crawl fabricant — run Laval', () => {
  it(
    'trouve des PDF sans moteur de recherche',
    async () => {
      const s = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
      const { data: run } = await s
        .from('tender_datasheet_runs')
        .select('*')
        .eq('id', RUN_ID)
        .single()
      expect(run).toBeTruthy()

      const result: Record<string, ChapterResult> = {}
      for (const [code, res] of Object.entries(
        run!.result as Record<string, ChapterResult>,
      )) {
        result[code] = { ...EMPTY_CHAPTER_RESULT, ...res }
      }
      const missing = Object.values(result)
        .flatMap((r) => r.documents)
        .filter((d) => !d.url && d.marque && d.marque !== '—')
        .slice(0, LIMIT)
      console.log(`\nDocuments sans URL testés : ${missing.length}`)

      let ok = 0
      for (const doc of missing) {
        const domains = await resolveManufacturerDomains(
          doc.marque,
          doc.designation,
          doc.reference === '—' ? '' : doc.reference,
        )
        const tokens = tokensOf(doc.marque, doc.designation)
        let pdfs: string[] = []
        for (const domain of domains) {
          pdfs = await discoverPdfsOnSite(domain, tokens)
          if (pdfs.length) break
        }
        if (pdfs.length) ok++
        console.log(
          `${pdfs.length ? 'OK ' : '-- '} ${doc.marque} | ${doc.designation.slice(0, 45)} ` +
            `| domaines: ${domains.length} | pdf: ${pdfs.length}` +
            (pdfs[0] ? `\n     ${pdfs[0].slice(0, 110)}` : ''),
        )
      }
      console.log(`\nRésultat : ${ok}/${missing.length} documents avec PDF trouvé`)
      expect(missing.length).toBeGreaterThan(0)
    },
    600_000,
  )
})
