-- ============================================================================
-- Nexus — Migration 0014 : fonction métier du membre (job_role) auto-éditable
-- La policy members_update exige owner/admin ; un membre ne peut donc pas
-- modifier sa propre ligne. Cette RPC SECURITY DEFINER n'autorise que la
-- colonne job_role de SA propre ligne, après vérification de membership.
-- ============================================================================

create or replace function public.set_my_job_role(p_org_id uuid, p_job_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_org_member(p_org_id) then
    raise exception 'Accès refusé';
  end if;
  if p_job_role is not null and p_job_role not in (
    'dirigeant','chef_projet','redacteur','charge_admin','chiffreur','lecteur'
  ) then
    raise exception 'Fonction invalide';
  end if;
  update public.organization_members
    set job_role = p_job_role, updated_at = now()
    where organization_id = p_org_id and user_id = auth.uid();
end $$;
