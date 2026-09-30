-- Bibliothèque produits : fiches techniques téléchargées au fil des AO.
-- Une entrée = un document fabricant (fiche, notice, avis…) rattaché à un
-- produit (marque + référence). Le même produit réutilisé entre plusieurs
-- AO pointe vers le même `documents` — pas de re-téléchargement.
create table public.datasheet_library (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  designation text not null default '',
  brand text not null default '',
  reference text not null default '',
  doc_type text not null default 'Fiche_technique',
  /** Thème métier (ex. « Béton », « Armatures ») = libellé du chapitre CCTP. */
  theme text,
  source_url text,
  statut text not null default 'OK',
  document_id uuid references public.documents(id) on delete set null,
  /** Clé de dédup normalisée « marque|référence|type » calculée côté app. */
  dedup_key text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dedup_key)
);
create index datasheet_library_org_brand_idx on public.datasheet_library (organization_id, brand);
create index datasheet_library_org_theme_idx on public.datasheet_library (organization_id, theme);
create trigger datasheet_library_touch before update on public.datasheet_library
  for each row execute function public.touch_updated_at();

alter table public.datasheet_library enable row level security;
create policy datasheet_library_select on public.datasheet_library
  for select using (public.is_org_member(organization_id));
create policy datasheet_library_insert on public.datasheet_library
  for insert with check (public.has_org_role(organization_id, '{owner,admin,member}'));
create policy datasheet_library_update on public.datasheet_library
  for update using (public.has_org_role(organization_id, '{owner,admin,member}'))
  with check (public.has_org_role(organization_id, '{owner,admin,member}'));
create policy datasheet_library_delete on public.datasheet_library
  for delete using (public.has_org_role(organization_id, '{owner,admin}'));
