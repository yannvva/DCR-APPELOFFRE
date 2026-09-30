-- ============================================================================
-- Nexus — Migration 0005 : analyses IA de DCE
-- Stocke le résultat structuré de l'agent de lecture de DCE (extraction,
-- synthèse, pièces exigées) par dossier d'appel d'offres.
-- ============================================================================

create table public.tender_dce_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tender_id uuid not null references public.tenders(id) on delete cascade,
  status text not null default 'done' check (status in ('done', 'error')),
  model text,
  -- Pièces effectivement analysées : [{name, type, chars}]
  files jsonb not null default '[]'::jsonb,
  -- Pièces ignorées : [{name, reason}]
  skipped jsonb not null default '[]'::jsonb,
  -- Résultat structuré (schéma DceAnalysis — src/lib/dce/types.ts)
  result jsonb,
  error text,
  input_tokens int,
  output_tokens int,
  applied_at timestamptz, -- résultat appliqué au dossier (champs + lots + checklist)
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index dce_analyses_tender_idx on public.tender_dce_analyses (tender_id, created_at desc);

alter table public.tender_dce_analyses enable row level security;
create policy tender_dce_analyses_select on public.tender_dce_analyses
  for select using (public.is_org_member(organization_id));
create policy tender_dce_analyses_insert on public.tender_dce_analyses
  for insert with check (public.has_org_role(organization_id, '{owner,admin,member}'));
create policy tender_dce_analyses_update on public.tender_dce_analyses
  for update using (public.has_org_role(organization_id, '{owner,admin,member}'))
  with check (public.has_org_role(organization_id, '{owner,admin,member}'));
create policy tender_dce_analyses_delete on public.tender_dce_analyses
  for delete using (public.has_org_role(organization_id, '{owner,admin}'));
