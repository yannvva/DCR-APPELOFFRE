// Rebouche datasheet_library.document_id depuis les fiches récupérées :
// le script de récupération a recréé les documents + document_id dans
// run.result, mais la bibliothèque est restée à NULL → « PDF non récupéré ».
// Appariement : library.source_url === run.result[].documents[].url.
// Usage : node scripts/relink-library-docs.mjs [--dry-run]
import { readFileSync } from 'node:fs'

const DRY = process.argv.includes('--dry-run')
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const ORG = '390bf68d-d189-45b4-b340-7a3a5f96ded0'
const HJ = {
  apikey: KEY,
  authorization: `Bearer ${KEY}`,
  'content-type': 'application/json',
  prefer: 'return=minimal',
}
const api = async (path, opts = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: HJ, ...opts })
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status} : ${(await r.text()).slice(0, 200)}`)
  const text = await r.text()
  return text ? JSON.parse(text) : null
}

// URL → document_id depuis tous les runs du tenant.
const runs = await api(`tender_datasheet_runs?organization_id=eq.${ORG}&select=result`)
const urlToDoc = new Map()
for (const r of runs ?? [])
  for (const res of Object.values(r.result ?? {}))
    for (const d of res.documents ?? [])
      if (d.url && d.document_id) urlToDoc.set(d.url, d.document_id)

// Les documents référencés existent-ils vraiment ? (purge → liens morts)
const docIds = [...new Set(urlToDoc.values())]
const docs = docIds.length
  ? await api(`documents?id=in.(${docIds.join(',')})&select=id`)
  : []
const alive = new Set((docs ?? []).map((d) => d.id))

const lib = await api(
  `datasheet_library?organization_id=eq.${ORG}&select=id,brand,reference,document_id,source_url`,
)
let relinked = 0, dead = 0, skipped = 0
for (const e of lib ?? []) {
  // Cas 1 : document_id NULL mais source_url connue → relier.
  if (!e.document_id && e.source_url && urlToDoc.has(e.source_url)) {
    const docId = urlToDoc.get(e.source_url)
    if (!alive.has(docId)) {
      console.log('MORT ', e.brand, (e.reference ?? '').slice(0, 45))
      dead++
      continue
    }
    console.log(`${DRY ? '[dry] ' : ''}LINK  ${e.brand} ${(e.reference ?? '').slice(0, 45)}`)
    if (!DRY)
      await api(`datasheet_library?id=eq.${e.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ document_id: docId }),
      })
    relinked++
    continue
  }
  // Cas 2 : document_id pointe un document supprimé → nettoyer (ou relier).
  if (e.document_id && !alive.has(e.document_id)) {
    const docId = e.source_url ? urlToDoc.get(e.source_url) : null
    const patch = docId && alive.has(docId) ? { document_id: docId } : { document_id: null }
    console.log(`${DRY ? '[dry] ' : ''}FIX   ${e.brand} ${(e.reference ?? '').slice(0, 45)} → ${docId && alive.has(docId) ? 'relié' : 'remis à null'}`)
    if (!DRY)
      await api(`datasheet_library?id=eq.${e.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
    if (docId && alive.has(docId)) relinked++
    else dead++
    continue
  }
  skipped++
}
console.log(`\n${relinked} reliées, ${dead} sans document retrouvé, ${skipped} déjà OK`)
