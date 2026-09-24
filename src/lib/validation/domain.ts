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
  entityType: z.enum(['account', 'contact', 'lead', 'opportunity', 'project', 'task', 'tender']),
  entityId: z.uuid(),
})

// ============================ APPELS D'OFFRES ============================

const optionalDate = z.string().optional().or(z.literal(''))

export const tenderLotSchema = z.object({
  number: z.coerce.number().int().min(1),
  title: z.string().min(1).max(300),
  amountEuros: z.coerce.number().min(0).optional(),
})

export const tenderSchema = z.object({
  title: z.string().min(1, 'Intitulé requis').max(300),
  reference: z.string().max(120).optional().or(z.literal('')),
  buyerAccountId: z.uuid().optional().or(z.literal('')),
  platform: z.string().max(120).optional().or(z.literal('')),
  dceUrl: z.url('URL invalide').optional().or(z.literal('')),
  publishedAt: optionalDate,
  responseDeadline: z.string().min(1, 'Date limite de réponse requise'),
  questionsDeadline: optionalDate,
  siteVisitAt: optionalDate,
  siteVisitMandatory: z.boolean().default(false),
  procedureType: z.string().max(120).optional().or(z.literal('')),
  marketType: z.enum(['travaux', 'fournitures', 'services', 'mixte']).optional().or(z.literal('')),
  durationMonths: z.coerce.number().int().min(1).optional().or(z.literal('')),
  estimatedAmountEuros: z.coerce.number().min(0).optional().or(z.literal('')),
  region: z.string().max(120).optional().or(z.literal('')),
  priceWeight: z.coerce.number().min(0).max(100).optional().or(z.literal('')),
  technicalWeight: z.coerce.number().min(0).max(100).optional().or(z.literal('')),
  depositMode: z.enum(['electronique', 'papier', 'hybride']).optional().or(z.literal('')),
  responsibleId: z.uuid().optional().or(z.literal('')),
  notes: z.string().max(10000).optional().or(z.literal('')),
  lots: z.array(tenderLotSchema).default([]),
})

export const checklistItemSchema = z.object({
  label: z.string().min(1, 'Libellé requis').max(300),
  category: z
    .enum(['dce', 'administratif', 'technique', 'financier', 'memoire', 'depot', 'autre'])
    .default('administratif'),
  requirement: z.enum(['obligatoire', 'recommande', 'facultatif']).default('obligatoire'),
  assigneeId: z.uuid().optional().or(z.literal('')),
  internalDeadline: optionalDate,
  requiresSignature: z.boolean().default(false),
  requiresChiffrage: z.boolean().default(false),
  riskLevel: z.enum(['bas', 'moyen', 'haut']).default('moyen'),
  comment: z.string().max(2000).optional().or(z.literal('')),
})

export const submissionSchema = z.object({
  platform: z.string().max(120).optional().or(z.literal('')),
  submissionRef: z.string().max(200).optional().or(z.literal('')),
  notes: z.string().max(5000).optional().or(z.literal('')),
  confirmComplete: z.literal(true, {
    error: 'Vous devez certifier le dossier complet pour enregistrer le dépôt.',
  }),
})

export const tenderResultSchema = z.object({
  outcome: z.enum(['gagne', 'perdu', 'sans_suite', 'annule']),
  awardedAmountEuros: z.coerce.number().min(0).optional().or(z.literal('')),
  awardedTo: z.string().max(200).optional().or(z.literal('')),
  decidedAt: optionalDate,
  lossReason: z.string().max(2000).optional().or(z.literal('')),
})

export const ENTITY_LABELS: Record<string, string> = {
  account: 'Entreprise',
  contact: 'Contact',
  lead: 'Lead',
  opportunity: 'Opportunité',
  project: 'Projet',
  task: 'Tâche',
  document: 'Document',
  tender: 'Appel d’offres',
}
