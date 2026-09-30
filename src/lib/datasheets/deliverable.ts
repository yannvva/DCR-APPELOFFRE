import 'server-only'

import { strToU8, zipSync, type ZippableFile } from 'fflate'
import { sanitizeFilename } from './research'
import { shortText } from '@/lib/naming'
import { folderForDocType } from './types'
import type { ChapterDef, ChapterResult } from './types'

const txt = (s: string) => strToU8(s.replace(/\r?\n/g, '\r\n'))

const FOLDERS = [
  '00 - Liste des marques',
  '01 - Fiches techniques',
  '02 - Notices de pose',
  '03 - PV, avis techniques et certifications',
  '04 - FDES et environnement',
  '05 - FDS',
  '06 - A valider ou documents manquants',
] as const

/** "LOT 01 - DESAMIANTAGE DEMOLITION" → "Lot 01" (partie courte pour le nom du classeur). */
export function lotShortLabel(lotLabel: string): string {
  const m = lotLabel.trim().match(/^lot\s*[\w-]+/i)
  return m ? m[0].replace(/^lot/i, 'Lot') : lotLabel.trim()
}

/**
 * Nom du classeur Excel : « Fiche technique - Lot 01.xlsx »
 * (« ABEILLE CAMUS - Fiche technique - Lot 01 - ECOLE NORD.xlsx » quand
 * l'opération et la variante sont renseignées). Le libellé de lot complet
 * (liste des corps d'état) donnait des noms de 175 caractères.
 */
export function classeurFilename(
  lotLabel: string,
  variante: string,
  operationShort?: string,
): string {
  const prefix = [
    operationShort && shortText(operationShort, 30),
    'Fiche technique',
    lotShortLabel(lotLabel),
    variante,
  ]
    .filter(Boolean)
    .join(' - ')
  return sanitizeFilename(`${prefix}.xlsx`)
}

/** Bloc « Nommage / Prefixes » commun aux LISEZ-MOI (format de reference). */
function namingRules(chapitres: Record<string, ChapterDef>): string {
  const entries = Object.entries(chapitres).map(([code, ch]) => {
    const label = ch.onglet.replace(/^\S+\s+/, '').trim() || ch.libelle || code
    return `${code} = ${label}`
  })
  const lines = [
    'Nommage : [Article CCTP] [Marque] [Reference][ - Type_document].pdf',
  ]
  if (entries.length) {
    lines.push(`Prefixes : ${entries.join(',\n           ')}.`)
  }
  return lines.join('\n')
}

/** Sources non officielles (miroir distributeur…) à signaler en « Nota ». */
function notaDocs(
  folder: string,
  results: Record<string, ChapterResult>,
): string[] {
  const lines: string[] = []
  for (const res of Object.values(results)) {
    for (const d of res.documents) {
      if (d.filename === '—' || folderForDocType(d.type_document) !== folder)
        continue
      if (/distributeur|miroir|revendeur|reseller/i.test(d.source)) {
        lines.push(
          `${d.designation} (${d.marque} ${d.reference}) : ${d.source}.`,
        )
      }
    }
  }
  return lines
}

function lisezMoi(folder: string, input: DeliverableInput): string {
  switch (folder) {
    case '00 - Liste des marques': {
      const marquesImposees = Object.values(input.chapitres).some((ch) =>
        ch.exigences.some((e) => e.marques_imposees.length),
      )
      const lines = [
        `Liste des marques (xlsx) du ${input.dossierLot}, index des documents,`,
        'tableau de conformite et rapport des ecarts et reserves.',
        '',
      ]
      if (!marquesImposees) {
        lines.push(
          'Le CCTP ne cite AUCUNE marque : les marques et references listees sont des',
          "propositions, a soumettre a l'agrement de la maitrise d'oeuvre.",
          '',
        )
      }
      lines.push(namingRules(input.chapitres))
      return lines.join('\n')
    }
    case '06 - A valider ou documents manquants':
      return 'Produits sans fiche officielle recuperee et documents a demander.\nVoir _DOCUMENTS A OBTENIR.txt dans ce dossier.'
    case '05 - FDS':
      return [
        'Fiches de donnees de securite (FDS) - jamais de FDS dans les autres dossiers.',
        '',
        namingRules(input.chapitres),
      ].join('\n')
    default: {
      const intro: Record<string, string> = {
        '01 - Fiches techniques':
          'Fiches techniques officielles des fabricants.',
        '02 - Notices de pose':
          'Notices de pose et documentation produit officielles des fabricants.',
        '03 - PV, avis techniques et certifications':
          'PV, avis techniques, DTA, certificats et declarations UE officiels.',
        '04 - FDES et environnement':
          'FDES et documents environnementaux officiels.',
      }
      const lines = [
        intro[folder] ??
          `Documents officiels du fabricant - ${folder.slice(4)}.`,
      ]
      const nota = notaDocs(folder, input.results)
      if (nota.length) lines.push('', 'Nota : ' + nota.join('\n'))
      lines.push('', namingRules(input.chapitres))
      return lines.join('\n')
    }
  }
}

