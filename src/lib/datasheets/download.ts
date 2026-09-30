import 'server-only'

import { isSafeUrl } from '@/lib/tender-import'
import { extractUsefulLinks } from '@/lib/ai/web-tools'

const TIMEOUT_MS = 30_000
const MAX_PDF_BYTES = 25 * 1024 * 1024 // aligné sur la limite du module documents

export interface PdfFetchResult {
  data?: Uint8Array
  size?: number
  error?: string
  /** URL effectivement téléchargée (renseignée si elle diffère de l'URL demandée). */
  url?: string
}

/**
 * Résout une PAGE produit (HTML) vers son PDF : les fabricants publient
 * souvent la fiche derrière une page « produit » et l'agent renvoie cette page
 * en dernier recours. Sans cette étape, ces documents finissaient en échec
 * « pas un PDF » alors que la fiche était accessible en un clic de plus.
 */
export async function resolvePdfFromPage(
  pageUrl: string,
): Promise<PdfFetchResult> {
  const raw = pageUrl.trim()
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let page: Response
  try {
    const url = new URL(candidate)
    if (!isSafeUrl(url)) return { error: 'URL non autorisée' }
    page = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'fr-FR,fr;q=0.9',
      },
      redirect: 'follow',
    })
  } catch {
    return { error: 'page produit inaccessible' }
  }
  if (!page.ok) return { error: `page produit HTTP ${page.status}` }
  // Pages produit lourdes (Liferay/CEMEX ≈ 530 Ko) : les liens « Télécharger
  // le PDF » sont souvent en bas de page — caper à 1,5 Mo ne les coupe plus.
  const html = (await page.text()).slice(0, 1_500_000)
  // Les PDF d'abord, puis les liens « bibliothèque de documents » des CMS
  // fabricants (Liferay /documents/d/…, download.ashx, scene7…) qui servent
  // un PDF sans extension .pdf dans l'URL, puis le reste. fetchPdf valide
  // le contenu (%PDF) et écarte les faux positifs.
  const score = (u: string) =>
    /\.pdf($|[?#])/i.test(u)
      ? 2
      : /\/documents?\b|\/m[ée]dias?\b|\/downloads?\b|\.ashx|scene7|\/fichiers?\b|attachment|\/asset|getfile/i.test(
            u,
          )
        ? 1
        : 0
  const links = extractUsefulLinks(html, page.url || candidate)
    .map((entry) => entry.split('\n').pop()?.trim() ?? '')
    .filter((u) => /^https?:/i.test(u))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 6)
  for (const link of links) {
    const dl = await fetchPdf(link)
    if (dl.data) return { ...dl, url: link }
  }
  return { error: 'aucun PDF trouvé sur la page produit' }
}

/**
 * Télécharge un PDF officiel depuis son URL (côté serveur — pas besoin du
 * navigateur comme dans le workflow Cowork). Garde-fous SSRF + taille +
 * vérification magique %PDF.
 */
export async function fetchPdf(rawUrl: string): Promise<PdfFetchResult> {
  // Les agents renvoient parfois « www.acme.com/f.pdf » sans schéma —
  // on complète en https plutôt que de rejeter.
  const raw = rawUrl.trim()
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { error: 'URL invalide' }
  }
  if (!isSafeUrl(url)) return { error: 'URL non autorisée' }

  let res: Response
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.5',
        'accept-language': 'fr-FR,fr;q=0.9',
      },
      redirect: 'follow',
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 200) : 'Échec réseau' }
  }
  // Re-validation de l'URL finale : un lien officiel ne doit pas pouvoir
  // rebondir par redirection vers une adresse interne/privée (SSRF).
  if (res.url && res.url !== url.toString()) {
    try {
      if (!isSafeUrl(new URL(res.url))) {
        return { error: 'Redirection vers une URL non autorisée' }
      }
    } catch {
      return { error: 'Redirection vers une URL non autorisée' }
    }
  }
  if (!res.ok) return { error: `HTTP ${res.status}` }

  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_PDF_BYTES) return { error: 'PDF trop volumineux (>25 Mo)' }

  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0) return { error: 'fichier vide' }
  if (bytes.byteLength > MAX_PDF_BYTES) return { error: 'PDF trop volumineux (>25 Mo)' }

  // Certains fabricants servent le PDF sans content-type correct (scene7, download.ashx)
  const isPdf =
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 // %PDF
  if (!isPdf) {
    const ct = res.headers.get('content-type') ?? ''
    return { error: `pas un PDF (${ct || 'content-type inconnu'})` }
  }
  return { data: bytes, size: bytes.byteLength }
}
