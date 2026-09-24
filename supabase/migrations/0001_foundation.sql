-- ============================================================================
-- Nexus — Migration 0001 : fondation multi-tenant + RLS
-- Référence : docs/architecture.md §3-4
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ============================================================================
-- 2. Identité & organisations
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  default_organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  logo_url text,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member','viewer')),
  invited_by uuid references public.profiles(id),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_role_idx on public.organization_members (organization_id, role);

-- ============================================================================
-- Helpers RLS (SECURITY DEFINER — évitent la récursion sur members)
-- Déclarés après organization_members : les fonctions LANGUAGE SQL sont
-- validées à la création et exigent que la table existe.
-- ============================================================================

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(org_id uuid, roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.role = any(roles)
  );
$$;

alter table public.profiles
  add constraint profiles_default_org_fk
  foreign key (default_organization_id) references public.organizations(id) on delete set null;

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null default 'member' check (role in ('admin','member','viewer')),
  token uuid not null default gen_random_uuid() unique,
  status text not null default 'pending' check (status in ('pending','accepted','expired','revoked')),
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

-- ============================================================================
-- 3. CRM
-- ============================================================================

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  domain text,
  industry text,
  website text,
  phone text,
  address jsonb,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index accounts_org_name_idx on public.accounts (organization_id, lower(name));
create index accounts_org_created_idx on public.accounts (organization_id, created_at desc);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  first_name text,
  last_name text not null check (char_length(last_name) between 1 and 120),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  role text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_org_account_idx on public.contacts (organization_id, account_id);
create index contacts_org_name_idx on public.contacts (organization_id, lower(last_name));

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pipelines_org_idx on public.pipelines (organization_id);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  position int not null,
  probability int not null default 0 check (probability between 0 and 100),
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_id, position),
  check (not (is_won and is_lost))
);
create index pipeline_stages_org_idx on public.pipeline_stages (organization_id, pipeline_id, position);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text,
  status text not null default 'new' check (status in ('new','contacted','qualified','converted','lost')),
  contact_id uuid references public.contacts(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  title text,
  notes text,
  converted_opportunity_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_org_status_idx on public.leads (organization_id, status);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete restrict,
  stage_id uuid not null references public.pipeline_stages(id) on delete restrict,
  account_id uuid references public.accounts(id) on delete set null,
  primary_contact_id uuid references public.contacts(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  value_cents bigint check (value_cents is null or value_cents >= 0),
  currency char(3) not null default 'EUR',
  probability int check (probability is null or probability between 0 and 100),
  expected_close_date date,
  status text not null default 'open' check (status in ('open','won','lost')),
  lost_reason text,
  won_project_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index opportunities_org_status_idx on public.opportunities (organization_id, status);
create index opportunities_org_stage_idx on public.opportunities (organization_id, stage_id);
create index opportunities_org_close_idx on public.opportunities (organization_id, expected_close_date);

alter table public.leads
  add constraint leads_converted_opp_fk
  foreign key (converted_opportunity_id) references public.opportunities(id) on delete set null;

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null check (type in ('note','call','email','meeting')),
  subject text,
  body text,
  occurred_at timestamptz not null default now(),
  account_id uuid references public.accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(account_id, contact_id, opportunity_id) >= 1)
);
create index interactions_org_entity_idx on public.interactions (organization_id, occurred_at desc);

-- ============================================================================
-- 4. Projets & tâches
-- ============================================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null check (char_length(name) between 1 and 200),
  description text,
  status text not null default 'active' check (status in ('active','on_hold','done','archived')),
  account_id uuid references public.accounts(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  start_date date,
  due_date date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  check (due_date is null or start_date is null or due_date >= start_date)
);
create index projects_org_status_idx on public.projects (organization_id, status);
create index projects_org_due_idx on public.projects (organization_id, due_date);
create index projects_org_created_idx on public.projects (organization_id, created_at desc);

alter table public.opportunities
  add constraint opportunities_won_project_fk
  foreign key (won_project_id) references public.projects(id) on delete set null;

