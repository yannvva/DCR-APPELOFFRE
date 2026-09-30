import 'server-only'

import { decodeEntities, isSafeUrl, stripHtml } from '@/lib/tender-import'

const TIMEOUT_MS = 25_000
const MAX_PAGE_BYTES = 2_000_000
const MAX_PDF_FETCH_BYTES = 25 * 1024 * 1024
const MAX_TOOL_CHARS = 14_000

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

async function fetchSafe(
  rawUrl: string,
  accept: string,
  timeoutMs = TIMEOUT_MS,
): Promise<Response | string> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'URL invalide.'
  }
  if (!isSafeUrl(url)) return 'URL non autorisée.'
  try {
    return await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': UA, accept, 'accept-language': 'fr-FR,fr;q=0.9' },
      redirect: 'follow',
    })
  } catch (e) {
    return `Échec réseau : ${e instanceof Error ? e.message.slice(0, 120) : 'inconnu'}`
  }
}

interface SearchHit {
  url: string
  title: string
}

function cleanTitle(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function formatHits(hits: SearchHit[]): string {
  return hits
    .slice(0, 8)
    .map((h, i) => `${i + 1}. ${h.title || h.url}\n   ${h.url}`)
    .join('\n')
}

const DEACCENT = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Mots trop génériques pour prouver la pertinence (présents dans n'importe
 *  quelle page de documentation, y compris les pages leurres anti-bot). */
const GENERIC_TERMS = new Set([
  'pdf',
  'fiche',
  'fiches',
  'technique',
  'techniques',
  'document',
  'documents',
  'download',
  'telecharger',
  'filetype',
  'notice',
  'produit',
  'produits',
])

/**
 * Garde-fou anti-leurre : certains moteurs (Bing sous détection de bot)
 * renvoient des résultats totalement hors-sujet. On exige qu'au moins un
 * résultat partage un terme significatif de la requête — sinon le moteur est
 * considéré en échec et le suivant prend le relais.
 */
function relevant(hits: SearchHit[], query: string): boolean {
  const terms = DEACCENT(query)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !GENERIC_TERMS.has(t))
  if (!terms.length) return true
  return hits.some((h) => {
    const hay = DEACCENT(`${h.title} ${h.url}`)
    return terms.some((t) => hay.includes(t))
  })
}

function parseDdg(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  // Liens de résultats DDG : <a class="result__a" href="//duckduckgo.com/l/?uddg=...">
  for (const m of html.matchAll(
    /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([^<]+)/gi,
  )) {
    const url = decodeDdg(m[1])
    if (url) hits.push({ url, title: cleanTitle(m[2]) })
    if (hits.length >= 8) return hits
  }
  for (const m of html.matchAll(
    /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const url = decodeDdg(m[1])
    const title = cleanTitle(m[2])
    if (url && title) hits.push({ url, title })
    if (hits.length >= 8) return hits
  }
  return hits
}

/** SearXNG (instances publiques) : <article class="result">…<h3><a href>. */
function parseSearx(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  for (const block of html.matchAll(
    /<article[^>]+class="[^"]*result[^"]*"[\s\S]*?<\/article>/gi,
  )) {
    const m =
      block[0].match(
        /<h3[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      ) ?? block[0].match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class="url_header"/i)
    if (!m) continue
    hits.push({
      url: decodeEntities(m[1]),
      title: m[2] ? cleanTitle(m[2]) : decodeEntities(m[1]),
    })
    if (hits.length >= 8) break
  }
  return hits
}

/** Brave Search : liens de résultats `class="… l1"` suivis du titre. */
function parseBrave(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  const rx =
    /<a href="(https?:\/\/[^"]+)"[^>]*class="[^"]*l1[^"]*"[^>]*>[\s\S]{0,4000}?<div class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/g
  for (const m of html.matchAll(rx)) {
    if (/brave\.com|brave\.app/i.test(m[1])) continue
    hits.push({ url: decodeEntities(m[1]), title: cleanTitle(m[2]) })
    if (hits.length >= 8) break
  }
  return hits
}

