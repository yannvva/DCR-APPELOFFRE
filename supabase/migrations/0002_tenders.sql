-- ============================================================================
-- Nexus — Migration 0002 : module Appels d'offres (ERP AO)
-- Référence : docs/audit-erp-marches-publics.md
-- ============================================================================

-- ============================================================================
-- 1. Extensions des tables existantes
-- ============================================================================

-- Rôles métier (complètent le rôle d'accès owner/admin/member/viewer)
alter table public.organization_members
  add column job_role text check (job_role in (
    'dirigeant','chef_projet','redacteur','charge_admin','chiffreur','lecteur'
  ));

-- Documents : catégorisation métier AO + cycle de validation + réutilisation
alter table public.documents
  add column category text not null default 'autre' check (category in (
    'dce','administratif','technique','financier','memoire','depot','autre'
  )),
  add column document_type text,
  add column valid_until date,
  add column status text not null default 'brouillon' check (status in (
    'brouillon','a_valider','valide','refuse','archive'
  )),
  add column version int not null default 1 check (version > 0),
  add column is_signed boolean not null default false,
  add column is_reusable boolean not null default false,
  add column rejection_reason text,
  add column validated_by uuid references public.profiles(id),
  add column validated_at timestamptz;
create index documents_expiry_idx on public.documents (organization_id, valid_until)
  where valid_until is not null;
create index documents_reusable_idx on public.documents (organization_id, is_reusable)
  where is_reusable;

-- Tags et liens documentaires applicables aux tenders
alter table public.entity_tags drop constraint entity_tags_entity_type_check;
alter table public.entity_tags add constraint entity_tags_entity_type_check
  check (entity_type in ('account','contact','lead','opportunity','project','task','document','tender'));

alter table public.document_links drop constraint document_links_entity_type_check;
alter table public.document_links add constraint document_links_entity_type_check
  check (entity_type in ('account','contact','lead','opportunity','project','task','tender'));

-- ============================================================================
-- 2. Appels d'offres
-- ============================================================================

create table public.tenders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  reference text,
  buyer_account_id uuid references public.accounts(id) on delete set null,
  platform text,
  dce_url text,
  published_at date,
  response_deadline timestamptz not null,
  questions_deadline timestamptz,
  site_visit_at timestamptz,
  site_visit_mandatory boolean not null default false,
  site_visit_justified boolean not null default false,
  procedure_type text,
  market_type text check (market_type in ('travaux','fournitures','services','mixte')),
  duration_months int check (duration_months is null or duration_months > 0),
  estimated_amount_cents bigint check (estimated_amount_cents is null or estimated_amount_cents >= 0),
  region text,
  award_criteria jsonb not null default '{}',
  deposit_mode text check (deposit_mode in ('electronique','papier','hybride')),
  status text not null default 'detecte' check (status in (
    'detecte','analyse','en_preparation','a_deposer','depose','gagne','perdu','abandonne','annule'
  )),
  responsible_id uuid references public.profiles(id),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tenders_org_deadline_idx on public.tenders (organization_id, response_deadline);
create index tenders_org_status_idx on public.tenders (organization_id, status);
create index tenders_buyer_idx on public.tenders (organization_id, buyer_account_id);

create table public.tender_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tender_id uuid not null references public.tenders(id) on delete cascade,
  number int not null check (number > 0),
  title text not null check (char_length(title) between 1 and 300),
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  selected boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tender_id, number)
);
create index tender_lots_tender_idx on public.tender_lots (tender_id);

create table public.tender_members (
  tender_id uuid not null references public.tenders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_on_tender text not null default 'collaborateur' check (role_on_tender in (
    'responsable','collaborateur','chiffreur','redacteur','lecteur'
  )),
  created_at timestamptz not null default now(),
  primary key (tender_id, user_id)
);
create index tender_members_user_idx on public.tender_members (organization_id, user_id);

-- ============================================================================
-- 3. Checklists : modèles + items par dossier
-- ============================================================================

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  market_type text check (market_type in ('travaux','fournitures','services','mixte')),
  is_default boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 300),
  category text not null default 'administratif' check (category in (
    'dce','administratif','technique','financier','memoire','depot','autre'
  )),
  requirement text not null default 'obligatoire' check (requirement in (
    'obligatoire','recommande','facultatif'
  )),
  requires_signature boolean not null default false,
  requires_chiffrage boolean not null default false,
  position int not null default 0
);
create index template_items_template_idx on public.checklist_template_items (template_id, position);

