import type { DceDocType } from './types'

/**
 * Classification d'une pièce de DCE : nom de fichier d'abord,
 * contenu en secours. Un DCE typique contient RC, CCTP, CCAP, AE,
 * BPU/DPGF et des annexes — les intitulés varient selon les acheteurs.
 */

// Note : \b ne considère pas « _ » comme séparateur — on utilise des classes
// de caractères explicites pour les sigles (RC, AE, BPU, DQE).
const FILENAME_RULES: [RegExp, DceDocType][] = [
  [/(?:^|[^a-z0-9])rc(?:[^a-z0-9]|$)|r[èe]glement[-_ ]?(de[-_ ]?)?(la[-_ ]?)?consultation/i, 'rc'],
  [/cctp|cahier.*clauses?.*techn.*part/i, 'cctp'],
  [/ccap|cahier.*clauses?.*admin.*part/i, 'ccap'],
  [/ccag|cahier.*clauses?.*(admin|g[ée]n[ée]r)/i, 'ccag'],
  [/(?:^|[^a-z0-9])ae(?:[^a-z0-9]|$)|acte.{0,4}engagement/i, 'ae'],
  [/(?:^|[^a-z0-9])bpu(?:[^a-z0-9]|$)|bordereau.*prix/i, 'bpu'],
  [/dpgf|(?:^|[^a-z0-9])dqe(?:[^a-z0-9]|$)|d[ée]tail[-_ ]?quantitatif|cadre[-_ ]?de[-_ ]?(d[ée]composition|prix)/i, 'dpgf'],
  [
    /annexe|pj\d|appendice|notice|plan[-_ n]|planning|planche|diagnostic|plomb|amiante|thermique|rict|ppsps|(?:^|[^a-z])pgc(?:[^a-z]|$)|carnet|coupe|fa[cç]ade|toiture|situation|g[ée]om[èe]tre|[ée]tat actuel|rapport/i,
    'annexe',
  ],
]

const CONTENT_RULES: [RegExp, DceDocType, number][] = [
  [/r[èe]glement\s+(?:de\s+la\s+|de\s+|du\s+)?consultation/i, 'rc', 3],
  [/crit[èe]res?\s+d['e]?attribution/i, 'rc', 2],
  [/date\s+limite\s+(?:de\s+)?(?:remise|d[ée]p[ôo]t|r[ée]ception)/i, 'rc', 1],
  [/cahier\s+des\s+clauses?\s+techniques?\s+particuli[èe]res?/i, 'cctp', 3],
  [/cahier\s+des\s+clauses?\s+administratives?\s+particuli[èe]res?/i, 'ccap', 3],
  [/cahier\s+des\s+clauses?\s+(?:administratives?\s+)?g[ée]n[ée]rales?/i, 'ccag', 3],
  [/acte\s+d['e]engagement/i, 'ae', 3],
  [/bordereau\s+des\s+prix\s+unitaires?/i, 'bpu', 3],
  [/prix\s+unitaire\s*(?:ht|€)/i, 'bpu', 1],
  [/d[ée]tail\s+quantitatif\s+et\s+estimatif|dpgf/i, 'dpgf', 3],
]

export function classifyDoc(name: string, text: string): DceDocType {
  for (const [re, type] of FILENAME_RULES) {
    if (re.test(name)) return type
  }
  const sample = text.slice(0, 15_000)
  let best: DceDocType = 'autre'
  let bestScore = 0
  for (const [re, type, w] of CONTENT_RULES) {
    if (re.test(sample)) {
      const score = w
      if (score > bestScore) {
        best = type
        bestScore = score
      }
    }
  }
  return best
}
