// Migration des dossiers de fiches existants vers les conventions actuelles :
//   1. Noms de fiches courts « 5.5.3 Cemex CXB Voile.pdf » (docFilename).
//   2. Dossier de rangement « AO <réf> — <titre court>/Fiches techniques/
//      LOT 01 - <libellé court> » (fusionne l'ancien chemin au titre complet).
//   3. Purge des livrables obsolètes (classeur + ZIP) non suivis par le run —
//      les exports répétés empilaient des doublons identiques.
//
// Copie volontairement la logique de src/lib/naming.ts et de
// src/lib/datasheets/research.ts (docFilename) — script .mjs autonome.
// Usage : node scripts/normalize-datasheet-names.mjs
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
const ORG = '390bf68d-d189-45b4-b340-7a3a5f96ded0'
const H = { apikey: KEY, authorization: `Bearer ${KEY}` }
const HJ = { ...H, 'content-type': 'application/json', prefer: 'return=minimal' }

// ---------- répliques de src/lib/naming.ts ----------
const FILLER = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'a', 'au', 'aux', 'et',
  'en', 'sur', 'pour', 'dans', 'un', 'une', 'par', 'avec', 'ou', 'the', 'of',
])
const shortText = (s, max) => {
  const clean = (s ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const at = cut.lastIndexOf(' ')
  const head = (at > max * 0.45 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, '')
  return head ? `${head}…` : `${clean.slice(0, max - 1)}…`
}
const condense = (s, max) => {
  const words = (s ?? '').replace(/\s+/g, ' ').trim().split(' ')
  const kept = words.filter(
    (w, i) => i === 0 || !FILLER.has(w.toLowerCase().replace(/[’']/g, "'")),
  )
  return shortText(kept.join(' '), max)
}
const shortAffaire = (title, reference, max = 40) => {
  const prefix = reference?.trim() ? `AO ${reference.trim()} — ` : 'AO — '
  return `${prefix}${condense(title?.trim() || 'Sans titre', max)}`
}
const parseLotLabel = (label) => {
  const m = label.trim().match(/^lot\s*0*(\d{1,3})\s*[-–—:.]?\s*(.*)$/i)
  return m ? { number: Number(m[1]), title: m[2].trim() } : { number: null, title: label.trim() }
}
const shortLotLabel = (number, title, max = 40) => {
  const prefix = number != null ? `LOT ${String(number).padStart(2, '0')} - ` : ''
  const budget = Math.max(12, max - prefix.length)
  const segs = title.split(/\s*[,;/]\s*|\s+[–—]\s+/).map((s) => s.trim()).filter(Boolean)
  if (segs.length >= 3) {
    const kept = []
    for (const s of segs) {
      if ([...kept, s].join(', ').length <= budget - 4) kept.push(s)
      else break
    }
    if (kept.length) {
      const rest = segs.length - kept.length
      return `${prefix}${kept.join(', ')}${rest > 0 ? ` +${rest}` : ''}`
    }
  }
  return `${prefix}${condense(title, budget)}`
}
const shortenLotLabel = (label) => {
  const { number, title } = parseLotLabel(label)
  return shortLotLabel(number, title)
}
const productName = (designation, max = 45) => {
  const head = (designation ?? '')
    .split(/\s+[–—]\s+|\s*\(|\s*,\s|\s*:\s|\s+\|\s+/)[0]
    .replace(/\s+/g, ' ')
    .trim()
  return shortText(head || designation, max)
}
const shortReference = (reference, max = 26) => {
  const head = (reference ?? '')
    .split(/\s+[–—]\s+|\s*\(|\s*:\s/)[0]
    .replace(/\s+/g, ' ')
    .trim()
  return shortText(head || reference, max)
}
const articleNumber = (code) => {
  const m =
    code.match(/\bart(?:icle)?\s*[.:]?\s*(\d+(?:[\s.-]+\d+)*[a-zA-Z]?)/i) ??
    code.match(/(\d+(?:[-.]\d+)+[a-zA-Z]?)/)
  if (!m) return null
  const num = m[1].replace(/[\s-]+/g, '.').replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '')
  return num || null
}
const sanitizeFilename = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/…+/g, '')
    .replace(/[/:*?"<>|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 220)

// ---------- réplique de src/lib/datasheets/research.ts docFilename ----------
const docFilename = (d) => {
  const art = articleNumber(d.code ?? '')
  const head = art ?? ((d.chap ?? '').trim() || condense(d.code ?? '', 24) || 'fiche')
  const brand = (d.marque ?? '').trim() && d.marque.trim() !== '—' ? shortText(d.marque, 22) : ''
  const ref = (d.reference ?? '').trim() && d.reference.trim() !== '—' ? shortReference(d.reference) : ''
  const refHasBrand =
    !!brand &&
    (ref.toLowerCase().startsWith(brand.toLowerCase() + ' ') ||
      ref.toLowerCase().startsWith(brand.toLowerCase() + '-'))
  const product = ref
    ? refHasBrand
      ? ref
      : [brand, ref].filter(Boolean).join(' ')
    : [brand, productName(d.designation ?? '')].filter(Boolean).join(' ')
  const typeSuffix =
    d.type_document && d.type_document !== 'Fiche_technique' ? ` - ${d.type_document}` : ''
  const name = [head, product].filter((p) => p && p !== '—').join(' ')
  return sanitizeFilename(name + typeSuffix) + '.pdf'
}

const DOC_TYPES = new Set([
  'Fiche_technique', 'Notice_de_pose', 'Notice_produit', 'Documentation_technique',
  'Guide', 'Avis_Technique', 'DTA', 'Certificat', 'Certification', 'DoP',
  'Declaration_UE_conformite', 'PV', 'FDES', 'FDS',
])

/**
 * Reconstruit les champs d'un PDF d'ancienne génération :
 * « 01a-Code - Designation - Marque - Ref - Type.pdf » (séparateurs « - »
 * ASCII ; le « — » cadratin interne aux désignations ne coupe pas). Sert à
 * renommer les PDF orphelins (résultat de run réécrit depuis leur dépôt).
 */
const parseLegacyName = (filename) => {
  const stem = filename.replace(/\.pdf$/i, '')
  const parts = stem.split(' - ')
  if (parts.length < 4) return null
  const headRaw = parts[0]
  let type = parts[parts.length - 1].trim()
  // Le type a pu être tronqué par l'ancien plafond de 220 caractères.
  if (!DOC_TYPES.has(type)) {
    const found = [...DOC_TYPES].find((t) => type.startsWith(t.slice(0, 6)))
    type = found ?? 'Fiche_technique'
  }
  const reference = parts[parts.length - 2]
  const marque = parts[parts.length - 3]
  const designation = parts.slice(1, parts.length - 3).join(' - ')
  const chap = (headRaw.match(/^(\w+)-/) ?? [])[1] ?? headRaw.split('-')[0]
  const code = headRaw.replace(/^\w+-/, '')
  return { chap, code, designation, marque, reference, type_document: type }
}

const api = async (path, opts = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: HJ, ...opts })
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status} : ${(await r.text()).slice(0, 200)}`)
  return r.status === 204 ? null : r.json()
}

// ---------- 1. Runs ----------
const runs = await api(
  `tender_datasheet_runs?organization_id=eq.${ORG}&select=id,tender_id,lot_label,result,download_report,deliverable_document_ids&limit=100`,
)
const tenderIds = [...new Set(runs.map((r) => r.tender_id))]
const tenders = tenderIds.length
  ? await api(`tenders?id=in.(${tenderIds.join(',')})&select=id,title,reference`)
  : []
const tenderById = new Map(tenders.map((t) => [t.id, t]))

// Livrables suivis par N'IMPORTE QUEL run du même AO : un livrable d'un
// autre run du même lot n'est pas obsolète.
const trackedByTender = new Map()
for (const r of runs) {
  const set = trackedByTender.get(r.tender_id) ?? new Set()
  for (const id of r.deliverable_document_ids ?? []) set.add(id)
  trackedByTender.set(r.tender_id, set)
}

let renamedDocs = 0, renamedRows = 0, movedFolders = 0, purged = 0

for (const run of runs) {
  const result = run.result ?? {}
  // --- Renommage des fiches : recompute + dédup globale ---
  const used = new Set()
  const renames = [] // { doc, oldName, newName }
  for (const res of Object.values(result)) {
    for (const d of res.documents ?? []) {
      if (!d.filename || d.filename === '—') continue
      const base = docFilename(d)
      let name = base
      for (let n = 2; used.has(name); n++) {
        name = base.replace(/\.pdf$/i, ` (${n}).pdf`)
      }
      used.add(name)
      if (name !== d.filename) renames.push({ doc: d, oldName: d.filename, newName: name })
      d.filename = name
    }
  }

  // --- download_report : renommer les clés ---
  const report = { ...(run.download_report ?? {}) }
  for (const { oldName, newName } of renames) {
    if (report[oldName] !== undefined) {
      report[newName] = report[oldName]
      delete report[oldName]
    }
  }

  // --- documents.name pour les fiches téléchargées ---
  const renamedDocIds = new Set()
  for (const { doc: d, oldName, newName } of renames) {
    if (!d.document_id) continue
    const rows = await api(`documents?id=eq.${d.document_id}&select=id,name`)
    const row = rows?.[0]
    if (row && row.name === oldName) {
      await api(`documents?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: newName }),
      })
      renamedDocs++
      renamedDocIds.add(row.id)
    }
  }
  if (renames.length) {
    await api(`tender_datasheet_runs?id=eq.${run.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ result, download_report: report }),
    })
    renamedRows += renames.length
  }

  // --- PDF orphelins : déposés par une version précédente du résultat
  //     (réécrite depuis) — ils restent des fiches valides : renommage au
  //     nouveau format via l'ancien nom, puis rangement au bon dossier. ---
  const runFiles = await api(
    `documents?organization_id=eq.${ORG}&storage_path=like.%25/datasheets/${run.id}/%25&select=id,name,folder_path`,
  )
  for (const d of runFiles ?? []) {
    if (renamedDocIds.has(d.id) || !/\.pdf$/i.test(d.name)) continue
    const parsed = parseLegacyName(d.name)
    if (!parsed) continue
    const base = docFilename(parsed)
    if (base === d.name) continue
    let name = base
    for (let n = 2; used.has(name); n++) {
      name = base.replace(/\.pdf$/i, ` (${n}).pdf`)
    }
    used.add(name)
    await api(`documents?id=eq.${d.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
    renamedDocs++
    renamedDocIds.add(d.id)
  }

  // --- Dossier de rangement canonique pour tous les fichiers du run ---
  const tender = tenderById.get(run.tender_id)
  if (tender) {
    const expected = `${shortAffaire(tender.title, tender.reference)}/Fiches techniques/${shortenLotLabel(run.lot_label)}`
    for (const d of runFiles ?? []) {
      if (d.folder_path !== expected) {
        await api(`documents?id=eq.${d.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ folder_path: expected }),
        })
        movedFolders++
      }
    }
  }

  // --- Livrables obsolètes : sous le préfixe du run mais non suivis,
  //     OU ancienne paire classeur/ZIP du même lot hors préfixe courant ---
  const tracked = new Set(run.deliverable_document_ids ?? [])
  const runDocs = await api(
    `documents?organization_id=eq.${ORG}&storage_path=like.%25/datasheets/${run.id}/%25&select=id,storage_path,document_type`,
  )
  // NE JAMAIS purger que les livrables générés : les PDF de fiches
  // téléchargés vivent sous le même préfixe — les filtrer ici les effacerait.
  const stale = (runDocs ?? []).filter(
    (d) =>
      (d.document_type === 'Classeur_DCR' ||
        d.document_type === 'Arborescence_livraison') &&
      !tracked.has(d.id),
  )
  const { number: lotNum } = parseLotLabel(run.lot_label)
  if (lotNum != null) {
    const links = await api(
      `document_links?organization_id=eq.${ORG}&entity_type=eq.tender&entity_id=eq.${run.tender_id}&select=document_id`,
    )
    const ids = (links ?? []).map((l) => l.document_id)
    if (ids.length) {
      const others = await api(
        `documents?organization_id=eq.${ORG}&id=in.(${ids.join(',')})` +
          `&document_type=in.(Classeur_DCR,Arborescence_livraison)` +
          `&name=ilike.LOT%20${String(lotNum).padStart(2, '0')}%20*` +
          `&storage_path=not.like.%25/datasheets/${run.id}/%25&select=id,storage_path,document_type`,
      )
      const allTracked = trackedByTender.get(run.tender_id) ?? new Set()
      for (const d of others ?? []) {
        if (!allTracked.has(d.id) && !stale.some((s) => s.id === d.id)) stale.push(d)
      }
    }
  }
  for (const d of stale) {
    // Objet storage puis ligne (document_links cascade via FK).
    await fetch(`${SB}/storage/v1/object/documents/${d.storage_path}`, {
      method: 'DELETE',
      headers: H,
    })
    await api(`documents?id=eq.${d.id}`, { method: 'DELETE' })
    purged++
  }
  if (renames.length)
    console.log(`run ${run.id.slice(0, 8)} : ${renames.length} fiches renommées`)
}

console.log(
  `Terminé : ${renamedRows} fiches renommées, ${renamedDocs} lignes documents maj, ` +
    `${movedFolders} dossiers corrigés, ${purged} livrables obsolètes purgés`,
)
