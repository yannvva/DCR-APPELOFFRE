-- ============================================================================
-- Nexus — Migration 0006 : dossiers « Fiches techniques » (liste des marques)
-- Un run = un dossier DCR de fiches techniques pour un lot d'AO :
-- exigences extraites du CCTP, résultats des agents de recherche web,
-- rapport de téléchargement des PDF officiels et livrables (classeur, ZIP).
-- ============================================================================

create table public.tender_datasheet_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tender_id uuid not null references public.tenders(id) on delete cascade,
  lot_id uuid references public.tender_lots(id) on delete set null,
  lot_label text not null,
  status text not null default 'draft' check (status in (
    'draft',        -- créé, en attente de dépouillage
    'brief_ready',  -- exigences extraites, chapitres proposés
    'researched',   -- agents de recherche terminés (au moins un chapitre)
    'downloaded',   -- téléchargement des PDF effectué
    'error'
  )),
  -- { operation: string[], variantes: string[] }
  config jsonb not null default '{}'::jsonb,
  -- { code: { onglet, libelle, exigences: [{code, texte, marques_imposees[]}] } }
  chapters jsonb not null default '{}'::jsonb,
  -- { code: { produits, documents, conformite, ecarts, a_obtenir } }
  result jsonb not null default '{}'::jsonb,
  -- { filename: { ok, reason?, document_id?, size? } }
  download_report jsonb not null default '{}'::jsonb,
  -- ids des documents livrables générés (classeur xlsx, zip arborescence)
  deliverable_document_ids uuid[] not null default '{}',
  model text,
  input_tokens int,
  output_tokens int,
  error text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index datasheet_runs_tender_idx on public.tender_datasheet_runs (tender_id, created_at desc);

alter table public.tender_datasheet_runs enable row level security;
create policy tender_datasheet_runs_select on public.tender_datasheet_runs
  for select using (public.is_org_member(organization_id));
create policy tender_datasheet_runs_insert on public.tender_datasheet_runs
  for insert with check (public.has_org_role(organization_id, '{owner,admin,member}'));
create policy tender_datasheet_runs_update on public.tender_datasheet_runs
  for update using (public.has_org_role(organization_id, '{owner,admin,member}'))
  with check (public.has_org_role(organization_id, '{owner,admin,member}'));
create policy tender_datasheet_runs_delete on public.tender_datasheet_runs
  for delete using (public.has_org_role(organization_id, '{owner,admin}'));
