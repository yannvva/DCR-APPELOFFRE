# -*- coding: utf-8 -*-
"""Prépare les gabarits DC1/DC2 : convertit les valeurs figées (anciennes
opérations + identité DCR) en placeholders {{...}} et nomme les cases à
cocher FORMCHECKBOX pour un pilotage runtime.

Usage : python scripts/prepare-dc-templates.py
Entrées : ~/Desktop/DC1-TEMPLATE.docx, ~/Desktop/DC2-TEMPLATE.docx (conversion
          des .doc via scripts/convert-doc.ps1)
Sorties : src/lib/dc/base/dc1.docx, dc2.docx
"""
import os
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = Path.home() / 'Desktop'
OUT = ROOT / 'src' / 'lib' / 'dc' / 'base'

RE_P = re.compile(r'<w:p[ >].*?</w:p>', re.S)
RE_WT = re.compile(r'(<w:t\b[^>]*>)([^<]*)(</w:t>)')


def para_text(p: str) -> str:
    return ''.join(m.group(2) for m in RE_WT.finditer(p))


def set_para(p: str, text: str) -> str:
    """Tout le texte du paragraphe -> `text` (format du 1er run conservé)."""
    found = False

    def repl(m: re.Match) -> str:
        nonlocal found
        open_tag = m.group(1)
        if found:
            return open_tag + m.group(3)
        found = True
        if 'xml:space' not in open_tag:
            open_tag = open_tag[:-1] + ' xml:space="preserve">'
        return open_tag + text + m.group(3)

    return RE_WT.sub(repl, p)


def apply_ops(xml: str, ops: list) -> str:
    """ops: (mode, anchor[, new][, occ]) — 'set' remplace tout le paragraphe,
    'run' remplace uniquement le run contenant l'ancre, 'delete' supprime le
    paragraphe, 'clear' vide le texte."""
    for op in ops:
        mode = op[0]
        anchor = op[1]
        occ = op[3] if len(op) > 3 else 0
        paras = list(RE_P.finditer(xml))
        matches = [i for i, m in enumerate(paras) if anchor in para_text(m.group(0))]
        if len(matches) <= occ:
            raise SystemExit(f'anchor non trouvé (occ {occ}) : {anchor!r}')
        i = matches[occ]
        m = paras[i]
        if mode == 'delete':
            xml = xml[: m.start()] + xml[m.end() :]
        elif mode == 'clear':
            xml = xml[: m.start()] + set_para(m.group(0), '') + xml[m.end() :]
        elif mode == 'run':
            new_p = m.group(0)
            # remplace le texte du w:t contenant l'ancre, vide ses continuations
            wt_iter = list(RE_WT.finditer(new_p))
            hit = [j for j, wm in enumerate(wt_iter) if anchor in wm.group(2)]
            if not hit:
                raise SystemExit(f'run non trouvé : {anchor!r}')
            j0 = hit[0]
            out_p, last = '', 0
            for j, wm in enumerate(wt_iter):
                out_p += new_p[last : wm.start()]
                open_tag = wm.group(1)
                if j == j0:
                    if 'xml:space' not in open_tag:
                        open_tag = open_tag[:-1] + ' xml:space="preserve">'
                    out_p += open_tag + op[2] + wm.group(3)
                elif j0 < j <= hit[-1]:
                    out_p += open_tag + wm.group(3)
                else:
                    out_p += wm.group(0)
                last = wm.end()
            out_p += new_p[last:]
            xml = xml[: m.start()] + out_p + xml[m.end() :]
        else:  # set
            xml = xml[: m.start()] + set_para(m.group(0), op[2]) + xml[m.end() :]
        paras = list(RE_P.finditer(xml))
    return xml


def name_checkboxes(xml: str, names: list[str]) -> str:
    """Nomme les FORMCHECKBOX dans l'ordre du document via <w:name w:val=.../>."""
    out = xml
    for idx, name in enumerate(names):
        pos = -1
        for _ in range(idx + 1):
            pos = out.find('<w:checkBox>', pos + 1)
            if pos == -1:
                raise SystemExit(f'checkbox #{idx} introuvable')
        # <w:name w:val=""/> précède le checkBox dans le même fldChar begin
        seg_start = out.rfind('<w:ffData>', 0, pos)
        if seg_start == -1:
            raise SystemExit(f'ffData introuvable pour checkbox #{idx}')
        seg = out[seg_start:pos]
        seg2, n = re.subn(r'<w:name w:val="[^"]*"/>', f'<w:name w:val="{name}"/>', seg, count=1)
        if n != 1:
            raise SystemExit(f'w:name introuvable pour checkbox #{idx}')
        out = out[:seg_start] + seg2 + out[pos:]
    return out


