/**
 * Cible de redirection interne uniquement.
 *
 * `origin + next` ne suffit pas à garantir la même origine : `?next=@evil.com`
 * donne `https://app.tld@evil.com`, où `app.tld` devient l'utilisateur et
 * `evil.com` l'hôte — une redirection ouverte. `//evil.com` (URL
 * protocol-relative) et `/\evil.com` (barre oblique inverse, normalisée par
 * certains clients) sont refusés pour la même raison.
 */
export function safeNext(value: unknown, fallback: string): string {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\')
    ? value
    : fallback
}
