# Epic 2 — CRM cœur

> Résultat cohérent : gérer entreprises, contacts et opportunités sur un pipeline, avec recherche et tags.

## E2-S1 — Entreprises (accounts)

- **Objectif** : en tant qu'utilisateur, créer et gérer les entreprises.
- **Contexte** : entité racine CRM ; liée aux contacts, opportunités, projets, documents.
- **AC** : Given un formulaire valide, When je crée une entreprise, Then elle apparaît dans la liste paginée et est retrouvée par recherche. Given un viewer, When il tente de créer, Then refus (bouton masqué + serveur refuse).
- **Règles métier** : `name` obligatoire par org ; `domain` optionnel, dédupliqué en warning (pas en blocage).
- **Authz** : lecture tout membre ; écriture owner/admin/member. **RLS** : policies standards. **DB** : `accounts`.
- **UX** : table TanStack (tri, pagination serveur), drawer détail (contacts, opps, docs liés), création via ⌘K et bouton.
- **Erreurs/edge** : nom dupliqué → warning non bloquant ; suppression avec enfants → confirmation listant l'impact (cascade documents liés conservés, liens supprimés).
- **Tests** : CRUD intégration + isolation RLS + Zod. **Dépendances** : E1-S5.
- **DoD** : E2E create→search→edit→delete. **Risque** : faible.

## E2-S2 — Contacts

- **Objectif** : gérer les contacts, rattachés ou non à une entreprise.
- **AC** : Given un compte sélectionné, When je crée un contact, Then il est lié et listé dans le drawer du compte.
- **Règles métier** : `last_name` obligatoire ; email validé Zod si fourni ; contact orphelin autorisé.
- **Authz/RLS/DB** : idem E2-S1 (`contacts`, index `(organization_id, account_id)`).
- **UX** : table + drawer ; sélecteur de compte avec recherche.
- **Erreurs/edge** : suppression compte → `account_id` mis à NULL (SET NULL), contact conservé.
- **Tests** : intégration liaison + SET NULL ; isolation. **Dépendances** : E2-S1.
- **DoD** : E2E complet. **Risque** : faible.

## E2-S3 — Pipeline & opportunités

- **Objectif** : suivre des opportunités dans un pipeline kanban.
- **Contexte** : pipeline + stages par défaut seedés à la création d'org (E1-S4).
- **AC** : Given une opportunité, When je la déplace de stage en kanban, Then `stage_id` et `probability` mis à jour (optimiste + rollback si échec) + activité loggée. When je la marque `won`, Then proposition de conversion en projet (E3-S2). When `lost`, Then `lost_reason` demandée.
- **Règles métier** : une opp appartient à un stage du pipeline de son org ; valeur ≥ 0 ; devise EUR MVP ; stage `won/lost` → `status` dérivé.
- **Authz/RLS** : standards + DELETE owner/admin. **DB** : `pipelines`, `pipeline_stages`, `opportunities`.
- **UX** : kanban drag&drop + vue table ; drawer détail (infos, docs, activité, tâches liées future).
- **Erreurs/edge** : drop vers stage d'un autre pipeline → refus serveur ; opp `won` non modifiable sauf réouverture (admin).
- **Tests** : transitions de stage, isolation, audit. **Dépendances** : E2-S1 (compte/contact optionnels).
- **DoD** : E2E drag&drop + won→projet. **Risque** : moyen (dnd-kit + optimistic).

## E2-S4 — Tags transverses

- **Objectif** : tagger n'importe quelle entité (account, contact, opp, projet, document).
- **AC** : Given un tag « AO Bâtiment », When je l'applique à une opportunité et un projet, Then filtrage par tag fonctionne sur les deux listes.
- **Règles métier** : nom unique par org (insensible casse) ; suppression tag = suppression des liens.
- **Authz** : création tag = member+. **RLS** : standards. **DB** : `tags`, `entity_tags`.
- **UX** : chips colorées, autocomplete création inline, filtre dans tables.
- **Erreurs/edge** : `entity_type` hors whitelist → rejet Zod/serveur.
- **Tests** : intégration polymorphe + unicité. **Dépendances** : E2-S1.
- **DoD** : filtrage E2E. **Risque** : faible.

## E2-S5 — Leads (léger)

- **Objectif** : capter des leads et les convertir en opportunité.
- **AC** : Given un lead, When « convertir », Then opportunité créée pré-remplie + lead lié (`converted_opportunity_id`), lead marqué converti.
- **Règles métier** : statuts (new,contacted,qualified,converted,lost).
- **Authz/RLS/DB** : `leads`, standards. **UX** : table simple + drawer.
- **Erreurs/edge** : double conversion → refus si `converted_opportunity_id` déjà posé.
- **Tests** : intégration conversion. **Dépendances** : E2-S3.
- **DoD** : E2E lead→opp. **Risque** : faible. — *Réductible si pression temps (JTBD AO couvert par opps seules).*