/** Bing : <li class="b_algo">…<h2><a href="…">titre</a>. */
function parseBing(html: string): SearchHit[] {
  const hits: SearchHit[] = []
  for (const block of html.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/gi)) {
    const m = block[0].match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!m) continue
    const url = decodeBing(m[1])
    const title = cleanTitle(m[2])
    if (url && title) hits.push({ url, title })
    if (hits.length >= 8) break
  }
  return hits
}

function decodeDdg(href: string): string | null {
  const m = href.match(/[?&]uddg=([^&]+)/)
  const url = m ? decodeURIComponent(m[1]) : href
  try {
    return /^https?:/i.test(url) ? new URL(url).toString() : null
  } catch {
    return null
  }
}

/** Bing encapsule ses liens : bing.com/ck/a?…&u=a1<base64url de l'URL>. */
function decodeBing(href: string): string | null {
  const raw = decodeEntities(href)
  if (!/bing\.com\/ck\/a/i.test(raw)) {
    try {
      return /^https?:/i.test(raw) ? new URL(raw).toString() : null
    } catch {
      return null
    }
  }
  const u = raw.match(/[?&]u=([^&]+)/)?.[1]
  if (!u) return null
  try {
    const b64 = u.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/')
    const url = Buffer.from(b64, 'base64').toString('utf8')
    return /^https?:/i.test(url) ? new URL(url).toString() : null
  } catch {
    return null
  }
}

interface Engine {
  name: string
  url: string
  parse: (html: string) => SearchHit[]
  timeout: number
}

/** Instances SearXNG publiques : agrégeables, sans clé, mais limitées en débit
 *  — plusieurs instances pour tourner quand l'une répond 429. */
const SEARX_INSTANCES = [
  'https://opnxng.com',
  'https://paulgo.io',
  'https://searxng.site',
  'https://search.rhscz.eu',
  'https://search.inetol.net',
  'https://searx.tiekoetter.com',
]

/** Délai minimum entre deux requêtes de recherche (courtoisie anti-429). */
const MIN_SEARCH_GAP_MS = 1_500
let lastSearchAt = 0
/** Rotation des instances SearXNG : évite de taper toujours la même en tête. */
let searxRotation = 0

/** Santé du backend de recherche (par processus) : permet de distinguer
 *  « aucun document n'existe » de « les moteurs sont indisponibles ». */
let searchSuccesses = 0
let searchFailures = 0

export function searchHealth(): {
  successes: number
  failures: number
  apiError: string
} {
  return { successes: searchSuccesses, failures: searchFailures, apiError: lastApiError }
}

/** Cache de requêtes : l'agent repose souvent la même question d'un chapitre à
 *  l'autre — sans cache, chaque répétition consommait du quota d'API et
 *  aggravait le rate-limit des moteurs gratuits. */
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 300
const searchCache = new Map<string, { at: number; text: string }>()

function cacheGet(query: string): string | null {
  const entry = searchCache.get(query.trim().toLowerCase())
  if (!entry) return null
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    searchCache.delete(query.trim().toLowerCase())
    return null
  }
  return entry.text
}

/** Vide le cache (changement de configuration de recherche, tests). */
export function clearSearchCache() {
  searchCache.clear()
}

function cacheSet(query: string, text: string) {
  const key = query.trim().toLowerCase()
  if (searchCache.size >= CACHE_MAX) {
    const oldest = searchCache.keys().next().value
    if (oldest) searchCache.delete(oldest)
  }
  searchCache.set(key, { at: Date.now(), text })
}

export function resetSearchHealth() {
  searchSuccesses = 0
  searchFailures = 0
  lastApiError = ''
}

async function throttle() {
  const wait = lastSearchAt + MIN_SEARCH_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastSearchAt = Date.now()
}

/** Exécute un moteur et ne retourne que des résultats exploitables.
 *  Le garde-fou de pertinence n'est appliqué qu'aux moteurs connus pour servir
 *  des pages leurres (Bing) : l'appliquer partout faisait rejeter des résultats
 *  légitimes dont la requête n'apparaît pas dans le titre tronqué. */
