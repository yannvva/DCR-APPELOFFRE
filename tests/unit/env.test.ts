import { describe, expect, it } from 'vitest'

describe('validation des variables d’environnement', () => {
  it('rejette une configuration incomplète', async () => {
    const original = { ...process.env }
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const { getEnv } = await import('@/env')
    expect(() => getEnv()).toThrow()

    process.env = original
  })
})