DC1_OPS = {
    'word/document.xml': [
        ('set', 'Groupement Philanthropique', '{{ACHETEUR}}'),
        ('delete', '8 allée des Coudraies'),
        ('delete', '91190 Gif-sur-yvette'),
        ('set', 'CONSTRUCTION D\u2019UNE URTSA', '{{OBJET}}'),
        ('set', 'LOT 1 \u2013 GROS-OEUVRE', '{{LOTS}}'),
        ('set', 'DESIGN CONSTRUCTION RENOVATION', '{{RAISON_SOCIALE}}'),
        ('set', '6 RUE JACQUARD', '{{ADRESSE}}'),
        ('set', 'dcr@dcr-idf.fr', '{{EMAIL}}'),
        ('set', '01 60 91 67 60', '{{TELEPHONE}}'),
        ('set', '823\xa0633\xa0862', '{{SIRET}}'),
        ('set', 'www.dcr-idf.fr', '- Adresse internet : {{SITE_WEB}}'),
        ('set', 'www.attestationlegale.fr',
         '- Renseignements nécessaires pour y accéder : {{SITE_PREUVES}}'),
    ],
    # pied de page p1 : objet de la consultation (donnée dynamique par AO)
    'word/footer2.xml': [
        ('set', 'CONSTRUCTION D\u2019UNE URTSA', '{{OBJET_FOOTER}}'),
    ],
}

DC1_CB = [
    'CB_MARCHE', 'CB_TOUS_LOTS', 'CB_LOTS', 'CB_SEUL', 'CB_GROUPEMENT',
    'CB_CONJOINT', 'CB_SOLIDAIRE', 'CB_MANDATAIRE_SOLIDAIRE', 'CB_EXCLUSIONS',
    'CB_F3_DC2', 'CB_F3_PIECES',
]

DC2_OPS = {
    'word/document.xml': [
        ('set', 'Commune de COUPVRAY', '{{ACHETEUR}}'),
        ('delete', 'Place de la Mairie'),
        ('delete', '77700 Coupvray'),
        ('set', 'CONSTRUCTION DU GYMNASE', '{{OBJET}}'),
        ('set', 'DESIGN CONSTRUCTION RENOVATION', '{{RAISON_SOCIALE}}'),
        ('set', '6 RUE JACQUARD', '{{ADRESSE}}'),
        ('set', 'dcr@dcr-idf.fr', '{{EMAIL}}'),
        ('set', '01 60 91 67 60', '{{TELEPHONE}}'),
        ('set', '823\xa0633\xa0862', '{{SIRET}}'),
        ('run', 'SASU', '{{FORME_JURIDIQUE}}'),
        ('set', '01/01/2023', '{{EXERCICE_1}}'),
        ('set', '01/01/2024', '{{EXERCICE_2}}'),
        ('set', '01/01/2025', '{{EXERCICE_3}}'),
        ('set', '3 304 274', '{{CA_1}}'),
        ('set', '3 696 185', '{{CA_2}}'),
        ('set', '13 897 070', '{{CA_3}}'),
        ('set', '43 %', '{{CA_PART_1}}'),
        ('set', '48 %', '{{CA_PART_2}}'),
        ('set', '54 %', '{{CA_PART_3}}'),
        ('set', '\u2026\u2026', '{{DATE_CREATION}}'),
        # 'www.dcr-idf.fr' occ.0 = marché réservé entreprise adaptée (n/a) -> vidé
        ('set', 'www.dcr-idf.fr', 'Adresse internet :', 0),
        # après le vidage ci-dessus, la restante = F4 (occ 0)
        ('set', 'www.dcr-idf.fr', '- Adresse internet : {{SITE_WEB}}', 0),
        ('set', 'www.attestationlegale.fr',
         '- Adresse internet : {{SITE_PREUVES}}'),
    ],
    # pied de page p1 : objet + lot (donnée dynamique par AO/lot)
    'word/footer1.xml': [
        ('set', 'CONSTRUCTION DU GYMNASE', '{{OBJET_FOOTER}}'),
    ],
}

DC2_CB = [
    'CB_PME_OUI', 'CB_PME_NON', 'CB_RESERVE_INSERTION', 'CB_RESERVE_ADAPTEE',
    'CB_RESERVE_ESAT', 'CB_RESERVE_ESS', 'CB_RESERVE_PENITENTIAIRE',
    'CB_C3_DECLARATION', 'CB_DECENNALE',
]


def process(src: Path, dst: Path, ops_by_part: dict, cb_names: list[str]) -> None:
    with zipfile.ZipFile(src) as z:
        parts = {n: z.read(n) for n in z.namelist()}
    doc = name_checkboxes(parts['word/document.xml'].decode('utf-8'), cb_names)
    parts['word/document.xml'] = doc.encode('utf-8')
    n_ops = 0
    for part, ops in ops_by_part.items():
        if part not in parts:
            raise SystemExit(f'partie absente : {part}')
        parts[part] = apply_ops(parts[part].decode('utf-8'), ops).encode('utf-8')
        n_ops += len(ops)
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix('.tmp')
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name, data in parts.items():
            zout.writestr(name, data)
    os.replace(tmp, dst)
    print(f'{dst} écrit ({n_ops} ops, {len(cb_names)} cases nommées)')


if __name__ == '__main__':
    process(DESKTOP / 'DC1-TEMPLATE.docx', OUT / 'dc1.docx', DC1_OPS, DC1_CB)
    process(DESKTOP / 'DC2-TEMPLATE.docx', OUT / 'dc2.docx', DC2_OPS, DC2_CB)
