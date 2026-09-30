/** Types de l'étape 1 du pipeline mémoire technique DCR. */

/**
 * Fiche d'analyse du DCE — remplie par le LLM avant toute rédaction
 * (calque de 03_CHECKLIST_ANALYSE_DCE.md du pipeline DCR).
 */
export interface MemoireAnalysis {
  couverture: {
    /** Ex. "ESAT Marsoulan — 64-68 rue Robespierre, 93100 Montreuil" */
    moa: string
    /** Opération courte ≤ ~75 caractères */
    operation: string
    /** Ex. "Lot n°1 — Gros œuvre / Carrelage" */
    lot: string
    /** Ex. "Consultation 26.30 — MAPA" */
    reference: string
    /** Date limite de remise (+ visite éventuelle) */
    remise: string
  }
  footer: {
    /** Ex. "Ateliers du Pôle Compans — Montreuil (93)" */
    operation_courte: string
    /** Commence par " n°X : " — ex. " n°01 : Curage — Maçonnerie" */
    suffixe_lot: string
  }
  /** MOA, MOE/mandataire, BET, CT, CSPS, OPC, conduite d'opération… */
  intervenants: string[]
  /** Critères de jugement avec pondération exacte (ex. "Valeur technique — 20 pts") */
  criteres: string[]
  /** Exigences explicites du RC sur le mémoire (cadre imposé, planning, visites…) */
  exigences_rc: string[]
  /** Pénalités chiffrées du CCAP (objet + montant) */
  penalites: string[]
  /** Conditions du marché : prix ferme/révisable + index BT, avance, retenue
   *  de garantie, modalités de réception (unique/partielle), clause sociale. */
  conditions_marche: string[]
  delai_global: string
  /** Phases datées du planning (libellé + période/durée) */
  planning_phases: string[]
  /** Jalons nommés (fin GO, hors d'eau, OPR, réception…) */
  jalons: string[]
  /** Contrainte majeure du site (site occupé, emprise, bruit…) */
  contrainte_site: string
  /** Consistance des travaux poste par poste (repère DPGF + description) */
  consistence: string[]
  /** Interfaces / limites de prestations avec les autres lots */
  interfaces: string[]
  /** Options, variantes, PSE à chiffrer */
  options: string[]
  /** Marques/produits prescrits nommément par le CCTP */
  marques_prescrites: string[]
  /** Visite de site : obligatoire/recommandée, date, contact, attestation → [2.1, récap] */
  visite: string
  /** Prix : ferme/actualisable/révisable + index BT, avance, retenue de garantie → [5.4] */
  prix: string
  /** Réception : unique/partielle, remise en état, délais DOE → [4.6] */
  reception: string
  /** Clauses sociales (insertion) et environnementales (chartes) → [5.2, 5.4] */
  clauses: string[]
  /** Rapport géotechnique : aléas, sols, préconisations → [2.1, 2.2, méthodologie] */
  geotechnique: string
  /** Pièces à remettre exigées par le RC (DPGF Excel, attestations, DC4…) → [récap] */
  pieces_a_remettre: string[]
  /** Données nécessaires absentes du DCE (à signaler, jamais inventer) */
  manquants: string[]
}

export const EMPTY_ANALYSIS: MemoireAnalysis = {
  couverture: { moa: '', operation: '', lot: '', reference: '', remise: '' },
  footer: { operation_courte: '', suffixe_lot: '' },
  intervenants: [],
  criteres: [],
  exigences_rc: [],
  penalites: [],
  conditions_marche: [],
  delai_global: '',
  planning_phases: [],
  jalons: [],
  contrainte_site: '',
  consistence: [],
  interfaces: [],
  options: [],
  marques_prescrites: [],
  visite: '',
  prix: '',
  reception: '',
  clauses: [],
  geotechnique: '',
  pieces_a_remettre: [],
  manquants: [],
}