create table public.project_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('manager','member')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_org_idx on public.project_members (organization_id, project_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_task_id uuid references public.tasks(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  status text not null default 'todo' check (status in ('backlog','todo','in_progress','in_review','done')),
  priority text not null default 'medium' check (priority in ('urgent','high','medium','low')),
  due_date date,
  position int not null default 0,
  completed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_org_project_status_idx on public.tasks (organization_id, project_id, status);
create index tasks_org_project_due_idx on public.tasks (organization_id, project_id, due_date);
create index tasks_org_open_due_idx on public.tasks (organization_id, due_date) where status <> 'done';
create index tasks_parent_idx on public.tasks (parent_task_id);

create table public.task_assignees (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_assignees_org_idx on public.task_assignees (organization_id, task_id);
create index task_assignees_user_idx on public.task_assignees (organization_id, user_id);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 10000),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

-- ============================================================================
-- 5. Tags
-- ============================================================================

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  name_lower text generated always as (lower(name)) stored,
  color text not null default '#6366f1',
  created_at timestamptz not null default now(),
  unique (organization_id, name_lower)
);

create table public.entity_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  entity_type text not null check (entity_type in ('account','contact','lead','opportunity','project','task','document')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tag_id, entity_type, entity_id)
);
create index entity_tags_entity_idx on public.entity_tags (organization_id, entity_type, entity_id);
create index entity_tags_tag_idx on public.entity_tags (organization_id, tag_id);

-- ============================================================================
-- 6. Documents
-- ============================================================================

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 300),
  folder_path text not null default '/',
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  checksum text,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_org_folder_idx on public.documents (organization_id, folder_path);
create index documents_org_created_idx on public.documents (organization_id, created_at desc);

create table public.document_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  entity_type text not null check (entity_type in ('account','contact','lead','opportunity','project','task')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (document_id, entity_type, entity_id)
);
create index document_links_entity_idx on public.document_links (organization_id, entity_type, entity_id);
create index document_links_doc_idx on public.document_links (document_id);

-- ============================================================================
-- 7. Activité, notifications, vues
-- ============================================================================

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_logs_entity_idx on public.activity_logs (organization_id, entity_type, entity_id, created_at desc);
create index activity_logs_org_idx on public.activity_logs (organization_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  entity_type text not null,
  name text not null,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, entity_type, name)
);

-- ============================================================================
-- 8. Agents, automatisations, intégrations (fondation inerte au MVP)
-- ============================================================================

create table public.agent_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  current_version_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agent_definitions(id) on delete cascade,
  version int not null,
  system_prompt text not null,
  model text not null,
  tools jsonb not null default '[]',
  cost_limit_cents int check (cost_limit_cents is null or cost_limit_cents >= 0),
  timeout_seconds int not null default 300,
  concurrency int not null default 1 check (concurrency >= 1),
  triggers jsonb not null default '[]',
  approval_policy jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);

alter table public.agent_definitions
  add constraint agent_definitions_current_version_fk
  foreign key (current_version_id) references public.agent_versions(id) on delete set null;

create table public.agent_tools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_version_id uuid not null references public.agent_versions(id) on delete cascade,
  tool_key text not null,
  config jsonb not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.agent_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_version_id uuid not null references public.agent_versions(id) on delete cascade,
  source_type text not null,
  ref text not null,
  config jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agent_definitions(id) on delete cascade,
  agent_version_id uuid not null references public.agent_versions(id),
  trigger_type text not null,
  initiated_by uuid references public.profiles(id),
  status text not null default 'queued' check (status in ('queued','running','awaiting_approval','succeeded','failed','cancelled')),
  context jsonb not null default '{}',
  result_ref text,
  error text,
  cost_cents int,
  duration_ms int,
  idempotency_key text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index agent_runs_org_status_idx on public.agent_runs (organization_id, status, created_at desc);

create table public.agent_run_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  step_index int not null,
  type text not null,
  tool_key text,
  input jsonb,
  output jsonb,
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed','skipped')),
  duration_ms int,
  created_at timestamptz not null default now(),
  unique (run_id, step_index)
);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  trigger jsonb not null,
  conditions jsonb not null default '{}',
  actions jsonb not null default '[]',
  enabled boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','skipped')),
  context jsonb not null default '{}',
  error text,
  duration_ms int,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  status text not null default 'active' check (status in ('active','error','revoked')),
  credentials_ref text,
  scopes text[],
  connected_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  url text not null,
  secret_hash text not null,
  events text[] not null default '{}',
  enabled boolean not null default true,
  last_delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}',
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);

-- Rate limiting minimal (MVP) : compteur par clé/fenêtre
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (key, window_start)
);