async function tryEngine(
  engine: Engine,
  query: string,
  strictRelevance = false,
): Promise<SearchHit[] | null> {
  const res = await fetchSafe(engine.url, 'text/html', engine.timeout)
  if (typeof res === 'string' || !res.ok) return null
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > MAX_PAGE_BYTES) return null
  const hits = engine.parse(decodeEntities(new TextDecoder('utf-8').decode(bytes)))
  if (!hits.length) return null
  return !strictRelevance || relevant(hits, query) ? hits : null
}

/**
 * Recherche web sans clé API, multi-moteurs avec repli en cascade.
 * DuckDuckGo et Brave d'abord (meilleure qualité) ; s'ils sont injoignables ou
 * limités (429), plusieurs instances SearXNG sont interrogées en parallèle,
 * puis Bing en dernier recours — chaque moteur est filtré par un garde-fou de
 * pertinence (Bing sert des pages leurres aux clients non navigateurs).
 * Timeouts courts : un moteur muet ne doit pas consommer le budget de l'agent.
 */
/**
 * Normalise la réponse d'une API de recherche (SearxNG `results[]`, Brave
 * Search API `web.results[]`, Serper `organic[]`…) en résultats exploitables.
 */
export function parseApiResults(payload: unknown): SearchHit[] {
  const seen = new Set<string>()
  const hits: SearchHit[] = []
  const visit = (v: unknown, depth: number) => {
    if (depth > 4 || v == null || hits.length >= 8) return
    if (Array.isArray(v)) {
      for (const item of v) {
        if (hits.length >= 8) return
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>
          const url = o.url ?? o.link ?? o.href
          if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
            if (!seen.has(url)) {
              seen.add(url)
              hits.push({
                url,
                title: cleanTitle(String(o.title ?? o.name ?? url)),
              })
            }
          } else {
            visit(item, depth + 1)
          }
        }
      }
      return
    }
    if (typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'results' || k === 'organic' || k === 'web' || k === 'items' || k === 'data') {
          visit(child, depth + 1)
        }
      }
    }
  }
  visit(payload, 0)
  return hits
}

type ApiProvider = 'serper' | 'tavily' | 'brave' | 'searxng' | 'generic'

/** Détecte le fournisseur d'après l'URL : les API diffèrent par la méthode
 *  (GET/POST), l'en-tête d'authentification et les paramètres. Serper et
 *  Tavily ne répondent qu'en POST — les appeler en GET échouait toujours. */
function apiProvider(url: string): ApiProvider {
  if (/serper\.dev/i.test(url)) return 'serper'
  if (/tavily\.com/i.test(url)) return 'tavily'
  if (/api\.search\.brave\.com/i.test(url)) return 'brave'
  if (/searx|format=json|\/search/i.test(url)) return 'searxng'
  return 'generic'
}

/** Dernière erreur de l'API de recherche configurée (clé invalide, quota…).
 *  Sans cela, une clé mal configurée ressemblait à « aucun résultat ». */
let lastApiError = ''

/** Recherche par API configurée (SEARCH_API_URL) — null si non configurée. */
async function apiSearch(query: string): Promise<SearchHit[] | null> {
  // Lecture directe (variables optionnelles) : la recherche web doit rester
  // utilisable même si le reste de l'environnement est incomplet (tests,
  // scripts CLI) — pas de dépendance au schéma d'env complet.
  const apiUrl = process.env.SEARCH_API_URL
  if (!apiUrl) return null
  const apiKey = process.env.SEARCH_API_KEY
  const provider = apiProvider(apiUrl)
  lastApiError = ''

  const headers: Record<string, string> = { accept: 'application/json' }
  if (apiKey) {
    // Envoyés ensemble : chaque fournisseur lit celui qui le concerne
    // (Brave/Serper `X-API-KEY` ou `X-Subscription-Token`, Tavily `Bearer`).
    headers.authorization = `Bearer ${apiKey}`
    headers['x-subscription-token'] = apiKey
    headers['x-api-key'] = apiKey
  }

  let url = apiUrl
  let init: RequestInit = { headers }
  if (provider === 'serper') {
    init = {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ q: query, num: 10, gl: 'fr', hl: 'fr' }),
    }
  } else if (provider === 'tavily') {
    init = {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ query, max_results: 10, search_depth: 'basic' }),
    }
  } else {
    const enc = encodeURIComponent(query)
    url = apiUrl.includes('{query}')
      ? apiUrl.replace('{query}', enc)
      : `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}q=${enc}${
          provider === 'brave' ? '&count=10' : '&format=json'
        }`
  }

  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      lastApiError = `HTTP ${res.status}`
      return []
    }
    const hits = parseApiResults(await res.json())
    if (!hits.length) lastApiError = 'réponse sans résultat exploitable'
    return hits
  } catch (e) {
    lastApiError = e instanceof Error ? e.message.slice(0, 120) : 'échec réseau'
    return []
  }
}

