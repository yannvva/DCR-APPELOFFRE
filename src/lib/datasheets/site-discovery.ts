import 'server-only'

import { completeJson } from '@/lib/ai/deepseek'
import { decodeEntities, isSafeUrl } from '@/lib/tender-import'

/**
 * Découverte des fiches techniques PDF SANS moteur de recherche.
 *
 * Sur les réseaux d'entreprise, DuckDuckGo/Brave/Bing sont bloqués ou
 * renvoient des résultats leurres : l'agent ne peut alors trouver aucune URL
 * officielle. Ce module contourne le problème en allant directement sur le
 * site du fabricant : résolution du domaine (LLM), puis exploration de la
 * page d'accueil / de la recherche interne du site à la recherche de PDF
 * correspondant au produit.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
const TIMEOUT_MS = 12_000
const MAX_PAGES = 6
const MAX_PDF_BYTES = 25 * 1024 * 1024

/** Mots trop génériques pour identifier un produit. */
const GENERIC = new Set([
  'pdf',
  'fiche',
  'fiches',
  'technique',
  'techniques',
  'document',
  'documents',
  'notice',
  'produit',
  'produits',
  'catalogue',
  'download',
  'telecharger',
  'www',
  'http',
  'https',
])

const DEACCENT = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

/** Jetons significatifs d'un produit (marque, référence, désignation). */
export function tokensOf(...parts: string[]): string[] {
  const tokens = new Set<string>()
  for (const part of parts) {
    for (const t of DEACCENT(part ?? '')
      .split(/[^a-z0-9]+/)
      .filter((x) => x.length >= 3 && !GENERIC.has(x))) {
      tokens.add(t)
    }
  }
  return [...tokens]
}

/** URL PDF absolues trouvées dans un HTML (attributs href/data-src). */
export function pdfLinksIn(html: string, baseUrl: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/(?:href|data-src|data-url)=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)) {
    try {
      const url = new URL(decodeEntities(m[1]), baseUrl)
      if (isSafeUrl(url) && /\.pdf$/i.test(url.pathname)) out.add(url.toString())
    } catch {
      // lien relatif invalide — ignoré
    }
  }
  return [...out]
}

/** Liens internes plausibles (page produit, fiche, catalogue) du même site. */
export function internalLinks(
  html: string,
  baseUrl: string,
  tokens: string[],
): string[] {
  const base = new URL(baseUrl)
  const scored: { url: string; score: number }[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let url: URL
    try {
      url = new URL(decodeEntities(m[1]), base)
    } catch {
      continue
    }
    if (!isSafeUrl(url)) continue
    if (url.hostname !== base.hostname) continue
    if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|docx?|xlsx?)$/i.test(url.pathname)) continue
    const key = url.toString()
    if (seen.has(key)) continue
    const hay = DEACCENT(`${url.pathname} ${m[2].replace(/<[^>]+>/g, ' ')}`)
    const hits = tokens.filter((t) => hay.includes(t)).length
    // Les pages « fiche technique »/« produit » du site sont prioritaires.
    const bonus = /fiche|technique|produit|catalogue|documentation|telechargement/i.test(hay)
      ? 1
      : 0
    if (hits === 0 && !bonus) continue
    seen.add(key)
    scored.push({ url: key, score: hits * 2 + bonus })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PAGES)
    .map((s) => s.url)
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const u = new URL(url)
    if (!isSafeUrl(u)) return null
    const res = await fetch(u, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'fr-FR,fr;q=0.9',
      },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_PDF_BYTES) return null
    return new TextDecoder('utf-8').decode(buf)
  } catch {
    return null
  }
}

/**
 * Demande au LLM le domaine officiel du fabricant (le web ne connaît que la
 * marque ; les URL de fiches sont ensuite découvertes en explorant le site).
 */
export async function resolveManufacturerDomains(
  marque: string,
  designation: string,
  reference: string,
): Promise<string[]> {
  try {
    const { data } = await completeJson<{ domains?: string[] }>({
      system:
        'Tu identifies les sites web OFFICIELS de fabricants de matériaux de ' +
        'construction. Réponds en JSON {"domains": ["https://…"]} — 1 à 3 ' +
        'domaines racine (page d’accueil), sans chemin. Si tu ne connais pas ' +
        'le fabricant avec certitude, réponds {"domains": []}.',
      prompt:
        `Fabricant : « ${marque} »\nProduit : « ${designation} »\n` +
        (reference ? `Référence : « ${reference} »\n` : '') +
        'Quels sont les domaines officiels de ce fabricant (site français en priorité) ?',
      maxTokens: 400,
    })
    return (data?.domains ?? [])
      .filter((d) => typeof d === 'string' && /^https?:\/\//i.test(d))
      .map((d) => d.replace(/\/+$/, ''))
      .slice(0, 3)
  } catch {
    return []
  }
}

/**
 * Explore un site fabricant à la recherche des PDF correspondant aux jetons du
 * produit : accueil, recherche interne du site, puis pages produit détectées.
 */
export async function discoverPdfsOnSite(
  domain: string,
  tokens: string[],
): Promise<string[]> {
  const found = new Set<string>()
  const root = await fetchHtml(domain)
  if (!root) return []

  const candidates = internalLinks(root, domain, tokens)
  // Recherche interne du site (les CMS FR exposent souvent /recherche?q=).
  for (const path of ['/recherche?q=', '/search?q=', '/?s=']) {
    candidates.push(`${domain}${path}${encodeURIComponent(tokens[0] ?? '')}`)
  }

  const pages = candidates.slice(0, MAX_PAGES)
  // Pages fetchées par lots de 3 : une page lente (12 s de timeout)
  // ne bloque plus les suivantes — les sites fabriquants sont lents.
  const PAGE_CONCURRENCY = 3
  for (let i = 0; i < pages.length && found.size < 8; i += PAGE_CONCURRENCY) {
    const batch = pages.slice(i, i + PAGE_CONCURRENCY)
    const htmls = await Promise.all(batch.map((p) => fetchHtml(p)))
    for (let j = 0; j < batch.length; j++) {
      const html = htmls[j]
      if (!html) continue
      for (const pdf of pdfLinksIn(html, batch[j])) {
        // Jetons testés sur le CHEMIN seul : le domaine contient toujours la
        // marque et ferait passer n'importe quel PDF du site (faux positifs).
        let path = pdf
        try {
          path = decodeURIComponent(new URL(pdf).pathname)
        } catch {
          // URL déjà validée par pdfLinksIn — repli sur la chaîne brute
        }
        const hay = DEACCENT(path)
        if (
          tokens.some((t) => hay.includes(t)) ||
          /fiche|technique|ft_|notice|datasheet|produit/i.test(hay)
        ) {
          found.add(pdf)
        }
      }
      if (found.size >= 8) break
    }
  }
  return [...found].slice(0, 8)
}
