import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

import { importTenderFromUrl, normalizeHttpUrl } from '@/lib/tender-import'

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

  it('extrait les données d’une consultation Maximilien (Atexo)', async () => {
    mockFetchHtml(fixture('maximilien.html'))
    const d = await importTenderFromUrl(
      'https://marches.maximilien.fr/entreprise/consultation/945739?orgAcronyme=a8z',
    )
    expect(d.platform).toBe('Maximilien')
    expect(d.title).toBe('Travaux de Régulation du Trafic')
    expect(d.reference).toBe('DVM-2026-07')
    expect(d.buyer).toContain('Conseil départemental du Val-de-Marne')
    expect(d.region).toBe('94')
    expect(d.responseDeadline).toBe('2026-10-30T16:00')
    expect(d.procedureType).toContain('appel public')
    expect(d.marketType).toBe('travaux')
  })

  it('rejette une URL non http(s)', async () => {
    await expect(importTenderFromUrl('file:///etc/passwd')).rejects.toThrow()
  })

  it('rejette une cible locale (SSRF)', async () => {
    await expect(
      importTenderFromUrl('http://localhost:3000/x'),
    ).rejects.toThrow()
    await expect(importTenderFromUrl('http://192.168.1.1/x')).rejects.toThrow()
  })

  it('signale une page protégée par anti-robot (DataDome)', async () => {
    mockFetchHtml(
      Buffer.from(
        '<p id="cmsg">Please enable JS and disable any ad blocker</p>var dd={rt:"i"}',
      ),
      403,
    )
    await expect(
      importTenderFromUrl('https://www.francemarches.com/appel-offre/x'),
    ).rejects.toThrow(/bloque la lecture automatique.*403/)
  })

  it('utilise l’id BOAMP encodé dans le slug francemarches (26-84820)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const u = String(input)
      if (u.includes('boamp-datadila')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                idweb: '26-84820',
                objet:
                  "Mission d'Assistance à Maitrise d'Ouvrage pour la passation d'un marché",
                nomacheteur:
                  'Fonds de Garantie des Assurances Obligatoires de Dommages',
                datelimitereponse: '2026-10-06T10:00:00+00:00',
                dateparution: '2026-09-02',
              },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response('cf-chl please enable js', { status: 403 })
    })
    const d = await importTenderFromUrl(
      'https://www.francemarches.com/appel-offre/3boamp2684820-2026-mission-assistance-maitrise',
    )
    expect(d.reference).toBe('26-84820')
    expect(d.publishedAt).toBe('2026-09-02')
    expect(d.responseDeadline).toMatch(/^2026-10-06T\d{2}:\d{2}$/)
    expect(d.buyer).toContain('Fonds de Garantie')
  })

  it('rejette un idweb capturé par hasard dans le slug (2684820-2026 → 20-2026)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const u = String(input)
      if (u.includes('boamp-datadila')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                idweb: '20-2026',
                objet:
                  'Aménagement de 3 terrains synthétiques de football à Laval',
                datelimitereponse: '2020-01-29T22:00:00+00:00',
                dateparution: '2020-01-07',
              },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response('cf-chl please enable js', { status: 403 })
    })
    await expect(
      importTenderFromUrl(
        'https://www.example-avis.fr/consultation/maconnerie-2684820-2026',
      ),
    ).rejects.toThrow(/bloque la lecture automatique/)
  })

  it('accepte une saisie sans schéma et avec caractères invisibles', async () => {
    mockFetchHtml(fixture('marchesonline.html'))
    const d = await importTenderFromUrl(
      '\u200Bwww.marchesonline.com/appels-offres/avis/prestation-de-traiteur/ao-9518474-1\u200B',
    )
    expect(d.platform).toBe('Marchés Online')
    expect(d.url).toMatch(/^https:\/\/www\.marchesonline\.com\//)
  })
})

describe('normalizeHttpUrl', () => {
  it('ajoute https:// quand le schéma manque', () => {
    expect(
      normalizeHttpUrl('francemarches.com/appel-offre/x')?.toString(),
    ).toBe('https://francemarches.com/appel-offre/x')
  })

  it('conserve les URL déjà complètes et nettoie les caractères invisibles', () => {
    expect(
      normalizeHttpUrl(
        '\u200B https://www.francemarches.com/appel-offre/1\u00AD',
      )?.hostname,
    ).toBe('www.francemarches.com')
  })

  it('retourne null sur une saisie non parseable', () => {
    expect(normalizeHttpUrl('pas une url :::')).toBe(null)
    expect(normalizeHttpUrl('')).toBe(null)
  })
})
