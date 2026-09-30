import 'server-only'

import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { articleNumber } from '@/lib/naming'
import type { ChapterDef, ChapterResult, DatasheetDoc, DatasheetProduct } from './types'

const TNR = 'Times New Roman'
const CAL = 'Calibri'
const THIN = { style: 'thin' } as const
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const COLS = ['Code', 'Titre', 'Marque', 'Référence', 'Fiche technique']
const WIDTHS = [14.71, 48, 24, 40, 48]

let logoCache: string | null | undefined
function logoBase64(): string | null {
  if (logoCache !== undefined) return logoCache
  try {
    logoCache = readFileSync(
      join(process.cwd(), 'src', 'lib', 'datasheets', 'logo-dcr.png'),
    ).toString('base64')
  } catch {
    logoCache = null
  }
  return logoCache
}

function sheetName(name: string) {
  return name.replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Feuille'
}

/** ExcelJS refuse les noms d'onglets dupliqués — deux chapitres dont les
 *  intitulés partagent un préfixe de 31 car. collisionneraient. */
function uniqueSheetName(used: Map<string, number>, nom: string): string {
  const base = sheetName(nom)
  const count = used.get(base) ?? 0
  used.set(base, count + 1)
  if (!count) return base
  return `${base.slice(0, 27)} (${count + 1})`
}

function entete(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  operation: string,
  sousTitre: string,
  ncols: number,
) {
  ws.mergeCells(1, 3, 1, Math.max(4, ncols))
  const c = ws.getCell(1, 3)
  c.value = operation
  c.font = { name: TNR, size: 18, bold: true }
  c.alignment = { horizontal: 'right', vertical: 'top', wrapText: true }
  ws.getRow(1).height = 92.25
  const logo = logoBase64()
  if (logo) {
    const id = wb.addImage({ base64: logo, extension: 'png' })
    ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 375, height: 183 } })
  }

  ws.mergeCells(2, 1, 2, ncols)
  const st = ws.getCell(2, 1)
  st.value = sousTitre
  st.font = { name: CAL, size: 14, bold: true }
  st.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(2).height = 41.1
  ws.getRow(3).height = 7.5
  return 4
}

function ligneEntetes(ws: ExcelJS.Worksheet, r: number, headers: string[]) {
  headers.forEach((h, i) => {
    const c = ws.getCell(r, i + 1)
    c.value = h
    c.font = { name: CAL, size: 10, bold: true }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    c.border = BORDER
  })
  ws.getRow(r).height = 15.75
  return r + 1
}

function ligneVide(ws: ExcelJS.Worksheet, r: number, ncols: number) {
  for (let i = 1; i <= ncols; i++) ws.getCell(r, i).border = BORDER
  ws.getRow(r).height = 15.75
  return r + 1
}

type MarqueRow = {
  code: string
  titre: string
  marque: string
  ref: string
  fiche: string
  sub: boolean
}

const normKey = (v: string) =>
  v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')

/** Index « § CCTP → fiches normalisées » : construit une fois par feuille,
 *  ficheOf n'a plus à re-normaliser chaque document pour chaque produit. */
type IndexedFiche = { m: string; r: string; doc: DatasheetDoc }

function indexFiches(docs: DatasheetDoc[]): Map<string, IndexedFiche[]> {
  const idx = new Map<string, IndexedFiche[]>()
  for (const d of docs) {
    if (d.type_document !== 'Fiche_technique') continue
    const code = articleNumber(d.code) ?? normKey(d.code)
    const list = idx.get(code) ?? []
    list.push({
      m: normKey(d.marque === '—' ? '' : d.marque),
      r: normKey(d.reference === '—' ? '' : d.reference),
      doc: d,
    })
    idx.set(code, list)
  }
  return idx
}

/** Fiche technique du produit : la ligne « documents » qui partage son §
 *  CCTP et sa marque/référence. Un produit peut n'avoir aucune fiche
 *  (prestation pure, ou PDF non trouvé) → cellule vide alors. */
function ficheOf(
  p: DatasheetProduct,
  idx: Map<string, IndexedFiche[]>,
): DatasheetDoc | undefined {
  const code = articleNumber(p.code) ?? normKey(p.code)
  if (!code) return undefined // ligne de sous-titre : pas de fiche associée
  const m = normKey(p.marque === '—' ? '' : p.marque)
  const r = normKey(p.reference === '—' ? '' : p.reference)
  return idx
    .get(code)
    ?.find((e) => (!m || e.m === m) && (!r || e.r === r))?.doc
}

/** Port du filtre du gabarit : tous les produits analysés sont conservés
 *  (même sans marque proposée — la ligne reste utile pour lister les éléments
 *  à documenter) ; seuls les sous-titres orphelins (sans produit ensuite)
 *  sont retirés. */
