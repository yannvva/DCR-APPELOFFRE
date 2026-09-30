// Complétion « 1 produit = 1 fiche » sur un run existant :
// pour chaque produit proposé (marque/référence réelle, ≠ NON CONFORME,
// rattaché à une exigence du chapitre) sans ligne « documents », ajoute la
// ligne Fiche_technique à rechercher + l'entrée « à obtenir ».
// Port fidèle de ensureProductDocRows (src/lib/datasheets/research.ts).
// Usage : node scripts/complete-doc-rows.mjs [--dry-run]
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
const RUN = 'b804bbb5-4d79-4fbb-813c-1dca27fed44c'
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

// ---------- Port des règles (types.ts / research.ts) ----------
const NORM_REF =
  /^\s*(dtu|nf\b|nfen|nf en|nf p|en \d|iso|eurocode|ec\d|bael|reef|cstb|unm|u\.n\.m|afnor|setra|cerib|xpg?|xp p|dta|atec|règles? pro)/i
const isProductDocument = (d) => {
  const marque = (d.marque ?? '').trim()
  if (marque && marque !== '—' && !NORM_REF.test(marque)) return true
  const ref = (d.reference ?? '').trim()
  if (!ref || ref === '—') return false
  return !NORM_REF.test(ref)
}
const normCode = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
const matchesExigenceCode = (code, exigenceCodes) => {
  const c = normCode(code)
  if (!c) return false
  return exigenceCodes.some((e) => {
    const n = normCode(e)
    return !!n && (n === c || n.includes(c) || c.includes(n))
  })
}
const PDF_NON_TROUVE =
  'Fiche technique PDF officielle non trouvée à ce stade — validation fournisseur/fabricant nécessaire'

function ensureProductDocRows(res, chap, exigenceCodes) {
  const normKey = (s) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '')
  const refOf = (d) =>
    d.reference?.trim() && d.reference !== '—' ? d.reference : d.designation
  const have = (res.documents ?? []).map((d) => ({
    m: normKey(d.marque || '—'),
    r: normKey(refOf(d)),
  }))
  const covered = (marque, refNorm) =>
    have.some(
      (k) =>
        k.m === normKey(marque || '—') &&
        k.r.length >= 4 &&
        refNorm.length >= 4 &&
        (k.r.includes(refNorm) || refNorm.includes(k.r)),
    )
  const obtainKey = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const obtain = new Set((res.a_obtenir ?? []).map((o) => obtainKey(o.document)))
  let added = 0
  for (const p of res.produits ?? []) {
    if (p.statut === 'NON CONFORME' || !isProductDocument(p)) continue
    const code = (p.code ?? '').trim()
    if (!code || code === '—' || !(p.designation ?? '').trim()) continue
    if (
      exigenceCodes?.length &&
      !matchesExigenceCode(code, exigenceCodes) &&
      !normCode(code).includes(normCode(chap))
    )
      continue
    const refNorm = normKey(refOf(p))
    if (covered(p.marque, refNorm)) continue
    have.push({ m: normKey(p.marque || '—'), r: refNorm })
    res.documents.push({
      chap,
      code,
      designation: p.designation,
      marque: p.marque,
      reference: p.reference,
      type_document: 'Fiche_technique',
      filename: '—',
      url: '',
      source: '',
      statut: `À VALIDER | ${PDF_NON_TROUVE}`,
    })
    added++
    const label = `${p.marque !== '—' ? `${p.marque} ` : ''}${p.reference !== '—' ? p.reference : p.designation}`
    if (!obtain.has(obtainKey(label))) {
      obtain.add(obtainKey(label))
      res.a_obtenir.push({
        origine: 'fabricant',
        document: label.slice(0, 300),
        fabricant: p.marque !== '—' ? p.marque.slice(0, 120) : undefined,
        raison: 'Fiche technique officielle à obtenir pour le produit proposé',
      })
    }
  }
  return added
}

// ---------- Application au run ----------
const [run] = await api(
  `tender_datasheet_runs?id=eq.${RUN}&organization_id=eq.${ORG}&select=id,result,chapters`,
)
if (!run) throw new Error('run introuvable')
const result = run.result ?? {}
let total = 0
for (const [code, res] of Object.entries(result)) {
  const codes = (run.chapters?.[code]?.exigences ?? [])
    .map((e) => e.code)
    .filter((c) => c?.trim())
  const before = res.documents?.length ?? 0
  const added = ensureProductDocRows(res, code, codes)
  total += added
  if (added) console.log(`${code} : ${before} → ${res.documents.length} fiches (+${added})`)
}
const docs = Object.values(result).reduce((n, r) => n + (r.documents?.length ?? 0), 0)
const produits = Object.values(result).reduce((n, r) => n + (r.produits?.length ?? 0), 0)
console.log(`\n${total} lignes fiches ajoutées — ${produits} produits → ${docs} documents`)
if (!DRY && total) {
  await api(`tender_datasheet_runs?id=eq.${RUN}`, {
    method: 'PATCH',
    body: JSON.stringify({ result, updated_at: new Date().toISOString() }),
  })
  console.log('Run mis à jour — « Rechercher les documents manquants » cherchera ces fiches.')
}
