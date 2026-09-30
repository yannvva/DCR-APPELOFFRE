-- 0008 — Catégorie documentaire « societe » : pièces de l'entreprise
-- (KBIS, RIB, attestations URSSAF/assurances, DC1/DC2 signés, présentation…)
-- stockées au niveau organisation et mises à disposition des agents.
alter table public.documents drop constraint documents_category_check;
alter table public.documents
  add constraint documents_category_check check (category in (
    'dce','administratif','technique','financier','memoire','depot','societe','autre'
  ));
