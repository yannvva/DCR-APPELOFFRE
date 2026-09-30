import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { COVER_SOURCES, FOOTER_SOURCES, validateContentPy } from '@/lib/memoire/generate'

/** Squelette minimal mais structurellement complet (carte des blocs tpl.docx). */
function validCode() {
  return [
    // Partie 1 — §2
    `set_content(blk[25], [chip('ANALYSE', A)])`,
    `set_content(blk[27], [body('intro')])`,
    `risk_tbl = copy.deepcopy(blk[74])`,
    `blk[28].addnext(risk_tbl)`,
    `risk_tbl.addnext(copy.deepcopy(blk[28]))`,
    `rewrite_header_row(risk_tbl, ['RISQUE', 'CONSÉQUENCE', 'SOLUTION'])`,
    `fill_table(risk_tbl, [["a", "b", "c"]])`,
    // Partie 2 — §3.1-3.3
    `set_content(blk[31], [chip('ÉQUIPE', A)])`,
    `rewrite_header_row(blk[33], ['INTERVENANT', 'FONCTION', 'EXPÉRIENCE', 'AFFECTATION'])`,
    `fill_table(blk[33], [["i", "f", "e", "a"]])`,
    `_trs = blk[37].findall('w:tr', ns)`,
    `cell_paras(_trs[1].findall('w:tc', ns)[-1], [chip('CV1', A)])`,
    `cell_paras(_trs[2].findall('w:tc', ns)[-1], [chip('CV2', A)])`,
    `set_content(blk[39], [chip('BET', A)])`,
    `rewrite_header_row(blk[41], ['BET', 'SPÉCIALITÉ', 'MISSIONS'])`,
    `fill_table(blk[41], [["b", "s", "m"]])`,
    // Partie 3 — §3.4-3.6
    `set_content(blk[47], [chip('ST', A)])`,
    `rewrite_header_row(blk[49], ['ÉTAPE', 'ACTION', 'DOC', 'DÉLAI'])`,
    `fill_table(blk[49], [["e", "a", "d", "d"]])`,
    `set_content(blk[51], [chip('QUALITÉ', A)])`,
    `rewrite_header_row(blk[53], ['NIVEAU', 'FRÉQUENCE', 'RESP', 'LIVRABLE'])`,
    `fill_table(blk[53], [["n", "f", "r", "l"]])`,
    `set_content(blk[55], [body('carence')])`,
    `rewrite_header_row(blk[57], ['NIVEAU', 'DÉCLENCHEUR', 'MESURES', 'DÉLAI'])`,
    `fill_table(blk[57], [["n", "d", "m", "d"]])`,
    `set_content(blk[59], [chip('INSERTION', A)])`,
    `rewrite_header_row(blk[61], ['RÉFÉRENCE', 'MOA', 'HEURES'])`,
    `fill_table(blk[61], [["r", "m", "h"]])`,
    // Partie 4 — §4.1-4.3
    `set_content(blk[65], [chip('PREP', A)])`,
    `set_content(blk[67], [chip('EXE', A)])`,
    `para_replace(blk[71], list(chip('SÉQUENÇAGE', A)))`,
    `para_replace(blk[72], list(body('x')))`,
    `rewrite_header_row(blk[74], ['PHASE', 'OPS', 'VIGILANCE'])`,
    `fill_table(blk[74], [["p", "o", "v"]])`,
    `box_tc = blk[77].findall('.//w:tc', ns)[-1]`,
    `cell_paras(box_tc, [chip('MÉTHODO', A)])`,
    `rewrite_header_row(blk[83], ['OUVRAGE', 'MÉTHODE'])`,
    `fill_table(blk[83], [["o", "m"]])`,
    // Partie 5 — §4.4-4.6
    `set_content(blk[86], [chip('FICHES', A)])`,
    `rewrite_header_row(blk[88], ['FAMILLE', 'FOURNISSEUR', 'NORME'])`,
    `fill_table(blk[88], [["f", "s", "n"]])`,
    `set_content(blk[90], [chip('MOYENS', A)])`,
    `rewrite_header_row(blk[92], ['MATÉRIEL', 'CARACTÉRISTIQUE', 'USAGE'])`,
    `fill_table(blk[92], [["m", "c", "u"]])`,
    `set_content(blk[94], [chip('RÉCEPTION', A)])`,
    `rewrite_header_row(blk[96], ['ÉTAPE', 'MODALITÉ', 'DÉLAI'])`,
    `fill_table(blk[96], [["e", "m", "d"]])`,
    // Partie 6 — §5
    `set_content(blk[100], [chip('CALENDRIER', G)])`,
    `rewrite_header_row(blk[102], ['PHASE', 'CONTENU', 'LIVRABLE'])`,
    `fill_table(blk[102], [["j", "c", "l"]])`,
    `set_content(blk[104], [chip('EFFECTIFS', G)])`,
    `eff_tbl = copy.deepcopy(blk[102])`,
    `blk[105].addnext(eff_tbl)`,
    `eff_tbl.addnext(copy.deepcopy(blk[105]))`,
    `rewrite_header_row(eff_tbl, ['PHASE', 'EFFECTIF', 'COMPOSITION'])`,
    `fill_table(eff_tbl, [["p", "e", "c"]])`,
    `_trs = blk[106].findall('w:tr', ns)`,
    `cell_paras(_trs[1].findall('w:tc', ns)[-1], [chip('ANTICIPATION', G)])`,
    `cell_paras(_trs[2].findall('w:tc', ns)[-1], [chip('N1', G)])`,
    `cell_paras(_trs[3].findall('w:tc', ns)[-1], [chip('N2', G)])`,
    `cell_paras(_trs[4].findall('w:tc', ns)[-1], [chip('N3', G)])`,
    `cell_paras(_trs[5].findall('w:tc', ns)[-1], [chip('INDICATEURS', G)])`,
    `rewrite_header_row(blk[108], ['INDICATEUR', 'FRÉQUENCE', 'RESP', 'DEST'])`,
    `fill_table(blk[108], [["i", "f", "r", "d"]])`,
    `set_content(blk[110], [chip('APPRO', G)])`,
    `rewrite_header_row(blk[112], ['MATÉRIAU', 'DÉLAI', 'MESURE'])`,
    `fill_table(blk[112], [["m", "d", "s"]])`,
    // Partie 7 — §6, §7, sélection, fin
    `_trs = blk[119].findall('w:tr', ns)`,
    `cell_paras(_trs[1].findall('w:tc', ns)[-1], [chip('PROT', G)])`,
    `cell_paras(_trs[2].findall('w:tc', ns)[-1], [chip('NUISANCES', G)])`,
    `set_content(blk[121], [chip('SOSED', G)])`,
    `rewrite_header_row(blk[123], ['FLUX', 'COND', 'FILIÈRE', 'TRACE'])`,
    `fill_table(blk[123], [["f", "c", "f", "t"]])`,
    `set_content(blk[126], [chip('RÉEMPLOI', G)])`,
    `set_content(blk[129], [chip('MATÉRIAUX', G)])`,
    `rewrite_header_row(blk[131], ['CRITÈRE', 'EXIGENCE', 'RÉFÉRENCE'])`,
    `fill_table(blk[131], [["c", "e", "r"]])`,
    `set_content(blk[133], [chip('RSE', G)])`,
    `_trs = blk[139].findall('w:tr', ns)`,
    `cell_paras(_trs[1].findall('w:tc', ns)[-1], [chip('PIC', A)])`,
    `cell_paras(_trs[2].findall('w:tc', ns)[-1], [chip('CLÔTURE', A)])`,
    `set_content(blk[141], [chip('PRÉVENTION', A)])`,
    `rewrite_header_row(blk[143], ['EPI', 'NORME', 'RENOUVELLEMENT'])`,
    `fill_table(blk[143], [["e", "n", "r"]])`,
    `set_content(blk[145], [chip('ACCÈS', A)])`,
    `rewrite_header_row(blk[147], ['MESURE', 'MODALITÉ', 'RESP'])`,
    `fill_table(blk[147], [["m", "m", "r"]])`,
    `to_delete = [blk[80], blk[81]]`,
    `to_delete += [blk[i] for i in range(4, 23)]`,
    `for el in to_delete:`,
    `    body_el.remove(el)`,
    `fix_red_headers(body_el)`,
    `subs = [`,
    ...COVER_SOURCES.map((s) => `    ("${s}", "cible"),`),
    `]`,
    `fsubs = [`,
    ...FOOTER_SOURCES.map((s) => `    ("${s}", "cible"),`),
    `]`,
    `f = open(DIR + '/word/footer1.xml', encoding='utf-8').read()`,
    `print('OK')`,
  ].join('\n')
}

