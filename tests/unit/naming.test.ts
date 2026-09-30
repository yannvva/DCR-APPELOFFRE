import { describe, expect, it } from 'vitest'
import {
  LIMITS,
  articleNumber,
  condense,
  memoireFilenameBase,
  parseLotLabel,
  productName,
  shortAffaire,
  shortLotLabel,
  shortReference,
  shortText,
  shortenLotLabel,
} from '@/lib/naming'
import { tenderFolderName } from '@/lib/doc-folders'
import { docFilename } from '@/lib/datasheets/research'
import { classeurFilename, lotShortLabel } from '@/lib/datasheets/deliverable'

/** Intitulés réels du dossier de Laval (AO 20-2026). */
const AO_TITLE =
  "Aménagement de 3 terrains synthétiques de football à Laval, L'Huisserie et Saint-Berthévin"
const LOT_TITLE =
  "DÉMOLITIONS, TERRASSEMENTS, FONDATIONS, MAÇONNERIE, DALLAGE, RAVALEMENT, CANALISATIONS, V.R.D. (AMÉNAGEMENTS DES ABORDS)"
const LOT_LABEL = `LOT 01 - ${LOT_TITLE}`

describe('shortText', () => {
  it('ne coupe jamais au milieu d’un mot', () => {
    const out = shortText('Aménagement de 3 terrains synthétiques de football', 30)
    expect(out).toBe('Aménagement de 3 terrains…')
    expect(out).not.toMatch(/synthé\s*…$/)
  })

  it('laisse intact ce qui tient déjà', () => {
    expect(shortText('Kbis 2026', 40)).toBe('Kbis 2026')
  })

  it('gère les chaînes vides', () => {
    expect(shortText('', 10)).toBe('')
  })
})

describe('condense', () => {
  it('retire les mots de liaison sans valeur d’identification', () => {
    expect(condense('Travaux de rénovation de la maison des associations', 60)).toBe(
      'Travaux rénovation maison associations',
    )
  })

  it('conserve le premier mot même s’il est un mot de liaison', () => {
    expect(condense('de la même façon', 60)).toBe('de même façon')
  })
})

describe('shortAffaire — dossier d’appel d’offres', () => {
  it('passe de 98 à ~52 caractères', () => {
    const full = `AO 20-2026 — ${AO_TITLE}`
    const out = shortAffaire(AO_TITLE, '20-2026')
    expect(full.length).toBeGreaterThan(90)
    expect(out.length).toBeLessThanOrEqual(56)
    expect(out).toBe('AO 20-2026 — Aménagement 3 terrains synthétiques…')
  })

  it('sans référence : « AO — … »', () => {
    expect(shortAffaire('Rénovation école', null)).toBe('AO — Rénovation école')
  })

  it('gère un titre absent', () => {
    expect(shortAffaire(null, '20-2026')).toBe('AO 20-2026 — Sans titre')
  })
})

describe('parseLotLabel', () => {
  it('extrait le numéro et le titre', () => {
    expect(parseLotLabel(LOT_LABEL)).toEqual({ number: 1, title: LOT_TITLE })
    expect(parseLotLabel('LOT 12 : VRD')).toEqual({ number: 12, title: 'VRD' })
    expect(parseLotLabel('Terrassements')).toEqual({
      number: null,
      title: 'Terrassements',
    })
  })
})

describe('shortLotLabel — libellé de lot', () => {
  it('résume une liste de corps d’état en « +N »', () => {
    const out = shortenLotLabel(LOT_LABEL)
    expect(out).toBe('LOT 01 - DÉMOLITIONS, TERRASSEMENTS +6')
    expect(out.length).toBeLessThanOrEqual(LIMITS.lot)
  })

  it('garde le libellé entier s’il est court', () => {
    expect(shortenLotLabel('LOT 03 - Peinture')).toBe('LOT 03 - Peinture')
  })

  it('tronque proprement un libellé long sans virgules', () => {
    const out = shortLotLabel(
      2,
      'Fourniture et pose de clôtures rigides et souples y compris accessoires',
    )
    expect(out).toMatch(/^LOT 02 - /)
    expect(out.length).toBeLessThanOrEqual(LIMITS.lot)
    expect(out.endsWith('…')).toBe(true)
  })

  it('sans numéro, aucun préfixe LOT', () => {
    expect(shortLotLabel(null, 'Peinture intérieure')).toBe('Peinture intérieure')
  })
})

