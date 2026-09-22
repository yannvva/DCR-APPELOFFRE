import { describe, expect, it } from 'vitest'
import { createOrganizationSchema, inviteMemberSchema, signupSchema } from '@/lib/validation/auth'

describe('schémas de validation', () => {
  it('signup : email invalide rejeté', () => {
    expect(
      signupSchema.safeParse({ fullName: 'Test', email: 'nope', password: 'password1' }).success,
    ).toBe(false)
  })

  it('signup : mot de passe < 8 rejeté', () => {
    expect(
      signupSchema.safeParse({ fullName: 'Test', email: 'a@b.co', password: 'short' }).success,
    ).toBe(false)
  })

  it('createOrganization : nom trop court rejeté', () => {
    expect(createOrganizationSchema.safeParse({ name: 'A' }).success).toBe(false)
    expect(createOrganizationSchema.safeParse({ name: 'DCR Bâtiment' }).success).toBe(true)
  })

  it('inviteMember : rôle owner interdit', () => {
    expect(
      inviteMemberSchema.safeParse({ email: 'a@b.co', role: 'owner' }).success,
    ).toBe(false)
  })
})
