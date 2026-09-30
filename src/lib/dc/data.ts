import {
  companyRequirements,
  parseCompanyProfile,
  type CompanyProfile,
} from '@/lib/company'
import type { TenderLot } from '@/lib/types'

/**
 * Mapping « profil société + dossier d'AO » → placeholders {{...}} et cases
 * CB_* des gabarits DC1/DC2 (base/dc1.docx, dc2.docx).
 */

export interface DcContext {
  profile: CompanyProfile
  tender: { title: string; reference: string | null; market_type: string | null }
  /** Nom de l'acheteur (compte CRM) — seul champ fiable. */
  buyerName?: string
  /** Lignes d'adresse de l'acheteur si connues. */
  buyerAddress?: string[]
  /** Lots retenus pour la candidature (DC1 commun ; un DC2 par lot). */
  lots: Pick<TenderLot, 'number' | 'title'>[]
  /** Nombre total de lots de la consultation (détecte « tous les lots »). */
  totalLots: number
}

const clean = (v?: string) => v?.trim() ?? ''

function objetLine(ctx: DcContext, lot?: Pick<TenderLot, 'number' | 'title'>) {
  const base =
    clean(ctx.tender.title) +
    (ctx.tender.reference ? ` — Réf. ${ctx.tender.reference}` : '')
  return lot ? `${base}\nLot n°${lot.number} – ${lot.title}` : base
}

/** Objet mono-ligne pour le pied de page (« … – Lot 01 » sur le DC2). */
function objetFooter(ctx: DcContext, lot?: Pick<TenderLot, 'number' | 'title'>) {
  const t = clean(ctx.tender.title)
  return lot ? `${t} – Lot ${String(lot.number).padStart(2, '0')}` : t
}

function identityVars(p: CompanyProfile): Record<string, string> {
  return {
    RAISON_SOCIALE: clean(p.identite.raison_sociale).toUpperCase(),
    ADRESSE: clean(p.siege.adresse).toUpperCase(),
    EMAIL: clean(p.siege.email),
    TELEPHONE: p.siege.telephone ? `Tél. : ${clean(p.siege.telephone)}` : '',
    SIRET: clean(p.identite.siret),
    SITE_WEB: clean(p.siege.site_web),
    SITE_PREUVES: clean(p.siege.site_web),
  }
}

export function dc1Vars(ctx: DcContext): Record<string, string> {
  return {
    ACHETEUR: [ctx.buyerName, ...(ctx.buyerAddress ?? [])]
      .filter((l): l is string => !!clean(l))
      .join('\n'),
    OBJET: objetLine(ctx),
    OBJET_FOOTER: objetFooter(ctx),
    LOTS: ctx.lots.map((l) => `Lot n°${l.number} – ${l.title}`).join('\n'),
    ...identityVars(ctx.profile),
  }
}

export function dc1Checks(ctx: DcContext): Record<string, boolean> {
  const allSelected = ctx.totalLots > 0 && ctx.lots.length === ctx.totalLots
  return {
    CB_MARCHE: ctx.totalLots === 0,
    CB_TOUS_LOTS: allSelected,
    CB_LOTS: ctx.totalLots > 0 && !allSelected,
    CB_SEUL: true,
    CB_GROUPEMENT: false,
    CB_CONJOINT: false,
    CB_SOLIDAIRE: false,
    CB_MANDATAIRE_SOLIDAIRE: false,
    CB_EXCLUSIONS: true,
    CB_F3_DC2: true,
    CB_F3_PIECES: false,
  }
}

// ---------------------------------------------------------------------------
// DC2 — finances
// ---------------------------------------------------------------------------

interface CaLine {
  year?: string
  ca: string
  part?: string
}

/** « 2025 — 14 M€ — 54 % » ou « 2024 : 3 696 185 € » → {year, ca, part}. */
export function parseCaLine(line: string): CaLine {
  const m = line.match(/(\d{4})\s*[—–\-:]\s*(.+)$/)
  if (!m) return { ca: line.trim() }
  const [ca, part] = m[2].split(/\s+[—–]\s+/)
  return { year: m[1], ca: (ca ?? '').trim(), part: part?.trim() }
}

