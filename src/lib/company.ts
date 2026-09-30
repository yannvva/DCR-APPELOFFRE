/** Profil société de l'organisation (DCR) — stocké dans organizations.settings.company.
 *  Source de vérité entreprise pour les agents : DC1/DC2, mémoire technique
 *  (couverture, §1 présentation, §3 équipe), fiches, dépôt. */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface CompanyProfile {
  identite: {
    raison_sociale?: string
    forme_juridique?: string // SAS, SARL…
    capital_euros?: string
    siren?: string
    siret?: string
    rcs_ville?: string // RCS de …
    code_ape?: string
    tva_intracom?: string
    date_creation?: string
  }
  siege: {
    adresse?: string // ligne complète
    telephone?: string
    email?: string
    site_web?: string
  }
  /** Représentant signataire (DC1, acte d'engagement). */
  dirigeant: { nom?: string; qualite?: string }
  banque: {
    titulaire?: string
    domiciliation?: string
    iban?: string
    bic?: string
  }
  finance: {
    /** Ex. "2025 — 14 M€" — une ligne par exercice. */
    chiffre_affaires?: string[]
    effectif?: string
    notation_bdf?: string // ex. "G4"
    agences_notation?: string // ex. "Euler Hermes, Coface"
  }
  assurances: {
    /** Ex. "Décennale — AXA — police n°… — valide jusqu'au …" */
    lignes?: string[]
  }
  /** Qualibat, amiante SS4, ISO 9001/14001/45001… */
  certifications: string[]
  /** Membres clés mobilisables (mémoire §3) — "Nom — fonction — expérience". */
  equipe: string[]
  /** Entrepôt, atelier, agences — "Entrepôt 1 000 m² — Île-de-France". */
  implantations: string[]
  /** Chantiers de référence — "Chantier — MOA — année/montant". */
  references: string[]
  /** Texte de présentation entreprise (mémoire §1.1, plaquettes). */
  presentation?: string
}

export const EMPTY_COMPANY_PROFILE: CompanyProfile = {
  identite: {},
  siege: {},
  dirigeant: {},
  banque: {},
  finance: {},
  assurances: {},
  certifications: [],
  equipe: [],
  implantations: [],
  references: [],
}

/** Lit le profil depuis organizations.settings.company (tolérant). */
export function parseCompanyProfile(settings: unknown): CompanyProfile {
  const s = (settings ?? {}) as Record<string, unknown>
  const c = (s.company ?? {}) as Record<string, unknown>
  const sec = (k: keyof CompanyProfile) =>
    (c[k] && typeof c[k] === 'object' ? c[k] : {}) as Record<string, unknown>
  const strs = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
  return {
    identite: sec('identite'),
    siege: sec('siege'),
    dirigeant: sec('dirigeant'),
    banque: sec('banque'),
    finance: { ...sec('finance'), chiffre_affaires: strs(sec('finance').chiffre_affaires) },
    assurances: { lignes: strs(sec('assurances').lignes) },
    certifications: strs(c.certifications),
    equipe: strs(c.equipe),
    implantations: strs(c.implantations),
    references: strs(c.references),
    presentation:
      typeof c.presentation === 'string' && c.presentation.trim() ? c.presentation.trim() : undefined,
  }
}

export function companyProfileIsEmpty(p: CompanyProfile): boolean {
  return (
    !p.presentation &&
    !Object.values(p.identite).some(Boolean) &&
    !Object.values(p.siege).some(Boolean) &&
    !Object.values(p.dirigeant).some(Boolean) &&
    !Object.values(p.banque).some(Boolean) &&
    ![p.finance.effectif, p.finance.notation_bdf, p.finance.agences_notation].some(Boolean) &&
    !(p.finance.chiffre_affaires ?? []).length &&
    !(p.assurances.lignes ?? []).length &&
    !p.certifications.length &&
    !p.equipe.length &&
    !p.implantations.length &&
    !p.references.length
  )
}

// ---------------------------------------------------------------------------
// Éléments demandés par les pièces et les agents (DC1/DC2, mémoire, dépôt)
// ---------------------------------------------------------------------------

