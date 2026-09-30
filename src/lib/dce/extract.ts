import 'server-only'

import { unzipSync, strFromU8 } from 'fflate'
import { classifyDoc } from './classify'
import type { ExtractedDoc, SkippedDoc } from './types'

const MAX_FILE_BYTES = 30 * 1024 * 1024
const MAX_TEXT_CHARS = 500_000 // garde-fou avant le budget du prompt
const MAX_ZIP_ENTRIES = 60
const MIN_TEXT_CHARS = 20

const TEXT_EXT = /\.(txt|md|csv|tsv)$/i
const XML_STRIP = /<[^>]+>/g

async function pdfText(buf: Uint8Array): Promise<string> {
  // Contournement : pdf-parse v1 tente de charger un fichier test à l'import —
  // on cible directement lib/pdf-parse.js (même pattern que rc-analysis).
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
  const pdf = await pdfParse(Buffer.from(buf))
  return pdf.text ?? ''
}

/** XLSX (DPGF, BPU chiffré…) : dump des cellules ligne par ligne, onglet par onglet. */
async function xlsxText(buf: Uint8Array): Promise<string> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(buf) as unknown as ArrayBuffer)
  const parts: string[] = []
  for (const ws of wb.worksheets) {
    parts.push(`=== ${ws.name} ===`)
    ws.eachRow((row) => {
      // eachCell donne les vrais numéros de colonne — les cellules vides en
      // tête de ligne ne doivent pas décaler le dump (postes DPGF en colonnes).
      const cells: string[] = []
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        const v = cell.value
        const s =
          v == null
            ? ''
            : v instanceof Date
              ? v.toISOString().slice(0, 10)
              : typeof v === 'object'
                ? 'richText' in v
                  ? v.richText.map((r) => r.text).join('')
                  : 'text' in v
                    ? String(v.text)
                    : 'result' in v
                      ? String(v.result ?? '')
                      : String(v)
                : String(v)
        cells[col - 1] = s.replace(/\s+/g, ' ').trim()
      })
      const line = cells.map((c) => c ?? '').join(' | ').replace(/(\|\s*)+$/, '').trim()
      if (line && line !== '|') parts.push(line)
    })
  }
  return parts.join('\n')
}

function isXlsx(name: string, mime?: string) {
  return (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel' ||
    /\.(xlsx|xlsm)$/i.test(name)
  )
}

/** DOCX = ZIP : le texte est dans word/document.xml (+ headers/footers). */
export function docxText(buf: Uint8Array): string {
  const entries = unzipSync(buf)
  const parts: string[] = []
  for (const [path, data] of Object.entries(entries)) {
    if (/^word\/(document|header\d*|footer\d*)\.xml$/i.test(path)) {
      const xml = strFromU8(data)
      parts.push(
        xml
          .replace(/<w:p[ >][^]*?<\/w:p>/g, (m) => `${m.replace(XML_STRIP, '')}\n`)
          .replace(XML_STRIP, ' '),
      )
    }
  }
  return parts.join('\n')
}

function isZipLike(name: string, mime?: string) {
  return (
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    /\.zip$/i.test(name)
  )
}

function isRarLike(name: string, mime?: string) {
  return (
    mime === 'application/vnd.rar' ||
    mime === 'application/x-rar-compressed' ||
    /\.rar$/i.test(name)
  )
}

/**
 * RAR via node-unrar-js (port WASM d'unrar — pas de binaire natif).
 * Même contrat que `unzipEntries` : `path` = chemin relatif interne.
 */
export async function unrarEntries(
  buf: Uint8Array,
): Promise<{
  entries: { name: string; path: string; data: Uint8Array }[]
  /** Nombre réel d'entrées dans l'archive — la liste est plafonnée. */
  total: number
}> {
  const { createExtractorFromData } = await import('node-unrar-js')
  // buf peut être une vue : recaler l'ArrayBuffer sur la plage exacte.
  const data = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer
  const extractor = await createExtractorFromData({ data })
  const headers = [...extractor.getFileList().fileHeaders].filter(
    (h) => !h.flags.directory,
  )
  const names = headers.slice(0, MAX_ZIP_ENTRIES).map((h) => h.name)
  const { files } = extractor.extract({ files: names })
  const out: { name: string; path: string; data: Uint8Array }[] = []
  for (const f of files) {
    const path = f.fileHeader.name
    out.push({
      name: path.split('/').pop() ?? path,
      path,
      data: f.extraction ?? new Uint8Array(),
    })
  }
  return { entries: out, total: headers.length }
}

