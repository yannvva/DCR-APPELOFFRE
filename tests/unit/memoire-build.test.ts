import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { buildMemoireDocx } from '@/lib/memoire/build'

const code = readFileSync(
  join(__dirname, '../fixtures/content_full_test.py'),
  'utf-8',
)

function pythonReady(): boolean {
  for (const bin of ['python3', 'python', 'py']) {
    const r = spawnSync(bin, ['-c', 'import lxml'], { timeout: 15_000 })
    if (!r.error && r.status === 0) return true
  }
  return false
}

const itPy = pythonReady() ? it : it.skip

/** Texte visible d'un document.xml (balises retirées). */
function visibleText(docx: Uint8Array): string {
  const z = unzipSync(docx)
  return new TextDecoder().decode(z['word/document.xml']).replace(/<[^>]+>/g, ' ')
}

describe('buildMemoireDocx — build réel sur tpl.docx', () => {
  itPy('étape 2 : mémoire complet validé — 7 sections, couverture et pied remplacés', () => {
    const { docx } = buildMemoireDocx(code, { full: true })
    const z = unzipSync(docx)
    const names = Object.keys(z)
    expect(names).toContain('word/media/dcr_logo_cover.png')
    const text = visibleText(docx)
    for (const s of [
      'COMPRÉHENSION DU PROJET',
      'MOYENS HUMAINS',
      "MÉTHODOLOGIE D'EXÉCUTION",
      'PLANNING',
      'DÉMARCHE ENVIRONNEMENTALE',
      'SÉCURITÉ',
      'ESAT Marsoulan',
      'Pôle Compans',
    ]) {
      expect(text).toContain(s)
    }
    for (const gone of ['La Gommerie', 'Mairie de Rambouillet', 'N° de consultation', 'JJ / MM']) {
      expect(text).not.toContain(gone)
    }
    const foot = new TextDecoder().decode(z['word/footer1.xml'])
    expect(foot).not.toContain('Gommerie')
  }, 120_000)

  itPy('étape 1 : sortie _DCR — couverture + sections 2/4/5 uniquement', () => {
    const { docx } = buildMemoireDocx(code, { full: false })
    const z = unzipSync(docx)
    expect(Object.keys(z)).toContain('word/media/dcr_logo_cover.png')
    const text = visibleText(docx)
    for (const s of [
      'COMPRÉHENSION DU PROJET',
      "MÉTHODOLOGIE D'EXÉCUTION",
      'PLANNING',
      'Pôle Compans',
      'RISQUE IDENTIFIÉ',
      'EFFECTIF MOYEN',
    ]) {
      expect(text).toContain(s)
    }
    // Les titres des sections retirées peuvent subsister dans la TDM en cache
    // (champ Word rafraîchi à l'ouverture) — on vérifie donc des contenus qui
    // n'existent que dans les corps de section.
    for (const gone of [
      'taille humaine', // §1 présentation entreprise
      'YILDIRIM', // §3.2 CV encadrants
      'Gravats inertes', // §6.2 tableau des déchets
      'Chaussures de sécurité', // §7.2 tableau EPI
    ]) {
      expect(text).not.toContain(gone)
    }
    // La TDM est marquée pour régénération automatique à l'ouverture.
    const settings = new TextDecoder().decode(z['word/settings.xml'])
    expect(settings).toContain('updateFields')
  }, 120_000)
})
