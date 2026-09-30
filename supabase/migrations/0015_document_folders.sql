-- ============================================================================
-- 0012 — Rangement des documents : une seule convention de chemin
--
-- Constat (données réelles) : trois conventions coexistaient —
--   « /Société »                      (slash initial, créé par sanitizeFolder)
--   « AO 20-2026 — …/DC1-DC2 »        (rangement par appel d'offres)
--   « DCE/02 - CCTP »                 (pièces DCE importées AVANT le
--                                      rangement par AO → orphelines à la racine)
--
-- Cible : aucun slash initial/final, et toute pièce de DCE rangée sous le
-- dossier de son appel d'offres. Seules racines : « Société » (kit
-- candidature, commun à tous les marchés) et un dossier par AO.
--
-- Idempotente : peut être rejouée sans effet de bord.
-- ============================================================================

-- 1. Normalisation : pas de slash initial/final, séparateurs uniques,
--    segments « . » / « .. » retirés.
create or replace function public.norm_folder_path(p text)
returns text
language sql
immutable
as $fn$
  select coalesce(
    nullif(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(p, ''), '\\', '/', 'g'),
            '/{2,}', '/', 'g'
          ),
          '(^|/)\.\.?($|/)', '\1', 'g'
        ),
        '/'
      ),
      ''
    ),
    '/'
  );
$fn$;

comment on function public.norm_folder_path(text) is
  'Chemin de dossier canonique des documents (pas de slash initial/final).';

-- 2. Chemins historiques normalisés (« /Société » → « Société »).
update public.documents d
set folder_path = public.norm_folder_path(d.folder_path)
where d.folder_path is distinct from public.norm_folder_path(d.folder_path);

-- 3. Pièces de DCE restées à la racine → replacées sous leur appel d'offres.
--    La racine de l'AO est DÉDUITE des documents déjà rangés de ce même AO
--    (DC1/DC2, fiches techniques) : si le titre du dossier a changé depuis
--    l'import, on ne fabrique pas un second dossier « AO … ».
with ao_base as (
  select
    l.entity_id as tender_id,
    min(split_part(public.norm_folder_path(d.folder_path), '/', 1)) as base
  from public.document_links l
  join public.documents d
    on d.id = l.document_id
   and d.organization_id = l.organization_id
  where l.entity_type = 'tender'
    and split_part(public.norm_folder_path(d.folder_path), '/', 1)
        not in ('', 'DCE', 'Société')
  group by l.entity_id
)
update public.documents d
set folder_path = left(b.base || '/' || public.norm_folder_path(d.folder_path), 300)
from public.document_links l
join ao_base b on b.tender_id = l.entity_id
where l.document_id = d.id
  and l.entity_type = 'tender'
  and l.organization_id = d.organization_id
  and split_part(public.norm_folder_path(d.folder_path), '/', 1) = 'DCE';

-- 3 bis. AO n'ayant QUE des pièces de DCE (rien de généré) : la racine est
--        reconstruite depuis la référence + le titre du dossier, selon la
--        même règle que l'application (tenderFolderName).
with ao_base as (
  select
    t.id as tender_id,
    left(
      case
        when nullif(btrim(t.reference), '') is not null
          then 'AO ' || btrim(t.reference) || ' — ' ||
               coalesce(nullif(btrim(t.title), ''), 'Sans titre')
        else 'AO — ' || coalesce(nullif(btrim(t.title), ''), 'Sans titre')
      end,
      90
    ) as base
  from public.tenders t
)
update public.documents d
set folder_path = left(b.base || '/' || public.norm_folder_path(d.folder_path), 300)
from public.document_links l
join ao_base b on b.tender_id = l.entity_id
where l.document_id = d.id
  and l.entity_type = 'tender'
  and l.organization_id = d.organization_id
  and split_part(public.norm_folder_path(d.folder_path), '/', 1) = 'DCE'
  and not exists (
    select 1
    from public.document_links l2
    join public.documents d2
      on d2.id = l2.document_id
     and d2.organization_id = l2.organization_id
    where l2.entity_type = 'tender'
      and l2.entity_id = l.entity_id
      and split_part(public.norm_folder_path(d2.folder_path), '/', 1)
          not in ('', 'DCE', 'Société')
  );

-- 4. Invariant au niveau base : plus jamais de chemin commençant par « / ».
alter table public.documents
  drop constraint if exists documents_folder_path_normalized;
alter table public.documents
  add constraint documents_folder_path_normalized
  check (folder_path = '/' or folder_path !~ '^/');
