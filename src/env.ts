import { z } from 'zod'

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  /** Recherche web par API (recommandée) : SearxNG auto-hébergé, Brave Search
   *  API, Serper… Utilisée en priorité par les agents — les moteurs HTML
   *  gratuits sont régulièrement bloqués (429, résultats leurres anti-bot).
   *  Peut contenir `{query}` (sinon `?q=` est ajouté automatiquement). */
  SEARCH_API_URL: z.url().optional(),
  SEARCH_API_KEY: z.string().min(1).optional(),
  APP_URL: z.string().default('http://localhost:3000'),
  SENTRY_DSN: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

export function getEnv(): Env {
  if (!cached) {
    cached = envSchema.parse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
      SEARCH_API_URL: process.env.SEARCH_API_URL,
      SEARCH_API_KEY: process.env.SEARCH_API_KEY,
      APP_URL: process.env.APP_URL,
      SENTRY_DSN: process.env.SENTRY_DSN,
    })
  }
  return cached
}
