import 'server-only'

export interface TenderImport {
  title?: string
  reference?: string
  buyer?: string
  responseDeadline?: string // 'YYYY-MM-DDTHH:mm' pour input datetime-local
  publishedAt?: string // 'YYYY-MM-DD'
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

function isSafeUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) return false
  const h = url.hostname.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return false
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false
  if (h.endsWith('.internal') || h.endsWith('.local')) return false
  return true
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
}

function decodeEntities(s: string) {
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

export async function importTenderFromUrl(rawUrl: string): Promise<TenderImport> {
  const url = new URL(rawUrl.trim())
  if (!isSafeUrl(url)) throw new Error('URL non autorisée')

  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'fr-FR,fr;q=0.9',
    },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`Page inaccessible (HTTP ${res.status})`)

  const declaredSize = Number(res.headers.get('content-length') ?? 0)
  if (declaredSize > MAX_BYTES) throw new Error('Page trop volumineuse')
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) throw new Error('Page trop volumineuse')

  // Charset : header HTTP, meta charset, sinon heuristique U+FFFD → windows-1252
  const ct = res.headers.get('content-type') ?? ''
  let charset = ct.match(/charset=([\w-]+)/i)?.[1]?.toLowerCase()
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
  const text = decodeEntities(stripHtml(html))

  const out: TenderImport = { url: rawUrl.trim() }

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

  // Date de publication
  const pub = findDateNear(text, /(?:date de )?publication/i) ??
    findDateNear(text, /parution|diffus[ée]e? le/i)
  if (pub) out.publishedAt = pub.slice(0, 10)

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
