import type { DceAnalysis, DceRequiredDocument } from './types'

// Normalisation tolérante du JSON renvoyé par le LLM : on nettoie
// plutôt que rejeter (types vagues → undefined, strings → numbers…).

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[\s€]/g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined

/** Placeholders que le LLM écrit littéralement — traités comme absent. */
const PLACEHOLDER = /^(?:non\s+(?:pr[ée]cis[ée]?|renseign[ée]?|indiqu[ée]?|communiqu[ée]?|d[ée]tect[ée]?|applicable|sp[ée]cifi[ée]?)|pas\s+(?:de|pr[ée]cis[ée])|n\/?a|nd|-+)$/i
const meaningful = (v: unknown): string | undefined => {
  const s = str(v)
  return s && !PLACEHOLDER.test(s) ? s : undefined
}

const iso = (v: unknown): string | undefined => {
  const s = str(v)
  if (!s) return undefined
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toISOString()
}

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  allowed.includes(v as T) ? (v as T) : undefined

/**
 * Date de publication exploitable : parsable, non future, et au plus deux ans
 * avant la remise des offres. Une valeur aberrante — « 2020 » pour un marché
 * 2026, souvent une date interne d'une pièce (PGC, rapport de contrôle) lue
 * comme une date de parution — est écartée plutôt qu'écrite au dossier.
 */
export function plausiblePublishedAt(
  v: unknown,
  responseDeadline?: string,
): string | undefined {
  const s = str(v)
  if (!s) return undefined
  const p = Date.parse(s)
  if (Number.isNaN(p)) return undefined
  const DAY = 24 * 3600 * 1000
  if (p > Date.now() + DAY) return undefined
  const anchor = responseDeadline ? Date.parse(responseDeadline) : NaN
  const ref = Number.isNaN(anchor) ? Date.now() : anchor
  if (p < ref - 2 * 365 * DAY) return undefined
  return new Date(p).toISOString().slice(0, 10)
}

const MARKET_TYPES = ['travaux', 'fournitures', 'services', 'mixte'] as const
const DEPOSIT_MODES = ['electronique', 'papier', 'hybride'] as const
const CATEGORIES = ['dce', 'administratif', 'technique', 'financier', 'memoire', 'depot', 'autre'] as const
const REQUIREMENTS = ['obligatoire', 'recommande', 'facultatif'] as const
const SEVERITIES = ['bloquante', 'critique', 'importante', 'info'] as const

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
}

/** Numéro de lot : entier strictement positif, sinon indéfini. */
function lotNum(v: unknown): number | undefined {
  const n = num(v)
  return n != null && n > 0 ? Math.round(n) : undefined
}

export function normalizeAnalysis(raw: unknown): DceAnalysis {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = (r.identification ?? {}) as Record<string, unknown>
  const dl = (r.deadlines ?? {}) as Record<string, unknown>
  const visit = (dl.site_visit ?? {}) as Record<string, unknown>
  const gn = (r.go_nogo ?? {}) as Record<string, unknown>

  return {
    summary: str(r.summary) ?? '',
    identification: {
      title: str(id.title),
      reference: str(id.reference),
      buyer: str(id.buyer),
      platform: str(id.platform),
      published_at: str(id.published_at),
      region: str(id.region),
      procedure_type: str(id.procedure_type),
      market_type: pick(id.market_type, MARKET_TYPES),
      deposit_mode: pick(id.deposit_mode, DEPOSIT_MODES),
      duration_months: num(id.duration_months),
      estimated_amount_euros: num(id.estimated_amount_euros),
    },
    deadlines: {
      response_deadline: iso(dl.response_deadline),
      questions_deadline: iso(dl.questions_deadline),
      site_visit: Object.keys(visit).length
        ? {
            mandatory: visit.mandatory === true,
            date: iso(visit.date),
            dates: strArr(visit.dates)
              .map(iso)
              .filter((d): d is string => !!d),
            access: str(visit.access),
            details: str(visit.details),
          }
        : undefined,
      offer_validity: str(dl.offer_validity),
      other: arr(dl.other)
        .map((o) => ({ label: str(o.label) ?? '', date: iso(o.date) ?? '' }))
        .filter((o) => o.label && o.date),
    },
    award_criteria: arr(r.award_criteria)
      .map((c) => ({ label: str(c.label) ?? '', weight_pct: num(c.weight_pct) }))
      .filter((c) => c.label),
    lots: arr(r.lots)
      .map((l) => ({
        number: num(l.number) ?? 0,
        title: str(l.title) ?? '',
        amount_euros: num(l.amount_euros),
        duree: meaningful(l.duree),
        variantes: meaningful(l.variantes),
      }))
      .filter((l) => l.number > 0 && l.title),
    required_documents: arr(r.required_documents)
      .map(
        (d): DceRequiredDocument => ({
          label: str(d.label) ?? '',
          category: pick(d.category, CATEGORIES) ?? 'autre',
          requirement: pick(d.requirement, REQUIREMENTS) ?? 'obligatoire',
          requires_signature: d.requires_signature === true,
          requires_chiffrage: d.requires_chiffrage === true,
          lot: lotNum(d.lot),
          source: str(d.source),
        }),
      )
      .filter((d) => d.label),
    contacts: arr(r.contacts)
      .map((c) => ({
        name: str(c.name),
        email: str(c.email),
        phone: str(c.phone),
        role: str(c.role),
      }))
      .filter((c) => c.name || c.email || c.phone),
    risks: arr(r.risks)
      .map((x) => ({
        severity: pick(x.severity, SEVERITIES) ?? 'info',
        message: str(x.message) ?? '',
      }))
      .filter((x) => x.message),
    go_nogo: {
      favorable_signals: strArr(gn.favorable_signals),
      blocking_signals: strArr(gn.blocking_signals),
      recommendation: str(gn.recommendation),
    },
  }
}
