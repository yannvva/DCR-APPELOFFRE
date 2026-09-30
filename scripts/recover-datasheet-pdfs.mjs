// Récupération après purge accidentelle des fiches PDF :
//   1. Re-télécharge les PDF des documents du run (URL conservées dans result).
//   2. Re-télécharge les fiches orphelines référencées dans datasheet_library
//      (source_url conservée) : HERAS, Layher… — recrée le document, le lie
//      au tender et rebouche document_id en bibliothèque.
// Usage : node scripts/recover-datasheet-pdfs.mjs
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

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
const USER = '397df572-9112-4f51-b00c-aa728fcd12e9'
const TENDER = '8ea38978-1a5f-4d3b-9e09-7af97b17e504'
const FOLDER =
  'AO 20-2026 — Aménagement 3 terrains synthétiques…/Fiches techniques/LOT 01 - DÉMOLITIONS, TERRASSEMENTS +6'
const H = { apikey: KEY, authorization: `Bearer ${KEY}` }
const HJ = { ...H, 'content-type': 'application/json', prefer: 'return=minimal' }

const api = async (path, opts = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: HJ, ...opts })
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status} : ${(await r.text()).slice(0, 200)}`)
  const text = await r.text()
  return text ? JSON.parse(text) : null
}

const storageSafeName = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.()\- ]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200)

async function fetchPdf(url) {
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; NexusDocs/1.0)' },
      signal: AbortSignal.timeout(30_000),
      redirect: 'follow',
    })
    if (!r.ok) return { error: `HTTP ${r.status}` }
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
      return { error: 'pas un PDF' }
    }
    if (bytes.length > 30 * 1024 * 1024) return { error: 'trop volumineux' }
    return { bytes }
  } catch (e) {
    return { error: `réseau : ${String(e).slice(0, 120)}` }
  }
}

async function storePdf({ runId, name, bytes, folder, docType }) {
  const docId = randomUUID()
  const storagePath = `org_${ORG}/datasheets/${runId}/${docId}-${storageSafeName(name)}`
  const up = await fetch(`${SB}/storage/v1/object/documents/${storagePath}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/pdf',
      'x-upsert': 'true',
    },
    body: bytes,
  })
  if (!up.ok) return { error: `upload HTTP ${up.status}` }
  await api('documents', {
    method: 'POST',
    body: JSON.stringify({
      id: docId,
      organization_id: ORG,
      name: name.slice(0, 300),
      folder_path: folder,
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: bytes.byteLength,
      category: 'technique',
      document_type: docType,
      uploaded_by: USER,
    }),
  })
  await api('document_links?on_conflict=document_id,entity_type,entity_id', {
    method: 'POST',
    headers: { ...HJ, prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      organization_id: ORG,
      document_id: docId,
      entity_type: 'tender',
      entity_id: TENDER,
    }),
  })
  return { docId }
}

// ---------- 1. Documents du run ----------
const [run] = await api(
  `tender_datasheet_runs?id=eq.b804bbb5-4d79-4fbb-813c-1dca27fed44c&select=id,result,download_report,lot_label`,
)
const result = run.result ?? {}
const report = run.download_report ?? {}
const usedUrls = new Set()
let ok = 0, ko = 0
for (const res of Object.values(result)) {
  for (const d of res.documents ?? []) {
    if (!d.url || d.downloaded || d.document_id) continue
    const dl = await fetchPdf(d.url)
    if (!dl.bytes) {
      d.download_error = `re-téléchargement : ${dl.error}`
      report[d.filename] = { ok: false, reason: `re-téléchargement : ${dl.error}` }
      ko++
      console.log('KO ', d.filename.slice(0, 60), dl.error)
      continue
    }
    const st = await storePdf({
      runId: run.id,
      name: d.filename,
      bytes: dl.bytes,
      folder: FOLDER,
      docType: d.type_document,
    })
    if (st.error) {
      d.download_error = st.error
      ko++
      console.log('KO ', d.filename.slice(0, 60), st.error)
      continue
    }
    d.downloaded = true
    d.document_id = st.docId
    d.download_error = undefined
    report[d.filename] = {
      ok: true,
      document_id: st.docId,
      size: dl.bytes.byteLength,
      reason: 'Re-téléchargé après purge',
    }
    usedUrls.add(d.url)
    ok++
    console.log('OK ', d.filename.slice(0, 70))
  }
}
await api(`tender_datasheet_runs?id=eq.${run.id}`, {
  method: 'PATCH',
  body: JSON.stringify({
    result,
    download_report: report,
    status: ok > 0 ? 'downloaded' : 'researched',
    updated_at: new Date().toISOString(),
  }),
})

// ---------- 2. Fiches orphelines via la bibliothèque ----------
const lib = await api(
  `datasheet_library?organization_id=eq.${ORG}&document_id=is.null&source_url=not.is.null&select=id,designation,brand,reference,doc_type,source_url,dedup_key,theme,statut`,
)
let orphans = 0
for (const e of lib ?? []) {
  if (!e.source_url || usedUrls.has(e.source_url)) continue
  const dl = await fetchPdf(e.source_url)
  if (!dl.bytes) {
    console.log('KO-orphan', e.brand, e.reference?.slice(0, 40), dl.error)
    continue
  }
  const name = `${[e.brand, e.reference].filter(Boolean).join(' ')}${e.doc_type && e.doc_type !== 'Fiche_technique' ? ` - ${e.doc_type}` : ''}.pdf`
  const st = await storePdf({
    runId: run.id,
    name,
    bytes: dl.bytes,
    folder: FOLDER,
    docType: e.doc_type,
  })
  if (st.error) {
    console.log('KO-orphan', name.slice(0, 60), st.error)
    continue
  }
  await api(`datasheet_library?id=eq.${e.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ document_id: st.docId }),
  })
  orphans++
  console.log('OK-orphan', name.slice(0, 70))
}
console.log(`Récupération : ${ok} fiches du run + ${orphans} orphelines, ${ko} échecs`)
