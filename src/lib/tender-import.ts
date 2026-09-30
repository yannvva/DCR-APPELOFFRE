import 'server-only'
import { createRequire } from 'node:module'

export interface TenderImport {
  title?: string
  reference?: string
  buyer?: string
  responseDeadline?: string // 'YYYY-MM-DDTHH:mm' pour input datetime-local
  questionsDeadline?: string // 'YYYY-MM-DDTHH:mm'
  publishedAt?: string // 'YYYY-MM-DD'
  siteVisitAt?: string // 'YYYY-MM-DDTHH:mm'
  siteVisitMandatory?: boolean
  estimatedAmountEuros?: number
  durationMonths?: number
  platform?: string
  region?: string
  procedureType?: string
  marketType?: 'travaux' | 'fournitures' | 'services' | 'mixte'
  excerpt?: string
  url: string
}

const TIMEOUT_MS = 12_000
const MAX_BYTES = 2_000_000

const PLATFORM_NAMES: [RegExp, string][] = [
  [/marchesonline\.com/i, 'Marchés Online'],
  [/francemarches\.com/i, 'France Marchés'],
  [/maximilien\.fr|marches-securises\.fr|atexo/i, 'Maximilien'],
  [/place\.gouv\.fr|marches-publics\.gouv\.fr/i, 'PLACE'],
  [/aws-avis\.com/i, 'AWS Avis'],
  [/boamp\.fr/i, 'BOAMP'],
  [/ted\.europa\.eu/i, 'TED (JOUE)'],
]

const MONTHS: Record<string, number> = {
  janvier: 0, fevrier: 1, 'février': 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, 'août': 7, septembre: 8, octobre: 9, novembre: 10,
  decembre: 11, 'décembre': 11,
}

export function isSafeUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) return false
  const h = url.hostname.toLowerCase()
  // Littéraux IPv6 (URL.hostname garde les crochets) : non utilisés pour des
  // sites fabricants et vecteur de contournement ([::ffff:7f00:1] = 127.0.0.1,
  // fd00::/8 ULA, fe80::/10 link-local) → refusés en bloc.
  if (h.startsWith('[')) return false
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return false
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false
  if (h.endsWith('.internal') || h.endsWith('.local')) return false
  return true
}

/**
 * Normalise une saisie utilisateur en URL : retire les caractères invisibles
 * (zero-width, BOM…) fréquents au copier-coller, ajoute https:// si le schéma
 * manque (« francemarches.com/appel-offre/… »). null si toujours invalide.
 */
export function normalizeHttpUrl(input: string): URL | null {
  const cleaned = input
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g, '')
    .trim()
  if (!cleaned) return null
  // Schéma déjà présent (même exotique : ftp:, file: → refusé par isSafeUrl)
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(cleaned) ? cleaned : `https://${cleaned}`
  try {
    return new URL(withScheme)
  } catch {
    return null
  }
}

export function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
}

export function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

