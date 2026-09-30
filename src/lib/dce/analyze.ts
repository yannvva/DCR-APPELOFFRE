import 'server-only'

import { completeJson } from '@/lib/ai/deepseek'
import { normalizeAnalysis } from './normalize'
import type { DceAnalysis, DceDocType, ExtractedDoc } from './types'

// Budget caractères par type de pièce : le RC et le CCTP portent l'essentiel
// de l'information ; les annexes sont échantillonnées.
const DOC_BUDGET: Record<DceDocType, number> = {
  rc: 55_000,
  cctp: 40_000,
  ccap: 25_000,
  ccag: 10_000,
  ae: 10_000,
  dpgf: 8_000,
  bpu: 8_000,
  annexe: 5_000,
  autre: 6_000,
}
const TOTAL_BUDGET = 150_000
const MAX_DOCS = 25

const DOC_LABELS: Record<DceDocType, string> = {
  rc: 'Règlement de consultation',
  cctp: 'CCTP',
  ccap: 'CCAP',
  ccag: 'CCAG',
  ae: "Acte d'engagement",
  bpu: 'BPU',
  dpgf: 'DPGF/DQE',
  annexe: 'Annexe',
  autre: 'Autre',
}

const SYSTEM = `Tu es un expert français des marchés publics (code de la commande publique).
On te fournit les pièces textuelles d'un DCE (dossier de consultation des entreprises).
Ta mission : produire une analyse structurée fidèle, jamais inventée.

Règles impératives :
- Réponds UNIQUEMENT en JSON valide, sans markdown, sans commentaire.
- Ne devine jamais : si une information n'apparaît pas dans les pièces, laisse le champ absent (null/omis).
- Les dates au format ISO 8601 ("2026-10-15T14:00:00"). Si l'année manque, utilise l'année de publication.
- Pour chaque pièce exigée (required_documents), cite la source : nom du document + extrait court.
- required_documents = les pièces que le soumissionnaire DOIT produire dans sa réponse (DC1, DC2, AE signé, attestations, mémoire, BPU chiffré…), pas les pièces du DCE lui-même.
- risks : signale les points de vigilance réels (visite obligatoire, délai court, caution, variante interdite, clauses inhabituelles, incohérences entre pièces).
- site_visit : capture TOUTES les dates de visite proposées (dates[], pas seulement la première) et dans "access" les modalités complètes : inscription préalable (auprès de qui, avant quand), lieu du rendez-vous, pièces/EPI à apporter, justificatif à produire.
- contacts : toutes les personnes en charge mentionnées dans les pièces — contact acheteur/MOA, maître d'œuvre, support de la plateforme de dépôt, contact visite de site. role = leur fonction dans la consultation.
- lots : liste TOUS les lots du marché, même ceux auxquels l'entreprise ne répondrait pas, avec l'intitulé exact du RC ou de la DPGF. Pour chaque lot : duree (durée d'exécution propre si précisée, sinon durée globale) et variantes (autorisées/interdites, ou « non précisé »). Attention : les pièces sont souvent par lot (« DPGF lot 2 », dossier « LOT 3/… ») — rattache les montants à la bonne pièce.
- required_documents.lot : si une pièce n'est exigée QUE pour certains lots (DPGF/BPU propres à chaque lot, PPSPS du lot 3…), indique le numéro ; sinon ommets le champ (= exigence commune).
- summary : synthèse exécutive en 4-8 phrases — objet, enjeux, points critiques, contexte de la réponse.`