describe('validateContentPy', () => {
  it('accepte un fichier conforme à la carte des blocs tpl.docx', () => {
    const { errors } = validateContentPy(validCode())
    expect(errors).toEqual([])
  })

  it('signale « & » en avertissement sans bloquer (comme les exemples du pipeline)', () => {
    const { errors, warnings } = validateContentPy(`${validCode()}\n# R&D`)
    expect(errors).toEqual([])
    expect(warnings.join(' ')).toContain('&')
  })

  it('rejette un appel de bloc manquant', () => {
    const code = validCode().replace('fill_table(blk[74]', 'fill_table(blk[99]')
    expect(validateContentPy(code).errors.join(' ')).toContain('blk[74]')
  })

  it('rejette une chaîne de couverture non remplacée (source absente)', () => {
    const code = validCode().replace(COVER_SOURCES[0], 'Ville inconnue')
    expect(validateContentPy(code).errors.join(' ')).toContain('couverture')
  })

  it('rejette les fences markdown et le déséquilibre de parenthèses hors chaînes', () => {
    expect(validateContentPy('```python\n' + validCode() + '\n```').errors.join(' ')).toContain(
      'markdown',
    )
    expect(validateContentPy(validCode() + '\nset_content(blk[25], [').errors.join(' ')).toContain(
      'déséquilibre',
    )
    // Les parenthèses dans les chaînes ne faussent pas le comptage
    expect(validateContentPy(validCode() + '\nbody("(à lire")').errors).toEqual([])
  })

  it('rejette le code hors squelette (le fichier est exécuté au build)', () => {
    expect(validateContentPy(validCode() + '\nimport os').errors.join(' ')).toContain('import')
    expect(
      validateContentPy(validCode() + '\nx = eval("1")').errors.join(' '),
    ).toContain('eval')
    expect(
      validateContentPy(validCode() + '\nopen("/etc/passwd").read()').errors.join(' '),
    ).toContain('open()')
    expect(
      validateContentPy(validCode() + '\nfor f in os.listdir("."):\n    pass').errors.join(' '),
    ).toContain('for')
    // open(DIR …) et les boucles du squelette restent acceptés
    expect(validateContentPy(validCode()).errors).toEqual([])
  })
})