export interface CompanyRequirement {
  key: string
  label: string
  /** Où l'information est demandée (DC1, mémoire §3…). */
  usage: string
  /** Ancre de la carte du formulaire (#identite, #contact…). */
  section: string
  filled: boolean
  /** Valeur actuellement enregistrée (aperçu tronqué dans la checklist). */
  value?: string
  /** Champ scalaire éditable en ligne : 'identite.siren', 'banque.iban'… */
  path?: string
}

/** Résumé d'une liste : « 3 lignes — 2025 — 13 897 070 €… ». */
const listValue = (a?: string[], unit = 'ligne') =>
  a?.length
    ? `${a.length} ${unit}${a.length > 1 ? 's' : ''} — ${a[0]}`
    : ''

/** Éléments attendus dans une réponse à marché public — statut rempli/manquant. */
export function companyRequirements(p: CompanyProfile): CompanyRequirement[] {
  const has = (v?: string) => !!v?.trim()
  const t = (v?: string) => v?.trim() ?? ''
  return [
    { key: 'raison_sociale', label: 'Raison sociale', usage: 'DC1, DC2, acte d’engagement', section: 'identite', path: 'identite.raison_sociale', filled: has(p.identite.raison_sociale), value: t(p.identite.raison_sociale) },
    { key: 'forme_juridique', label: 'Forme juridique', usage: 'DC1, DC2', section: 'identite', path: 'identite.forme_juridique', filled: has(p.identite.forme_juridique), value: t(p.identite.forme_juridique) },
    { key: 'capital', label: 'Capital social', usage: 'DC1, DC2', section: 'identite', path: 'identite.capital_euros', filled: has(p.identite.capital_euros), value: p.identite.capital_euros ? `${t(p.identite.capital_euros)} €` : '' },
    { key: 'siren', label: 'SIREN', usage: 'DC1, DC2, attestations', section: 'identite', path: 'identite.siren', filled: has(p.identite.siren), value: t(p.identite.siren) },
    { key: 'siret', label: 'SIRET (siège)', usage: 'DC1, DC2, attestation URSSAF', section: 'identite', path: 'identite.siret', filled: has(p.identite.siret), value: t(p.identite.siret) },
    { key: 'rcs_ville', label: 'RCS (ville)', usage: 'DC1, DC2', section: 'identite', path: 'identite.rcs_ville', filled: has(p.identite.rcs_ville), value: t(p.identite.rcs_ville) },
    { key: 'tva_intracom', label: 'TVA intracommunautaire', usage: 'DC1, attestation fiscale', section: 'identite', path: 'identite.tva_intracom', filled: has(p.identite.tva_intracom), value: t(p.identite.tva_intracom) },
    { key: 'adresse', label: 'Adresse du siège', usage: 'DC1, couverture mémoire', section: 'contact', path: 'siege.adresse', filled: has(p.siege.adresse), value: t(p.siege.adresse) },
    { key: 'telephone', label: 'Téléphone', usage: 'Couverture mémoire, DC1', section: 'contact', path: 'siege.telephone', filled: has(p.siege.telephone), value: t(p.siege.telephone) },
    { key: 'email', label: 'Email', usage: 'DC1, couverture mémoire', section: 'contact', path: 'siege.email', filled: has(p.siege.email), value: t(p.siege.email) },
    { key: 'dirigeant', label: 'Dirigeant (nom)', usage: 'Signature DC1, acte d’engagement', section: 'contact', path: 'dirigeant.nom', filled: has(p.dirigeant.nom), value: t(p.dirigeant.nom) },
    { key: 'qualite', label: 'Qualité du signataire', usage: 'DC1, acte d’engagement', section: 'contact', path: 'dirigeant.qualite', filled: has(p.dirigeant.qualite), value: t(p.dirigeant.qualite) },
    { key: 'iban', label: 'IBAN', usage: 'RIB — paiement du marché', section: 'banque', path: 'banque.iban', filled: has(p.banque.iban), value: t(p.banque.iban) },
    { key: 'bic', label: 'BIC', usage: 'RIB — paiement du marché', section: 'banque', path: 'banque.bic', filled: has(p.banque.bic), value: t(p.banque.bic) },
    { key: 'effectif', label: 'Effectif', usage: 'DC2', section: 'banque', path: 'finance.effectif', filled: has(p.finance.effectif), value: t(p.finance.effectif) },
    { key: 'chiffre_affaires', label: 'Chiffre d’affaires (exercices)', usage: 'DC2', section: 'banque', filled: !!(p.finance.chiffre_affaires ?? []).length, value: listValue(p.finance.chiffre_affaires, 'exercice') },
    { key: 'assurances', label: 'Assurances (décennale, RC pro…)', usage: 'DC1, DC2, pièces', section: 'assurances', filled: !!(p.assurances.lignes ?? []).length, value: listValue(p.assurances.lignes, 'police') },
    { key: 'certifications', label: 'Certifications / qualifications', usage: 'Mémoire, exigences CCTP', section: 'assurances', filled: !!p.certifications.length, value: listValue(p.certifications, 'certification') },
    { key: 'equipe', label: 'Équipe clé', usage: 'Mémoire §3 moyens humains', section: 'equipe', filled: !!p.equipe.length, value: listValue(p.equipe, 'profil') },
    { key: 'references', label: 'Références chantier', usage: 'Mémoire, DC2', section: 'equipe', filled: !!p.references.length, value: listValue(p.references, 'référence') },
    { key: 'presentation', label: 'Présentation de l’entreprise', usage: 'Mémoire §1 présentation', section: 'equipe', filled: !!p.presentation, value: t(p.presentation) },
  ]
}

