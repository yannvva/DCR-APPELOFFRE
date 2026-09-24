-- Allow manual override of checklist item validation.
-- Permet de forcer la validité d'une ligne sans pièce attachée,
-- avec un motif obligatoire.

alter table public.tender_checklist_items
  add column if not exists forced_valid boolean not null default false,
  add column if not exists force_reason text;

-- tender_readiness : une ligne forced_valid compte comme validée
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
      where i.requirement = 'obligatoire' and i.status <> 'non_requis'
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
      when count(*) filter (where i.requirement = 'obligatoire' and i.status <> 'non_requis') = 0 then 100
      else round(
        100.0 * count(*) filter (
          where i.requirement = 'obligatoire' and i.status <> 'non_requis'
            and (
              i.forced_valid
              or (
                i.status = 'valide'
                and (not i.requires_signature or coalesce(d.is_signed, false))
                and (d.valid_until is null or d.valid_until >= v_deadline)
              )
            )
        ) / count(*) filter (where i.requirement = 'obligatoire' and i.status <> 'non_requis')
      )::int
    end,
    not exists (
      select 1 from public.tender_checklist_items x
      left join public.documents dx on dx.id = x.document_id
      where x.tender_id = p_tender_id
        and x.requirement = 'obligatoire' and x.status <> 'non_requis'
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
