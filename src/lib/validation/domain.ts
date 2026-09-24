import { z } from 'zod'

export const accountSchema = z.object({
  name: z.string().min(1, 'Nom requis').max(200),
  domain: z.string().max(120).optional().or(z.literal('')),
  industry: z.string().max(120).optional().or(z.literal('')),
  website: z.string().max(300).optional().or(z.literal('')),
  phone: z.string().max(40).optional().or(z.literal('')),
  notes: z.string().max(5000).optional().or(z.literal('')),
})

export const contactSchema = z.object({
  firstName: z.string().max(120).optional().or(z.literal('')),
  lastName: z.string().min(1, 'Nom requis').max(120),
  email: z.email('Email invalide').optional().or(z.literal('')),
  phone: z.string().max(40).optional().or(z.literal('')),
  role: z.string().max(120).optional().or(z.literal('')),
  accountId: z.uuid().optional().or(z.literal('')),
  notes: z.string().max(5000).optional().or(z.literal('')),
})

export const opportunitySchema = z.object({
  title: z.string().min(1, 'Titre requis').max(200),
  accountId: z.uuid().optional().or(z.literal('')),
  primaryContactId: z.uuid().optional().or(z.literal('')),
  valueEuros: z.coerce.number().min(0).optional(),
  expectedCloseDate: z.string().optional().or(z.literal('')),
})

export const leadSchema = z.object({
  title: z.string().min(1, 'Titre requis').max(200),
  source: z.string().max(80).optional().or(z.literal('')),
  notes: z.string().max(5000).optional().or(z.literal('')),
  contactId: z.uuid().optional().or(z.literal('')),
  accountId: z.uuid().optional().or(z.literal('')),
})

export const tagSchema = z.object({
  name: z.string().min(1, 'Nom requis').max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
})

export const projectSchema = z.object({
  name: z.string().min(1, 'Nom requis').max(200),
  description: z.string().max(10000).optional().or(z.literal('')),
  accountId: z.uuid().optional().or(z.literal('')),
  startDate: z.string().optional().or(z.literal('')),
  dueDate: z.string().optional().or(z.literal('')),
})

export const taskSchema = z.object({
  title: z.string().min(1, 'Titre requis').max(300),
  description: z.string().max(10000).optional().or(z.literal('')),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done']).default('todo'),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).default('medium'),
  dueDate: z.string().optional().or(z.literal('')),
  parentTaskId: z.uuid().optional().or(z.literal('')),
  assigneeIds: z.array(z.uuid()).default([]),
})

export const commentSchema = z.object({
  body: z.string().min(1, 'Commentaire vide').max(10000),
})

export const linkDocumentSchema = z.object({
  documentId: z.uuid(),
  entityType: z.enum(['account', 'contact', 'lead', 'opportunity', 'project', 'task']),
  entityId: z.uuid(),
})

export const ENTITY_LABELS: Record<string, string> = {
  account: 'Entreprise',
  contact: 'Contact',
  lead: 'Lead',
  opportunity: 'Opportunité',
  project: 'Projet',
  task: 'Tâche',
  document: 'Document',
}