describe('articleNumber — clé de nommage « 5.5.3 Marque Produit »', () => {
  it('extrait le numéro d’article CCTP en points', () => {
    expect(articleNumber('Lot 1 Art. 5-5-3')).toBe('5.5.3')
    expect(articleNumber('Ch. II-III Art. 3-3')).toBe('3.3')
    expect(articleNumber('Art. 3 4 7')).toBe('3.4.7')
    expect(articleNumber('2-13')).toBe('2.13')
    expect(articleNumber('2.1.4c')).toBe('2.1.4c')
    expect(articleNumber('Art. 5')).toBe('5')
  })

  it('sans numérotation : null (repli sur chap-code)', () => {
    expect(articleNumber('Generalites Ch. IX')).toBeNull()
    expect(articleNumber('')).toBeNull()
  })
})

describe('productName / shortReference — noms de fiches', () => {
  it('coupe à la première précision descriptive', () => {
    expect(
      productName(
        'Cloture Mobile M300 — cloture de chantier type HERAS (panneau 3500 x 2000 mm, maille 100 x 250 mm)',
      ),
    ).toBe('Cloture Mobile M300')
    expect(
      productName(
        "Bloc beton creux de 0,20 m d'epaisseur, estampille NF, conforme NF 14-101 et suivantes (BBP premier choix NF)",
      ),
    ).toBe("Bloc beton creux de 0,20 m d'epaisseur")
    expect(productName('Notice de montage, de demontage et d’utilisation')).toBe(
      'Notice de montage',
    )
  })

  it('réduit la référence aux précisions', () => {
    expect(shortReference('Leaflet C5107000 — Cloture Mobile M300')).toBe(
      'Leaflet C5107000',
    )
  })

  it('un nom de fiche complet tient en ~55 caractères', () => {
    const name = docFilename({
      chap: '01a',
      code: 'Generalites Ch. IX',
      designation:
        'Cloture Mobile M300 — cloture de chantier type HERAS (panneau 3500 x 2000 mm, maille 100 x 250 mm)',
      marque: 'HERAS',
      reference: 'Leaflet C5107000 — Cloture Mobile M300',
      type_document: 'Fiche_technique',
    })
    expect(name).toBe('01a HERAS Leaflet C5107000.pdf')
    expect(name.length).toBeLessThan(60)
  })
})

describe('memoireFilenameBase', () => {
  it('borne le nom du mémoire', () => {
    const base = memoireFilenameBase(LOT_LABEL)
    expect(base).toHaveLength(LIMITS.memoire)
    expect(base).toBe('LOT01_DEMOLITIONS_TERRASSEMENTS_FO')
    expect(`MEMOIRE_TECHNIQUE_${base}_DCR.docx`).toBe(
      'MEMOIRE_TECHNIQUE_LOT01_DEMOLITIONS_TERRASSEMENTS_FO_DCR.docx',
    )
  })

  it('retombe sur AFFAIRE si rien d’exploitable', () => {
    expect(memoireFilenameBase('LOT 01 - ')).toBe('LOT01')
  })
})

describe('noms de livrables — avant / après', () => {
  it('dossier d’AO : 98 → ≤ 56 caractères', () => {
    const out = tenderFolderName({ title: AO_TITLE, reference: '20-2026' })
    expect(out).toBe('AO 20-2026 — Aménagement 3 terrains synthétiques…')
    expect(out.length).toBeLessThan(60)
  })

  it('dossier de lot : 238 → 106 caractères', () => {
    const out = tenderFolderName(
      { title: AO_TITLE, reference: '20-2026' },
      `Fiches techniques/${shortenLotLabel(LOT_LABEL)}`,
    )
    expect(out).toBe(
      'AO 20-2026 — Aménagement 3 terrains synthétiques…/Fiches techniques/LOT 01 - DÉMOLITIONS, TERRASSEMENTS +6',
    )
    expect(out.length).toBeLessThan(120)
  })

  it('classeur : 175 → ≤ 60 caractères (« Fiche technique - Lot 01 »)', () => {
    const sans = classeurFilename(LOT_LABEL, '')
    const avec = classeurFilename(LOT_LABEL, '', 'ABEILLE CAMUS - ECOLE NORD')
    expect(sans).toBe('Fiche technique - Lot 01.xlsx')
    expect(avec).toBe('ABEILLE CAMUS - ECOLE NORD - Fiche technique - Lot 01.xlsx')
    expect(avec.length).toBeLessThan(65)
  })

  it('ZIP de livraison : « Fiches techniques - Lot 01.zip »', () => {
    const zip = `Fiches techniques - ${lotShortLabel(LOT_LABEL)}.zip`
    expect(zip).toBe('Fiches techniques - Lot 01.zip')
  })
})
