-- ============================================================================
-- Nexus — Migration 0009 : mémoire technique complet (étape 2)
-- Un même fichier de contenu content_*.py produit deux .docx :
--   étape 1 → MEMOIRE_TECHNIQUE_<X>_DCR.docx            (couverture + §2/4/5)
--   étape 2 → MEMOIRE_TECHNIQUE_<X>_DCR_avec_couverture.docx (mémoire complet)
-- ============================================================================

alter table public.tender_memoire_runs
  add column docx_full_document_id uuid references public.documents(id) on delete set null,
  add column docx_full_filename text;

alter table public.tender_memoire_runs
  drop constraint tender_memoire_runs_status_check;
alter table public.tender_memoire_runs
  add constraint tender_memoire_runs_status_check
  check (status in (
    'draft',       -- créé, en attente de l'analyse du DCE
    'analyzed',    -- fiche d'analyse remplie (checklist DCE)
    'generated',   -- content_*.py produit et rangé dans les documents
    'built',       -- .docx étape 1 construit (sections 2/4/5)
    'built_full',  -- .docx étape 2 construit (mémoire complet 7 parties)
    'error'
  ));
