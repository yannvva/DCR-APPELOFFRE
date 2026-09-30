-- ============================================================================
-- 0013 : les pièces de catégorie 'depot' ne bloquent plus la conformité
-- ----------------------------------------------------------------------------
-- « Dossier téléversé sur la plateforme » et « Récépissé de dépôt archivé »
-- sont des lignes POST-dépôt : elles ne peuvent pas être validées avant la
-- soumission. Comptées dans tender_readiness, elles rendaient le dossier
-- « incomplet » à vie et bloquaient le dépôt (deadlock). Elles restent
-- obligatoires et suivies dans la checklist, mais :
--   1. tender_readiness() les exclut du compteur et des blockers ;
--   2. run_compliance_checks() ne génère plus d'alerte « pièce manquante »
--      pour ces lignes tant qu'elles ne sont pas traitées ;
--   3. l'action de dépôt (submitTender) marque « dossier téléversé » comme
--      validée — voir src/app/actions/tenders.ts.
-- ============================================================================

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
    count(*) filter (
      where i.requirement = 'obligatoire' and i.status <> 'non_requis'
        and i.category <> 'depot'
    )::int,
    count(*) filter (
      where i.requirement = 'obligatoire' and i.status <> 'non_requis'
        and i.category <> 'depot'
        and (
          i.forced_valid
          or (
            i.status = 'valide'
            and (not i.requires_signature or coalesce(d.is_signed, false))
            and (d.valid_until is null or d.valid_until >= v_deadline)
          )
        )
    )::int,
    case
      when count(*) filter (
        where i.requirement = 'obligatoire' and i.status <> 'non_requis'
          and i.category <> 'depot'
      ) = 0 then 100
      else round(
        100.0 * count(*) filter (
          where i.requirement = 'obligatoire' and i.status <> 'non_requis'
            and i.category <> 'depot'
            and (
              i.forced_valid
              or (
                i.status = 'valide'
                and (not i.requires_signature or coalesce(d.is_signed, false))
                and (d.valid_until is null or d.valid_until >= v_deadline)
              )
            )
        ) / count(*) filter (
          where i.requirement = 'obligatoire' and i.status <> 'non_requis'
            and i.category <> 'depot'
        )
      )::int
    end,
    not exists (
      select 1 from public.tender_checklist_items x
      left join public.documents dx on dx.id = x.document_id
      where x.tender_id = p_tender_id
        and x.requirement = 'obligatoire' and x.status <> 'non_requis'
        and x.category <> 'depot'
        and not x.forced_valid
        and (
          x.status <> 'valide'
          or (x.requires_signature and not coalesce(dx.is_signed, false))
          or (dx.valid_until is not null and dx.valid_until < v_deadline)
        )
    ),
    array(
      select case
          when x.forced_valid then null
          when x.status <> 'valide' then x.label || ' — non validé'
          when x.requires_signature and not coalesce(dx.is_signed, false) then x.label || ' — signature manquante'
          else x.label || ' — document expiré'
        end
      from public.tender_checklist_items x
      left join public.documents dx on dx.id = x.document_id
      where x.tender_id = p_tender_id
        and x.requirement = 'obligatoire' and x.status <> 'non_requis'
        and x.category <> 'depot'
        and not x.forced_valid
        and (
          x.status <> 'valide'
          or (x.requires_signature and not coalesce(dx.is_signed, false))
          or (dx.valid_until is not null and dx.valid_until < v_deadline)
        )
      order by x.position
    )
  from public.tender_checklist_items i
  left join public.documents d on d.id = i.document_id
  where i.tender_id = p_tender_id;
end;
$$;

-- Les lignes 'depot' ne doivent pas non plus générer d'alerte bloquante
-- « aucune pièce attachée » avant le dépôt : elles se traitent après.
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

  -- Purge limitée aux alertes gérées par ce moteur : les dce_risk_* (issues
  -- de l'analyse IA) et les alertes manuelles survivent aux régénérations.
  delete from public.tender_alerts
  where tender_id = p_tender_id and source = 'auto' and resolved_at is null
    and check_key not like 'dce_risk_%';

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

  -- Deadline des questions à l'acheteur : une fois passée, plus aucune
  -- question n'est possible — à anticiper pendant la lecture du DCE.
  if v_t.questions_deadline is not null
     and v_t.status not in ('depose','gagne','perdu','abandonne','annule') then
    if v_t.questions_deadline > now() and v_t.questions_deadline < now() + interval '2 days' then
      insert into public.tender_alerts (organization_id, tender_id, severity, check_key, message, recommended_action)
      values (v_org, p_tender_id, 'critique', 'questions_deadline_j2',
        'Date limite des questions à l''acheteur à moins de 2 jours (' || to_char(v_t.questions_deadline, 'DD/MM/YYYY HH24:MI') || ').',
        'Envoyer immédiatement les questions restantes au contact acheteur.');
      v_n := v_n + 1;
    elsif v_t.questions_deadline > now() + interval '2 days' and v_t.questions_deadline < now() + interval '5 days' then
      insert into public.tender_alerts (organization_id, tender_id, severity, check_key, message, recommended_action)
      values (v_org, p_tender_id, 'importante', 'questions_deadline_j5',
        'Date limite des questions à l''acheteur à moins de 5 jours.',
        'Consolider et envoyer les questions de lecture du DCE.');
      v_n := v_n + 1;
    end if;
  end if;

  -- Pièces obligatoires : manquantes / expirées / non signées.
  -- La catégorie 'depot' est exclue : ses lignes (« dossier téléversé »,
  -- « récépissé ») se traitent après la soumission, pas avant.
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
    and i.category <> 'depot'
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
