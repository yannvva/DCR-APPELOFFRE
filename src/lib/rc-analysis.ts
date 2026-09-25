import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RcAnalysis {
  emails: string[]
  phones: string[]
  dates: { label: string; value: string }[]
  siteVisit: { mandatory: boolean; date: string | null; details: string | null }
  contacts: { name: string; role: string | null }[]
  keySections: { title: string; excerpt: string }[]
  criteria: string[]
  summary: string
}

/** Télécharge un PDF depuis Supabase Storage et l'analyse. */
export async function analyzeRcDocument(
  supabase: SupabaseClient,
  orgId: string,
  documentId: string,
): Promise<RcAnalysis> {
  // 1. Récupérer le chemin du document
  const { data: doc } = await supabase
    .from('documents')
    .select('storage_path, mime_type, name')
    .eq('organization_id', orgId)
    .eq('id', documentId)
    .single()
  if (!doc) throw new Error('Document introuvable.')

  // 2. Télécharger le fichier
  const { data: fileData, error } = await supabase.storage
    .from('documents')
    .download(doc.storage_path)
  if (error || !fileData) throw new Error('Téléchargement du fichier impossible.')

  // 3. Extraire le texte
  let text = ''
  if (doc.mime_type === 'application/pdf') {
    const buf = Buffer.from(await fileData.arrayBuffer())
    // Contournement : pdf-parse v1 tente de charger un fichier test à l'import.
    // On importe directement lib/pdf-parse.js pour éviter ce bug.
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
    const pdf = await pdfParse(buf)
    text = pdf.text
  } else if (doc.mime_type?.startsWith('text/')) {
    text = await fileData.text()
  } else {
    throw new Error('Format non analysable (PDF requis).')
  }

  if (!text || text.trim().length < 20) {
    throw new Error('Texte illisible ou vide dans ce document.')
  }

  return parseRcText(text)
}