function meta(html: string, ...names: string[]) {
  for (const n of names) {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i'))?.[0]
      ?? html.match(new RegExp(`<meta[^>]+content=[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i'))?.[0]
    if (!tag) continue
    const v =
      tag.match(/content\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/content\s*=\s*'([^']*)'/i)?.[1]
    if (v) return decodeEntities(v)
  }
  return undefined
}

/** Cherche une date FR dans la fenêtre de texte après un mot-clé. */
function findDateNear(text: string, keywords: RegExp) {
  const kw = keywords.exec(text)
  if (!kw) return undefined
  const window = text.slice(kw.index, kw.index + 220)

  // dd/mm/yyyy ou dd-mm-yyyy
  const m = window.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/)
  // jj mois aaaa (« 15 janvier 2026 »)
  if (!m) {
    const t = window.match(
      /(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i,
    )
    if (t) {
      const month = MONTHS[t[2].toLowerCase()]
      if (month == null) return undefined
      const day = t[1].padStart(2, '0')
      const mon = String(month + 1).padStart(2, '0')
      const time = captureTime(window)
      return `${t[3]}-${mon}-${day}T${time ?? '12:00'}`
    }
    return undefined
  }
  const day = m[1].padStart(2, '0')
  const mon = m[2].padStart(2, '0')
  const time = captureTime(window)
  return `${m[3]}-${mon}-${day}T${time ?? '12:00'}`
}

function captureTime(window: string) {
  const t = window.match(/(?:à|a)\s+(\d{1,2})[hH:](\d{2})|(\d{1,2})[hH](\d{2})|(\d{1,2}):(\d{2})/)
  if (!t) return undefined
  const hh = (t[1] ?? t[3] ?? t[5]).padStart(2, '0')
  const mm = t[2] ?? t[4] ?? t[6]
  return `${hh}:${mm}`
}

function capture(pattern: RegExp, text: string) {
  const m = text.match(pattern)
  return m ? decodeEntities(m[1]).replace(/\s{2,}/g, ' ').trim() : undefined
}

/** Une référence plausible : majuscules/chiffres/séparateurs, au moins un chiffre.
 *  Parcourt tous les matchs — un libellé « référence » dans le menu ne doit pas
 *  masquer la vraie référence plus loin dans la page. */
function captureRef(pattern: RegExp, text: string) {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
  for (const m of text.matchAll(new RegExp(pattern.source, flags))) {
    const v = decodeEntities(m[1]).trim()
    if (/^[A-Z0-9][A-Z0-9\-_./]{2,45}$/.test(v) && /\d/.test(v)) return v
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Lecture de la page — chaîne de fallback (anti-robot : DataDome, Cloudflare…)
// ---------------------------------------------------------------------------

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

const CHALLENGE_RE =
  /datadome|please enable js|cf-chl|__cf_|just a moment|captcha|are you a robot/i

async function fetchDirect(url: URL): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'fr-FR,fr;q=0.9',
    },
    redirect: 'follow',
  })
  // Re-validation de l'URL finale : une chaîne de redirections peut mener
  // vers une cible interne/privée (SSRF par rebond).
  try {
    if (res.url && !isSafeUrl(new URL(res.url))) {
      throw new Error('Redirection vers une URL non autorisée')
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Redirection')) throw e
    throw new Error('Redirection vers une URL non autorisée')
  }
  if (!res.ok) {
    const head = new TextDecoder('latin1').decode(
      (await res.arrayBuffer().catch(() => new ArrayBuffer(0))).slice(0, 8192),
    )
    const challenge = CHALLENGE_RE.test(head)
    const err = new Error(`HTTP ${res.status}${challenge ? ' anti-robot' : ''}`)
    ;(err as Error & { blocked?: boolean }).blocked =
      res.status === 401 || res.status === 403 || challenge
    throw err
  }
  const declaredSize = Number(res.headers.get('content-length') ?? 0)
  if (declaredSize > MAX_BYTES) throw new Error('Page trop volumineuse')
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) throw new Error('Page trop volumineuse')
  return decodeHtml(bytes, res.headers.get('content-type') ?? '')
}

function decodeHtml(bytes: Uint8Array, contentType: string): string {
  let charset = contentType.match(/charset=([\w-]+)/i)?.[1]?.toLowerCase()
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 8192))
    charset =
      head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]?.toLowerCase() ??
      head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1]?.toLowerCase()
  }
  let html = new TextDecoder(charset ?? 'utf-8').decode(bytes)
  if (!charset && html.includes('\ufffd')) {
    html = new TextDecoder('windows-1252').decode(bytes)
  }
  return html
}

/** Mots-clés significatifs du slug d'URL (recherche BOAMP). */
function slugKeywords(pathname: string): string[] {
  const STOP = new Set([
    'appel', 'offre', 'offres', 'avis', 'marche', 'marches', 'consultation',
    'annonce', 'detail', 'notice', 'html', 'aspx', 'php', 'id', 'ref',
    'de', 'la', 'le', 'les', 'des', 'du', 'et', 'en', 'au', 'aux', 'un', 'une',
    'pour', 'sur', 'par', 'dans', 'avec', 'son', 'sa', 'ses', 'www', 'com', 'fr',
  ])
  return decodeURIComponent(pathname)
    .toLowerCase()
    .replace(/\.(html?|aspx?|php)$/i, '')
    .split(/[^a-zàâäéèêëîïôöùûüç0-9]+/i)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d{8,}$/.test(w))
    .slice(0, 8)
}

interface BoampRecord {
  idweb?: string
  objet?: string
  nomacheteur?: string
  datelimitereponse?: string
  dateparution?: string
  code_departement?: string[]
  type_marche?: string[]
  procedure_libelle?: string
  descripteur_libelle?: string[]
  gestion?: string
}

/** Id BOAMP encodé dans l'URL d'une plateforme :
 *  francemarches « …/appel-offre/3boamp2684820-… » → idweb « 26-84820 ». */
function boampEmbeddedId(pathname: string): string | null {
  const m = pathname.match(/boamp(\d{2})(\d{4,6})/i)
  return m ? `${m[1]}-${m[2]}` : null
}

/** ISO (souvent UTC) → valeur pour input datetime-local en heure locale. */
function toLocalInput(iso: string): string | undefined {
  if (!iso.includes('T')) return `${iso.slice(0, 10)}T12:00`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Fallback BOAMP : francemarches, marchesonline, AWS… republient les avis
 *  BOAMP — l'open-data DILA est la source officielle, sans anti-robot. */
async function fetchViaBoamp(url: URL): Promise<TenderImport | null> {
  const keywords = slugKeywords(url.pathname)

  // 1. Id BOAMP encodé par la plateforme (« boamp2684820 ») — autoritaire.
  // 2. Idweb explicite « YY-NNNNN » en segment propre — bornes pour ne pas
  //    capturer « 20-2026 » dans « 2684820-2026 ».
  const embedded = boampEmbeddedId(url.pathname)
  const idweb =
    embedded ??
    url.pathname.match(/(?<![\d-])(\d{2}-\d{4,6})(?![\d-])/)?.[1] ??
    null
  const where = idweb
    ? `where=${encodeURIComponent(`idweb="${idweb}"`)}`
    : keywords.length >= 2
      ? `where=${encodeURIComponent(`search("${keywords.join(' ')}")`)}`
      : null
  if (!where) return null

  const api =
    'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records' +
    `?limit=15&order_by=dateparution%20desc&${where}`
  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const json = (await res.json()) as { results?: BoampRecord[] }
    const results = json.results ?? []
    if (!results.length) return null

    // Meilleur candidat : recouvrement des mots-clés du slug dans l'objet.
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
    let best: BoampRecord | null = null
    let bestScore = 0
    for (const r of results) {
      const obj = norm(r.objet ?? '')
      if (!obj || !keywords.length) continue
      const matched = keywords.filter((k) => obj.includes(norm(k))).length
      const score = matched / keywords.length
      if (score > bestScore) {
        bestScore = score
        best = r
      }
    }
    if (embedded) {
      // Référence BOAMP intégrée à l'URL de la plateforme : source de vérité.
      best = results[0]
    } else if (idweb) {
      // Idweb glané dans le slug : ne pas retourner un avis sans rapport.
      // (« …2684820-2026… » → « 20-2026 » = avis 2020 non pertinent.)
      if (keywords.length >= 2 && bestScore === 0) return null
      if (!best) best = results[0]
    }
    if (!best || (!idweb && bestScore < 0.4)) return null

    const out: TenderImport = { url: url.toString() }
    out.title = best.objet?.trim()
    out.buyer = best.nomacheteur?.trim()
    out.reference = best.idweb
    const deadline = best.datelimitereponse
      ? toLocalInput(best.datelimitereponse)
      : undefined
    if (deadline) out.responseDeadline = deadline
    if (best.dateparution) out.publishedAt = best.dateparution.slice(0, 10)
    if (best.code_departement?.length) out.region = best.code_departement.join(', ')
    out.platform = 'BOAMP'
    out.procedureType = best.procedure_libelle
    const tm = best.type_marche?.[0]?.toUpperCase()
    out.marketType =
      tm === 'TRAVAUX' ? 'travaux' : tm === 'FOURNITURES' ? 'fournitures' : tm === 'SERVICES' ? 'services' : undefined
    if (best.descripteur_libelle?.length) out.excerpt = best.descripteur_libelle.join(' · ')
    // Visite de site : le bloc « gestion » contient les conditions de participation.
    if (best.gestion && /visite.{0,120}obligatoire|obligatoire.{0,60}visite/i.test(best.gestion)) {
      out.siteVisitMandatory = true
    }
    return out
  } catch {
    return null
  }
}

/** Fallback lecteur : r.jina.ai rend la page côté serveur (markdown). */
async function fetchViaJina(url: URL): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url.toString()}`, {
      signal: AbortSignal.timeout(30_000),
      headers: { accept: 'text/plain', 'user-agent': UA },
    })
    if (!res.ok) return null
    const text = await res.text()
    if (!text || text.length < 200) return null
    // Jina signale elle-même les challenges CAPTCHA
    if (/captcha|please make sure you are authorized/i.test(text.slice(0, 1500)) && text.length < 3000) {
      return null
    }
    return text
  } catch {
    return null
  }
}

/** Fallback navigateur : Chrome réel via Playwright (require non-statique —
 *  devDependency locale, absente en prod). Désactivé sous vitest. */
async function fetchViaBrowser(url: URL): Promise<string | null> {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null
  try {
    const req = createRequire(process.cwd() + '/package.json')
    const { chromium } = req('@playwright/test') as typeof import('@playwright/test')
    const browser = await chromium.launch({ channel: 'chrome', headless: true })
    try {
      const ctx = await browser.newContext({ locale: 'fr-FR', userAgent: UA })
      const page = await ctx.newPage()
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
      // Laisse le challenge JS éventuel se résoudre tout seul
      for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(2500)
        const html = await page.content()
        if (!CHALLENGE_RE.test(html) && html.length > 2000) return html
      }
      return null
    } finally {
      await browser.close()
    }
  } catch {
    return null
  }
}

