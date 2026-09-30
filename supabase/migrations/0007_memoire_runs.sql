-- ============================================================================
-- Nexus — Migration 0007 : génération du mémoire technique (étape 1)
-- Un run = la production du fichier content_<AFFAIRE>.py pour un lot d'AO :
-- fiche d'analyse du DCE (checklist), puis code Python de contenu qui alimente
-- le build .docx (étape 2, hors applicatif). Le .py généré est rangé comme
-- document category='memoire' et lié au dossier.
-- ============================================================================

create table public.tender_memoire_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tender_id uuid not null references public.tenders(id) on delete cascade,
  lot_id uuid references public.tender_lots(id) on delete set null,
  lot_label text not null,
  status text not null default 'draft' check (status in (
    'draft',      -- créé, en attente de l'analyse du DCE
    'analyzed',   -- fiche d'analyse remplie (checklist DCE)
    'generated',  -- content_*.py produit et rangé dans les documents
    'built',      -- .docx construit (étape 2 : ref_cr.docx + helpers_pa + content)
    'error'
  )),
  -- Fiche d'analyse structurée (cf. checklist) : couverture, critères,
  -- pénalités, délais/planning, consistence, interfaces, manquants…
  analysis jsonb not null default '{}'::jsonb,
  -- Document .py produit (étape 1) — entrée du build .docx (étape 2)
  content_document_id uuid references public.documents(id) on delete set null,
  content_filename text,
  -- .docx produit (étape 2 — build ref_cr.docx + content_*.py)
  docx_document_id uuid references public.documents(id) on delete set null,
  docx_filename text,
  -- Avertissements de validation statique du fichier généré
  warnings jsonb not null default '[]'::jsonb,
  model text,
  input_tokens int,
  output_tokens int,
  error text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memoire_runs_tender_idx on public.tender_memoire_runs (tender_id, created_at desc);

alter table public.tender_memoire_runs enable row level security;
create policy tender_memoire_runs_select on public.tender_memoire_runs
  for select using (public.is_org_member(organization_id));
create policy tender_memoire_runs_insert on public.tender_memoire_runs
  for insert with check (public.has_org_role(organization_id, '{owner,admin,member}'));
create policy tender_memoire_runs_update on public.tender_memoire_runs
  for update using (public.has_org_role(organization_id, '{owner,admin,member}'))
  with check (public.has_org_role(organization_id, '{owner,admin,member}'));
create policy tender_memoire_runs_delete on public.tender_memoire_runs
  for delete using (public.has_org_role(organization_id, '{owner,admin}'));
