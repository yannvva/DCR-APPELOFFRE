import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

import { importTenderFromUrl } from '@/lib/tender-import'

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, '../fixtures', name))

function mockFetchHtml(html: Buffer, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(new Uint8Array(html), {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  )
}

afterEach(() => vi.restoreAllMocks())

describe('importTenderFromUrl', () => {
  it('extrait les données d’un avis Marchés Online', async () => {
    mockFetchHtml(fixture('marchesonline.html'))
    const d = await importTenderFromUrl(
      'https://www.marchesonline.com/appels-offres/avis/prestation-de-traiteur/ao-9518474-1',
    )
    expect(d.platform).toBe('Marchés Online')
    expect(d.title).toBe('PRESTATION DE TRAITEUR')
    expect(d.reference).toBe('25-124783')
    expect(d.buyer).toBe('PARIS SACLAY CANCER CLUSTER')
    expect(d.region).toBe('94, 75')
    expect(d.responseDeadline).toMatch(/^2025-12-10T\d{2}:\d{2}$/)
  })

  it('rejette une URL non http(s)', async () => {
    await expect(importTenderFromUrl('file:///etc/passwd')).rejects.toThrow()
  })

  it('rejette une cible locale (SSRF)', async () => {
    await expect(importTenderFromUrl('http://localhost:3000/x')).rejects.toThrow()
    await expect(importTenderFromUrl('http://192.168.1.1/x')).rejects.toThrow()
  })

  it('signale une page inaccessible', async () => {
    mockFetchHtml(Buffer.from('blocked'), 403)
    await expect(
      importTenderFromUrl('https://www.francemarches.com/appel-offre/x'),
    ).rejects.toThrow(/403/)
  })
})
