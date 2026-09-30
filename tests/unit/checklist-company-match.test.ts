import { describe, expect, it } from 'vitest'
import { matchCompanyDocument } from '@/lib/checklist-company-match'
import type { CompanyDocumentRef } from '@/lib/company'

function doc(
  name: string,
  document_type: string,
  overrides: Partial<CompanyDocumentRef> = {},
): CompanyDocumentRef {
  return {
    id: `${document_type}-${name}`,
    name,
    document_type,
    valid_until: null,
    expired: false,
    storage_path: `org/societe/${name}`,
    mime_type: 'application/pdf',
    is_signed: false,
    ...overrides,
  }
}

const KIT: CompanyDocumentRef[] = [
  doc('DC1 - TEMPLATE.doc', 'dc1'),
  doc('DC2 - TEMPLATE.doc', 'dc2'),
  doc('DCR - Kbis 15 05 2026.pdf', 'kbis'),
  doc('DCR - Attestation URSSAF - 05 03 2026.pdf', 'urssaf'),
  doc('DCR - Attestation de régularité fiscale 01 04 2026.pdf', 'attestation_fiscale'),
  doc('DCR - Attestation assurance RC & D 2026.pdf', 'assurance'),
  doc('DCR - Attestation PRO BTP 27 02 2026.PDF', 'assurance'),
  doc('DCR - Attestation CIBTP à jour.pdf', 'autre'),
  doc('DCR - RIB SG.pdf', 'rib'),
  doc('DCR - Tableau effectifs moyens annuels.pdf', 'autre'),
  doc('DCR - Attestation sur honneur.pdf', 'autre'),
  doc('DCR - Attestation SIRET INPI.pdf', 'autre'),
  doc('Dossier DC4 COMPLET.pdf', 'autre'),
  doc('DCR - Attestations QUALIBAT 2026.pdf', 'qualification'),
  doc('DCR - Références GO.pdf', 'reference'),
]

describe('matchCompanyDocument', () => {
  it('matche le kit candidature standard aux libellés de checklist', () => {
    const cases: [string, string][] = [
      ['Lettre de candidature — DC1', 'dc1'],
      ['Déclaration du candidat — DC2', 'dc2'],
      ['Extrait Kbis (< 3 mois)', 'kbis'],
      ['Attestation fiscale (< 6 mois)', 'attestation_fiscale'],
      ['Attestation sociale — vigilance URSSAF (< 6 mois)', 'urssaf'],
      ['Assurance décennale', 'assurance'],
      ['Références clients / chantiers', 'reference'],
      ['Documents sous-traitants / cotraitants', 'autre'],
    ]
    for (const [label, docType] of cases) {
      expect(matchCompanyDocument(label, KIT)?.document_type, label).toBe(docType)
    }
  })

  it('choisit la RC&D pour une ligne « assurance RC » (pas PRO BTP)', () => {
    const m = matchCompanyDocument('Assurance RC professionnelle', KIT)
    expect(m?.name).toContain('RC & D')
  })

  it('matche une ligne « PRO BTP » sur l’attestation PRO BTP (pas RC&D)', () => {
    const m = matchCompanyDocument("Attestation d'assurance PRO BTP", KIT)
    expect(m?.name).toContain('PRO BTP')
  })

  it('ne matche pas les pièces propres au marché', () => {
    for (const label of [
      'Règlement de consultation (RC) analysé',
      "Acte d'engagement (AE)",
      'Planning prévisionnel',
      'BPU / DPGF / DQE chiffrés',
      'Mémoire technique',
      'Dossier téléversé sur la plateforme de dépôt',
      'Récépissé de dépôt archivé',
    ]) {
      expect(matchCompanyDocument(label, KIT), label).toBeNull()
    }
  })

  it('préfère une pièce non expirée', () => {
    const docs = [
      doc('Kbis ancien.pdf', 'kbis', { id: 'old', expired: true }),
      doc('Kbis récent.pdf', 'kbis', { id: 'new' }),
    ]
    expect(matchCompanyDocument('Extrait Kbis', docs)?.id).toBe('new')
  })

  it('retombe sur une pièce expirée si c’est la seule disponible', () => {
    const docs = [doc('Kbis ancien.pdf', 'kbis', { expired: true })]
    expect(matchCompanyDocument('Extrait Kbis', docs)?.name).toBe('Kbis ancien.pdf')
  })

  it('renvoie null si le type requis est absent du référentiel', () => {
    expect(matchCompanyDocument('Extrait Kbis', [doc('RIB.pdf', 'rib')])).toBeNull()
  })
})