export function companyCompletion(p: CompanyProfile): { done: number; total: number } {
  const reqs = companyRequirements(p)
  return { done: reqs.filter((r) => r.filled).length, total: reqs.length }
}

/** Types de pièces société (upload + badges de couverture/liste). */
export const COMPANY_DOC_TYPES = [
  { value: 'presentation', label: 'Présentation / plaquette' },
  { value: 'kbis', label: 'Kbis' },
  { value: 'rib', label: 'RIB' },
  { value: 'urssaf', label: 'Attestation URSSAF' },
  { value: 'assurance', label: 'Attestation assurance' },
  { value: 'dc1', label: 'DC1 signé' },
  { value: 'dc2', label: 'DC2 signé' },
  { value: 'attestation_fiscale', label: 'Attestation fiscale' },
  { value: 'qualification', label: 'Qualification / certification' },
  { value: 'cv', label: 'CV encadrant' },
  { value: 'reference', label: 'Référence chantier' },
  { value: 'autre', label: 'Autre pièce société' },
] as const

export const COMPANY_DOC_TYPE_LABELS: Record<string, string> =
  Object.fromEntries(COMPANY_DOC_TYPES.map((t) => [t.value, t.label]))

/**
 * Kit candidature DCR — l'ensemble standard des pièces jointes à chaque
 * réponse (identique pour tous les marchés). `match` affine le contrôle
 * par nom de fichier quand un même type couvre plusieurs attestations.
 */
export const REQUIRED_COMPANY_DOCS: {
  type: string
  label: string
  /** Expression rationnelle optionnelle sur le nom du fichier. */
  match?: RegExp
}[] = [
  { type: 'kbis', label: 'Kbis (< 3 mois)' },
  { type: 'rib', label: 'RIB' },
  { type: 'urssaf', label: 'Attestation URSSAF / vigilance (6 mois)' },
  { type: 'attestation_fiscale', label: 'Attestation fiscale (6 mois)' },
  {
    type: 'assurance',
    match: /rc|d[ée]cennale/i,
    label: 'Assurance RC & décennale',
  },
  { type: 'assurance', match: /pro ?btp/i, label: 'Attestation PRO BTP' },
  { type: 'autre', match: /cibtp/i, label: 'Attestation CIBTP' },
  { type: 'autre', match: /honneur/i, label: 'Attestation sur l’honneur' },
  { type: 'autre', match: /siret|inpi/i, label: 'Attestation SIRET (INPI)' },
  { type: 'qualification', label: 'Qualifications QUALIBAT' },
  {
    type: 'reference',
    label: 'Références chantiers / attestations de travaux',
  },
  { type: 'autre', match: /effectif/i, label: 'Tableau des effectifs' },
  { type: 'dc1', label: 'Gabarit DC1' },
  { type: 'dc2', label: 'Gabarit DC2' },
  { type: 'autre', match: /dc4/i, label: 'Dossier DC4' },
]

