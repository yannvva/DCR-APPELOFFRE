import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const UNIT_DIR = join(process.cwd(), 'tests', 'unit')
const SELF = 'test-hygiene.test.ts'

/**
 * La suite unitaire doit rester hermétique : hors-ligne, sans écriture en base
 * et sans consommation d'API payantes. Les scripts qui interrogent réellement
 * la base ou les modèles vont dans `tests/live/` et se lancent via
 * `npm run test:live`.
 *
 * Indicateur retenu : la clé service-role, qui n'a jamais sa place dans un
 * test unitaire (elle contourne RLS). La simple mention d'une variable
 * d'environnement reste permise — `env.test.ts` vérifie la validation de
 * configuration sans contacter quoi que ce soit.
 */
const FORBIDDEN = ['SUPABASE_SERVICE_ROLE_KEY']

describe('hygiène de la suite unitaire', () => {
  it('aucun test unitaire n’utilise la clé service-role (accès réel à la base)', () => {
    const offenders = readdirSync(UNIT_DIR)
      .filter((f) => f.endsWith('.test.ts') && f !== SELF)
      .filter((f) => {
        const src = readFileSync(join(UNIT_DIR, f), 'utf8')
        return FORBIDDEN.some((k) => src.includes(k))
      })
    expect(offenders).toEqual([])
  })
})
