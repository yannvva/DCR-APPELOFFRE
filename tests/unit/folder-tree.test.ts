import { describe, expect, it } from 'vitest'
import {
  ancestorFolders,
  buildFolderTree,
  flattenFolders,
  folderLabel,
  isRootFolder,
  normalizeFolderPath,
  parentFolder,
} from '@/lib/folder-tree'

describe('normalizeFolderPath — une seule convention de chemin', () => {
  it('retire les slashs initiaux et finaux', () => {
    expect(normalizeFolderPath('/Société')).toBe('Société')
    expect(normalizeFolderPath('Société/')).toBe('Société')
    expect(normalizeFolderPath('/AO 20-2026 — Laval/DCE/02 - CCTP/')).toBe(
      'AO 20-2026 — Laval/DCE/02 - CCTP',
    )
  })

  it('collapse les séparateurs et normalise les antislashs Windows', () => {
    expect(normalizeFolderPath('A//B///C')).toBe('A/B/C')
    expect(normalizeFolderPath('A\\B')).toBe('A/B')
  })

  it('neutralise les segments relatifs', () => {
    expect(normalizeFolderPath('A/../B')).toBe('A/B')
    expect(normalizeFolderPath('A/./B')).toBe('A/B')
  })

  it('racine pour vide, null, « / » et suites de slashs', () => {
    for (const v of ['', '/', '//', null, undefined]) {
      expect(normalizeFolderPath(v)).toBe('/')
    }
  })

  it('préserve les accents et caractères des titres réels', () => {
    const p = "AO 20-2026 — Aménagement de 3 terrains … L'Huisserie/DCE/01 - Règlement"
    expect(normalizeFolderPath(p)).toBe(p)
  })
})

describe('segments et parents', () => {
  it('isRootFolder', () => {
    expect(isRootFolder('/')).toBe(true)
    expect(isRootFolder('Société')).toBe(false)
  })

  it('folderLabel = dernier segment', () => {
    expect(folderLabel('A/B/C')).toBe('C')
    expect(folderLabel('/')).toBe('Racine')
  })

  it('parentFolder', () => {
    expect(parentFolder('A/B/C')).toBe('A/B')
    expect(parentFolder('A')).toBe('/')
    expect(parentFolder('/')).toBeNull()
  })

  it('ancestorFolders sert à déplier l’arbre jusqu’au dossier courant', () => {
    expect(ancestorFolders('A/B/C')).toEqual(['A', 'A/B', 'A/B/C'])
    expect(ancestorFolders('/')).toEqual([])
  })
})

describe('buildFolderTree', () => {
  const rows = [
    { path: '/Société', count: 21 },
    { path: 'AO 20-2026 — Laval/DC1-DC2', count: 2 },
    { path: 'AO 20-2026 — Laval/Fiches techniques/LOT 01 - DÉMOLITIONS', count: 6 },
    { path: 'AO 20-2026 — Laval/DCE/01 - Règlement de consultation', count: 1 },
    { path: 'AO 20-2026 — Laval/DCE/02 - CCTP', count: 1 },
    { path: 'AO 20-2026 — Laval/DCE/06 - Annexes', count: 7 },
  ]

  it('Société d’abord, puis les dossiers d’AO', () => {
    const tree = buildFolderTree(rows)
    expect(tree.map((n) => n.name)).toEqual(['Société', 'AO 20-2026 — Laval'])
    expect(tree[0].count).toBe(21)
  })

  it('les chemins historiques « /Société » tombent dans le même dossier', () => {
    const tree = buildFolderTree([
      { path: '/Société', count: 3 },
      { path: 'Société', count: 2 },
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].count).toBe(5)
  })

  it('total agrège les sous-dossiers, count reste le niveau direct', () => {
    const tree = buildFolderTree(rows)
    const ao = tree.find((n) => n.name.startsWith('AO'))!
    expect(ao.count).toBe(0)
    expect(ao.total).toBe(2 + 6 + 1 + 1 + 7)
    const dce = ao.children.find((c) => c.name === 'DCE')!
    expect(dce.count).toBe(0)
    expect(dce.total).toBe(9)
    expect(dce.children.map((c) => c.name)).toEqual([
      '01 - Règlement de consultation',
      '02 - CCTP',
      '06 - Annexes',
    ])
  })

  it('crée les dossiers intermédiaires non peuplés', () => {
    const tree = buildFolderTree([
      { path: 'AO X/Fiches techniques/LOT 01', count: 4 },
    ])
    const ao = tree[0]
    expect(ao.children[0].name).toBe('Fiches techniques')
    expect(ao.children[0].count).toBe(0)
    expect(ao.children[0].total).toBe(4)
  })

  it('les documents sans dossier sont comptés à la racine', () => {
    const tree = buildFolderTree([{ path: '/', count: 2 }])
    expect(tree).toEqual([])
  })

  it('flattenFolders liste tous les chemins', () => {
    const all = flattenFolders(buildFolderTree(rows)).map((n) => n.path)
    expect(all).toContain('AO 20-2026 — Laval/DCE/06 - Annexes')
    expect(all).toContain('Société')
    // Société + AO + (DC1-DC2, Fiches techniques, Fiches techniques/LOT 01,
    // DCE, DCE/01, DCE/02, DCE/06)
    expect(all).toHaveLength(9)
  })

  it('tri alphabétique français dans un même niveau', () => {
    const tree = buildFolderTree([
      { path: 'AO/Études', count: 1 },
      { path: 'AO/Annexes', count: 1 },
      { path: 'AO/Zones', count: 1 },
    ])
    expect(tree[0].children.map((c) => c.name)).toEqual(['Annexes', 'Études', 'Zones'])
  })
})
