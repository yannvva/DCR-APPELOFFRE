import * as Sentry from '@sentry/nextjs'

/**
 * Monitoring navigateur opt-in — nécessite NEXT_PUBLIC_SENTRY_DSN (la clé
 * serveur SENTRY_DSN n'est jamais exposée au client).
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  Sentry.init({ dsn, tracesSampleRate: 0.1 })
}
