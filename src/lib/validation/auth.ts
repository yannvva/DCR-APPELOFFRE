import { z } from 'zod'

export const signupSchema = z.object({
  fullName: z.string().min(2, 'Nom requis (2 caractères min.)').max(120),
  email: z.email('Email invalide'),
  password: z.string().min(8, '8 caractères minimum'),
})

export const loginSchema = z.object({
  email: z.email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
})

export const createOrganizationSchema = z.object({
  name: z.string().min(2, 'Nom requis (2 caractères min.)').max(120),
})

export const inviteMemberSchema = z.object({
  email: z.email('Email invalide'),
  role: z.enum(['admin', 'member', 'viewer']),
})

export const updateMemberRoleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(['admin', 'member', 'viewer', 'owner']),
})

export type ActionState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: boolean
  inviteUrl?: string
  id?: string
} | undefined
