import 'server-only'

import { completeJson } from '@/lib/ai/deepseek'
import type { ExtractedDoc } from '@/lib/dce/types'
import type { ChapterDef } from './types'

// Le CCTP porte l'essentiel des exigences produits ; CCAP/DPGF complètent.
const DOC_BUDGET: Partial<Record<ExtractedDoc['docType'], number>> = {
  cctp: 90_000,
  ccap: 25_000,
  ccag: 8_000,
  dpgf: 25_000,
  bpu: 8_000,
  annexe: 10_000,
  rc: 8_000,
  autre: 5_000,
}
const TOTAL_BUDGET = 170_000
const MAX_DOCS = 25

const SYSTEM = `Tu es un conducteur d'opération senior (entreprise BTP française) spécialisé
dans la réponse aux marchés publics. On te fournit les pièces textuelles d'un DCE
pour UN LOT donné. Ta mission : dépouiller le CCTP (et les pièces complémentaires)
pour préparer le dossier « Liste des marques / fiches techniques ».

Règles impératives :
- Réponds UNIQUEMENT en JSON valide, sans markdown.
- Ne devine jamais : chaque exigence citée doit apparaître dans les pièces fournies,
  avec son paragraphe CCTP exact dans "code".
- Releve TOUTES les exigences produits/matériels : épaisseurs, classes, normes,
  performances, certifications exigées, essais, EPI, matériels de chantier.
- Pour chaque exigence, liste dans "marques_imposees" les marques citées par le CCTP
  (« type X ou équivalent ») — tableau vide si le CCTP n'impose rien.
- Regroupe les exigences en chapitres logiques de mise en œuvre (familles de produits)
  avec un code court unique (01a, 01b, 01c…) et un libellé en majuscules.
- Le "code" de chaque exigence est le § CCTP EXACT et unique : il sert de clé de
  traçabilité aux fiches techniques du dossier (une fiche est rattachée à une
  exigence par ce code). Ne le reformule jamais, ne le laisse jamais vide.
- Distingue bien les exigences de PRODUIT (matériau/matériel identifiable, avec
  marque ou référence commerciale possible) des exigences de MISE EN ŒUVRE
  (procédé, mode opératoire, essai, plan) : les deux sont utiles, mais seules les
  premières donnent lieu à des fiches techniques fabricant.
- "doutes" : incohérences CCTP ↔ DPGF, normes périmées, pièces citées mais absentes.`

const USER_TEMPLATE = `Lot concerné : %LOT%
%VARIANTES%

Dépouille les pièces ci-dessous et retourne un JSON de cette forme exacte :

{
  "chapitres": {
    "01a": {
      "onglet": "01a Confinement",
      "libelle": "INSTALLATIONS ET PROTECTIONS COLLECTIVES",
      "exigences": [
        { "code": "2.2.1.2a", "texte": "film polyéthylène 200 µm…", "marques_imposees": ["POLYANE"] }
      ]
    }
  },
  "doutes": ["string — écarts/incohérences relevés à la lecture"]
}

=== PIÈCES DU DCE ===
%DOCS%`

export interface DatasheetBrief {
  chapitres: Record<string, ChapterDef>
  doutes: string[]
}

export interface BriefResult {
  brief: DatasheetBrief
  model: string
  usage: { inputTokens: number; outputTokens: number }
  files: { name: string; chars: number }[]
}

/**
 * Échantillonnage d'une pièce qui dépasse son budget : tête + queue plutôt que
 * troncation frontale — les exigences produits d'un CCTP sont souvent en fin
 * de document (prescriptions techniques par famille de travaux).
 */
function sampleText(text: string, budget: number): string {
  if (text.length <= budget) return text
  const head = Math.floor(budget * 0.75)
  return `${text.slice(0, head)}\n[…] extrait intermédiaire omis […]\n${text.slice(-(budget - head))}`
}

/** Étape « dépouillage » : textes DCE → exigences produits par chapitre. */
export async function extractRequirements(
  docs: ExtractedDoc[],
  lotLabel: string,
  variantes: string[],
): Promise<BriefResult> {
  const pertinent = docs.filter((d) => (DOC_BUDGET[d.docType] ?? 0) > 0)
  if (!pertinent.length) {
    throw new Error('Aucune pièce technique (CCTP/CCAP/DPGF) lisible dans les documents liés.')
  }

  // À budget constant, les pièces taguées du lot de l'affaire passent avant
  // celles des autres lots (un CCTP « lot 2 » ne doit pas consommer le budget
  // quand on dépouille le lot 1). Même logique que lib/memoire/analyze.ts.
  const runLot = Number(
    lotLabel.match(/lot\s*n?[°o]?\s*0*(\d{1,2})/i)?.[1] ?? lotLabel.match(/\d{1,2}/)?.[0],
  )
  const lotRank = (d: ExtractedDoc) =>
    runLot && d.lots?.length ? (d.lots.includes(runLot) ? 0 : 2) : 1
  const ORDER: ExtractedDoc['docType'][] = [
    'cctp', 'dpgf', 'bpu', 'ccap', 'ccag', 'annexe', 'rc', 'autre',
  ]
  pertinent.sort(
    (a, b) =>
      lotRank(a) - lotRank(b) ||
      ORDER.indexOf(a.docType) - ORDER.indexOf(b.docType) ||
      a.name.localeCompare(b.name, 'fr'),
  )

  let remaining = TOTAL_BUDGET
  const used: { name: string; chars: number }[] = []
  const chunks: string[] = []
  for (const doc of pertinent.slice(0, MAX_DOCS)) {
    const budget = Math.min(DOC_BUDGET[doc.docType] ?? 5_000, remaining)
    if (budget < 2_000) break
    const text = sampleText(doc.text, budget)
    const lotTag = doc.lots?.length ? ` — lots : ${doc.lots.join(', ')}` : ''
    const cut = text.length < doc.text.length || doc.truncated
    chunks.push(`\n--- PIÈCE : ${doc.name} [${doc.docType}${lotTag}]${cut ? ' (tronquée)' : ''} ---\n${text}`)
    used.push({ name: doc.name, chars: text.length })
    remaining -= text.length
  }

  const prompt = USER_TEMPLATE.replace('%LOT%', lotLabel)
    .replace('%VARIANTES%', variantes.length ? `Variantes : ${variantes.join(', ')}` : '')
    .replace('%DOCS%', chunks.join('\n'))

  const { data, model, usage } = await completeJson<DatasheetBrief>({
    system: SYSTEM,
    prompt,
    maxTokens: 16_000,
  })

  // Normalisation défensive : chapitres sans exigences = ignorés
  const chapitres: Record<string, ChapterDef> = {}
  for (const [code, ch] of Object.entries(data.chapitres ?? {})) {
    if (!ch || typeof ch !== 'object') continue
    chapitres[code] = {
      onglet: String(ch.onglet ?? code).slice(0, 60),
      libelle: String(ch.libelle ?? '').slice(0, 120),
      exigences: (ch.exigences ?? [])
        .filter((e) => e && typeof e.texte === 'string' && e.texte.trim())
        .map((e) => ({
          code: String(e.code ?? '').slice(0, 30),
          texte: e.texte.slice(0, 1000),
          marques_imposees: Array.isArray(e.marques_imposees)
            ? e.marques_imposees.map(String).slice(0, 10)
            : [],
        })),
    }
  }
  if (!Object.keys(chapitres).length) {
    throw new Error('Aucune exigence produit détectée dans le CCTP de ce lot.')
  }

  return {
    brief: { chapitres, doutes: (data.doutes ?? []).map(String).slice(0, 30) },
    model,
    usage,
    files: used,
  }
}