create table public.tender_checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tender_id uuid not null references public.tenders(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 300),
  category text not null default 'administratif' check (category in (
    'dce','administratif','technique','financier','memoire','depot','autre'
  )),
  requirement text not null default 'obligatoire' check (requirement in (
    'obligatoire','recommande','facultatif'
  )),
  status text not null default 'non_commence' check (status in (
    'non_commence','en_cours','a_verifier','valide','bloque','non_requis'
  )),
  assignee_id uuid references public.profiles(id),
  internal_deadline date,
  document_id uuid references public.documents(id) on delete set null,
  comment text,
  risk_level text not null default 'moyen' check (risk_level in ('bas','moyen','haut')),
  requires_signature boolean not null default false,
  requires_chiffrage boolean not null default false,
  position int not null default 0,
  validated_by uuid references public.profiles(id),
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index checklist_tender_idx on public.tender_checklist_items (tender_id, position);
create index checklist_org_status_idx on public.tender_checklist_items (organization_id, status);

-- ============================================================================
-- 4. Alertes de conformité
-- ============================================================================

create table public.tender_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tender_id uuid not null references public.tenders(id) on delete cascade,
  severity text not null check (severity in ('bloquante','critique','importante','info')),
  check_key text not null,
  element_ref text,
  message text not null,
  recommended_action text,
  assignee_id uuid references public.profiles(id),
  due_date date,
  source text not null default 'auto' check (source in ('auto','manual')),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index alerts_tender_idx on public.tender_alerts (tender_id, resolved_at);
create index alerts_org_open_idx on public.tender_alerts (organization_id, severity)
  where resolved_at is null;

-- ============================================================================
-- 5. Dépôts et résultats
-- ============================================================================

create table public.tender_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tender_id uuid not null references public.tenders(id) on delete cascade,
  version int not null default 1 check (version > 0),
  submitted_at timestamptz not null default now(),
  platform text,
  submission_ref text,
  receipt_document_id uuid references public.documents(id) on delete set null,
  validated_by uuid references public.profiles(id),
  validated_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (tender_id, version)
);

