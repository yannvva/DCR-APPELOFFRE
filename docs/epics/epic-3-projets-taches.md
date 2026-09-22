# Epic 3 — Projets & tâches

> Résultat cohérent : piloter l'exécution — projets, tâches, assignations, échéances, kanban.

## E3-S1 — Projets

- **Objectif** : créer et gérer des projets liés au CRM.
- **AC** : Given un projet créé, When j'ouvre sa page, Then tabs (tâches, documents, activité, infos) s'affichent. Given un viewer, When il consulte, Then lecture seule.
- **Règles métier** : `code` auto `PRJ-0001` unique par org ; statuts (active,on_hold,done,archived) ; dates : `due_date` ≥ `start_date` si les deux.
- **Authz** : lecture membres org ; gestion member+ ; suppression admin+. **RLS/DB** : `projects`, `project_members`. Séquence `project_code_seq` par org (fonction).
- **UX** : table projets + page détail à tabs ; badge statut.
- **Erreurs/edge** : archivage conserve tout (soft state, pas delete) ; accès projet archivé en URL → lecture seule.
- **Tests** : intégration + isolation + unicité code. **Dépendances** : E1-S5.
- **DoD** : E2E cycle de vie projet. **Risque** : faible.

## E3-S2 — Conversion opportunité → projet

- **Objectif** : transformer une opportunité gagnée en projet sans ressaisie.
- **AC** : Given une opp `won`, When « Convertir en projet », Then projet créé (nom, compte, opp liée, docs et contacts accessibles) + `won_project_id` posé + audit.
- **Règles métier** : idempotent — si `won_project_id` existe, rediriger vers le projet ; documents liés à l'opp re-liés au projet (liens additionnels, pas déplacement).
- **Authz** : member+. **RLS** : standards. **DB** : colonnes déjà prévues.
- **UX** : action dans drawer opp + confirmation récapitulative.
- **Erreurs/edge** : opp non `won` → action masquée/refusée ; échec partiel → transaction complète.
- **Tests** : intégration atomicité + idempotence. **Dépendances** : E3-S1, E2-S3.
- **DoD** : E2E won→projet. **Risque** : faible.

## E3-S3 — Tâches & sous-tâches

- **Objectif** : découper le travail en tâches assignées avec échéances.
- **AC** : Given un projet, When je crée une tâche avec assignés + échéance + priorité, Then elle apparaît dans les vues. Given une tâche, When j'ajoute une sous-tâche, Then elle est imbriquée (1 niveau — création de sous-sous-tâche impossible).
- **Règles métier** : `parent_task_id` 1 niveau (CHECK : le parent n'a pas de parent) ; `completed_at` auto quand `status=done` ; réouverture remet `completed_at` à NULL ; suppression parent → sous-tâches remontées ou supprimées (choix : supprimées, confirmé).
- **Authz** : member+ crée/modifie ; assignés = membres de l'org (membership vérifié serveur). **RLS** : standards. **DB** : `tasks`, `task_assignees`, trigger `completed_at`, CHECK profondeur.
- **UX** : création inline dans liste/kanban, drawer tâche (description, sous-tâches, assignés, commentaires, docs, activité).
- **Erreurs/edge** : assigner un non-membre → refus ; échéance passée = badge retard ; boucle parent impossible (contrainte DB).
- **Tests** : contrainte profondeur, trigger completed_at, assignation non-membre refusée, isolation. **Dépendances** : E3-S1.
- **DoD** : E2E crud+subtask+assign. **Risque** : faible.

## E3-S4 — Kanban & liste des tâches

- **Objectif** : visualiser et manipuler les tâches en liste et kanban.
- **AC** : Given le kanban projet, When je déplace une carte, Then `status`+`position` persistés (optimiste, rollback sur échec). Given la liste, When je filtre (statut/priorité/assigné/retard), Then requête serveur paginée filtrée.
- **Règles métier** : position = entier réordonné par colonne ; filtres combinables ; retard = `due_date < today && status <> done`.
- **Authz/RLS** : standards. **DB** : index `(organization_id, project_id, status)`, `(…, due_date)`.
- **UX** : dnd-kit, colonnes scrollables, compteurs, skeletons ; liste TanStack.
- **Erreurs/edge** : conflit de drag concurrent → dernier write gagne + refresh ; colonne > 200 cartes → pagination interne.
- **Tests** : intégration filtre + ordre ; E2E drag. **Dépendances** : E3-S3.
- **DoD** : E2E kanban+filtres. **Risque** : moyen (optimistic dnd).

## E3-S5 — Commentaires & activité tâche

- **Objectif** : commenter les tâches et voir l'historique d'activité.
- **AC** : Given une tâche, When je commente, Then le commentaire apparaît + activité loggée. Given auteur, When je modifie, Then `edited_at` posé. Given non-auteur (sauf admin), When suppression tentée, Then refus.
- **Règles métier** : édition/suppression par l'auteur ou admin+ ; pas de commentaires sur entités archivées.
- **Authz** : DELETE policy = `author_id = auth.uid() OR has_org_role(...,'{owner,admin}')`. **RLS/DB** : `task_comments`, `activity_logs`.
- **UX** : thread simple dans le drawer, timestamps relatifs fr.
- **Erreurs/edge** : commentaire vide/espaces → rejet Zod ; XSS → rendu texte pur (pas de HTML injecté).
- **Tests** : policies author vs admin, isolation. **Dépendances** : E3-S3, E1-S7.
- **DoD** : E2E commentaires. **Risque** : faible.