/**
 * Dédup GLOBALE des noms de PDF : normalizeChapterResult déduplique au sein
 * d'un chapitre, mais deux chapitres peuvent désigner le même produit et
 * produire un nom identique → collision dans le ZIP et le rapport de
 * téléchargement. Les docs déjà téléchargés conservent leur nom (il sert de
 * clé au rapport et au stockage) ; les autres sont suffixés « (n) ».
 * Idempotent : un second passage est stable.
 */
export function dedupeFilenames(results: Record<string, ChapterResult>) {
  // Passe 1 : les documents déjà téléchargés gardent leur nom — il sert de
  // clé au rapport de téléchargement et au chemin de stockage.
  const taken = new Set<string>()
  for (const res of Object.values(results)) {
    for (const d of res.documents) {
      if (d.filename !== '—' && (d.downloaded || d.document_id)) {
        taken.add(d.filename)
      }
    }
  }
  // Passe 2 : les autres docs sont suffixés « (n) » en cas de collision.
  for (const res of Object.values(results)) {
    for (const d of res.documents) {
      if (d.filename === '—' || d.downloaded || d.document_id) continue
      if (taken.has(d.filename)) {
        const base = d.filename
        for (let n = 2; ; n++) {
          const cand = base.replace(/\.pdf$/i, ` (${n}).pdf`)
          if (!taken.has(cand)) {
            d.filename = cand
            break
          }
        }
      }
      taken.add(d.filename)
    }
  }
}

export interface DeliverableInput {
  /** "LOT 01 - DESAMIANTAGE DEMOLITION" */
  dossierLot: string
  variante: string
  /** Lignes d'en-tête de l'opération (titre, MOA/MOE, remise) pour _ARBORESCENCE.txt. */
  operation: string[]
  classeurFilename: string
  classeur: Buffer
  chapitres: Record<string, ChapterDef>
  results: Record<string, ChapterResult>
  /** PDF effectivement téléchargés : nom de fichier → contenu. */
  pdfs: Map<string, Uint8Array>
}

function documentsAObtenir(results: Record<string, ChapterResult>): string {
  const lines: string[] = ['DOCUMENTS A OBTENIR', '==================', '']
  const allDocs = Object.values(results).flatMap((r) => r.documents)
  const sansPdf = allDocs.filter((d) => !d.url)
  const nonDl = allDocs
    .filter((d) => d.url && d.filename !== '—')
    .filter((d) => d.download_error || !d.downloaded)

  lines.push('A. PRODUITS SANS FICHE PDF OFFICIELLE')
  for (const d of sansPdf) {
    lines.push(
      ` - [${d.chap} ${d.code}] ${d.designation} — ${d.marque} ${d.reference}`,
    )
  }
  lines.push('', 'A bis. LIENS NON TELECHARGES')
  for (const d of nonDl) {
    lines.push(
      ` - ${d.filename} — ${d.url} (${d.download_error ?? 'non téléchargé'})`,
    )
  }

  const moe: string[] = []
  const fab: string[] = []
  for (const res of Object.values(results)) {
    for (const o of res.a_obtenir) {
      const line = ` - ${o.document}${o.fabricant ? ` (${o.fabricant})` : ''} — ${o.raison}`
      ;(o.origine === 'moe' ? moe : fab).push(line)
    }
  }
  lines.push(
    '',
    'B. DOCUMENTS A DEMANDER A LA MOE / MOA',
    ...moe,
    '',
    'C. DOCUMENTS A DEMANDER AUX FABRICANTS',
    ...fab,
  )

  lines.push('', 'D. ECARTS BLOQUANTS')
  for (const res of Object.values(results)) {
    for (const e of res.ecarts.filter((x) => x.criticite === 'BLOQUANT')) {
      lines.push(` - [${e.code}] ${e.objet} — ${e.action}`)
    }
  }
  return lines.join('\n')
}

