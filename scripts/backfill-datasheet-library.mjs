// Remplit la bibliothèque produits (datasheet_library) depuis les runs de
// fiches techniques déjà téléchargés — rétrocompatible avec les anciens
// dossiers, sans migration de données.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const ORG = '390bf68d-d189-45b4-b340-7a3a5f96ded0'
const USER = '397df572-9112-4f51-b00c-aa728fcd12e9'

const norm = (s) =>
  (s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
const dedupKey = (brand, ref, type) => `${norm(brand)}|${norm(ref)}|${norm(type)}`

const runs = await (
  await fetch(
    `${URL}/rest/v1/tender_datasheet_runs?organization_id=eq.${ORG}&select=id,result,chapters&limit=100`,
    { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } },
  )
).json()

let n = 0
for (const run of runs ?? []) {
  const chapters = run.chapters ?? {}
  for (const res of Object.values(run.result ?? {})) {
    for (const doc of res.documents ?? []) {
      if (!doc.document_id) continue
      const brand = doc.marque === '—' ? '' : (doc.marque ?? '')
      const reference =
        doc.reference && doc.reference !== '—' ? doc.reference : (doc.designation ?? '')
      const theme =
        chapters[doc.chap]?.libelle ?? chapters[doc.chap]?.onglet ?? null
      const body = {
        organization_id: ORG,
        designation: (doc.designation ?? '').slice(0, 300),
        brand: brand.slice(0, 200),
        reference: reference.slice(0, 200),
        doc_type: doc.type_document,
        theme,
        source_url: doc.url || null,
        statut: (doc.statut ?? 'OK').split('|')[0].trim(),
        document_id: doc.document_id,
        dedup_key: dedupKey(brand, reference, doc.type_document),
        created_by: USER,
      }
      const r = await fetch(
        `${URL}/rest/v1/datasheet_library?on_conflict=organization_id,dedup_key`,
        {
          method: 'POST',
          headers: {
            apikey: KEY,
            authorization: `Bearer ${KEY}`,
            'content-type': 'application/json',
            prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(body),
        },
      )
      if (r.ok) n++
      else console.log('ERR', r.status, await r.text())
    }
  }
}
console.log(`Bibliothèque : ${n} entrées insérées/mises à jour`)