function filtrerFiches(rows: MarqueRow[]): MarqueRow[] {
  const out: MarqueRow[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.sub) {
      const nextSub = rows.findIndex((r, j) => j > i && r.sub)
      const hasProduct = rows
        .slice(i + 1, nextSub < 0 ? rows.length : nextSub)
        .some((r) => !r.sub)
      if (!hasProduct) continue
    }
    out.push(row)
  }
  return out
}

function feuilleMarques(
  wb: ExcelJS.Workbook,
  used: Map<string, number>,
  nom: string,
  operation: string,
  lotLabel: string,
  produits: ChapterResult['produits'],
  documents: ChapterResult['documents'],
) {
  const fiches = indexFiches(documents)
  const rows = filtrerFiches(
    produits.map((p) => {
      const doc = ficheOf(p, fiches)
      return {
        code: p.code,
        titre: p.designation,
        // La ligne « produits » peut rester à « — » alors que la fiche
        // recherchée porte la marque réelle : on la récupère du document.
        marque:
          p.marque && p.marque !== '—'
            ? p.marque
            : (doc?.marque ?? p.marque),
        ref:
          p.reference && p.reference !== '—'
            ? p.reference
            : (doc?.reference ?? p.reference),
        fiche: doc?.filename && doc.filename !== '—' ? doc.filename : '',
        sub: !p.code && (!p.marque || p.marque === '—'),
      }
    }),
  )
  const ws = wb.addWorksheet(uniqueSheetName(used, nom))
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  let r = entete(wb, ws, operation, 'Liste des marques', COLS.length)
  r = ligneEntetes(ws, r, COLS)
  r = ligneVide(ws, r, COLS.length)

  ws.mergeCells(r, 1, r, 2)
  const lot = ws.getCell(r, 1)
  lot.value = lotLabel
  lot.font = { name: TNR, size: 11, bold: true }
  lot.alignment = { horizontal: 'left', wrapText: true }
  for (let i = 1; i <= COLS.length; i++) ws.getCell(r, i).border = BORDER
  r++
  r = ligneVide(ws, r, COLS.length)

  // Gabarit : les lignes de sous-titre sont préfixées du code chapitre
  // (« 01a — Confinement (…) »). Préfixe ajouté ici — pas au LLM.
  const chapPrefix = /^\d{2}[a-z]?$/i.test(nom.split(/\s+/)[0] ?? '')
    ? nom.split(/\s+/)[0]
    : null

  let prevCode: string | null = null
  rows.forEach((row, idx) => {
    const nouveauBloc = row.sub || row.code !== prevCode
    if (idx && nouveauBloc) r = ligneVide(ws, r, COLS.length)
    const titre =
      row.sub && chapPrefix && !row.titre.startsWith(chapPrefix)
        ? `${chapPrefix} — ${row.titre}`
        : row.titre
    ws.getCell(r, 1).value = nouveauBloc ? row.code : null
    ws.getCell(r, 2).value = titre
    ws.getCell(r, 3).value = row.marque === '—' ? null : row.marque || null
    ws.getCell(r, 4).value = row.ref === '—' ? null : row.ref || null
    ws.getCell(r, 5).value = row.fiche || null
    for (let i = 1; i <= COLS.length; i++) {
      const c = ws.getCell(r, i)
      c.border = BORDER
      c.font = { name: TNR, size: 11, bold: i === 1 || (i === 2 && nouveauBloc) }
      c.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
    }
    prevCode = row.code
    r++
  })
  r = ligneVide(ws, r, COLS.length)

  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 8 as ExcelJS.PaperSize,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.79, right: 0, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    printArea: `A1:E${r}`,
  }
}

function feuilleTableau(
  wb: ExcelJS.Workbook,
  used: Map<string, number>,
  nom: string,
  operation: string,
  sousTitre: string,
  headers: string[],
  widths: number[],
  rows: (string | number)[][],
  statutCol?: number,
) {
  const ws = wb.addWorksheet(uniqueSheetName(used, nom))
  const n = headers.length
  entete(wb, ws, operation, sousTitre, n)
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  let r = ligneEntetes(ws, 4, headers)
  const first = r
  for (const row of rows) {
    row.forEach((v, i) => {
      const c = ws.getCell(r, i + 1)
      c.value = v === '—' ? null : v
      c.font = { name: TNR, size: 11, bold: i + 1 === statutCol }
      c.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
      c.border = BORDER
    })
    r++
  }
  ws.views = [{ state: 'frozen', ySplit: first - 1 }]
  ws.autoFilter = { from: 'A4', to: `${String.fromCharCode(64 + n)}${r - 1}` }
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 8 as ExcelJS.PaperSize,
    fitToWidth: 1,
    fitToHeight: 0,
  }
}

