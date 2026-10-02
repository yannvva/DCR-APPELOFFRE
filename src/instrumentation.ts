import * as Sentry from '@sentry/nextjs'

/**
 * Monitoring d'erreurs opt-in : sans `SENTRY_DSN`, rien n'est initialisé
 * (aucun trafic réseau, aucun coût). Renseignez la variable pour activer.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
  })
}

/** Remontée automatique des erreurs de rendu serveur. */
export const onRequestError = Sentry.captureRequestError
