'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loginSchema, signupSchema, forgotPasswordSchema, updatePasswordSchema, type ActionState } from '@/lib/validation/auth'
import { getEnv } from '@/env'

// Cible interne uniquement — `//hote.tld` est une URL protocol-relative
// valide qui redirigerait vers un site externe.
function safeNext(next: FormDataEntryValue | null, fallback: string) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')
    ? next
    : fallback
}

export async function signup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  })

  if (error) {
    return { error: 'Impossible de créer le compte. Vérifiez vos informations ou réessayez.' }
  }

  const next = formData.get('next')
  redirect(safeNext(next, '/onboarding'))
}

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    return { error: 'Email ou mot de passe incorrect.' }
  }

  const next = formData.get('next')
  redirect(safeNext(next, '/'))
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

/**
 * Envoie le lien de réinitialisation. Réponse identique que l'email
 * existe ou non — ne jamais révéler l'existence d'un compte.
 */
export async function requestPasswordReset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const redirectTo = `${getEnv().APP_URL}/auth/callback?next=/auth/update-password`
  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo })

  return {
    success: true,
  }
}

/** Définit le nouveau mot de passe après clic sur le lien de récupération. */
export async function updatePassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  })
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    return { error: 'Lien expiré ou mot de passe invalide — recommencez la demande.' }
  }
  redirect('/login?reset=ok')
}