export interface WorkbookInput {
  operation: string[]
  variante: string
  lotLabel: string
  chapitres: Record<string, ChapterDef>
  results: Record<string, ChapterResult>
  /** Noms de fichiers effectivement téléchargés dans le stockage. */
  downloaded: Set<string>
}

/** Classeur Excel au gabarit DCR (une variante = un classeur). */
export async function buildWorkbook(input: WorkbookInput): Promise<Buffer> {
  const operation =
    input.operation.join('\n') + (input.variante ? ` - ${input.variante}` : '')
  const lotLabel = input.lotLabel + (input.variante ? ` - ${input.variante}` : '')

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Nexus — DCR'
  wb.created = new Date()
  const usedNames = new Map<string, number>()

  // Liste des marques, un onglet par chapitre
  for (const [code, ch] of Object.entries(input.chapitres)) {
    const res = input.results[code]
    feuilleMarques(
      wb,
      usedNames,
      ch.onglet || code,
      operation,
      `${lotLabel} - ${ch.libelle}`,
      res?.produits ?? [],
      res?.documents ?? [],
    )
  }

  // Index documents : statut complété par « PDF livré / non récupéré »
  const index: (string | number)[][] = []
  let n = 0
  for (const res of Object.values(input.results)) {
    for (const d of res.documents) {
      n++
      const statut = d.url
        ? `${d.statut} | ${input.downloaded.has(d.filename) ? 'PDF livré' : 'PDF non récupéré'}`
        : d.statut
      index.push([
        n,
        d.chap,
        d.code,
        d.designation,
        d.marque,
        d.reference,
        d.type_document,
        d.filename,
        d.url,
        d.source,
        statut,
      ])
    }
  }
  feuilleTableau(
    wb,
    usedNames,
    'Index documents',
    operation,
    'Index des documents techniques',
    ['N°', 'Chap.', 'Code', 'Désignation', 'Marque', 'Référence', 'Type de document', 'Nom du PDF', 'URL officielle', 'Source', 'Statut'],
    [5, 7, 13, 34, 20, 34, 24, 52, 58, 30, 44],
    index,
    11,
  )

  // Contrôle conformité
  const conf: (string | number)[][] = []
  for (const res of Object.values(input.results)) {
    for (const c of res.conformite) {
      conf.push([c.chap, c.code, c.exigence, c.donnee_fabricant, c.conforme, c.commentaire ?? ''])
    }
  }
  feuilleTableau(
    wb,
    usedNames,
    'Controle conformite',
    operation,
    'Tableau de contrôle de conformité',
    ['Chap.', 'Code', 'Exigence du CCTP', 'Donnée réelle du document officiel', 'Conforme', 'Commentaire'],
    [7, 13, 56, 70, 14, 62],
    conf,
    5,
  )

  // Écarts et réserves
  const ecarts: (string | number)[][] = []
  for (const [code, res] of Object.entries(input.results)) {
    for (const e of res.ecarts) {
      ecarts.push([code, e.criticite, e.code, e.objet, e.constat, e.action])
    }
  }
  feuilleTableau(
    wb,
    usedNames,
    'Ecarts et reserves',
    operation,
    'Rapport des écarts et réserves',
    ['Chap.', 'Criticité', 'Code', 'Objet', 'Constat', 'Action proposée'],
    [9, 12, 18, 44, 80, 70],
    ecarts,
    2,
  )

  // Documents à obtenir : produits sans PDF officiel + demandes MOE/fabricants —
  // onglet ajouté au gabarit pour que le classeur reste auto-suffisant sans
  // ouvrir le ZIP.
  const obtenir: (string | number)[][] = []
  for (const res of Object.values(input.results)) {
    for (const d of res.documents) {
      if (!d.url) {
        obtenir.push([
          'PDF non trouvé',
          d.chap,
          d.code,
          d.designation,
          d.marque,
          d.reference,
          'Chercher la fiche officielle du fabricant / contacter le fabricant',
        ])
      } else if (!input.downloaded.has(d.filename)) {
        obtenir.push([
          'PDF non récupéré',
          d.chap,
          d.code,
          d.designation,
          d.marque,
          d.reference,
          d.download_error ?? d.url,
        ])
      }
    }
    for (const o of res.a_obtenir) {
      obtenir.push([
        o.origine === 'moe' ? 'À demander MOE/MOA' : 'À demander fabricant',
        '',
        '',
        o.document,
        o.fabricant ?? '',
        '',
        o.raison,
      ])
    }
  }
  feuilleTableau(
    wb,
    usedNames,
    'Documents a obtenir',
    operation,
    'Documents à obtenir',
    ['Origine', 'Chap.', 'Code', 'Document / Désignation', 'Marque', 'Référence', 'Raison / action'],
    [22, 7, 13, 56, 20, 34, 60],
    obtenir,
    1,
  )

  return Buffer.from(await wb.xlsx.writeBuffer())
}
