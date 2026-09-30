/** Types du pipeline d'analyse de DCE (dossier de consultation des entreprises). */

export type DceDocType =
  | 'rc' // règlement de consultation
  | 'cctp'
  | 'ccap'
  | 'ccag'
  | 'ae' // acte d'engagement
  | 'bpu'
  | 'dpgf' // DQE
  | 'annexe'
  | 'autre'

/** Libellés d'affichage des types de pièces DCE. */
export const DCE_DOC_TYPE_LABELS: Record<DceDocType, string> = {
  rc: 'RC',
  cctp: 'CCTP',
  ccap: 'CCAP',
  ccag: 'CCAG',
  ae: "Acte d'engagement",
  bpu: 'BPU',
  dpgf: 'DPGF / DQE',
  annexe: 'Annexe',
  autre: 'Autre pièce DCE',
}

export interface ExtractedDoc {
  name: string
  docType: DceDocType
  text: string
  truncated: boolean
  /** Lots auxquels la pièce se rattache (détectés depuis le chemin/nom). */
  lots?: number[]
}

/** Pièce ignorée (format non lisible) — remontée à l'utilisateur. */
export interface SkippedDoc {
  name: string
  reason: string
}

export interface DceRequiredDocument {
  label: string
  category: 'dce' | 'administratif' | 'technique' | 'financier' | 'memoire' | 'depot' | 'autre'
  requirement: 'obligatoire' | 'recommande' | 'facultatif'
  requires_signature: boolean
  requires_chiffrage: boolean
  /** Lot concerné si la pièce n'est exigée que pour certains lots (sinon = tous). */
  lot?: number
  /** Traçabilité : document et extrait d'où vient l'exigence. */
  source?: string
}

export interface DceAnalysis {
  /** Synthèse exécutive (quelques phrases). */
  summary: string
  identification: {
    title?: string
    reference?: string
    buyer?: string
    platform?: string
    published_at?: string // YYYY-MM-DD
    region?: string
    procedure_type?: string
    market_type?: 'travaux' | 'fournitures' | 'services' | 'mixte'
    deposit_mode?: 'electronique' | 'papier' | 'hybride'
    duration_months?: number
    estimated_amount_euros?: number
  }
  deadlines: {
    response_deadline?: string // ISO 8601
    questions_deadline?: string
    site_visit?: {
      mandatory: boolean
      /** Première/principale date de visite (ISO). */
      date?: string
      /** Toutes les dates de visite proposées (ISO) — certains RC en imposent plusieurs. */
      dates?: string[]
      /** Modalités : inscription obligatoire, lieu du RDV, pièces à apporter, contact. */
      access?: string
      details?: string
    }
    offer_validity?: string
    other?: { label: string; date: string }[]
  }
  award_criteria: { label: string; weight_pct?: number }[]
  lots: {
    number: number
    title: string
    amount_euros?: number
    /** Durée d'exécution propre au lot si précisée. */
    duree?: string
    /** Variantes autorisées/interdites pour ce lot. */
    variantes?: string
  }[]
  required_documents: DceRequiredDocument[]
  contacts: { name?: string; email?: string; phone?: string; role?: string }[]
  risks: { severity: 'bloquante' | 'critique' | 'importante' | 'info'; message: string }[]
  go_nogo: {
    favorable_signals: string[]
    blocking_signals: string[]
    recommendation?: string
  }
}
