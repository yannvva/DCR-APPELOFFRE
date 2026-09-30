import 'server-only'

import { completeJson } from '@/lib/ai/deepseek'
import type { ExtractedDoc } from '@/lib/dce/types'
import { EMPTY_ANALYSIS } from './types'
import type { MemoireAnalysis } from './types'

// Le mémoire cite partout : critères du RC, pénalités du CCAP, prescriptions
// du CCTP, postes de la DPGF et phases du planning → budgets généreux.
const DOC_BUDGET: Partial<Record<ExtractedDoc['docType'], number>> = {
  rc: 60_000,
  cctp: 90_000,
  ccap: 45_000,
  ccag: 15_000,
  dpgf: 50_000,
  bpu: 15_000,
  annexe: 20_000,
  ae: 5_000,
  autre: 8_000,
}
// deepseek-chat : contexte 64K tokens — ~140k caractères français ≈ 45k tokens
// (marge pour le système, le gabarit et la réponse JSON).
const TOTAL_BUDGET = 140_000
const MAX_DOCS = 30

const SYSTEM = `Tu es le conducteur de travaux senior de DCR (entreprise générale de
bâtiment) qui prépare le mémoire technique d'une réponse à appel d'offres public.
Avant toute rédaction, tu remplis la FICHE D'ANALYSE du dossier de consultation.

Règles impératives :
- Réponds UNIQUEMENT en JSON valide, sans markdown.
- Chaque donnée doit provenir des pièces fournies, citée avec sa valeur EXACTE
  (montants de pénalités, points des critères, durées, dates, repères DPGF).
- Ne devine JAMAIS : une donnée absente va dans "manquants", pas dans le reste.
- "couverture" : reprends les formulations EXACTES du RC (maître d'ouvrage,
  intitulé de l'opération et du lot, référence de la consultation, date limite
  de remise avec plateforme ou visite si mentionnée).
- "criteres" : TOUS les critères et sous-critères de jugement avec leurs points
  ou pourcentages exacts — ils titreront les sections du mémoire.
- "exigences_rc" : tout ce que le RC impose au mémoire (cadre, planning avec
  effectifs par tâche, plan d'installation propre au lot, fréquence de visite
  du conducteur de travaux, note éliminatoire…).
- "penalites" : TOUTES les pénalités du CCAP avec montants (retard, réunions,
  documents/DOE, tri/nettoyage, badges, insertion, signalisation…).
- "conditions_marche" : prix ferme/révisable/actualisable + index BT, avance,
  retenue de garantie, réception unique ou partielle, clause sociale
  (heures d'insertion), chartes environnementales.
- "planning_phases" : phases datées avec durées réelles du planning du DCE.
- "consistence" : les familles de travaux du lot, repérées par les postes DPGF.
- "footer.suffixe_lot" commence obligatoirement par " n°" suivi du numéro de
  lot puis " : " puis l'intitulé court (ex. " n°1 : Gros œuvre — Carrelage").
- "visite" : obligatoire/recommandée, date, contact, attestation à joindre.
- "prix" : ferme/actualisable/révisable + indice BT, avance, retenue de garantie.
- "reception" : unique tous lots ou partielle, remise en état, délais DOE.
- "clauses" : clause sociale (heures d'insertion) et environnementale (chartes).
- "geotechnique" : rapport G2/G3 — aléas, succession de sols, préconisations.
- "pieces_a_remettre" : pièces exigées par le RC (DPGF Excel, attestations,
  DC4, cadre de mémoire imposé…).
- Les pièces taguées « — lots : N » sont propres à ces lots : pour la
  consistence, les montants et les postes, utilise UNIQUEMENT celles du lot
  de l'affaire demandée. Les pièces sans tag sont communes à tous les lots.`

const USER_TEMPLATE = `Affaire : %LOT%

Dépouille les pièces du DCE ci-dessous et retourne un JSON de cette forme exacte :

{
  "couverture": { "moa": "", "operation": "", "lot": "", "reference": "", "remise": "" },
  "footer": { "operation_courte": "", "suffixe_lot": "" },
  "intervenants": ["rôle : nom — …"],
  "criteres": ["Prix — 40 %", "Méthodologie — 20 pts", "…"],
  "exigences_rc": ["…"],
  "penalites": ["retard : P = V × R / 3000", "absence réunion : 300 €", "…"],
  "conditions_marche": ["prix fermes et actualisables (BT01)", "avance 5 %", "réception unique tous lots", "…"],
  "delai_global": "12 mois dont 2 de préparation",
  "planning_phases": ["Préparation — mois 1-2 (40 j)", "…"],
  "jalons": ["Fin GO — mois 8", "Réception unique — mois 12", "…"],
  "contrainte_site": "…",
  "consistence": ["2.2 Curage complet …", "2.3 Terrassements …", "…"],
  "interfaces": ["Lot 02 étanchéité : rehausses acrotères entre dépose et réfection", "…"],
  "options": ["Option n°01 : banque d'accueil", "…"],
  "marques_prescrites": ["THIRARD (organigramme existant)", "…"],
  "visite": "obligatoire le 14/08/2026 à 14h00 — attestation à joindre",
  "prix": "ferme et non révisable — avance 5 %, retenue de garantie 5 %",
  "reception": "réception unique tous lots — DOE sous 30 jours",
  "clauses": ["insertion : 5 % des heures", "charte chantier propre"],
  "geotechnique": "G2 PRO : aléa fort retrait-gonflement des argiles, pieux conseillés",
  "pieces_a_remettre": ["DPGF Excel signée", "attestation de visite", "…"],
  "manquants": ["planning détaillé non fourni", "…"]
}

=== PIÈCES DU DCE ===
%DOCS%`

