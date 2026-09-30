import { describe, expect, it } from 'vitest'
import { isGeneratedDoc, isAnalyzable } from '@/lib/dce/source-docs'

describe('isGeneratedDoc — exclusion des sorties de pipeline du corpus DCE', () => {
  it('exclut les DC1/DC2 générés (document_type), même sur ancien chemin', () => {
    expect(
      isGeneratedDoc({
        storage_path: 'org_1/abc/DC1_—_marché.docx',
        document_type: 'dc1',
      }),
    ).toBe(true)
    expect(
      isGeneratedDoc({
        storage_path: 'org_1/abc/DC2_—_Lot_2.docx',
        document_type: 'dc2',
      }),
    ).toBe(true)
  })

  it('exclut les sorties datasheets et mémoire par préfixe de chemin', () => {
    for (const p of [
      'org_1/datasheets/run_1/f-Fiche.pdf',
      'org_1/memoire/run_2/f-content_01.py',
      'org_1/dc/f-DC1.docx',
    ]) {
      expect(isGeneratedDoc({ storage_path: p })).toBe(true)
    }
  })

  it('exclut les types générés (mémoire, livrables) quel que soit le chemin', () => {
    for (const t of ['content_py', 'memoire_docx', 'Classeur_DCR', 'Arborescence_livraison']) {
      expect(isGeneratedDoc({ storage_path: 'org_1/x/fichier', document_type: t })).toBe(true)
    }
  })

  it('exclut les pièces du kit candidature société rattachées au dossier', () => {
    // attachCompanyDocsToChecklist lie les Kbis/URSSAF/références au tender
    // via document_links — sans filtre category ils pollueraient le corpus DCE.
    for (const name of ['DCR - Kbis.pdf', 'DCR - Attestation URSSAF.pdf']) {
      expect(
        isGeneratedDoc({
          storage_path: `org_1/x/${name}`,
          category: 'societe',
        }),
      ).toBe(true)
    }
  })

  it('conserve les vraies pièces du DCE', () => {
    for (const d of [
      { storage_path: 'org_1/x/RC.pdf', document_type: 'rc' },
      { storage_path: 'org_1/x/CCTP.pdf', document_type: null },
      { storage_path: 'org_1/x/DPGF.xlsx', document_type: 'dpgf' },
    ]) {
      expect(isGeneratedDoc(d)).toBe(false)
    }
  })
})

describe('isAnalyzable', () => {
  it('accepte les formats DCE', () => {
    expect(isAnalyzable('application/pdf', 'rc.pdf')).toBe(true)
    expect(isAnalyzable(null, 'cctp.docx')).toBe(true)
    expect(isAnalyzable(null, 'dpgf.xlsx')).toBe(true)
  })
  it('rejette images et binaires', () => {
    expect(isAnalyzable('image/png', 'plan.png')).toBe(false)
    expect(isAnalyzable(null, 'photo.jpg')).toBe(false)
  })
})
