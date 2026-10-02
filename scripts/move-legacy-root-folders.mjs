// Reclasse sous « Société/… » les dossiers racine créés avant la convention
// « Société + AO <réf> — <titre> » : les uploads depuis les fiches
// entreprise/contact/projet posaient « CRM — X » ou « Projet X — … » à la
// racine, signalés « non rattaché » dans l'arborescence Documents.
//
//   CRM — <entreprise>[/sous/…]     → Société/CRM — <entreprise>[/sous/…]
//   Projet <code> — <nom>[/sous/…]  → Société/Projet <code> — <nom>[/sous/…]
//
// Usage : node scripts/move-legacy-root-folders.mjs          (aperçu)
//         node scripts/move-legacy-root-folders.mjs --apply  (exécute)
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
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const HJ = {
  apikey: KEY,
  authorization: `Bearer ${KEY}`,
  'content-type': 'application/json',
  prefer: 'return=minimal',
}
const APPLY = process.argv.includes('--apply')

const api = async (path, opts = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: HJ, ...opts })
  if (!r.ok)
    throw new Error(`${path} → HTTP ${r.status} : ${(await r.text()).slice(0, 200)}`)
  return r.status === 204 ? null : r.json()
}

// Premiers segments legacy → reclassement sous Société/. Le préfixe couvre
// les descendants (« CRM — X/sous-dossier ») via startsWith sur le chemin.
const LEGACY_ROOT = /^CRM\s*[-–—]\s*|^Projet\s/i

const docs = await api(
  'documents?select=id,folder_path&folder_path=not.is.null&limit=10000',
)

const moves = []
for (const d of docs ?? []) {
  const p = (d.folder_path ?? '').replace(/^\/+|\/+$/g, '')
  if (!p || p === '/') continue
  const first = p.split('/')[0]
  if (first === 'Société' || /^AO\b/i.test(first)) continue // déjà conforme
  if (!LEGACY_ROOT.test(first)) continue
  const next = `Société/${p}`
  if (next !== d.folder_path) moves.push({ id: d.id, from: d.folder_path, to: next })
}

if (!moves.length) {
  console.log('Aucun dossier legacy à reclasser.')
  process.exit(0)
}

for (const m of moves) console.log(`${m.from}  →  ${m.to}`)
console.log(`\n${moves.length} document(s) à déplacer.`)

if (!APPLY) {
  console.log('Aperçu seulement — relancer avec --apply pour exécuter.')
  process.exit(0)
}

let done = 0
for (const m of moves) {
  await api(`documents?id=eq.${m.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ folder_path: m.to }),
  })
  done++
}
console.log(`Terminé : ${done} document(s) reclassé(s).`)
