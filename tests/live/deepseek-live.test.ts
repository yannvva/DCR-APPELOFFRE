// Test « live » — appelle réellement l'API DeepSeek pour valider la chaîne
// complète (env → callApi → retry → extractJson). Exclu de `npm run test`
// (dossier tests/live hors vitest include) ; lancer avec :
//   npx vitest run tests/live/deepseek-live.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Charge .env.local avant tout import des libs (env est caché au 1er accès).
const env = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
for (const m of env.matchAll(/^(\w+)=(.+)$/gm)) {
  if (!process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

describe('DeepSeek live', () => {
  it('completeJson retourne du JSON parsé', async () => {
    const { completeJson } = await import('@/lib/ai/deepseek')
    const r = await completeJson<{ ok: boolean; note: number }>({
      system: 'Tu réponds uniquement en JSON valide.',
      prompt: 'Retourne {"ok": true, "note": 7}',
      maxTokens: 100,
    })
    expect(r.data.ok).toBe(true)
    expect(r.data.note).toBe(7)
    expect(r.usage.inputTokens).toBeGreaterThan(0)
  }, 60_000)

  it('completeResearchJson exécute un tour d\'agent', async () => {
    const { completeResearchJson } = await import('@/lib/ai/deepseek')
    const r = await completeResearchJson<{ reponse: string }>({
      system: 'Tu réponds uniquement en JSON valide.',
      prompt: 'Retourne {"reponse": "pong"} sans appeler d\'outil.',
      maxTokens: 200,
      maxTurns: 3,
      maxSearches: 0,
      maxFetches: 0,
    })
    expect(r.data.reponse).toBe('pong')
  }, 120_000)
})
