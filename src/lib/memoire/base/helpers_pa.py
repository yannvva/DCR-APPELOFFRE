# -*- coding: utf-8 -*-
import copy, re
from lxml import etree
from lxml.builder import ElementMaker

DIR = 'ref'
WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
XMLNS = 'http://www.w3.org/XML/1998/namespace'
ns = {'w': WNS}
W = '{%s}' % WNS
E = ElementMaker(namespace=WNS, nsmap={'w': WNS})

NAVY = '1A4A7A'; NAVYD = '1A3A6B'; GREEN = '1A5C52'; BODYC = '2C3E30'


def rPr(bold=False, color=BODYC, sz='18', spacing=None, shd=None, italic=False, font=True):
    r = E.rPr()
    if font:
        r.append(E.rFonts(**{W + 'ascii': 'DM Sans', W + 'eastAsia': 'DM Sans', W + 'hAnsi': 'DM Sans', W + 'cs': 'DM Sans'}))
    if bold:
        r.append(E.b()); r.append(E.bCs())
    if italic:
        r.append(E.i()); r.append(E.iCs())
    if color:
        r.append(E.color(**{W + 'val': color}))
    if spacing:
        r.append(E.spacing(**{W + 'val': spacing}))
    r.append(E.sz(**{W + 'val': sz})); r.append(E.szCs(**{W + 'val': sz}))
    if shd:
        r.append(E.shd(**{W + 'val': 'clear', W + 'color': 'auto', W + 'fill': shd}))
    return r


def run(text, **kw):
    r = E.r(rPr(**kw))
    t = E.t(text); t.set('{%s}space' % XMLNS, 'preserve')
    r.append(t)
    return r


def sep_run():
    r = E.r(rPr(font=False, color=None, sz='14'))
    t = E.t('  '); t.set('{%s}space' % XMLNS, 'preserve')
    r.append(t)
    return r


def pPr(before=None, after=None, line=None):
    a = {}
    if before is not None: a[W + 'before'] = str(before)
    if after is not None: a[W + 'after'] = str(after)
    if line is not None:
        a[W + 'line'] = str(line); a[W + 'lineRule'] = 'auto'
    return E.pPr(E.spacing(**a))


def chip(text, color):
    return E.p(pPr(140, 40), run(text, bold=True, color=color, sz='15', spacing='70'))


def body(segments, sz='18'):
    p = E.p(pPr(40, 20, 340))
    if isinstance(segments, str):
        segments = [(segments, False)]
    for seg in segments:
        if isinstance(seg, str):
            p.append(run(seg, sz=sz))
        else:
            p.append(run(seg[0], bold=bool(seg[1]), sz=sz))
    return p


def mini(text, color):
    return E.p(pPr(120, 20), run(text, bold=True, color=color, sz='18'))


def tags(items, color):
    p = E.p(pPr(100, 40))
    for i, it in enumerate(items):
        if i:
            p.append(sep_run())
        p.append(run('  ' + it + '  ', bold=True, color=color, sz='14', spacing='40', shd='F0F0F0'))
    return p


def spacer(after='80'):
    return E.p(pPr(0, after))


def cell_paras(tc, paras):
    for p in tc.findall('w:p', ns):
        tc.remove(p)
    for p in paras:
        tc.append(p)


def set_content(tbl, paras):
    tr = tbl.findall('w:tr', ns)[-1]
    tc = tr.findall('w:tc', ns)[-1]
    cell_paras(tc, paras)


def recolor_heading(tbl, color):
    tr = tbl.findall('w:tr', ns)[0]
    for c in tr.iter(W + 'color'):
        if c.get(W + 'val') == 'EE0000':
            c.set(W + 'val', color)
    for tag in ('sz', 'szCs'):
        for s in list(tr.iter(W + tag)):
            s.getparent().remove(s)


def hdr_para(lab):
    return E.p(E.pPr(E.spacing(**{W + 'after': '20'})), run(lab, bold=True, color='FFFFFF', sz='14', spacing='50'))


def rewrite_header_row(tbl, labels):
    tr = tbl.findall('w:tr', ns)[0]
    tcs = tr.findall('w:tc', ns)
    for tc, lab in zip(tcs, labels):
        cell_paras(tc, [hdr_para(lab)])


def _data_para(text, bold, sz):
    p = E.p(E.pPr(E.spacing(**{W + 'line': '320', W + 'lineRule': 'auto'})))
    p.append(run(text, bold=bold, sz=sz))
    return p


def fill_table(tbl, rows_data, bold_col0=True, sz='17'):
    trs = tbl.findall('w:tr', ns)
    pattern = copy.deepcopy(trs[1])
    for tr in trs[1:]:
        tbl.remove(tr)
    for rd in rows_data:
        tr = copy.deepcopy(pattern)
        tcs = tr.findall('w:tc', ns)
        for j, (tc, val) in enumerate(zip(tcs, rd)):
            paras = []
            parts = val if isinstance(val, (list, tuple)) else [val]
            for part in parts:
                paras.append(_data_para(part, bold_col0 and j == 0, sz))
            cell_paras(tc, paras)
        tbl.append(tr)


def para_replace(p, paras):
    """Replace content of an existing body paragraph p with the children of the first para (keeps position)."""
    for ch in list(p):
        p.remove(ch)
    for ch in paras:
        p.append(ch)


def fix_red_headers(body_el):
    for tbl in body_el.iter(W + 'tbl'):
        trs = tbl.findall('w:tr', ns)
        if not trs:
            continue
        for tc in trs[0].findall('w:tc', ns):
            c = tc.find('.//w:r/w:rPr/w:color', ns)
            if c is not None and c.get(W + 'val') == 'EE0000':
                text = ''.join(tc.itertext()).strip()
                cell_paras(tc, [hdr_para(text)])
