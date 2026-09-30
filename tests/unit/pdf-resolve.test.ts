import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { resolvePdfFromPage } from '@/lib/datasheets/download'

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])

function htmlPage(body: string) {
  return {
    ok: true,
    status: 200,
    url: 'https://www.fabricant.fr/produit/m300',
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
  }
}

function pdfResponse() {
  return {
    ok: true,
    status: 200,
    url: 'https://www.fabricant.fr/doc/ft-m300.pdf',
    headers: new Headers({ 'content-type': 'application/pdf' }),
    text: async () => '',
    arrayBuffer: async () => PDF_BYTES.buffer.slice(0) as ArrayBuffer,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('resolvePdfFromPage', () => {
  it('extrait le PDF officiel depuis une page produit', async () => {
    const html = `
      <a href="/mentions-legales">Mentions légales</a>
      <a href="/doc/ft-m300.pdf">Télécharger la fiche technique</a>`
    vi.stubGlobal('fetch', async (input: unknown) =>
      String(input).includes('.pdf') ? pdfResponse() : htmlPage(html),
    )
    const r = await resolvePdfFromPage('https://www.fabricant.fr/produit/m300')
    expect(r.data?.byteLength).toBe(PDF_BYTES.byteLength)
    expect(r.url).toBe('https://www.fabricant.fr/doc/ft-m300.pdf')
  })

  it('échoue proprement quand la page n’expose aucun PDF', async () => {
    vi.stubGlobal('fetch', async () => htmlPage('<a href="/contact">Contact</a>'))
    const r = await resolvePdfFromPage('https://www.fabricant.fr/produit/m300')
    expect(r.data).toBeUndefined()
    expect(r.error).toContain('aucun PDF')
  })

  it('refuse une URL non autorisée (SSRF)', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ne doit pas être appelé')
    })
    const r = await resolvePdfFromPage('http://localhost:8080/admin')
    expect(r.error).toBe('URL non autorisée')
  })
})