export async function webSearch(query: string): Promise<string> {
  if (!query.trim()) return 'Requête vide.'
  const cached = cacheGet(query)
  if (cached) {
    searchSuccesses++
    return cached
  }
  const q = encodeURIComponent(query)

  // 1. API configurée (fiable, indépendante du blocage des moteurs HTML).
  const viaApi = await apiSearch(query)
  if (viaApi?.length) {
    searchSuccesses++
    const text = formatHits(viaApi)
    cacheSet(query, text)
    return text
  }
  const failures: string[] = []

  // Brave d'abord : le plus rapide et le plus pertinent quand il répond ;
  // DuckDuckGo ensuite (excellent ailleurs mais souvent injoignable ici, 4 s
  // de timeout seulement pour ne pas gaspiller le budget de l'agent).
  const primary: Engine[] = [
    {
      name: 'Brave',
      url: `https://search.brave.com/search?q=${q}`,
      parse: parseBrave,
      timeout: 8_000,
    },
    {
      name: 'DuckDuckGo',
      url: `https://html.duckduckgo.com/html/?q=${q}`,
      parse: parseDdg,
      timeout: 4_000,
    },
  ]
  for (const engine of primary) {
    await throttle()
    const hits = await tryEngine(engine, query)
    if (hits) {
      searchSuccesses++
      const text = formatHits(hits)
      cacheSet(query, text)
      return text
    }
    failures.push(engine.name)
  }

  // Instances SearXNG en parallèle, en rotation : les instances publiques
  // limitent le débit par IP, on ne tape donc pas toujours les mêmes en tête.
  searxRotation = (searxRotation + 1) % SEARX_INSTANCES.length
  const rotated = [
    ...SEARX_INSTANCES.slice(searxRotation),
    ...SEARX_INSTANCES.slice(0, searxRotation),
  ]
  const searxResults = await Promise.all(
    rotated.map((base) =>
      tryEngine(
        {
          name: base,
          url: `${base}/search?q=${q}`,
          parse: parseSearx,
          timeout: 9_000,
        },
        query,
      ).catch(() => null),
    ),
  )
  for (const hits of searxResults) {
    if (hits) {
      searchSuccesses++
      const text = formatHits(hits)
      cacheSet(query, text)
      return text
    }
  }
  failures.push('SearXNG')

  await throttle()
  // Bing : garde-fou strict (il sert des pages leurres aux clients non navigateurs).
  const bing = await tryEngine(
    {
      name: 'Bing',
      url: `https://www.bing.com/search?q=${q}&setlang=fr`,
      parse: parseBing,
      timeout: 8_000,
    },
    query,
    true,
  )
  if (bing) {
    searchSuccesses++
    const text = formatHits(bing)
    cacheSet(query, text)
    return text
  }
  failures.push('Bing')
  searchFailures++

  // Une API configurée mais en échec doit être signalée explicitement : sinon
  // une clé invalide ou un quota épuisé ressemble à « aucun document trouvé ».
  const apiHint = lastApiError
    ? ` L’API de recherche configurée a échoué (${lastApiError}) — vérifiez SEARCH_API_URL et SEARCH_API_KEY.`
    : ' La recherche web gratuite est bloquée depuis ce réseau : configurez SEARCH_API_URL (SearxNG auto-hébergé ou API Brave/Serper) dans .env.local.'
  return `Aucun résultat (moteurs injoignables, limités ou hors-sujet : ${failures.join(', ')}).${apiHint} Réessaie avec une autre requête.`
}

