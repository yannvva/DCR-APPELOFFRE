// Types applicatifs — remplacés par `supabase gen types` une fois le projet lié.

export type MembershipRole = 'owner' | 'admin' | 'member' | 'viewer'

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

// ---- Documents ----

export interface Document {
  id: string
  organization_id: string
  name: string
  folder_path: string
  storage_path: string
  mime_type: string
  size_bytes: number
  checksum: string | null
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

export interface DocumentLink {
  id: string
  organization_id: string
  document_id: string
  entity_type: LinkableEntityType
  entity_id: string
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