export interface AnalysisResult {
  analysis: MemoireAnalysis
  model: string
  usage: { inputTokens: number; outputTokens: number }
  files: { name: string; chars: number }[]
}

/** Tête + queue pour les pièces qui dépassent leur budget — les exigences
 *  fin de CCTP (prescriptions techniques) ne doivent pas être perdues. */
function sampleText(text: string, budget: number): string {
  if (text.length <= budget) return text
  const head = Math.floor(budget * 0.75)
  return `${text.slice(0, head)}\n[…] extrait intermédiaire omis […]\n${text.slice(-(budget - head))}`
}

function strArray(v: unknown, max = 60, itemMax = 600): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map((x) => x.slice(0, itemMax))
    .slice(0, max)
}

function normalize(raw: unknown): MemoireAnalysis {
  const r = (raw ?? {}) as Record<string, unknown>
  const cov = (r.couverture ?? {}) as Record<string, unknown>
  const ft = (r.footer ?? {}) as Record<string, unknown>
  const s = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max)

  let suffixe = s(ft.suffixe_lot, 160)
  if (suffixe && !suffixe.startsWith(' ')) suffixe = ` ${suffixe}`
  if (suffixe && !/ n°/i.test(suffixe) && s(cov.lot)) {
    const m = s(cov.lot).match(/lot\s*n?[°o]?\s*(\w+)/i)
    if (m) suffixe = ` n°${m[1]} : ${suffixe.replace(/^n°\w+\s*:?\s*/i, '')}`
  }

  return {
    couverture: {
      moa: s(cov.moa, 200),
      operation: s(cov.operation, 200),
      lot: s(cov.lot, 200),
      reference: s(cov.reference, 200),
      remise: s(cov.remise, 200),
    },
    footer: { operation_courte: s(ft.operation_courte, 150), suffixe_lot: suffixe },
    intervenants: strArray(r.intervenants, 15),
    criteres: strArray(r.criteres, 15),
    exigences_rc: strArray(r.exigences_rc, 20),
    penalites: strArray(r.penalites, 30),
    conditions_marche: strArray(r.conditions_marche, 15),
    delai_global: s(r.delai_global, 200),
    planning_phases: strArray(r.planning_phases, 20),
    jalons: strArray(r.jalons, 10),
    contrainte_site: s(r.contrainte_site, 800),
    consistence: strArray(r.consistence, 40, 800),
    interfaces: strArray(r.interfaces, 20),
    options: strArray(r.options, 15),
    marques_prescrites: strArray(r.marques_prescrites, 20),
    visite: s(r.visite, 400),
    prix: s(r.prix, 400),
    reception: s(r.reception, 400),
    clauses: strArray(r.clauses, 10),
    geotechnique: s(r.geotechnique, 800),
    pieces_a_remettre: strArray(r.pieces_a_remettre, 20),
    manquants: strArray(r.manquants, 20),
  }
}

/** Étape « dépouillage » du pipeline mémoire : textes DCE → fiche d'analyse. */
export async function analyzeForMemoire(
  docs: ExtractedDoc[],
  lotLabel: string,
): Promise<AnalysisResult> {
  const pertinent = docs.filter((d) => (DOC_BUDGET[d.docType] ?? 0) > 0)
  if (!pertinent.length) {
    throw new Error('Aucune pièce lisible (RC, CCTP, CCAP, DPGF…) dans les documents liés.')
  }

  // Le lot du run prime : à budget constant, la DPGF/CCTP du lot concerné doit
  // passer avant celles des autres lots (sinon la « consistence » du mémoire
  // décrirait le mauvais lot). Pièces non taguées : neutres. Autres lots :
  // déprioritisés mais conservés (interfaces, contexte marché).
  const runLot = Number(
    lotLabel.match(/lot\s*n?[°o]?\s*0*(\d{1,2})/i)?.[1] ?? lotLabel.match(/\d{1,2}/)?.[0],
  )
  const lotRank = (d: ExtractedDoc) =>
    runLot && d.lots?.length ? (d.lots.includes(runLot) ? 0 : 2) : 1
  const ORDER: ExtractedDoc['docType'][] = [
    'rc', 'cctp', 'ccap', 'ccag', 'dpgf', 'bpu', 'annexe', 'ae', 'autre',
  ]
  pertinent.sort(
    (a, b) =>
      ORDER.indexOf(a.docType) - ORDER.indexOf(b.docType) ||
      lotRank(a) - lotRank(b) ||
      a.name.localeCompare(b.name, 'fr'),
  )

  let remaining = TOTAL_BUDGET
  const used: { name: string; chars: number }[] = []
  const chunks: string[] = []
  for (const doc of pertinent.slice(0, MAX_DOCS)) {
    const budget = Math.min(DOC_BUDGET[doc.docType] ?? 5_000, remaining)
    if (budget < 2_000) break
    const text = sampleText(doc.text, budget)
    const cut = text.length < doc.text.length
    const lotTag = doc.lots?.length ? ` — lots : ${doc.lots.join(', ')}` : ''
    chunks.push(
      `\n--- PIÈCE : ${doc.name} [${doc.docType}${lotTag}]${cut ? ' (extrait tronqué)' : ''} ---\n${text}`,
    )
    used.push({ name: doc.name, chars: text.length })
    remaining -= text.length
  }

  const prompt = USER_TEMPLATE.replace('%LOT%', lotLabel).replace('%DOCS%', chunks.join('\n'))

  const { data, model, usage } = await completeJson<unknown>({
    system: SYSTEM,
    prompt,
    maxTokens: 8_000,
  })

  const analysis = { ...EMPTY_ANALYSIS, ...normalize(data) }
  return { analysis, model, usage, files: used }
}
