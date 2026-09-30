import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

vi.mock('server-only', () => ({}))

import { searchMissingDocUrls } from '@/lib/datasheets/research'

config({ path: '.env.local' })

const RUN_ID = 'b804bbb5-4d79-4fbb-813c-1dca27fed44c'

describe('debug recherche ciblée', () => {
  it('log la réponse brute de l’agent sur un petit lot', async () => {
    const s = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: run } = await s
      .from('tender_datasheet_runs')
      .select('*')
      .eq('id', RUN_ID)
      .single()
    const codes = Object.keys(run.result)
    console.log('chapitres:', codes)
    for (const code of codes) {
      const docs = (run.result[code].documents ?? []).filter(
        (d: { url?: string }) => !d.url,
      )
      if (!docs.length) continue
      const batch = docs.slice(0, 3)
      console.log(`\n=== ${code} — ${docs.length} sans URL, test sur ${batch.length}`)
      const r = await searchMissingDocUrls({
        operation: (run.config.operation ?? []).join(' — '),
        lotLabel: run.lot_label,
        code,
        chapter: run.chapters[code],
        docs: batch.map((d: { designation: string; marque: string; reference: string; type_document: string }) => ({
          designation: d.designation,
          marque: d.marque,
          reference: d.reference,
          type_document: d.type_document,
        })),
      })
      console.log('trouvailles:', JSON.stringify(r.trouvailles, null, 1))
      console.log('usage:', r.usage)
      expect(r).toBeTruthy()
      break
    }
  }, 900_000)
})