/** Ouvre une URL : HTML → texte nettoyé, PDF → texte extrait (tronqués). */
export async function webFetch(rawUrl: string): Promise<string> {
  const res = await fetchSafe(rawUrl, 'application/pdf,text/html;q=0.9,*/*;q=0.5')
  if (typeof res === 'string') return res
  // Re-validation de l'URL finale après redirection (SSRF par rebond).
  try {
    if (res.url && !isSafeUrl(new URL(res.url))) {
      return 'Redirection vers une URL non autorisée.'
    }
  } catch {
    return 'Redirection vers une URL non autorisée.'
  }
  if (!res.ok) return `HTTP ${res.status}`

  // Pré-contrôle : un serveur peut annoncer un corps énorme — refuser avant
  // de bufferiser (le contrôle effectif sur les octets lus reste plus bas).
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_PDF_FETCH_BYTES) return 'Document trop volumineux.'

  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0) return 'Page vide.'

  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  // PDF : 25 Mo (fiches fabricants parfois lourdes) ; HTML/texte : 2 Mo suffisent.
  if (bytes.byteLength > (isPdf ? MAX_PDF_FETCH_BYTES : MAX_PAGE_BYTES)) {
    return 'Document trop volumineux.'
  }
  if (isPdf) {
    try {
      // Contournement pdf-parse v1 (même pattern que dce/extract.ts)
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
      const pdf = await pdfParse(Buffer.from(bytes))
      const text = (pdf.text ?? '').replace(/\s{3,}/g, '  ').trim()
      if (text.length < 50) return 'PDF sans texte extractible (scan ?).'
      return `[PDF ${res.url}]\n${text.slice(0, MAX_TOOL_CHARS)}`
    } catch {
      return 'PDF illisible.'
    }
  }

  const ct = res.headers.get('content-type') ?? ''
  if (!/html|text|xml|json/i.test(ct) && !ct.includes('charset')) {
    return `Contenu non lisible (${ct || 'type inconnu'}) — probablement un binaire.`
  }
  const charset = ct.match(/charset=([\w-]+)/i)?.[1]?.toLowerCase() ?? 'utf-8'
  let html = new TextDecoder(charset === 'iso-8859-1' ? 'windows-1252' : charset).decode(bytes)
  if (html.includes('')) html = new TextDecoder('windows-1252').decode(bytes)
  const text = decodeEntities(stripHtml(html)).replace(/\s{3,}/g, '  ').trim()
  const links = extractUsefulLinks(html, res.url)
  if (text.length < 50 && !links.length) return 'Page sans contenu lisible.'
  return (
    `[${res.url}]\n${text.slice(0, MAX_TOOL_CHARS)}` +
    (links.length
      ? `\n\nLIENS UTILES (PDF et documentation technique) :\n${links.join('\n')}`
      : '')
  )
}

/**
 * Extrait les liens exploitables d'une page HTML — surtout les PDF et les
 * pages de documentation. Sans cela, l'agent ouvrait la page « catalogues »
 * d'un fabricant et ne pouvait JAMAIS atteindre la fiche technique : le texte
 * nettoyé supprime les `<a href>`.
 */
export function extractUsefulLinks(html: string, baseUrl: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(
    /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi,
  )) {
    let href = decodeEntities(m[1]).trim()
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href))
      continue
    if (href.startsWith('//')) href = `https:${href}`
    else if (!/^https?:/i.test(href)) {
      try {
        href = new URL(href, baseUrl).toString()
      } catch {
        continue
      }
    }
    const label = cleanTitle(m[2])
    const isPdf = /\.pdf($|[?#])/i.test(href)
    const looksDoc =
      /fiche|notice|documentation|technique|telechar|téléchar|catalog|brochure|dop\b|doe\b|atec|dta|fdes|fds|certificat/i.test(
        `${label} ${href}`,
      )
    if (!isPdf && !looksDoc) continue
    if (seen.has(href)) continue
    seen.add(href)
    out.push(`- ${isPdf ? '[PDF] ' : ''}${label || href}\n  ${href}`)
    if (out.length >= 20) break
  }
  return out
}