/**
 * Lots référencés par un chemin/nom de pièce : « LOT 3/DPGF.xlsx »,
 * « BPU-lot_2.xlsx », « CCTP lots 1 et 3.pdf » → [3], [2], [1, 3].
 * Le préfixe [^a-z] évite les faux positifs (« pilotage », « ilot »…).
 */
export function detectLotNumbers(path: string): number[] {
  const lots = new Set<number>()
  const re = /(?:^|[^a-zà-ÿ])lots?[\s_\-.]*0*(\d{1,2})/gi
  for (const m of path.matchAll(re)) {
    const n = Number(m[1])
    if (n >= 1 && n <= 99) lots.add(n)
  }
  // « lot 1-3 » / « lots 1 et 2 » : le second numéro dépend du même « lot »
  const chain = /lots?[\s_\-.]*0*\d{1,2}\s*(?:-|–|et|\/)\s*0*(\d{1,2})/gi
  for (const m of path.matchAll(chain)) {
    const n = Number(m[1])
    if (n >= 1 && n <= 99) lots.add(n)
  }
  return [...lots].sort((a, b) => a - b)
}

function isDocx(name: string, mime?: string) {
  return (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.docx$/i.test(name)
  )
}

function pushDoc(
  out: ExtractedDoc[],
  name: string,
  text: string,
  /** Chemin relatif (dossiers du ZIP) — porte souvent le numéro de lot. */
  path?: string,
) {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t]{3,}/g, '  ').trim()
  if (clean.length < MIN_TEXT_CHARS) return false
  const truncated = clean.length > MAX_TEXT_CHARS
  // La classification et la détection de lot exploitent le chemin complet :
  // « LOT 3/DPGF.xlsx » dans un ZIP perdrait son contexte avec le basename seul.
  const classifyKey = path ?? name
  const lots = detectLotNumbers(classifyKey)
  out.push({
    name,
    docType: classifyDoc(classifyKey, clean),
    text: truncated ? clean.slice(0, MAX_TEXT_CHARS) : clean,
    truncated,
    ...(lots.length ? { lots } : {}),
  })
  return true
}

async function extractOne(
  name: string,
  buf: Uint8Array,
  mime: string | undefined,
  out: ExtractedDoc[],
  skipped: SkippedDoc[],
  depth: number,
): Promise<void> {
  if (buf.byteLength > MAX_FILE_BYTES) {
    skipped.push({ name, reason: 'fichier trop volumineux (>30 Mo)' })
    return
  }
  if (buf.byteLength === 0) {
    skipped.push({ name, reason: 'fichier vide' })
    return
  }

  // DOCX/XLSX sont des conteneurs ZIP : les tester AVANT isZipLike — un
  // client peut envoyer mime 'application/zip' pour un .docx et le fichier
  // serait sinon déplié en XML internes inexploitables.
  if (isDocx(name, mime)) {
    try {
      if (!pushDoc(out, name, docxText(buf))) {
        skipped.push({ name, reason: 'DOCX sans texte extractible' })
      }
    } catch {
      skipped.push({ name, reason: 'DOCX illisible' })
    }
    return
  }

  if (isXlsx(name, mime)) {
    try {
      if (!pushDoc(out, name, await xlsxText(buf))) {
        skipped.push({ name, reason: 'XLSX sans contenu lisible' })
      }
    } catch {
      skipped.push({ name, reason: 'XLSX illisible' })
    }
    return
  }

  if (isZipLike(name, mime) || isRarLike(name, mime)) {
    if (depth > 1) {
      skipped.push({ name, reason: 'archive imbriquée ignorée' })
      return
    }
    let entries: { name: string; path: string; data: Uint8Array }[]
    let total = 0
    try {
      if (isRarLike(name, mime)) {
        const r = await unrarEntries(buf)
        entries = r.entries
        total = r.total
      } else {
        const r = unzipEntries(buf)
        entries = r.entries
        total = r.total
      }
    } catch {
      skipped.push({
        name,
        reason: isRarLike(name, mime)
          ? 'RAR illisible ou protégé par mot de passe'
          : 'ZIP illisible',
      })
      return
    }
    for (const e of entries.slice(0, MAX_ZIP_ENTRIES)) {
      // Chemin relatif conservé comme nom : « LOT 3/DPGF.xlsx » porte le lot.
      await extractOne(e.path, e.data, undefined, out, skipped, depth + 1)
    }
    if (total > MAX_ZIP_ENTRIES) {
      skipped.push({
        name,
        reason: `archive tronquée (${total - MAX_ZIP_ENTRIES} entrées ignorées)`,
      })
    }
    return
  }

  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
    try {
      if (!pushDoc(out, name, await pdfText(buf))) {
        skipped.push({ name, reason: 'PDF sans texte extractible (scan ?)' })
      }
    } catch {
      skipped.push({ name, reason: 'PDF illisible' })
    }
    return
  }

  if (mime?.startsWith('text/') || TEXT_EXT.test(name)) {
    if (!pushDoc(out, name, strFromU8(buf))) {
      skipped.push({ name, reason: 'fichier texte vide' })
    }
    return
  }

  skipped.push({ name, reason: 'format non analysable' })
}

