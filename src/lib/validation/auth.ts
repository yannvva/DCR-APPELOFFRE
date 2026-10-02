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

export const forgotPasswordSchema = z.object({
  email: z.email('Email invalide'),
})

export const updatePasswordSchema = z
  .object({
    password: z.string().min(8, '8 caractères minimum'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    path: ['confirm'],
    message: 'Les mots de passe ne correspondent pas',
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

export const JOB_ROLES = [
  'dirigeant',
  'chef_projet',
  'redacteur',
  'charge_admin',
  'chiffreur',
  'lecteur',
] as const

export const updateMyProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Nom requis (2 caractères min.)').max(120),
  jobRole: z.enum(JOB_ROLES).nullable(),
  defaultOrganizationId: z.uuid().nullable(),
})

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Nom requis (2 caractères min.)').max(120),
})

export const changePasswordSchema = z
  .object({
    current: z.string().min(1, 'Mot de passe actuel requis'),
    password: z.string().min(8, '8 caractères minimum'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    path: ['confirm'],
    message: 'Les mots de passe ne correspondent pas',
  })

export const changeEmailSchema = z.object({
  email: z.email('Email invalide'),
})

export const deleteOrganizationSchema = z.object({
  confirmName: z.string().min(1, 'Saisissez le nom de l’organisation'),
})

export type ActionState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: boolean
  inviteUrl?: string
  /** true si l'email d'invitation est parti (RESEND_API_KEY configurée). */
  emailSent?: boolean
  id?: string
} | undefined
