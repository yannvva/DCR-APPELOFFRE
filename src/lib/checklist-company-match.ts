import type { CompanyDocumentRef } from '@/lib/company'

/**
 * Rattachement automatique checklist ↔ pièces société.
 *
 * Le kit candidature DCR est le même pour tous les marchés (Kbis, URSSAF,
 * attestations, DC1/DC2…) : ces règles associent le libellé d'une ligne de
 * checklist au `document_type` (et au nom, quand plusieurs pièces partagent
 * un type) de la pièce société correspondante.
 */

interface MatchRule {
  /** Motif testé sur le libellé de la ligne de checklist. */
  label: RegExp
  /** document_type attendu de la pièce société. */
  docType: string
  /** Motif optionnel sur le nom du fichier (désambiguïsation). */
  name?: RegExp
}

const MATCH_RULES: MatchRule[] = [
  { label: /dc1|candidature/i, docType: 'dc1' },
  { label: /dc2|déclaration du candidat|declaration du candidat/i, docType: 'dc2' },
  { label: /dc4|sous.?trait/i, docType: 'autre', name: /dc4|sous.?trait/i },
  { label: /kbis|\bk\s?bis\b|registre du commerce/i, docType: 'kbis' },
  { label: /urssaf|vigilance|attestation sociale/i, docType: 'urssaf' },
  { label: /fiscale|imp[oô]t|régularité fiscale/i, docType: 'attestation_fiscale' },
  {
    label: /décennale|decennale/i,
    docType: 'assurance',
    name: /rc|décennale|decennale|r\.?\s?c\.?\s?&?\s?d/i,
  },
  { label: /pro ?btp/i, docType: 'assurance', name: /pro ?btp/i },
  {
    label: /assurance|rc pro|responsabilité civile/i,
    docType: 'assurance',
    name: /rc|responsabilité|décennale|decennale/i,
  },
  { label: /cibtp|congés intempéries/i, docType: 'autre', name: /cibtp/i },
  { label: /rib|relevé d.identité bancaire|coordonnées bancaires|bancaire/i, docType: 'rib' },
  { label: /effectif/i, docType: 'autre', name: /effectif/i },
  { label: /honneur|non.?condamnation/i, docType: 'autre', name: /honneur/i },
  { label: /siret|inpi|identification.*entreprise/i, docType: 'autre', name: /siret|inpi/i },
  { label: /qualibat|qualification.*professionnelle/i, docType: 'qualification' },
  {
    label: /référence|reference|chantiers?|attestation.*(travaux|chantier|bonne exécution)/i,
    docType: 'reference',
  },
]

/**
 * Renvoie la meilleure pièce société pour un libellé de checklist, ou null.
 * Préférence : pièce non expirée, puis la plus récente (la liste est déjà
 * triée par created_at descendant).
 */
export function matchCompanyDocument(
  itemLabel: string,
  docs: CompanyDocumentRef[],
): CompanyDocumentRef | null {
  for (const rule of MATCH_RULES) {
    if (!rule.label.test(itemLabel)) continue
    const candidates = docs.filter(
      (d) =>
        d.document_type === rule.docType && (!rule.name || rule.name.test(d.name)),
    )
    if (!candidates.length) continue
    return candidates.find((d) => !d.expired) ?? candidates[0]
  }
  return null
}