function arborescence(input: DeliverableInput): string {
  const lines = [
    input.dossierLot + (input.variante ? ` - ${input.variante}` : ''),
    ...input.operation,
    ...FOLDERS.map((f) => `+-- ${f}`),
  ]
  return lines.join('\n')
}

/**
 * Arborescence de livraison « format Bures » (dossiers 00 → 06) en ZIP.
 * Les PDF sont classés automatiquement sur le type en fin de nom de fichier.
 */
/** Segment de chemin ZIP compatible tous décompresseurs : ASCII pur (accents
 *  dépliés, « — » → « - »), mais la ponctuation ASCII légale (virgules…)
 *  est conservée pour garder des noms lisibles. */
export function zipSafeSegment(seg: string): string {
  return (
    seg
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\x20-\x7e]/g, '-')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^\.+$/, '_')
      .trim() || '_'
  )
}

/** Budget de chemin total par entrée ZIP : l'Explorateur Windows refuse
 *  d'extraire au-delà de MAX_PATH (260 c) et le dossier de destination
 *  ajoute sa propre longueur — on vise 200. Des entrées à 377 c rendaient
 *  les livrables inextractibles (« le ZIP ne marche pas »). */
export const ZIP_MAX_PATH = 200

export function buildDeliveryZip(input: DeliverableInput): Uint8Array {
  // Noms d'entrées en ASCII : les accents restent lisibles dans le contenu
  // des fichiers texte, mais certains décompresseurs Windows refusent les
  // chemins UTF-8 — le ZIP doit s'ouvrir partout.
  const zp = (path: string) => path.split('/').map(zipSafeSegment).join('/')
  // Racine courte : le libellé complet du lot (« LOT 01 - DEMOLITIONS,
  // TERRASSEMENTS, … », 135 c) explosait le budget de chemin à lui seul.
  const root = zp(
    shortText(
      (input.dossierLot + (input.variante ? ` - ${input.variante}` : '')).replace(
        /[/\\:*?"<>|]/g,
        '',
      ),
      48,
    ),
  ) + '/'
  const files: Record<string, ZippableFile> = {}

  /** Entrée « dossier/fichier » dont le chemin total tient dans le budget :
   *  le nom est tronqué (extension préservée) puis dédupliqué si la
   *  troncature crée une collision. */
  const entry = (folder: string, filename: string): string => {
    const f = zp(folder)
    let n = zp(filename)
    const budget = ZIP_MAX_PATH - root.length - f.length - 1
    if (n.length > budget) {
      const ext = n.match(/\.[A-Za-z0-9]{2,6}$/)?.[0] ?? ''
      n =
        n
          .slice(0, Math.max(16, budget - ext.length))
          .replace(/[\s.,;:_-]+$/, '') + ext
    }
    if (files[`${root}${f}/${n}`]) {
      const ext = n.match(/\.[A-Za-z0-9]{2,6}$/)?.[0] ?? ''
      const base = ext ? n.slice(0, -ext.length) : n
      for (let i = 2; ; i++) {
        const cand = `${base} (${i})${ext}`
        if (cand.length <= budget && !files[`${root}${f}/${cand}`]) {
          n = cand
          break
        }
      }
    }
    return `${root}${f}/${n}`
  }

  files[root + '_ARBORESCENCE.txt'] = txt(arborescence(input))
  files[entry('00 - Liste des marques', input.classeurFilename)] =
    new Uint8Array(input.classeur)
  files[
    root + '06 - A valider ou documents manquants/_DOCUMENTS A OBTENIR.txt'
  ] = txt(documentsAObtenir(input.results))
  for (const f of FOLDERS) {
    files[`${root}${zp(f)}/_LISEZ-MOI.txt`] = txt(lisezMoi(f, input))
  }

  for (const res of Object.values(input.results)) {
    for (const d of res.documents) {
      const pdf = d.filename !== '—' ? input.pdfs.get(d.filename) : undefined
      if (!pdf) continue
      // Les PDF sont déjà compressés (images/flate) : re-déflater à level 6
      // coûte du CPU pour ~0 % de gain — on les stocke (level 0), les textes
      // restent compressés.
      files[entry(folderForDocType(d.type_document), d.filename)] = [
        pdf,
        { level: 0 },
      ]
    }
  }

  return zipSync(files, { level: 6 })
}