const USER_TEMPLATE = `Analyse ce DCE et retourne un JSON conforme à cette structure :

{
  "summary": "string — synthèse exécutive",
  "identification": {
    "title": "string", "reference": "string", "buyer": "string",
    "platform": "string", "published_at": "YYYY-MM-DD",
    "region": "string",
    "procedure_type": "string (ex: appel d'offres ouvert, MAPA, dialogue compétitif)",
    "market_type": "travaux | fournitures | services | mixte",
    "deposit_mode": "electronique | papier | hybride",
    "duration_months": number, "estimated_amount_euros": number
  },
  "deadlines": {
    "response_deadline": "ISO 8601 — date+heure limite de remise des offres",
    "questions_deadline": "ISO 8601",
    "site_visit": {
      "mandatory": boolean,
      "date": "ISO — première date de visite",
      "dates": ["ISO — toutes les dates de visite proposées"],
      "access": "modalités : inscription, lieu du RDV, pièces/EPI à apporter, contact visite",
      "details": "string"
    },
    "offer_validity": "string (ex: 180 jours)",
    "other": [{ "label": "string", "date": "ISO" }]
  },
  "award_criteria": [{ "label": "string", "weight_pct": number }],
  "lots": [{ "number": number, "title": "string", "amount_euros": number,
             "duree": "string", "variantes": "string" }],
  "required_documents": [{
    "label": "string",
    "category": "administratif | technique | financier | memoire | depot | autre",
    "requirement": "obligatoire | recommande | facultatif",
    "requires_signature": boolean,
    "requires_chiffrage": boolean,
    "lot": number (numéro du lot si l'exigence lui est propre, sinon omis),
    "source": "document + extrait justifiant l'exigence"
  }],
  "contacts": [{ "name": "string", "email": "string", "phone": "string", "role": "string" }],
  "risks": [{ "severity": "bloquante | critique | importante | info", "message": "string" }],
  "go_nogo": {
    "favorable_signals": ["string"],
    "blocking_signals": ["string"],
    "recommendation": "string"
  }
}

=== PIÈCES DU DCE ===
%DOCS%`

function buildPrompt(
  docs: ExtractedDoc[],
  knownLots?: { number: number; title: string }[],
): {
  prompt: string
  used: { name: string; type: DceDocType; chars: number; lots?: number[] }[]
  dropped: { name: string; type: DceDocType }[]
} {
  let remaining = TOTAL_BUDGET
  const used: { name: string; type: DceDocType; chars: number; lots?: number[] }[] = []
  const dropped: { name: string; type: DceDocType }[] = []
  const chunks: string[] = []

  for (const doc of docs) {
    if (used.length >= MAX_DOCS) {
      dropped.push({ name: doc.name, type: doc.docType })
      continue
    }
    const budget = Math.min(DOC_BUDGET[doc.docType], remaining)
    if (budget < 2_000) {
      dropped.push({ name: doc.name, type: doc.docType })
      continue
    }
    // Tête + queue plutôt que troncation frontale : contacts, visites et
    // échéances sont souvent en fin de RC/annexes.
    const text =
      doc.text.length <= budget
        ? doc.text
        : `${doc.text.slice(0, Math.floor(budget * 0.75))}\n[…] extrait intermédiaire omis […]\n${doc.text.slice(-(budget - Math.floor(budget * 0.75)))}`
    // « (extrait tronqué) » signale au LLM que la suite n'a pas été envoyée —
    // il ne doit pas conclure qu'une info est absente du document.
    const cut = text.length < doc.text.length
    const lotTag = doc.lots?.length ? ` — lots : ${doc.lots.join(', ')}` : ''
    chunks.push(
      `\n--- PIÈCE : ${doc.name} [${DOC_LABELS[doc.docType]}${lotTag}]${cut ? ' (extrait tronqué)' : ''} ---\n${text}`,
    )
    used.push({ name: doc.name, type: doc.docType, chars: text.length, lots: doc.lots })
    remaining -= text.length
  }

  // Les lots déjà saisis au dossier aident à normaliser numéros/intitulés.
  const known = knownLots?.length
    ? `\n=== LOTS DÉJÀ SAISIS AU DOSSIER ===\n${knownLots
        .map((l) => `Lot ${l.number} : ${l.title}`)
        .join('\n')}\n`
    : ''

  return {
    prompt: USER_TEMPLATE.replace('%DOCS%', chunks.join('\n') + known),
    used,
    dropped,
  }
}

export interface DceAnalysisResult {
  analysis: DceAnalysis
  model: string
  usage: { inputTokens: number; outputTokens: number }
  files: { name: string; type: DceDocType; chars: number; lots?: number[] }[]
  /** Pièces non envoyées au LLM (limite ou budget épuisé) — à signaler. */
  dropped: { name: string; type: DceDocType }[]
}

/** Analyse un ensemble de pièces DCE déjà extraites. */
export async function analyzeDce(
  docs: ExtractedDoc[],
  opts?: { knownLots?: { number: number; title: string }[] },
): Promise<DceAnalysisResult> {
  if (!docs.length) throw new Error('Aucune pièce lisible dans le DCE.')
  const { prompt, used, dropped } = buildPrompt(docs, opts?.knownLots)
  const { data, model, usage } = await completeJson<unknown>({
    system: SYSTEM,
    prompt,
    maxTokens: 8192,
  })
  return { analysis: normalizeAnalysis(data), model, usage, files: used, dropped }
}
