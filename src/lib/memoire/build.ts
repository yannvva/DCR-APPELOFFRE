import 'server-only'

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { unzipSync, zipSync } from 'fflate'

/**
 * Build du mémoire .docx à partir du fichier content_*.py. Portage de
 * scripts/build.sh :
 *   1. décompresse base/tpl.docx (gabarit DCR complet, 7 sections) dans <work>/ref/
 *   2. exécute helpers_pa.py + content_*.py (python3 + lxml)
 *   3. rezippe ref/ en .docx
 *   4. valide via validate_docx.py
 *
 * Deux sorties à partir du MÊME fichier de contenu (comme les deux exemples
 * de référence, dont les sections 2/4/5 sont identiques au caractère près) :
 *   - full=false → MEMOIRE_TECHNIQUE_<X>_DCR.docx : couverture + TDM + §2/4/5
 *   - full=true  → ..._avec_couverture.docx       : mémoire complet 7 parties
 *
 * Compatible Windows : pas besoin de unzip/zip/bash — fflate gère les
 * archives, python est détecté via python3 / python / py.
 */

const ASSETS = join(process.cwd(), 'src', 'lib', 'memoire', 'base')

/**
 * Retrait des sections 1, 3, 6 et 7 pour la sortie « étape 1 » : on repère les
 * bandeaux de section (« N.  TITRE » en capitales dans un tableau) — robuste
 * aux insertions/suppressions faites par le contenu, contrairement aux
 * indices de blocs. Script interne fixe : seul le content_*.py validé vient
 * du LLM, celui-ci ne fait qu'effacer des plages de blocs.
 */
const STRIP_SCRIPT = `# -*- coding: utf-8 -*-
import re
from lxml import etree
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
tree = etree.parse('ref/word/document.xml')
b = tree.getroot().find('w:body', ns)
kids = list(b)
def num(el):
    if etree.QName(el).localname != 'tbl':
        return None
    m = re.match(r'^([0-9])\\.\\s\\s', ''.join(el.itertext()).lstrip())
    return int(m.group(1)) if m else None
bounds = [(i, n) for i, n in ((i, num(el)) for i, el in enumerate(kids)) if n]
for k, (start, n) in enumerate(bounds):
    if n in (1, 3, 6, 7):
        end = bounds[k + 1][0] if k + 1 < len(bounds) else len(kids) - 1
        for i in range(start, end):
            b.remove(kids[i])
tree.write('ref/word/document.xml', xml_declaration=True, encoding='UTF-8', standalone=True)
print('strip OK')
`

export interface BuildResult {
  docx: Uint8Array
  warnings: string[]
}

export class BuildError extends Error {}

function pythonBin(): string {
  for (const bin of ['python3', 'python', 'py']) {
    const probe = spawnSync(/* turbopackIgnore: true */ bin, ['-c', 'import lxml'], { timeout: 15_000 })
    if (!probe.error && probe.status === 0) return bin
  }
  throw new BuildError(
    'Python 3 + lxml introuvables — installez Python puis lancez : pip install lxml',
  )
}

function runPython(bin: string, script: string, cwd: string): string {
  const r = spawnSync(/* turbopackIgnore: true */ bin, [script], { cwd, timeout: 300_000, encoding: 'utf-8' })
  if (r.error) throw new BuildError(`Python : ${r.error.message}`)
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || 'échec inconnu').toString().slice(0, 800)
    throw new BuildError(`Build du mémoire en échec : ${err}`)
  }
  return (r.stdout ?? '').toString()
}

/**
 * Construit le mémoire .docx. `code` = contenu complet du content_*.py.
 * `full: true` → mémoire complet 7 parties (« _avec_couverture ») ;
 * `full: false` → mémoire étape 1 (§2/4/5 uniquement, « _DCR »).
 */
export function buildMemoireDocx(code: string, opts?: { full?: boolean }): BuildResult {
  const py = pythonBin()
  if (!existsSync(join(ASSETS, 'tpl.docx')) || !existsSync(join(ASSETS, 'helpers_pa.py'))) {
    throw new BuildError('Assets du pipeline manquants (src/lib/memoire/base/).')
  }

  const work = mkdtempSync(join(tmpdir(), 'memoire-'))
  try {
    // 1. Extraction du gabarit de référence (7 sections, charte DCR complète)
    const refDir = join(work, 'ref')
    const entries = unzipSync(readFileSync(join(ASSETS, 'tpl.docx')))
    for (const [name, data] of Object.entries(entries)) {
      if (name.endsWith('/') || name.includes('..')) continue
      const dest = join(refDir, name.split('/').join(sep))
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, data)
    }

    // 2. helpers + contenu → exécution (DIR='ref' est relatif au cwd)
    writeFileSync(
      join(work, '_build_tmp.py'),
      readFileSync(join(ASSETS, 'helpers_pa.py'), 'utf-8') + '\n' + code,
      'utf-8',
    )
    runPython(py, '_build_tmp.py', work)

    // 2b. Sortie « étape 1 » : retrait des sections 1, 3, 6 et 7
    if (opts?.full === false) {
      writeFileSync(join(work, '_strip_sections.py'), STRIP_SCRIPT, 'utf-8')
      runPython(py, '_strip_sections.py', work)
    }

    // 2c. TDM automatique : <w:updateFields> force Word à régénérer la table
    // des matières à l'ouverture (équivaut au « Ctrl+A puis F9 » du process).
    const settingsPath = join(refDir, 'word', 'settings.xml')
    const settings = readFileSync(settingsPath, 'utf-8')
    if (!settings.includes('updateFields')) {
      const patched = settings.replace(/<w:settings[^>]*>/, (tag) =>
        tag + '<w:updateFields w:val="true"/>',
      )
      if (patched !== settings) writeFileSync(settingsPath, patched, 'utf-8')
    }

    // 3. Rezip — [Content_Types].xml en premier (convention OOXML)
    const refFiles = Object.keys(entries).filter((n) => !n.endsWith('/'))
    const zipEntries: Record<string, Uint8Array> = {}
    for (const name of ['[Content_Types].xml', ...refFiles.filter((n) => n !== '[Content_Types].xml')]) {
      zipEntries[name] = readFileSync(join(refDir, name.split('/').join(sep)))
    }
    const docx = zipSync(zipEntries, { level: 6 })
    writeFileSync(join(work, 'out.docx'), docx)

    // 4. Validation (mêmes contrôles que validate_docx.py)
    const warnings: string[] = []
    const valOut = spawnSync(/* turbopackIgnore: true */ py, [join(ASSETS, 'validate_docx.py'), join(work, 'out.docx')], {
      cwd: work,
      timeout: 60_000,
      encoding: 'utf-8',
    })
    const valText = `${valOut.stdout ?? ''}\n${valOut.stderr ?? ''}`
    if (valOut.status !== 0) {
      throw new BuildError(`Validation du .docx : ${valText.slice(0, 500)}`)
    }
    if (/ATTENTION/i.test(valText)) {
      warnings.push(valText.match(/ATTENTION[^\n]*/)?.[0] ?? 'Placeholders rouges à contrôler')
    }
    warnings.push('À faire dans Word : mettre à jour la table des matières (Ctrl+A puis F9).')

    return { docx, warnings }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
