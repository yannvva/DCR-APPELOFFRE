import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { unzipSync } from 'fflate'

/** Sonde d'intégrité des ZIP générés : télécharge les objets storage des
 *  livrables « Arborescence_livraison » et vérifie la signature PK + que
 *  l'archive se décompresse (npm run test:live). */
config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const live = url && key ? describe : describe.skip

live('ZIP livrables — intégrité du stockage', () => {
  const supabase = createClient(url!, key!, { auth: { persistSession: false } })

  it('les ZIP stockés s’ouvrent et contiennent des entrées', async () => {
    const { data: docs, error } = await supabase
      .from('documents')
      .select('id, name, storage_path, mime_type, size_bytes, created_at')
      .eq('document_type', 'Arborescence_livraison')
      .order('created_at', { ascending: false })
      .limit(3)
    if (error) throw error
    console.log(`\n${docs.length} ZIP trouvés`)
    expect(docs.length).toBeGreaterThan(0)

    for (const d of docs) {
      const { data: blob, error: dlErr } = await supabase.storage
        .from('documents')
        .download(d.storage_path)
      if (dlErr || !blob) {
        console.log(`✗ ${d.name} — download KO: ${dlErr?.message}`)
        continue
      }
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const magic = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
      const unz = unzipSync(bytes)
      const names = Object.keys(unz)
      const longest = names.reduce((a, b) => (b.length > a.length ? b : a), '')
      const over260 = names.filter((n) => n.length > 260)
      const over200 = names.filter((n) => n.length > 200)
      console.log(
        `${magic ? '✓' : '✗'} ${d.name.slice(0, 60)}…\n` +
          `    size=${bytes.length} entries=${names.length} | ` +
          `plus long=${longest.length} | >260c=${over260.length} | >200c=${over200.length}`,
      )
      for (const n of over260.slice(0, 5)) {
        console.log(`    [${n.length}c] ${n}`)
      }
      expect(magic, `${d.name} — signature PK absente`).toBe(true)
      expect(names.length).toBeGreaterThan(0)
    }
  }, 60000)
})