/** Analyse le texte extrait d'un RC et retourne les infos structurées. */
export function parseRcText(text: string): RcAnalysis {
  const clean = text.replace(/\s+/g, ' ').trim()

  // Emails
  const emails = [...new Set(clean.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])]

  // Téléphones (FR)
  const phones = [
    ...new Set(
      clean.match(/(?:0|\+33)[1-9](?:[\s.\-]?\d{2}){4}/g) ?? [],
    ),
  ]

  // Dates avec contexte
  const datePattern =
    /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})|(\d{1,2}\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+\d{4})/gi
  const dateContexts: { label: string; value: string }[] = []
  for (const m of clean.matchAll(datePattern)) {
    const date = m[0]
    const before = clean.slice(Math.max(0, m.index! - 80), m.index!)
    const label = detectDateLabel(before)
    if (label) dateContexts.push({ label, value: date })
  }
  // Dédupliquer
  const seen = new Set<string>()
  const dates = dateContexts.filter((d) => {
    const k = `${d.label}:${d.value}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  // Visite obligatoire
  const siteVisitMandatory =
    /visite\s+(obligatoire|de\s+site|des\s+lieux|sur\s+place|de\s+chantier)/i.test(clean) ||
    /recommand[ée]\s+(de\s+)?visite/i.test(clean)
  const visitDateMatch = clean.match(
    /visite[^.]{0,200}?(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+\d{4})/i,
  )
  const visitDetailsMatch = clean.match(
    /visite[^.]{0,300}?\./i,
  )
  const siteVisit = {
    mandatory: siteVisitMandatory,
    date: visitDateMatch?.[1] ?? null,
    details: visitDetailsMatch?.[0]?.trim() ?? null,
  }

  // Contacts (noms + rôles)
  const contacts = extractContacts(clean)

  // Sections clés
  const keySections = extractKeySections(clean)

  // Critères d'attribution
  const criteria = extractCriteria(clean)

  // Résumé
  const summary = buildSummary(clean, { siteVisit: siteVisitMandatory, dates, emails, phones })

  return { emails, phones, dates, siteVisit, contacts, keySections, criteria, summary }
}

function detectDateLabel(before: string): string | null {
  const b = before.toLowerCase()
  if (b.includes('remise') && b.includes('pli')) return 'Remise des plis'
  if (b.includes('limite') && b.includes('offre')) return 'Date limite des offres'
  if (b.includes('visite')) return 'Visite de site'
  if (b.includes('question')) return 'Questions'
  if (b.includes('ouverture')) return 'Ouverture des plis'
  if (b.includes('publication')) return 'Publication'
  if (b.includes('d[ée]but') || b.includes('commencement')) return 'Début du marché'
  if (b.includes('dur[ée]e') || b.includes('ex[ée]cution')) return 'Durée du marché'
  if (b.includes('visite')) return 'Visite'
  return 'Date mentionnée'
}

function extractContacts(text: string): { name: string; role: string | null }[] {
  const contacts: { name: string; role: string | null }[] = []
  const seen = new Set<string>()

  // Pattern : "M./Mme X Y" ou "Monsieur/Madame X Y" suivi d'un rôle
  const namePattern =
    /(?:M\.|Mme|Monsieur|Madame)\s+([A-Z][A-Za-zÀ-ÿ\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ\-]+){0,2})/g
  for (const m of text.matchAll(namePattern)) {
    const name = m[0].trim()
    if (seen.has(name)) continue
    seen.add(name)
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 100)
    const role =
      after.match(/(?:charg[ée]|responsable|directeur|coordinateur|contact)\s+(?:de\s+)?([^.]{3,60})/i)?.[0]?.trim() ??
      null
    contacts.push({ name, role })
  }

  // Pattern : email → nom déduit
  for (const email of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) {
    const localPart = email[0].split('@')[0]
    if (localPart.includes('.')) {
      const name = localPart
        .split(/[._-]/)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ')
      if (!seen.has(name) && name.length > 3) {
        seen.add(name)
        contacts.push({ name, role: null })
      }
    }
  }

  return contacts.slice(0, 10)
}

function extractKeySections(text: string): { title: string; excerpt: string }[] {
  const sections: { title: string; excerpt: string }[] = []
  const sectionTitles = [
    'objet du marché',
    'procédure',
    'critères de sélection',
    "critères d'attribution",
    'modalités de dépôt',
    'pièces à fournir',
    'condition de participation',
    'allotissement',
    'variantes',
    'durée du marché',
    'lieu d\'exécution',
    'caution',
    'garanties',
  ]

  for (const title of sectionTitles) {
    const idx = text.toLowerCase().indexOf(title)
    if (idx >= 0) {
      const excerpt = text.slice(idx, idx + 300).trim()
      sections.push({
        title: title.charAt(0).toUpperCase() + title.slice(1),
        excerpt: excerpt.length > 280 ? excerpt.slice(0, 280) + '…' : excerpt,
      })
    }
  }

  return sections.slice(0, 8)
}

function extractCriteria(text: string): string[] {
  const criteria: string[] = []
  // Critères avec pondération : "Prix : 60%" ou "Valeur technique : 40%"
  const weighted = text.matchAll(
    /(?:crit[èe]re[s]?)\s*[:\-]?\s*([^.]{5,80}?)\s*[:\-]\s*(\d{1,3})\s*%/gi,
  )
  for (const m of weighted) {
    criteria.push(`${m[1].trim()} : ${m[2]}%`)
  }
  if (criteria.length === 0) {
    // Critères listés
    const listMatch = text.match(
      /crit[èe]res?\s+d['e]?\s*attribution\s*[:\-]?\s*([^.]{10,500})/i,
    )
    if (listMatch) {
      criteria.push(listMatch[1].trim().slice(0, 200))
    }
  }
  return criteria
}

function buildSummary(
  text: string,
  info: { siteVisit: boolean; dates: { label: string; value: string }[]; emails: string[]; phones: string[] },
): string {
  const parts: string[] = []
  if (info.siteVisit) parts.push('Visite de site obligatoire détectée.')
  if (info.dates.length > 0) {
    const remise = info.dates.find((d) => d.label === 'Remise des plis')
    if (remise) parts.push(`Date limite de remise des plis : ${remise.value}.`)
  }
  if (info.emails.length > 0) parts.push(`${info.emails.length} contact(s) email trouvé(s).`)
  if (info.phones.length > 0) parts.push(`${info.phones.length} numéro(s) de téléphone trouvé(s).`)
  return parts.join(' ')
}