function caToEuros(ca: string): number | null {
  const m = ca.replace(/\s/g, '').match(/^(\d+(?:[.,]\d+)?)/)
  if (!m) return null
  let v = parseFloat(m[1].replace(',', '.'))
  if (/M€|M ?€|M HT/i.test(ca)) v *= 1_000_000
  else if (/k€|K€/i.test(ca)) v *= 1_000
  return Number.isFinite(v) ? v : null
}

/** PME au sens de la recommandation 2003 : effectif < 250 ET CA ≤ 50 M€. */
export function isPme(profile: CompanyProfile): boolean {
  const eff = parseInt(profile.finance.effectif ?? '', 10)
  const lines = (profile.finance.chiffre_affaires ?? []).map(parseCaLine)
  // L'ordre de saisie est libre : on teste l'exercice le plus récent.
  const dated = lines
    .filter((l): l is CaLine & { year: string } => !!l.year)
    .sort((a, b) => b.year.localeCompare(a.year))
  const latest = dated[0] ?? lines[lines.length - 1]
  const last = latest ? caToEuros(latest.ca) : null
  const okEff = Number.isNaN(eff) ? true : eff < 250
  const okCa = last == null ? true : last <= 50_000_000
  return okEff && okCa
}

function dateCreation(p: CompanyProfile): string {
  const d = clean(p.identite.date_creation)
  if (/^\d{4}$/.test(d)) return `01/01/${d}`
  return d
}

export function dc2Vars(
  ctx: DcContext,
  lot?: Pick<TenderLot, 'number' | 'title'>,
): Record<string, string> {
  const cas = (ctx.profile.finance.chiffre_affaires ?? [])
    .slice(0, 3)
    .map(parseCaLine)
  const vars: Record<string, string> = {
    ACHETEUR: [ctx.buyerName, ...(ctx.buyerAddress ?? [])]
      .filter((l): l is string => !!clean(l))
      .join('\n'),
    OBJET: objetLine(ctx, lot),
    OBJET_FOOTER: objetFooter(ctx, lot),
    FORME_JURIDIQUE: clean(ctx.profile.identite.forme_juridique),
    DATE_CREATION: dateCreation(ctx.profile),
    ...identityVars(ctx.profile),
  }
  for (let i = 0; i < 3; i++) {
    const c = cas[i]
    vars[`EXERCICE_${i + 1}`] = c?.year
      ? `Exercice du 01/01/${c.year} au 31/12/${c.year}`
      : ''
    vars[`CA_${i + 1}`] = c ? `${c.ca}${/€|H\.?T/i.test(c.ca) ? '' : ' € H.T.'}` : ''
    vars[`CA_PART_${i + 1}`] = c?.part ?? ''
  }
  return vars
}

export function dc2Checks(ctx: DcContext): Record<string, boolean> {
  const pme = isPme(ctx.profile)
  const travaux = ctx.tender.market_type === 'travaux' || ctx.tender.market_type === 'mixte'
  return {
    CB_PME_OUI: pme,
    CB_PME_NON: !pme,
    CB_RESERVE_INSERTION: false,
    CB_RESERVE_ADAPTEE: false,
    CB_RESERVE_ESAT: false,
    CB_RESERVE_ESS: false,
    CB_RESERVE_PENITENTIAIRE: false,
    CB_C3_DECLARATION: true,
    CB_DECENNALE: travaux,
  }
}

/**
 * Champs du profil société requis pour produire des DC1/DC2 propres —
 * la page /societe liste les mêmes éléments.
 */
export function dcMissingFields(settings: unknown): string[] {
  const profile = parseCompanyProfile(settings)
  const wanted = new Set([
    'raison_sociale',
    'siret',
    'forme_juridique',
    'adresse',
    'email',
    'telephone',
    'chiffre_affaires',
    'effectif',
  ])
  return companyRequirements(profile)
    .filter((r) => wanted.has(r.key) && !r.filled)
    .map((r) => r.label)
}
