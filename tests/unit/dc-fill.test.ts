import { describe, expect, it } from 'vitest'
import { zipSync, unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fillDcTemplate } from '@/lib/dc/fill'
import {
  dc1Checks,
  dc1Vars,
  dc2Vars,
  isPme,
  parseCaLine,
} from '@/lib/dc/data'
import type { DcContext } from '@/lib/dc/data'
import type { CompanyProfile } from '@/lib/company'

const DOC = 'word/document.xml'

function makeDocx(documentXml: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': new TextEncoder().encode('<Types/>'),
    [DOC]: new TextEncoder().encode(documentXml),
  })
}

function readDoc(docx: Uint8Array): string {
  return new TextDecoder().decode(unzipSync(docx)[DOC])
}

const CB_FIELD = (name: string) =>
  `<w:ffData><w:name w:val="${name}"/><w:enabled/><w:calcOnExit w:val="0"/><w:checkBox><w:default w:val="0"/></w:checkBox></w:ffData>`

const profile: CompanyProfile = {
  identite: {
    raison_sociale: 'Design Construction Renovation',
    forme_juridique: 'SASU',
    capital_euros: '50 000',
    siren: '823 633 862',
    siret: '823 633 862 00037',
    rcs_ville: 'Évry',
    code_ape: '4120A',
    tva_intracom: 'FR40823633862',
    date_creation: '2018',
  },
  siege: {
    adresse: '6 rue Jacquard, 91280 Saint-Pierre-du-Perray',
    telephone: '01 60 91 67 60',
    email: 'dcr@dcr-idf.fr',
    site_web: 'www.dcr-idf.fr',
  },
  dirigeant: { nom: 'YILDIRIM Mathieu', qualite: 'Président' },
  banque: { titulaire: '', domiciliation: '', iban: '', bic: '' },
  finance: {
    chiffre_affaires: [
      '2023 — 3 304 274 € — 43 %',
      '2024 — 3 696 185 € — 48 %',
      '2025 — 13 897 070 € — 54 %',
    ],
    effectif: '25',
    notation_bdf: '',
    agences_notation: '',
  },
  assurances: { lignes: ['Décennale — AXA'] },
  certifications: [],
  equipe: [],
  implantations: [],
  references: [],
  presentation: '',
}

const ctx: DcContext = {
  profile,
  tender: { title: 'Gymnase de Coupvray', reference: '2026-GYM', market_type: 'travaux' },
  buyerName: 'Commune de Coupvray',
  buyerAddress: ['Place de la Mairie', '77700 Coupvray'],
  lots: [{ number: 1, title: 'Gros œuvre' }],
  totalLots: 3,
}

describe('fillDcTemplate — placeholders', () => {
  it('remplace les variables et échappe le XML', () => {
    const tpl = makeDocx('<w:p><w:r><w:t>{{OBJET}}</w:t></w:r></w:p>')
    const out = readDoc(
      fillDcTemplate(tpl, { OBJET: 'A&B <test>' }),
    )
    expect(out).toContain('A&amp;B &lt;test&gt;')
    expect(out).not.toContain('{{OBJET}}')
  })

  it('convertit les sauts de ligne en <w:br/>', () => {
    const tpl = makeDocx('<w:p><w:r><w:t>{{ACHETEUR}}</w:t></w:r></w:p>')
    const out = readDoc(
      fillDcTemplate(tpl, { ACHETEUR: 'Commune de X\n1 rue A\n75000 Paris' }),
    )
    expect(out).toContain(
      'Commune de X</w:t><w:br/><w:t xml:space="preserve">1 rue A</w:t><w:br/><w:t xml:space="preserve">75000 Paris',
    )
  })

  it('coche et décoche les cases nommées', () => {
    const tpl = makeDocx(
      `<w:p>${CB_FIELD('CB_SEUL')}</w:p><w:p>${CB_FIELD('CB_GROUPEMENT')}</w:p>`,
    )
    const out = readDoc(
      fillDcTemplate(tpl, {}, { CB_SEUL: true, CB_GROUPEMENT: false }),
    )
    const seul = out.indexOf('w:val="CB_SEUL"')
    const gr = out.indexOf('w:val="CB_GROUPEMENT"')
    const seulBlock = out.slice(seul, out.indexOf('</w:checkBox>', seul))
    const grBlock = out.slice(gr, out.indexOf('</w:checkBox>', gr))
    expect(seulBlock).toContain('<w:checked/>')
    expect(grBlock).not.toContain('<w:checked/>')
  })
})