-- ============================================================================
-- 9. Triggers génériques
-- ============================================================================

-- updated_at générique
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- profile auto-créé au signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.raw_user_meta_data->>'avatar_url');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- compteur de code projet par org
create table public.organization_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  project_seq bigint not null default 0
);

create or replace function public.next_project_code(org_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare seq bigint;
begin
  insert into public.organization_counters (organization_id, project_seq)
  values (org_id, 1)
  on conflict (organization_id) do update set project_seq = organization_counters.project_seq + 1
  returning project_seq into seq;
  return 'PRJ-' || lpad(seq::text, 4, '0');
end $$;

create or replace function public.assign_project_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or new.code = '' then
    new.code := public.next_project_code(new.organization_id);
  end if;
  return new;
end $$;

create trigger trg_projects_code
  before insert on public.projects
  for each row execute function public.assign_project_code();

-- completed_at sur les tâches
create or replace function public.sync_task_completed_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    new.completed_at := now();
  elsif new.status is distinct from 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;

create trigger trg_tasks_completed
  before insert or update of status on public.tasks
  for each row execute function public.sync_task_completed_at();

-- profondeur max sous-tâche = 1 niveau
create or replace function public.check_task_depth()
returns trigger language plpgsql as $$
begin
  if new.parent_task_id is not null and exists (
    select 1 from public.tasks p where p.id = new.parent_task_id and p.parent_task_id is not null
  ) then
    raise exception 'Une sous-tâche ne peut pas avoir de sous-tâche';
  end if;
  return new;
end $$;

create trigger trg_tasks_depth
  before insert or update of parent_task_id on public.tasks
  for each row execute function public.check_task_depth();

-- audit append-only (insert via fonction)
create or replace function public.log_audit(
  p_organization_id uuid, p_action text, p_entity_type text default null,
  p_entity_id uuid default null, p_metadata jsonb default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_organization_id) then
    raise exception 'Accès refusé';
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), p_action, p_entity_type, p_entity_id,
          case when pg_column_size(p_metadata) > 8192 then '{}'::jsonb else p_metadata end)
  returning id into new_id;
  return new_id;
end $$;

-- acceptation d'invitation (token + email + expiry)
create or replace function public.accept_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  inv record;
  user_email text;
begin
  select * into inv from public.organization_invitations
  where token = p_token and status = 'pending' and expires_at > now();
  if not found then
    raise exception 'Invitation invalide ou expirée';
  end if;

  select email into user_email from auth.users where id = auth.uid();
  if user_email is null or lower(user_email) <> lower(inv.email) then
    raise exception 'Cette invitation est destinée à une autre adresse email';
  end if;

  insert into public.organization_members (organization_id, user_id, role, invited_by)
  values (inv.organization_id, auth.uid(), inv.role, inv.invited_by)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invitations set status = 'accepted' where id = inv.id;

  perform public.log_audit(inv.organization_id, 'invitation.accepted', 'organization_invitation', inv.id,
    jsonb_build_object('email', inv.email, 'role', inv.role));
  return inv.organization_id;
end $$;

-- empêcher la perte du dernier owner
create or replace function public.prevent_last_owner_removal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' and old.role = 'owner')
     or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    if not exists (
      select 1 from public.organization_members
      where organization_id = coalesce(old.organization_id, new.organization_id)
        and role = 'owner' and user_id <> coalesce(old.user_id, new.user_id)
    ) then
      raise exception 'Impossible de retirer le dernier propriétaire de l''organisation';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger trg_members_last_owner
  before delete or update of role on public.organization_members
  for each row execute function public.prevent_last_owner_removal();

-- ============================================================================
-- 10. Row Level Security
-- ============================================================================

-- Tables traitées individuellement (règles spécifiques) : profiles,
-- organizations, organization_members, organization_invitations, audit_logs,
-- rate_limits, organization_counters.
-- Toutes les autres : pattern standard ci-dessous.

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limits enable row level security;
alter table public.organization_counters enable row level security;

-- profiles : soi-même + co-membres d'org
create policy profiles_select on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from public.organization_members m1
    join public.organization_members m2
      on m1.organization_id = m2.organization_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id
  )
);
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- organizations : membres voient, tout authentifié crée, owner/admin modifient, owner supprime
create policy organizations_select on public.organizations for select
  using (public.is_org_member(id));