/** Fallback archive : dernier snapshot Wayback Machine de l'avis. */
async function fetchViaWayback(url: URL): Promise<string | null> {
  try {
    const avail = (await (
      await fetch(
        `https://archive.org/wayback/available?url=${encodeURIComponent(url.toString())}`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      )
    ).json()) as { archived_snapshots?: { closest?: { url?: string } } }
    const snap = avail.archived_snapshots?.closest?.url
    if (!snap || !isSafeUrl(new URL(snap))) return null
    const res = await fetch(snap, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': UA } })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > MAX_BYTES) return null
    const html = decodeHtml(bytes, res.headers.get('content-type') ?? '')
    return CHALLENGE_RE.test(html) ? null : html
  } catch {
    return null
  }
}

export async function importTenderFromUrl(rawUrl: string): Promise<TenderImport> {
  const url = normalizeHttpUrl(rawUrl)
  if (!url) throw new Error('URL invalide')
  if (!isSafeUrl(url)) throw new Error('URL non autorisée')

  const tried: string[] = []
  let html: string | null = null
  try {
    html = await fetchDirect(url)
  } catch (e) {
    tried.push(`accès direct (${e instanceof Error ? e.message : 'échec'})`)
  }

  if (html) {
    const parsed = parseTenderPage(html, url)
    // Page rendue JS-only (coquille vide) → on tente les autres canaux
    if (parsed.title || parsed.responseDeadline || parsed.buyer) return parsed
    html = null
    tried.push('page sans contenu exploitable')
  }

  // BOAMP open-data : source officielle des avis republiés par les plateformes
  const boamp = await fetchViaBoamp(url)
  if (boamp) return boamp
  tried.push('BOAMP')

  // Lecteur distant (rend les pages JS, passe certaines protections)
  html = await fetchViaJina(url)
  if (html) {
    const parsed = parseTenderPage(html, url)
    if (parsed.title || parsed.responseDeadline || parsed.buyer) return parsed
    html = null
  }
  tried.push('lecteur distant')

  // Chrome réel headless (local uniquement)
  html = await fetchViaBrowser(url)
  if (html) {
    const parsed = parseTenderPage(html, url)
    if (parsed.title || parsed.responseDeadline || parsed.buyer) return parsed
    html = null
  }
  tried.push('navigateur Chrome')

  // Snapshot archive.org
  html = await fetchViaWayback(url)
  if (html) {
    const parsed = parseTenderPage(html, url)
    if (parsed.title || parsed.responseDeadline || parsed.buyer) return parsed
  }
  tried.push('archive.org')

  throw new Error(
    `${url.hostname} bloque la lecture automatique — tentées : ${tried.join(', ')}. ` +
      'Ouvrez l’avis dans votre navigateur puis collez le contenu, ou renseignez le dossier manuellement.',
  )
}

function parseTenderPage(html: string, url: URL): TenderImport {
  const text = decodeEntities(stripHtml(html))

  const out: TenderImport = { url: url.toString() }

  // Plateforme
  out.platform = PLATFORM_NAMES.find(([re]) => re.test(url.hostname))?.[1] ?? url.hostname

  // Borne « début du libellé suivant » — le texte aplati n'a plus de sauts de ligne.
  const NEXT_LABEL =
    /(?=\s+(?:objet|intitul[ée]|r[ée]f[ée]rence|organisme|entit[ée]|service|type d'annonce|cat[ée]gorie|proc[ée]dure|date|section|adresse|code postal|ville|pays|contact|courriel|e-mail|t[ée]l[ée]phone|site web|descriptif|d[ée]partement|cpv|nature|forme juridique|num[ée]ro)\b|\||$)/

  // Titre : libellé « Intitulé : » / « Objet : » (avis structurés) > og:title > h1 > <title>
  const labelTitle =
    capture(
      new RegExp(`intitul[ée]\\s*[:\\-–]\\s*(.{4,200}?)${NEXT_LABEL.source}`, 'i'),
      text,
    ) ??
    capture(new RegExp(`\\bobjet\\s*[:\\-–]\\s*(.{4,200}?)${NEXT_LABEL.source}`, 'i'), text)
  out.title =
    labelTitle ||
    meta(html, 'og:title', 'twitter:title') ||
    capture(/^Title:\s*(.{4,200})$/im, text) || // sortie lecteur distant (markdown)
    decodeEntities(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1].replace(/<[^>]+>/g, '') ?? '') ||
    decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
  if (out.title) {
    out.title = out.title
      .replace(/\s*[|\-–—]\s*(Marchés? Online|France Marchés|PLACE|BOAMP).*$/i, '')
      .replace(/\.$/, '')
      .trim()
  }

  out.excerpt = meta(html, 'og:description', 'description')

  // Date limite de réponse
  out.responseDeadline =
    findDateNear(
      text,
      /date limite (?:de )?(?:remise|d[ée]p[ôo]t|r[ée]ception)(?: des| d'| de l')?\s*(?:offres?|plis?|candidatures?|propositions?)?/i,
    ) ??
    findDateNear(
      text,
      /(?:date(?:\s+et\s+heure)?\s+)?limite\s+de\s+(?:remise|r[ée]ception|d[ée]p[ôo]t)\s+des?\s*(?:plis?|offres?|candidatures?|propositions?)/i,
    ) ??
    findDateNear(text, /(?:date de )?cl[ôo]ture/i) ??
    findDateNear(text, /date limite/i)

  // Date limite de questions / renseignements
  out.questionsDeadline =
    findDateNear(
      text,
      /date limite (?:de |pour )?(?:la |l')?(?:remise|d[ée]p[ôo]t|transmission|envoi)\s+d['’]?(?:une |des |les )?(?:demandes? d['’]informations?|questions?|renseignements?)/i,
    ) ??
    findDateNear(text, /questions?\s+(?:peuvent être pos[ée]es\s+)?(?:jusqu['’]au|au plus tard)/i) ??
    findDateNear(text, /demandes? d['’]informations?\s+compl[ée]mentaires?/i)

  // Visite de site / réunion d'information (+ caractère obligatoire)
  const visitKw = /visite\s+(?:de|sur)\s+site|r[ée]union\s+d['’]information/i
  const visitM = visitKw.exec(text)
  if (visitM) {
    out.siteVisitAt = findDateNear(text, visitKw)
    const window = text.slice(visitM.index, visitM.index + 200)
    if (/obligatoire/i.test(window)) out.siteVisitMandatory = true
  }
  if (!out.siteVisitMandatory && /visite\s+(?:de|sur)\s+site\s+obligatoire/i.test(text)) {
    out.siteVisitMandatory = true
  }

  // Date de publication
  const pub = findDateNear(text, /(?:date de )?publication/i) ??
    findDateNear(text, /parution|diffus[ée]e? le/i)
  if (pub) out.publishedAt = pub.slice(0, 10)

  // Montant / valeur estimée (avec multiplicateur k€ / M€)
  const amtM = text.match(
    /(?:montant|valeur|enveloppe)\s+(?:estim[ée]e?|pr[ée]visionnel(?:le)?)[^0-9]{0,40}(\d[\d\s .,]*?)\s*(m€|k€|€|millions?|milliers?|euros?|eur)?/i,
  )
  if (amtM) {
    const num = Number(amtM[1].replace(/[\s ]/g, '').replace(',', '.'))
    const unit = (amtM[2] ?? '').toLowerCase()
    const mult = unit.startsWith('m') ? 1_000_000 : unit.startsWith('k') ? 1_000 : 1
    if (Number.isFinite(num) && num > 0) {
      out.estimatedAmountEuros = Math.round(num * mult * 100) / 100
    }
  }

  // Durée du marché (« durée : 12 mois », « durée d'exécution de 2 ans »)
  const durM = text.match(
    /dur[ée]e(?:\s+(?:du march[ée]|d['’]ex[ée]cution|initiale|contractuelle))?\s*(?::|de|d['’]environ)?\s*(\d{1,3})\s*(mois|an)/i,
  )
  if (durM) {
    out.durationMonths = durM[2].startsWith('an') ? Number(durM[1]) * 12 : Number(durM[1])
  }

  // Acheteur : « Nom officiel : X » (JOUE), « Organisme : X » (Maximilien/Atexo),
  // puis libellés génériques. La capture s'arrête au libellé du champ suivant.
  const NEXT_FIELD =
    /(?=\s+(?:num[ée]ro d'enregistrement|forme juridique|entit[ée]\s+publique|service|adresse|code postal|ville|pays|point de contact|contact|t[ée]l[ée]phone|courriel|e-mail|site web|type d'annonce|cat[ée]gorie|proc[ée]dure|objet|intitul[ée]|r[ée]f[ée]rence|date|d[ée]partement|descriptif|nature|section)\b|\.|,|\||$)/
  out.buyer =
    capture(new RegExp(`nom officiel\\s*[:\\-–]?\\s*(.{3,140}?)${NEXT_FIELD.source}`, 'i'), text) ??
    capture(new RegExp(`ma[îi]tre d'ouvrage\\s*[:\\-–]?\\s*(.{3,140}?)${NEXT_FIELD.source}`, 'i'), text) ??
    capture(
      new RegExp(`organisme\\s*[:\\-–]\\s*(.{3,140}?)${NEXT_FIELD.source}`, 'i'),
      text,
    ) ??
    capture(
      new RegExp(`acheteur(?:\\s+public)?\\s*[:\\-–]\\s*(.{3,140}?)${NEXT_FIELD.source}`, 'i'),
      text,
    )

  // Référence de consultation : « Annonce n° X », « Référence : X »
  out.reference =
    captureRef(/annonce\s+n[°o]\s*[:\-–]?\s*([A-Za-z0-9][A-Za-z0-9\-_./]{2,45})/i, text) ??
    captureRef(
      /r[ée]f[ée]rence(?: de la consultation| du dossier)?\s*[:\-–]?\s*(?:n[°o]\s*)?([A-Za-z0-9][A-Za-z0-9\-_./]{2,45})/i,
      text,
    )

  // Type d'annonce (procédure) et catégorie principale (type de marché)
  out.procedureType = capture(
    new RegExp(`type d'annonce\\s*[:\\-–]\\s*(.{3,120}?)${NEXT_LABEL.source}`, 'i'),
    text,
  )
  const cat = capture(/cat[ée]gorie principale\s*[:\-–]?\s*(\w{3,20})/i, text)?.toLowerCase()
  if (cat) {
    out.marketType = cat.startsWith('travaux')
      ? 'travaux'
      : cat.startsWith('fournit')
        ? 'fournitures'
        : cat.startsWith('service') || cat.startsWith('prestation')
          ? 'services'
          : undefined
  }

  // Département(s) de publication / région — liste stricte de codes « 94, 75 »
  out.region =
    capture(
      /d[ée]partement\(s\)(?: de publication)?\s*[:\-–]?\s*(\d{2,3}(?:\s*[,;]\s*\d{2,3})*)/i,
      text,
    ) ??
    capture(/d[ée]partement\s*[:\-–]\s*([^\n]{2,80}?)(?:\.|,|\||$)/i, text) ??
    capture(/r[ée]gion\s*[:\-–]\s*([^\n]{2,80}?)(?:\.|,|\||$)/i, text) ??
    // Fallback : code postal dans le nom de l'acheteur « …(94000 - Créteil) »
    out.buyer?.match(/\((\d{2})\d{3}\s*[-–]/)?.[1]

  return out
}