create table public.tender_results (
  tender_id uuid primary key references public.tenders(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outcome text not null check (outcome in ('gagne','perdu','sans_suite','annule')),
  awarded_amount_cents bigint check (awarded_amount_cents is null or awarded_amount_cents >= 0),
  awarded_to text,
  decided_at date,
  loss_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 6. Fonctions métier
-- ============================================================================

-- Checklist par défaut : pièces types d'un dossier de réponse français
create or replace function public.seed_default_checklist(p_tender_id uuid, p_org_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'Accès refusé';
  end if;
  insert into public.tender_checklist_items
    (organization_id, tender_id, label, category, requirement, requires_signature, requires_chiffrage, position)
  values
    (p_org_id, p_tender_id, 'Règlement de consultation (RC) analysé', 'dce', 'obligatoire', false, false, 10),
    (p_org_id, p_tender_id, 'Lettre de candidature — DC1', 'administratif', 'obligatoire', true, false, 20),
    (p_org_id, p_tender_id, 'Déclaration du candidat — DC2', 'administratif', 'obligatoire', true, false, 30),
    (p_org_id, p_tender_id, 'Extrait Kbis (< 3 mois)', 'administratif', 'obligatoire', false, false, 40),
    (p_org_id, p_tender_id, 'Attestation fiscale (< 6 mois)', 'administratif', 'obligatoire', false, false, 50),
    (p_org_id, p_tender_id, 'Attestation sociale — vigilance URSSAF (< 6 mois)', 'administratif', 'obligatoire', false, false, 60),
    (p_org_id, p_tender_id, 'Assurance RC professionnelle', 'administratif', 'obligatoire', false, false, 70),
    (p_org_id, p_tender_id, 'Assurance décennale', 'administratif', 'recommande', false, false, 80),
    (p_org_id, p_tender_id, 'Acte d''engagement (AE)', 'administratif', 'obligatoire', true, true, 90),
    (p_org_id, p_tender_id, 'Mémoire technique', 'memoire', 'obligatoire', false, false, 100),
    (p_org_id, p_tender_id, 'Références clients / chantiers', 'technique', 'obligatoire', false, false, 110),
    (p_org_id, p_tender_id, 'Planning prévisionnel', 'technique', 'recommande', false, false, 120),
    (p_org_id, p_tender_id, 'BPU / DPGF / DQE chiffrés', 'financier', 'obligatoire', false, true, 130),
    (p_org_id, p_tender_id, 'Documents sous-traitants / cotraitants', 'administratif', 'facultatif', false, false, 140),
    (p_org_id, p_tender_id, 'Dossier téléversé sur la plateforme de dépôt', 'depot', 'obligatoire', false, false, 200),
    (p_org_id, p_tender_id, 'Récépissé de dépôt archivé', 'depot', 'obligatoire', false, false, 210);
end;
$$;

-- Création atomique d'un AO : tender + lots + checklist (template ou défaut)
-- + responsable dans tender_members
create or replace function public.create_tender(p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_org uuid := (p_payload->>'organization_id')::uuid;
  v_id uuid;
  v_template_id uuid := nullif(p_payload->>'checklist_template_id', '')::uuid;
  v_lot jsonb;
begin
  if not public.has_org_role(v_org, '{owner,admin,member}') then
    raise exception 'Accès refusé';
  end if;

  insert into public.tenders (
    organization_id, title, reference, buyer_account_id, platform, dce_url,
    published_at, response_deadline, questions_deadline,
    site_visit_at, site_visit_mandatory, procedure_type, market_type,
    duration_months, estimated_amount_cents, region, award_criteria,
    deposit_mode, status, responsible_id, notes, created_by
  ) values (
    v_org,
    p_payload->>'title',
    nullif(p_payload->>'reference', ''),
    nullif(p_payload->>'buyer_account_id', '')::uuid,
    nullif(p_payload->>'platform', ''),
    nullif(p_payload->>'dce_url', ''),
    nullif(p_payload->>'published_at', '')::date,
    (p_payload->>'response_deadline')::timestamptz,
    nullif(p_payload->>'questions_deadline', '')::timestamptz,
    nullif(p_payload->>'site_visit_at', '')::timestamptz,
    coalesce((p_payload->>'site_visit_mandatory')::boolean, false),
    nullif(p_payload->>'procedure_type', ''),
    nullif(p_payload->>'market_type', ''),
    nullif(p_payload->>'duration_months', '')::int,
    nullif(p_payload->>'estimated_amount_cents', '')::bigint,
    nullif(p_payload->>'region', ''),
    coalesce(p_payload->'award_criteria', '{}'),
    nullif(p_payload->>'deposit_mode', ''),
    coalesce(nullif(p_payload->>'status', ''), 'detecte'),
    nullif(p_payload->>'responsible_id', '')::uuid,
    nullif(p_payload->>'notes', ''),
    auth.uid()
  ) returning id into v_id;

  -- Lots
  for v_lot in select * from jsonb_array_elements(coalesce(p_payload->'lots', '[]'))
  loop
    insert into public.tender_lots (organization_id, tender_id, number, title, amount_cents)
    values (
      v_org, v_id,
      (v_lot->>'number')::int,
      v_lot->>'title',
      nullif(v_lot->>'amount_cents', '')::bigint
    );
  end loop;

  -- Checklist : template choisi/défaut, sinon checklist standard AO
  if v_template_id is null then
    select id into v_template_id from public.checklist_templates
    where organization_id = v_org and is_default
    order by created_at limit 1;
  end if;

  if v_template_id is not null then
    insert into public.tender_checklist_items
      (organization_id, tender_id, label, category, requirement, requires_signature, requires_chiffrage, position)
    select v_org, v_id, label, category, requirement, requires_signature, requires_chiffrage, position
    from public.checklist_template_items
    where template_id = v_template_id;
  else
    perform public.seed_default_checklist(v_id, v_org);
  end if;

  -- Responsable → membre du dossier
  if nullif(p_payload->>'responsible_id', '') is not null then
    insert into public.tender_members (tender_id, user_id, organization_id, role_on_tender)
    values (v_id, (p_payload->>'responsible_id')::uuid, v_org, 'responsable')
    on conflict do nothing;
  end if;

  return v_id;
end;
$$;

-- Complétude + prêt-à-déposer d'un dossier.
-- Règle métier : ready ssi toutes les lignes obligatoires sont valides,
-- signées si requis, et non expirées à la deadline de dépôt.
create or replace function public.tender_readiness(p_tender_id uuid)
returns table(required int, validated int, pct int, ready boolean, blockers text[])
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_deadline date;
begin
  select t.response_deadline::date into v_deadline
  from public.tenders t where t.id = p_tender_id;

  return query
  select
    count(*) filter (where i.requirement = 'obligatoire' and i.status <> 'non_requis')::int,
    count(*) filter (
      where i.requirement = 'obligatoire' and i.status = 'valide'
        and (not i.requires_signature or coalesce(d.is_signed, false))
        and (d.valid_until is null or d.valid_until >= v_deadline)
    )::int,
    case
      when count(*) filter (where i.requirement = 'obligatoire' and i.status <> 'non_requis') = 0 then 100
      else round(
        100.0 * count(*) filter (
          where i.requirement = 'obligatoire' and i.status = 'valide'
            and (not i.requires_signature or coalesce(d.is_signed, false))
            and (d.valid_until is null or d.valid_until >= v_deadline)
        ) / count(*) filter (where i.requirement = 'obligatoire' and i.status <> 'non_requis')
      )::int
    end,
    not exists (
      select 1 from public.tender_checklist_items x
      left join public.documents dx on dx.id = x.document_id
      where x.tender_id = p_tender_id
        and x.requirement = 'obligatoire' and x.status <> 'non_requis'
        and (
          x.status <> 'valide'
          or (x.requires_signature and not coalesce(dx.is_signed, false))
          or (dx.valid_until is not null and dx.valid_until < v_deadline)
        )
    ),
    array(
      select case
          when x.status <> 'valide' then x.label || ' — non validé'
          when x.requires_signature and not coalesce(dx.is_signed, false) then x.label || ' — signature manquante'
          else x.label || ' — document expiré'
        end
      from public.tender_checklist_items x
      left join public.documents dx on dx.id = x.document_id
      where x.tender_id = p_tender_id
        and x.requirement = 'obligatoire' and x.status <> 'non_requis'
        and (
          x.status <> 'valide'
          or (x.requires_signature and not coalesce(dx.is_signed, false))
          or (dx.valid_until is not null and dx.valid_until < v_deadline)
        )
      order by x.position
    );
end;
$$;

-- Moteur de contrôle : régénère les alertes auto non résolues d'un dossier
create or replace function public.run_compliance_checks(p_tender_id uuid)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_t public.tenders%rowtype;
  v_n int := 0;
begin
  select * into v_t from public.tenders where id = p_tender_id;
  if not found then return 0; end if;
  if not public.is_org_member(v_t.organization_id) then
    raise exception 'Accès refusé';
  end if;
  v_org := v_t.organization_id;

  delete from public.tender_alerts
  where tender_id = p_tender_id and source = 'auto' and resolved_at is null;

  -- Deadline dépassée
  if v_t.response_deadline < now() and v_t.status not in ('depose','gagne','perdu','abandonne','annule') then
    insert into public.tender_alerts (organization_id, tender_id, severity, check_key, message, recommended_action)
    values (v_org, p_tender_id, 'bloquante', 'deadline_passed',
      'La date limite de réponse est dépassée.',
      'Confirmer un dépôt manuel ou passer le dossier en abandonné.');
    v_n := v_n + 1;
  elsif v_t.response_deadline < now() + interval '3 days' and v_t.status not in ('depose','gagne','perdu','abandonne','annule') then
    insert into public.tender_alerts (organization_id, tender_id, severity, check_key, message, recommended_action)
    values (v_org, p_tender_id, 'critique', 'deadline_j3',
      'Date limite de réponse à moins de 3 jours (' || to_char(v_t.response_deadline, 'DD/MM/YYYY HH24:MI') || ').',
      'Finaliser la checklist et préparer le dépôt immédiatement.');
    v_n := v_n + 1;
  elsif v_t.response_deadline < now() + interval '7 days' and v_t.status not in ('depose','gagne','perdu','abandonne','annule') then
    insert into public.tender_alerts (organization_id, tender_id, severity, check_key, message, recommended_action)
    values (v_org, p_tender_id, 'importante', 'deadline_j7',
      'Date limite de réponse à moins de 7 jours.',
      'Planifier la validation interne et le dépôt.');
    v_n := v_n + 1;
  end if;

  -- Pièces obligatoires : manquantes / expirées / non signées
  insert into public.tender_alerts (organization_id, tender_id, severity, check_key, element_ref, message, recommended_action, assignee_id, due_date)
  select v_org, p_tender_id,
    case
      when i.document_id is null or i.status <> 'valide' then 'bloquante'
      else 'critique'
    end,
    'checklist_' || lower(replace(i.category, ' ', '_')),
    i.id::text,
    case
      when i.document_id is null then i.label || ' : aucune pièce attachée.'
      when i.status <> 'valide' then i.label || ' : pièce non validée (statut ' || i.status || ').'
      when i.requires_signature and not coalesce(d.is_signed, false) then i.label || ' : signature manquante.'
      else i.label || ' : document expiré avant la deadline de dépôt.'
    end,
    'Attacher et valider une pièce conforme.',
    i.assignee_id, i.internal_deadline
  from public.tender_checklist_items i
  left join public.documents d on d.id = i.document_id
  where i.tender_id = p_tender_id
    and i.requirement = 'obligatoire' and i.status <> 'non_requis'
    and (
      i.document_id is null
      or i.status <> 'valide'
      or (i.requires_signature and not coalesce(d.is_signed, false))
      or (d.valid_until is not null and d.valid_until < v_t.response_deadline::date)
    );
  v_n := v_n + (select count(*) from public.tender_alerts
    where tender_id = p_tender_id and source = 'auto' and resolved_at is null
      and check_key like 'checklist_%');

  -- Visite obligatoire non justifiée
  if v_t.site_visit_mandatory and not v_t.site_visit_justified
     and v_t.status not in ('depose','gagne','perdu','abandonne','annule') then
    insert into public.tender_alerts (organization_id, tender_id, severity, check_key, message, recommended_action)
    values (v_org, p_tender_id, 'critique', 'site_visit',
      'Visite de site obligatoire non justifiée.',
      'Joindre l''attestation de visite et cocher « visite justifiée ».');
    v_n := v_n + 1;
  end if;

  -- Lots présents mais aucun sélectionné
  if exists (select 1 from public.tender_lots l where l.tender_id = p_tender_id)
     and not exists (select 1 from public.tender_lots l where l.tender_id = p_tender_id and l.selected) then
    insert into public.tender_alerts (organization_id, tender_id, severity, check_key, message, recommended_action)
    values (v_org, p_tender_id, 'bloquante', 'no_lot_selected',
      'Des lots existent mais aucun n''est sélectionné.',
      'Sélectionner les lots auxquels l''entreprise répond.');
    v_n := v_n + 1;
  end if;

  return v_n;
end;
$$;

-- ============================================================================
-- 7. Triggers updated_at
-- ============================================================================

create trigger trg_tenders_updated before update on public.tenders
  for each row execute function public.touch_updated_at();
create trigger trg_checklist_templates_updated before update on public.checklist_templates
  for each row execute function public.touch_updated_at();
create trigger trg_checklist_items_updated before update on public.tender_checklist_items
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- 8. RLS
-- ============================================================================

do $$
declare
  t text;
  standard_tables text[] := array[
    'tenders','tender_lots','tender_members','checklist_templates',
    'checklist_template_items','tender_checklist_items','tender_submissions',
    'tender_results'
  ];
begin
  foreach t in array standard_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.is_org_member(organization_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (public.has_org_role(organization_id, ''{owner,admin,member}''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (public.has_org_role(organization_id, ''{owner,admin,member}'')) with check (public.has_org_role(organization_id, ''{owner,admin,member}''))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (public.has_org_role(organization_id, ''{owner,admin}''))', t || '_delete', t);
  end loop;

  -- alertes : lecture membres, insert via run_compliance_checks (definer) ou member+,
  -- update member+ (résolution), delete admin+
  execute 'alter table public.tender_alerts enable row level security';
  execute 'create policy tender_alerts_select on public.tender_alerts for select using (public.is_org_member(organization_id))';
  execute 'create policy tender_alerts_insert on public.tender_alerts for insert with check (public.has_org_role(organization_id, ''{owner,admin,member}''))';
  execute 'create policy tender_alerts_update on public.tender_alerts for update using (public.has_org_role(organization_id, ''{owner,admin,member}'')) with check (public.has_org_role(organization_id, ''{owner,admin,member}''))';
  execute 'create policy tender_alerts_delete on public.tender_alerts for delete using (public.has_org_role(organization_id, ''{owner,admin}''))';
end $$;
