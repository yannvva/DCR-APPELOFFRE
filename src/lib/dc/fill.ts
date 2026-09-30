import { unzipSync, zipSync } from 'fflate'

/**
 * Remplissage des gabarits DC1/DC2 (base/dc1.docx, dc2.docx).
 *
 * - `{{NOM}}` dans word/document.xml, headers et footers → valeur échappée
 *   XML ; '\n' → <w:br/>.
 * - Cases FORMCHECKBOX nommées <w:name w:val="CB_X"/> → <w:checked/> ajouté
 *   ou retiré dans le <w:checkBox> suivant (document.xml uniquement).
 *
 * Pur et sans I/O : testable en unitaire.
 */

const escXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Un \n dans la valeur devient un saut de ligne Word (ferme le <w:t>, <w:br/>, rouvre). */
const toRuns = (v: string) =>
  v.split('\n').map(escXml).join('</w:t><w:br/><w:t xml:space="preserve">')

const TEXT_PART = /^word\/(document|header\d*|footer\d*)\.xml$/

export function fillDcTemplate(
  template: Uint8Array,
  vars: Record<string, string>,
  checks: Record<string, boolean> = {},
): Uint8Array {
  const entries = unzipSync(template)
  const dec = new TextDecoder()
  const enc = new TextEncoder()

  // Placeholders dans le corps + en-têtes/pieds de page (objet, acheteur…)
  for (const key of Object.keys(entries)) {
    if (!TEXT_PART.test(key)) continue
    entries[key] = enc.encode(
      dec.decode(entries[key]).replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, n: string) =>
        toRuns(vars[n] ?? ''),
      ),
    )
  }

  // Cases à cocher : uniquement dans le corps du document
  let out = dec.decode(entries['word/document.xml'])
  for (const [name, checked] of Object.entries(checks)) {
    const tag = `<w:name w:val="${name}"/>`
    const i = out.indexOf(tag)
    if (i === -1) continue
    const cbStart = out.indexOf('<w:checkBox>', i)
    const cbEnd = out.indexOf('</w:checkBox>', cbStart)
    if (cbStart === -1 || cbEnd === -1 || cbStart - i > 500) continue
    const inner = out.slice(cbStart, cbEnd)
    const updated = checked
      ? inner.includes('<w:checked/>')
        ? inner
        : `${inner}<w:checked/>`
      : inner.replace(/<w:checked\/>/g, '')
    out = out.slice(0, cbStart) + updated + out.slice(cbEnd)
  }
  entries['word/document.xml'] = enc.encode(out)

  return zipSync(entries, { level: 6 })
}

/**
 * Placeholders `{{TAG}}` restants après remplissage (corps + en-têtes/pieds) —
 * signale les champs que le mapping n'a pas couverts plutôt que de livrer un
 * formulaire avec des balises visibles.
 */
export function unfilledPlaceholders(filled: Uint8Array): string[] {
  const entries = unzipSync(filled)
  const dec = new TextDecoder()
  const found = new Set<string>()
  for (const key of Object.keys(entries)) {
    if (!TEXT_PART.test(key)) continue
    for (const m of dec.decode(entries[key]).matchAll(/\{\{([A-Z0-9_]+)\}\}/g)) {
      found.add(m[1])
    }
  }
  return [...found].sort()
}