/**
 * Déplie un ZIP : `name` = nom d'affichage, `path` = chemin relatif complet
 * (les dossiers portent souvent le numéro de lot — « LOT 3/DPGF.xlsx »).
 */
export function unzipEntries(buf: Uint8Array): {
  entries: { name: string; path: string; data: Uint8Array }[]
  /** Nombre réel d'entrées dans l'archive — la liste est plafonnée. */
  total: number
} {
  const entries = unzipSync(buf)
  const files = Object.entries(entries).filter(([path]) => !path.endsWith('/'))
  return {
    entries: files
      .slice(0, MAX_ZIP_ENTRIES)
      .map(([path, data]) => ({ name: path.split('/').pop() ?? path, path, data })),
    total: files.length,
  }
}

const PEEK_CHARS = 15_000

/**
 * Échantillon de texte pour classification (léger) : premières pages d'un PDF,
 * début d'un DOCX ou d'un texte brut. '' si non sniffable.
 */
export async function peekText(
  name: string,
  buf: Uint8Array,
  mime?: string,
): Promise<string> {
  try {
    if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default as (
        b: Buffer,
        o?: { max?: number },
      ) => Promise<{ text?: string }>
      const pdf = await pdfParse(Buffer.from(buf), { max: 4 })
      return (pdf.text ?? '').slice(0, PEEK_CHARS)
    }
    if (isDocx(name, mime)) return docxText(buf).slice(0, PEEK_CHARS)
    if (mime?.startsWith('text/') || TEXT_EXT.test(name)) {
      return strFromU8(buf.slice(0, PEEK_CHARS * 2)).slice(0, PEEK_CHARS)
    }
  } catch {
    return ''
  }
  return ''
}

/**
 * Point d'entrée : fichiers bruts → documents texte classés + pièces ignorées.
 * Les ZIP sont dépliés (un niveau), les DOCX décompressés, les PDF parsés.
 */
export async function extractDceFiles(
  files: { name: string; data: Uint8Array; mime?: string }[],
): Promise<{ docs: ExtractedDoc[]; skipped: SkippedDoc[] }> {
  const docs: ExtractedDoc[] = []
  const skipped: SkippedDoc[] = []
  for (const f of files) {
    await extractOne(f.name, f.data, f.mime, docs, skipped, 0)
  }
  // Documents structurants d'abord — priorité au budget du prompt.
  const order: ExtractedDoc['docType'][] = [
    'rc', 'cctp', 'ccap', 'ccag', 'ae', 'dpgf', 'bpu', 'annexe', 'autre',
  ]
  // Tri déterministe : type structurant d'abord, puis nom (ordre stable dans
  // le budget du prompt, quelle que soit l'ordre de retour du storage).
  docs.sort(
    (a, b) =>
      order.indexOf(a.docType) - order.indexOf(b.docType) ||
      a.name.localeCompare(b.name, 'fr'),
  )
  return { docs, skipped }
}