describe('dc data — mapping profil', () => {
  it('dc1Vars construit acheteur/objet/lots', () => {
    const v = dc1Vars(ctx)
    expect(v.ACHETEUR).toBe('Commune de Coupvray\nPlace de la Mairie\n77700 Coupvray')
    expect(v.OBJET).toContain('Gymnase de Coupvray')
    expect(v.OBJET).toContain('2026-GYM')
    expect(v.LOTS).toBe('Lot n°1 – Gros œuvre')
    expect(v.SIRET).toBe('823 633 862 00037')
    expect(v.TELEPHONE).toBe('Tél. : 01 60 91 67 60')
  })

  it('dc1Checks : lot partiel → CB_LOTS ; sans lots → CB_MARCHE', () => {
    expect(dc1Checks(ctx).CB_LOTS).toBe(true)
    expect(dc1Checks(ctx).CB_TOUS_LOTS).toBe(false)
    expect(dc1Checks({ ...ctx, lots: [], totalLots: 0 }).CB_MARCHE).toBe(true)
    expect(dc1Checks(ctx).CB_SEUL).toBe(true)
    expect(dc1Checks(ctx).CB_EXCLUSIONS).toBe(true)
  })

  it('dc2Vars : exercices/CA/parts mappés sur 3 lignes', () => {
    const v = dc2Vars(ctx, ctx.lots[0])
    expect(v.EXERCICE_1).toBe('Exercice du 01/01/2023 au 31/12/2023')
    expect(v.CA_3).toBe('13 897 070 €')
    expect(v.CA_PART_2).toBe('48 %')
    expect(v.FORME_JURIDIQUE).toBe('SASU')
    expect(v.DATE_CREATION).toBe('01/01/2018')
    expect(v.OBJET).toContain('Lot n°1')
  })

  it('parseCaLine et isPme', () => {
    expect(parseCaLine('2025 — 14 M€ — 60 %')).toEqual({
      year: '2025',
      ca: '14 M€',
      part: '60 %',
    })
    expect(isPme(profile)).toBe(true)
    expect(
      isPme({ ...profile, finance: { ...profile.finance, effectif: '600' } }),
    ).toBe(false)
  })
})

describe('gabarits réels (base/*.docx)', () => {
  it('dc1.docx contient les placeholders attendus', () => {
    const xml = new TextDecoder().decode(
      unzipSync(readFileSync(join(process.cwd(), 'src/lib/dc/base/dc1.docx')))[DOC],
    )
    for (const p of ['ACHETEUR', 'OBJET', 'LOTS', 'RAISON_SOCIALE', 'SIRET'])
      expect(xml).toContain(`{{${p}}}`)
    expect(xml).toContain('w:val="CB_SEUL"')
  })

  it('fillDcTemplate produit un docx lisible sur le vrai gabarit DC2', () => {
    const tpl = readFileSync(join(process.cwd(), 'src/lib/dc/base/dc2.docx'))
    const out = fillDcTemplate(tpl, dc2Vars(ctx, ctx.lots[0]), {
      CB_PME_OUI: true,
      CB_DECENNALE: true,
    })
    const xml = readDoc(out)
    expect(xml).not.toContain('{{')
    expect(xml).toContain('DESIGN CONSTRUCTION RENOVATION')
    expect(xml).toContain('Commune de Coupvray')
    expect(xml).toContain('823 633 862 00037')
    const pme = xml.indexOf('w:val="CB_PME_OUI"')
    expect(xml.slice(pme, xml.indexOf('</w:checkBox>', pme))).toContain(
      '<w:checked/>',
    )
    // pied de page : objet + lot remplacés, plus de résidu Coupvray
    const footer = new TextDecoder().decode(
      unzipSync(out)['word/footer1.xml'],
    )
    expect(footer).toContain('Gymnase de Coupvray – Lot 01')
    expect(footer).not.toContain('{{')
  })
})
