import { describe, expect, it } from 'vitest'
import { safeNext } from '@/lib/safe-redirect'

describe('safeNext — cible de redirection interne', () => {
  it('accepte un chemin interne', () => {
    expect(safeNext('/dashboard', '/')).toBe('/dashboard')
    expect(safeNext('/auth/update-password', '/')).toBe('/auth/update-password')
    expect(safeNext('/tenders/abc-123?tab=fiches', '/')).toBe('/tenders/abc-123?tab=fiches')
  })

  it('refuse la redirection ouverte par userinfo (origin + next)', () => {
    // `https://app.tld@evil.com` : app.tld devient l'utilisateur, evil.com l'hôte.
    expect(safeNext('@evil.com', '/')).toBe('/')
    expect(safeNext('app.tld@evil.com', '/')).toBe('/')
  })

  it('refuse les URL absolues et protocol-relative', () => {
    expect(safeNext('https://evil.com', '/')).toBe('/')
    expect(safeNext('//evil.com', '/')).toBe('/')
    expect(safeNext('/\\evil.com', '/')).toBe('/')
  })

  it('retombe sur la cible par défaut pour une valeur absente ou non textuelle', () => {
    expect(safeNext(null, '/login')).toBe('/login')
    expect(safeNext(undefined, '/login')).toBe('/login')
    expect(safeNext('', '/login')).toBe('/login')
  })
})