/** Contexte texte injecté dans les prompts des agents (mémoire, fiches…). */
export function companyContext(p: CompanyProfile): string {
  const lines: string[] = []
  const put = (label: string, v?: string) => v && lines.push(`- ${label} : ${v}`)
  const puts = (label: string, vs?: string[]) =>
    vs?.length && lines.push(`- ${label} : ${vs.join(' · ')}`)

  put('Raison sociale', p.identite.raison_sociale)
  put(
    'Forme / capital',
    [p.identite.forme_juridique, p.identite.capital_euros && `${p.identite.capital_euros} €`]
      .filter(Boolean)
      .join(' au capital de ') || undefined,
  )
  put('SIREN', p.identite.siren)
  put('SIRET', p.identite.siret)
  put('RCS', p.identite.rcs_ville)
  put('Code APE', p.identite.code_ape)
  put('TVA intracommunautaire', p.identite.tva_intracom)
  put('Création', p.identite.date_creation)
  put('Siège', p.siege.adresse)
  put('Téléphone', p.siege.telephone)
  put('Email', p.siege.email)
  put('Site web', p.siege.site_web)
  put(
    'Représentant (signataire)',
    [p.dirigeant.nom, p.dirigeant.qualite].filter(Boolean).join(' — ') || undefined,
  )
  puts('Chiffre d’affaires', p.finance.chiffre_affaires)
  put('Effectif', p.finance.effectif)
  put('Notation Banque de France', p.finance.notation_bdf)
  put('Agences de notation', p.finance.agences_notation)
  puts('Assurances', p.assurances.lignes)
  puts('Certifications', p.certifications)
  puts('Équipe clé', p.equipe)
  puts('Implantations', p.implantations)
  puts('Références chantier', p.references)
  if (p.presentation) lines.push(`- Présentation : ${p.presentation}`)
  return lines.join('\n')
}

/** Ligne de coordonnées pour la couverture du mémoire
 *  (remplace le placeholder « [ Adresse — Téléphone — Email — Site web ] »). */
export function companyCoverLine(p: CompanyProfile): string | undefined {
  const parts = [p.siege.adresse, p.siege.telephone, p.siege.email, p.siege.site_web]
    .map((x) => x?.trim())
    .filter(Boolean) as string[]
  return parts.length ? parts.join(' — ') : undefined
}

// ---------------------------------------------------------------------------
// Accès agents : pièces société réutilisables (DC1/DC2, dépôt…)
// ---------------------------------------------------------------------------

export interface CompanyDocumentRef {
  id: string
  name: string
  document_type: string | null
  valid_until: string | null
  expired: boolean
  storage_path: string
  mime_type: string
  is_signed: boolean
}

interface DocRow {
  id: string
  name: string
  document_type: string | null
  valid_until: string | null
  storage_path: string
  mime_type: string | null
  is_signed: boolean | null
}

/** Liste les pièces société réutilisables (category='societe', is_reusable)
 *  de l'organisation — à appeler depuis une action/route serveur avec le
 *  client de session (RLS). Les URL signées restent sous getDocumentUrl. */
export async function listCompanyDocuments(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<CompanyDocumentRef[]> {
  const { data } = await supabase
    .from('documents')
    .select('id, name, document_type, valid_until, storage_path, mime_type, is_signed')
    .eq('organization_id', organizationId)
    .eq('category', 'societe')
    .eq('is_reusable', true)
    .order('created_at', { ascending: false })
  const today = new Date().toISOString().slice(0, 10)
  return ((data ?? []) as DocRow[]).map((d) => ({
    id: d.id,
    name: d.name,
    document_type: d.document_type,
    valid_until: d.valid_until,
    expired: !!d.valid_until && d.valid_until < today,
    storage_path: d.storage_path,
    mime_type: d.mime_type ?? 'application/octet-stream',
    is_signed: d.is_signed ?? false,
  }))
}
