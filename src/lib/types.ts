// Types applicatifs — remplacés par `supabase gen types` une fois le projet lié.

export type MembershipRole = 'owner' | 'admin' | 'member' | 'viewer'

export type JobRole =
  | 'dirigeant'
  | 'chef_projet'
  | 'redacteur'
  | 'charge_admin'
  | 'chiffreur'
  | 'lecteur'

export interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  default_organization_id: string | null
  created_at: string
  updated_at: string
}

export interface Organization {
  id: string
  name: string
  slug: string
  logo_url: string | null
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface OrganizationMember {
  organization_id: string
  user_id: string
  role: MembershipRole
  invited_by: string | null
  joined_at: string
  profile?: Pick<Profile, 'full_name' | 'avatar_url'> | null
}

export interface OrganizationInvitation {
  id: string
  organization_id: string
  email: string
  role: Exclude<MembershipRole, 'owner'>
  token: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  invited_by: string
  expires_at: string
  created_at: string
}

// ---- CRM ----

export interface Account {
  id: string
  organization_id: string
  name: string
  domain: string | null
  industry: string | null
  website: string | null
  phone: string | null
  address: Record<string, string> | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  organization_id: string
  account_id: string | null
  first_name: string | null
  last_name: string
  email: string | null
  phone: string | null
  role: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  account?: Pick<Account, 'id' | 'name'> | null
}

export interface Pipeline {
  id: string
  organization_id: string
  name: string
  is_default: boolean
}

export interface PipelineStage {
  id: string
  organization_id: string
  pipeline_id: string
  name: string
  position: number
  probability: number
  is_won: boolean
  is_lost: boolean
}

export type OpportunityStatus = 'open' | 'won' | 'lost'

export interface Opportunity {
  id: string
  organization_id: string
  pipeline_id: string
  stage_id: string
  account_id: string | null
  primary_contact_id: string | null
  title: string
  value_cents: number | null
  currency: string
  probability: number | null
  expected_close_date: string | null
  status: OpportunityStatus
  lost_reason: string | null
  won_project_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  account?: Pick<Account, 'id' | 'name'> | null
  stage?: Pick<PipelineStage, 'id' | 'name'> | null
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost'

export interface Lead {
  id: string
  organization_id: string
  source: string | null
  status: LeadStatus
  contact_id: string | null
  account_id: string | null
  title: string | null
  notes: string | null
  converted_opportunity_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Interaction {
  id: string
  organization_id: string
  type: 'note' | 'call' | 'email' | 'meeting'
  subject: string | null
  body: string | null
  occurred_at: string
  account_id: string | null
  contact_id: string | null
  opportunity_id: string | null
  created_by: string | null
  created_at: string
}

// ---- Projets & tâches ----

export type ProjectStatus = 'active' | 'on_hold' | 'done' | 'archived'

export interface Project {
  id: string
  organization_id: string
  code: string
  name: string
  description: string | null
  status: ProjectStatus
  account_id: string | null
  opportunity_id: string | null
  start_date: string | null
  due_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  account?: Pick<Account, 'id' | 'name'> | null
}

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done'
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low'

export interface Task {
  id: string
  organization_id: string
  project_id: string
  parent_task_id: string | null
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  position: number
  completed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  assignees?: { user_id: string; profile?: Pick<Profile, 'full_name' | 'avatar_url'> | null }[]
  subtasks?: Task[]
  comment_count?: number
}

export interface TaskComment {
  id: string
  organization_id: string
  task_id: string
  author_id: string
  body: string
  edited_at: string | null
  created_at: string
  author?: Pick<Profile, 'full_name' | 'avatar_url'> | null
}

// ---- Tags ----

export interface Tag {
  id: string
  organization_id: string
  name: string
  color: string
}

export type TaggableEntityType =
  | 'account'
  | 'contact'
  | 'lead'
  | 'opportunity'
  | 'project'
  | 'task'
  | 'document'
  | 'tender'

// ---- Documents ----

export type DocumentCategory =
  | 'dce'
  | 'administratif'
  | 'technique'
  | 'financier'
  | 'memoire'
  | 'depot'
  | 'autre'

export type DocumentStatus = 'brouillon' | 'a_valider' | 'valide' | 'refuse' | 'archive'

export interface Document {
  id: string
  organization_id: string
  name: string
  folder_path: string
  storage_path: string
  mime_type: string
  size_bytes: number
  checksum: string | null
  category: DocumentCategory
  document_type: string | null
  valid_until: string | null
  status: DocumentStatus
  version: number
  is_signed: boolean
  is_reusable: boolean
  rejection_reason: string | null
  validated_by: string | null
  validated_at: string | null
  uploaded_by: string
  created_at: string
  updated_at: string
}

export type LinkableEntityType =
  | 'account'
  | 'contact'
  | 'lead'
  | 'opportunity'
  | 'project'
  | 'task'
  | 'tender'

export interface DocumentLink {
  id: string
  organization_id: string
  document_id: string
  entity_type: LinkableEntityType
  entity_id: string
}

// ---- Appels d'offres ----

export type TenderStatus =
  | 'detecte'
  | 'analyse'
  | 'en_preparation'
  | 'a_deposer'
  | 'depose'
  | 'gagne'
  | 'perdu'
  | 'abandonne'
  | 'annule'

export type MarketType = 'travaux' | 'fournitures' | 'services' | 'mixte'
export type DepositMode = 'electronique' | 'papier' | 'hybride'

export interface Tender {
  id: string
  organization_id: string
  title: string
  reference: string | null
  buyer_account_id: string | null
  platform: string | null
  dce_url: string | null
  published_at: string | null
  response_deadline: string
  questions_deadline: string | null
  site_visit_at: string | null
  site_visit_mandatory: boolean
  site_visit_justified: boolean
  procedure_type: string | null
  market_type: MarketType | null
  duration_months: number | null
  estimated_amount_cents: number | null
  region: string | null
  award_criteria: { prix?: number; technique?: number; autre?: number }
  deposit_mode: DepositMode | null
  status: TenderStatus
  responsible_id: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  buyer?: Pick<Account, 'id' | 'name'> | null
  responsible?: Pick<Profile, 'id' | 'full_name'> | null
  completeness?: { required: number; validated: number; pct: number; ready: boolean }
}

export interface TenderLot {
  id: string
  organization_id: string
  tender_id: string
  number: number
  title: string
  amount_cents: number | null
  selected: boolean
}

export type ChecklistCategory =
  | 'dce'
  | 'administratif'
  | 'technique'
  | 'financier'
  | 'memoire'
  | 'depot'
  | 'autre'

export type ChecklistRequirement = 'obligatoire' | 'recommande' | 'facultatif'
export type ChecklistItemStatus =
  | 'non_commence'
  | 'en_cours'
  | 'a_verifier'
  | 'valide'
  | 'bloque'
  | 'non_requis'

export interface TenderChecklistItem {
  id: string
  organization_id: string
  tender_id: string
  label: string
  category: ChecklistCategory
  requirement: ChecklistRequirement
  status: ChecklistItemStatus
  assignee_id: string | null
  internal_deadline: string | null
  document_id: string | null
  comment: string | null
  risk_level: 'bas' | 'moyen' | 'haut'
  requires_signature: boolean
  requires_chiffrage: boolean
  forced_valid: boolean
  force_reason: string | null
  position: number
  validated_by: string | null
  validated_at: string | null
  created_at: string
  updated_at: string
  document?: Pick<Document, 'id' | 'name' | 'valid_until' | 'is_signed' | 'status'> | null
  assignee?: Pick<Profile, 'id' | 'full_name'> | null
}

export type AlertSeverity = 'bloquante' | 'critique' | 'importante' | 'info'

export interface TenderAlert {
  id: string
  organization_id: string
  tender_id: string
  severity: AlertSeverity
  check_key: string
  element_ref: string | null
  message: string
  recommended_action: string | null
  assignee_id: string | null
  due_date: string | null
  source: 'auto' | 'manual'
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
}

export interface TenderSubmission {
  id: string
  organization_id: string
  tender_id: string
  version: number
  submitted_at: string
  platform: string | null
  submission_ref: string | null
  receipt_document_id: string | null
  validated_by: string | null
  validated_at: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  validator?: Pick<Profile, 'full_name'> | null
  receipt?: Pick<Document, 'id' | 'name'> | null
}

export interface TenderResult {
  tender_id: string
  organization_id: string
  outcome: 'gagne' | 'perdu' | 'sans_suite' | 'annule'
  awarded_amount_cents: number | null
  awarded_to: string | null
  decided_at: string | null
  loss_reason: string | null
  created_at: string
}

export interface TenderReadiness {
  required: number
  validated: number
  pct: number
  ready: boolean
  blockers: string[]
}

// ---- Activité ----

export interface ActivityLog {
  id: string
  organization_id: string
  actor_id: string | null
  entity_type: string
  entity_id: string
  action: string
  metadata: Record<string, unknown>
  created_at: string
  actor?: Pick<Profile, 'full_name'> | null
}

// ---- Pagination ----

export interface ListParams {
  page?: number
  pageSize?: number
  q?: string
  status?: string
  sort?: string
  order?: 'asc' | 'desc'
}

export interface Paged<T> {
  rows: T[]
  count: number
  page: number
  pageSize: number
}