create policy organizations_insert on public.organizations for insert
  with check (auth.uid() is not null);
create policy organizations_update on public.organizations for update
  using (public.has_org_role(id, '{owner,admin}'))
  with check (public.has_org_role(id, '{owner,admin}'));
create policy organizations_delete on public.organizations for delete
  using (public.has_org_role(id, '{owner}'));

-- organization_members : lecture membres ; écriture owner/admin (rôle attribué <= rôle de l'acteur géré en DAL)
create policy members_select on public.organization_members for select
  using (public.is_org_member(organization_id));
-- Insert direct réservé owner/admin ; rejoindre une org passe par accept_invitation (SECURITY DEFINER)
create policy members_insert on public.organization_members for insert
  with check (public.has_org_role(organization_id, '{owner,admin}'));
create policy members_update on public.organization_members for update
  using (public.has_org_role(organization_id, '{owner,admin}'))
  with check (public.has_org_role(organization_id, '{owner,admin}'));
create policy members_delete on public.organization_members for delete
  using (public.has_org_role(organization_id, '{owner,admin}') or user_id = auth.uid());

-- invitations : owner/admin gèrent ; lecture limitée aux gestionnaires
create policy invitations_select on public.organization_invitations for select
  using (public.has_org_role(organization_id, '{owner,admin}'));
create policy invitations_insert on public.organization_invitations for insert
  with check (public.has_org_role(organization_id, '{owner,admin}'));
create policy invitations_update on public.organization_invitations for update
  using (public.has_org_role(organization_id, '{owner,admin}'))
  with check (public.has_org_role(organization_id, '{owner,admin}'));
create policy invitations_delete on public.organization_invitations for delete
  using (public.has_org_role(organization_id, '{owner,admin}'));

-- audit_logs : lecture owner/admin ; insert via log_audit (SECURITY DEFINER) ; jamais update/delete
create policy audit_select on public.audit_logs for select
  using (public.has_org_role(organization_id, '{owner,admin}'));

-- rate_limits / counters : pas d'accès direct client (service role uniquement)
-- (aucune policy = tout refusé pour les roles anon/authenticated)

-- Pattern standard : lecture membre, écriture member+, suppression admin+
do $$
declare
  t text;
  standard_tables text[] := array[
    'accounts','contacts','pipelines','pipeline_stages','leads','opportunities',
    'interactions','projects','project_members','tasks','task_assignees',
    'task_comments','tags','entity_tags','documents','document_links','activity_logs',
    'notifications','saved_views'
  ];
  admin_tables text[] := array[
    'agent_definitions','agent_versions','agent_tools','agent_knowledge_sources',
    'agent_runs','agent_run_steps','automation_rules','automation_runs',
    'integration_connections','webhook_endpoints'
  ];
begin
  foreach t in array standard_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.is_org_member(organization_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (public.has_org_role(organization_id, ''{owner,admin,member}''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (public.has_org_role(organization_id, ''{owner,admin,member}'')) with check (public.has_org_role(organization_id, ''{owner,admin,member}''))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (public.has_org_role(organization_id, ''{owner,admin}''))', t || '_delete', t);
  end loop;

  -- agents/automatisations/intégrations : écriture réservée owner/admin
  foreach t in array admin_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.is_org_member(organization_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (public.has_org_role(organization_id, ''{owner,admin}''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (public.has_org_role(organization_id, ''{owner,admin}'')) with check (public.has_org_role(organization_id, ''{owner,admin}''))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (public.has_org_role(organization_id, ''{owner,admin}''))', t || '_delete', t);
  end loop;
end $$;

-- Affinements par table

-- task_comments : insert impose author_id = auth.uid() ; update/delete = auteur ou admin+
drop policy task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert
  with check (public.has_org_role(organization_id, '{owner,admin,member}') and author_id = auth.uid());
drop policy task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments for update
  using (author_id = auth.uid() or public.has_org_role(organization_id, '{owner,admin}'))
  with check (author_id = auth.uid() or public.has_org_role(organization_id, '{owner,admin}'));
drop policy task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments for delete
  using (author_id = auth.uid() or public.has_org_role(organization_id, '{owner,admin}'));

-- notifications : chaque user ne voit que les siennes ; update = marquer lu soi-même
drop policy notifications_select on public.notifications;
create policy notifications_select on public.notifications for select
  using (user_id = auth.uid() and public.is_org_member(organization_id));
drop policy notifications_update on public.notifications;
create policy notifications_update on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- saved_views : privées à leur auteur
drop policy saved_views_select on public.saved_views;
create policy saved_views_select on public.saved_views for select
  using (user_id = auth.uid() and public.is_org_member(organization_id));
drop policy saved_views_insert on public.saved_views;
create policy saved_views_insert on public.saved_views for insert
  with check (user_id = auth.uid() and public.has_org_role(organization_id, '{owner,admin,member}'));
drop policy saved_views_update on public.saved_views;
create policy saved_views_update on public.saved_views for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy saved_views_delete on public.saved_views;
create policy saved_views_delete on public.saved_views for delete
  using (user_id = auth.uid() or public.has_org_role(organization_id, '{owner,admin}'));

-- documents : suppression par uploader ou admin+
drop policy documents_delete on public.documents;
create policy documents_delete on public.documents for delete
  using (uploaded_by = auth.uid() or public.has_org_role(organization_id, '{owner,admin}'));

-- ============================================================================
-- 11. Storage : bucket privé + policies scopées par préfixe org_{uuid}/
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 26214400,
  array['application/pdf','image/png','image/jpeg','image/webp','image/gif',
        'application/zip','text/plain','text/csv',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
) on conflict (id) do nothing;

-- org id = segment 1 du path : org_{uuid}/doc_id/filename
create or replace function public.storage_org_id(object_name text)
returns uuid language sql immutable as $$
  select substring((storage.foldername(object_name))[1] from 5)::uuid
$$;

create policy documents_storage_select on storage.objects for select
  using (bucket_id = 'documents' and public.is_org_member(public.storage_org_id(name)));
create policy documents_storage_insert on storage.objects for insert
  with check (bucket_id = 'documents' and public.has_org_role(public.storage_org_id(name), '{owner,admin,member}'));
create policy documents_storage_update on storage.objects for update
  using (bucket_id = 'documents' and public.has_org_role(public.storage_org_id(name), '{owner,admin,member}'));
create policy documents_storage_delete on storage.objects for delete
  using (bucket_id = 'documents' and public.has_org_role(public.storage_org_id(name), '{owner,admin,member}'));

-- ============================================================================
-- 12. Création d'organisation atomique (org + owner + pipeline par défaut)
-- ============================================================================

create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org_id uuid;
  pipeline_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;

  insert into public.organizations (name, slug) values (p_name, p_slug) returning id into org_id;
  insert into public.organization_members (organization_id, user_id, role)
  values (org_id, auth.uid(), 'owner');
  insert into public.pipelines (organization_id, name, is_default)
  values (org_id, 'Pipeline commercial', true) returning id into pipeline_id;
  insert into public.pipeline_stages (organization_id, pipeline_id, name, position, probability, is_won, is_lost)
  values
    (org_id, pipeline_id, 'Nouveau',     0, 10,  false, false),
    (org_id, pipeline_id, 'Qualifié',    1, 25,  false, false),
    (org_id, pipeline_id, 'Proposition', 2, 50,  false, false),
    (org_id, pipeline_id, 'Négociation', 3, 75,  false, false),
    (org_id, pipeline_id, 'Gagné',       4, 100, true,  false),
    (org_id, pipeline_id, 'Perdu',       5, 0,   false, true);

  update public.profiles
  set default_organization_id = org_id
  where id = auth.uid() and default_organization_id is null;

  perform public.log_audit(org_id, 'organization.created', 'organization', org_id,
    jsonb_build_object('name', p_name));
  return org_id;
end $$;

-- ============================================================================
-- 13. updated_at triggers sur toutes les tables concernées
-- ============================================================================

do $$
declare
  t text;
  tables_with_updated_at text[] := array[
    'profiles','organizations','organization_members','organization_invitations',
    'accounts','contacts','pipelines','pipeline_stages','leads','opportunities',
    'interactions','projects','tasks','task_comments','documents',
    'saved_views','agent_definitions','automation_rules','integration_connections'
  ];
begin
  foreach t in array tables_with_updated_at loop
    execute format(
      'create trigger trg_%I_updated before update on public.%I for each row execute function public.touch_updated_at()',
      t, t);
  end loop;
end $$;
