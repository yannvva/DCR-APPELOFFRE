import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { checklistItemMatches } from '@/lib/checklist-attach'

const DC1 = [/\bdc1\b|lettre de candidature/i]
const DC2 = [/\bdc2\b|d[ée]claration du candidat/i]
const MEMOIRE = [/m[ée]moire/i]
const TELEVERSE = [/t[ée]l[ée]vers/i]

describe('checklistItemMatches — ciblage des lignes par livrable', () => {
  it('le DC1 généré cible la ligne lettre de candidature', () => {
    expect(checklistItemMatches('Lettre de candidature — DC1', DC1)).toBe(true)
    expect(checklistItemMatches('Déclaration du candidat — DC2', DC1)).toBe(false)
  })

  it('le DC2 généré cible la ligne déclaration du candidat', () => {
    expect(checklistItemMatches('Déclaration du candidat — DC2', DC2)).toBe(true)
    expect(checklistItemMatches('Lettre de candidature — DC1', DC2)).toBe(false)
  })

  it('un DC2 par lot ne touche que la ligne du même lot', () => {
    expect(checklistItemMatches('[Lot 1] Déclaration du candidat — DC2', DC2, 1)).toBe(true)
    expect(checklistItemMatches('[Lot 2] Déclaration du candidat — DC2', DC2, 1)).toBe(false)
    // Ligne sans périmètre de lot : reçoit le livrable quel que soit le lot
    expect(checklistItemMatches('Déclaration du candidat — DC2', DC2, 2)).toBe(true)
  })

  it('une ligne lotée n’est jamais écrasée par un livrable sans lot connu', () => {
    expect(checklistItemMatches('[Lot 2] Mémoire technique', MEMOIRE, null)).toBe(false)
    expect(checklistItemMatches('[Lot 2] Mémoire technique', MEMOIRE)).toBe(false)
  })

  it('le mémoire cible la ligne générique et la ligne de son lot', () => {
    expect(checklistItemMatches('Mémoire technique', MEMOIRE, 1)).toBe(true)
    expect(checklistItemMatches('[Lot 1] Mémoire technique de réponse', MEMOIRE, 1)).toBe(true)
  })

  it('la ligne dépôt est ciblée par le fait « téléversé »', () => {
    expect(
      checklistItemMatches('Dossier téléversé sur la plateforme de dépôt', TELEVERSE),
    ).toBe(true)
    expect(checklistItemMatches('Récépissé de dépôt archivé', TELEVERSE)).toBe(false)
  })
})
