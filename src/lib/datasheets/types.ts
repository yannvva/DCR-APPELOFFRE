/** Types du pipeline « Fiches techniques / Liste des marques » DCR. */

export const DOC_TYPES = [
  'Fiche_technique',
  'Notice_de_pose',
  'Notice_produit',
  'Documentation_technique',
  'Guide',
  'Avis_Technique',
  'DTA',
  'Certificat',
  'Certification',
  'DoP',
  'Declaration_UE_conformite',
  'PV',
  'FDES',
  'FDS',
] as const

export type DocType = (typeof DOC_TYPES)[number]

/** Phrase exacte DCR quand aucun PDF officiel n'a été trouvé. */
export const PDF_NON_TROUVE =
  'Fiche technique PDF officielle non trouvée à ce stade — validation fournisseur/fabricant nécessaire'

export type ProductStatus = 'OK' | 'À VALIDER' | 'NON CONFORME'

export interface DatasheetProduct {
  /** § CCTP (ex. "2.2.1.2d") ou "" pour une ligne de sous-titre. */
  code: string
  designation: string
  marque: string // '—' = prestation sans produit / aucune marque retenue
  reference: string
  statut: ProductStatus
}

export interface DatasheetDoc {
  chap: string
  code: string
  designation: string
  marque: string
  reference: string
  type_document: DocType
  /** Nom imposé : "01a-2.2.1.2d - Extracteur - MARQUE - Ref - Fiche_technique.pdf" */
  filename: string // '—' si pas de PDF
  url: string // '' si non trouvé
  source: string
  statut: string // 'OK' | 'À VALIDER' | 'NON CONFORME' | `À VALIDER | ${PDF_NON_TROUVE}`
  /** Rempli après téléchargement dans le bucket documents. */
  document_id?: string
  downloaded?: boolean
  download_error?: string
}

/** Référence normative (DTU, NF EN, Eurocode, guide CSTB…) : le document est
 *  une norme payante ou une prescription de CCTP — il n'existe pas de fiche
 *  PDF fabricant à télécharger. */
const NORM_REF =
  /^\s*(dtu|nf\b|nfen|nf en|nf p|en \d|iso|eurocode|ec\d|bael|reef|cstb|unm|u\.n\.m|afnor|setra|cerib|xpg?|xp p|dta|atec|règles? pro)/i

/** Ce document désigne-t-il un produit fabricant identifiable (donc une fiche
 *  PDF potentiellement téléchargeable) ? Sans marque NI référence produit,
 *  c'est une prescription CCTP : chercher sur le web ne donnera rien. */
export function isProductDocument(d: {
  marque: string
  reference: string
}): boolean {
  const marque = d.marque.trim()
  // Un organisme normatif (« CSTB », « U.N.M. », « AFNOR ») n'est pas un
  // fabricant — ses documents sont des normes, pas des fiches produit.
  if (marque && marque !== '—' && !NORM_REF.test(marque)) return true
  const ref = d.reference.trim()
  if (!ref || ref === '—') return false
  return !NORM_REF.test(ref)
}

export interface DatasheetConformite {
  chap: string
  code: string
  exigence: string
  donnee_fabricant: string
  conforme: 'Oui' | 'Non' | 'À vérifier'
  commentaire?: string
}

export type EcartCriticite = 'BLOQUANT' | 'MAJEUR' | 'MINEUR'

export interface DatasheetEcart {
  criticite: EcartCriticite
  code: string
  objet: string
  constat: string
  action: string
}

export interface DatasheetToObtain {
  origine: 'moe' | 'fabricant'
  document: string
  fabricant?: string
  raison: string
  /** Chapitre du dépouillement d'où vient la demande (traçabilité). */
  chap?: string
}

/** Résultat d'un agent de recherche pour un chapitre (= res_XX.md structuré). */
export interface ChapterResult {
  produits: DatasheetProduct[]
  documents: DatasheetDoc[]
  conformite: DatasheetConformite[]
  ecarts: DatasheetEcart[]
  a_obtenir: DatasheetToObtain[]
}

export const EMPTY_CHAPTER_RESULT: ChapterResult = {
  produits: [],
  documents: [],
  conformite: [],
  ecarts: [],
  a_obtenir: [],
}

/** Exigence produit relevée dans le CCTP (§ + texte + marques éventuelles). */
export interface ChapterRequirement {
  code: string
  texte: string
  marques_imposees: string[]
}

export interface ChapterDef {
  onglet: string
  libelle: string
  exigences: ChapterRequirement[]
}

export interface DatasheetConfig {
  /** Lignes d'en-tête affichées dans le classeur (opération, MOA/MOE, remise). */
  operation: string[]
  /** Nom court de l'opération (ex. "ABEILLE CAMUS") — préfixe du classeur Excel. */
  operationShort?: string
  /** Variantes du lot (ex. ["ECOLE NORD","ECOLE SUD"]) — [] = un seul dossier. */
  variantes: string[]
}

export interface DownloadEntry {
  ok: boolean
  reason?: string
  document_id?: string
  size?: number
}

/** Dossier de l'arborescence de livraison (format Bures) pour un type de doc. */
export function folderForDocType(t: DocType): string {
  switch (t) {
    case 'FDS':
      return '05 - FDS'
    case 'Notice_de_pose':
      return '02 - Notices de pose'
    case 'Avis_Technique':
    case 'DTA':
    case 'Certificat':
    case 'Certification':
    case 'DoP':
    case 'Declaration_UE_conformite':
    case 'PV':
      return '03 - PV, avis techniques et certifications'
    case 'FDES':
      return '04 - FDES et environnement'
    default:
      return '01 - Fiches techniques'
  }
}
