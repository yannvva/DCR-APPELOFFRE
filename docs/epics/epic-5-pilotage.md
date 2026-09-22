# Epic 5 — Pilotage, recherche & UX système

> Résultat cohérent : un cockpit quotidien — dashboard, recherche globale, command palette, dark mode.

## E5-S1 — Dashboard

- **Objectif** : voir l'essentiel en 30 s (JTBD-3).
- **AC** : Given l'org, When `/[org]/dashboard`, Then widgets : tâches en retard, échéances 7 j, pipeline (count+valeur par stage), activité récente — chacun cliquable.
- **Règles métier** : agrégats calculés par requêtes SQL scopées org (pas de vues matérialisées au MVP) ; retard = `due_date < today && status <> 'done'`.
- **Authz/RLS** : lecture membre ; requêtes via DAL. **DB** : index existants suffisent (vérifier EXPLAIN).
- **UX** : cards KPI + listes compactes, skeletons, empty states utiles (« Tout est à jour »).
- **Erreurs/edge** : org vide → empty states avec CTA création.
- **Tests** : intégration agrégats + isolation. **Dépendances** : E2, E3.
- **DoD** : E2E dashboard. **Risque** : faible.

## E5-S2 — Recherche globale

- **Objectif** : trouver toute entité par nom/email/titre (JTBD-4).
- **AC** : Given ⌘K ou `/`, When je tape ≥ 2 caractères, Then résultats groupés par type en < 300 ms (debounced 200 ms, serveur, scopé org).
- **Règles métier** : recherche ILIKE trigram sur name/title/email des entités de l'org ; 8 résultats max par type ; récents en tête.
- **Authz/RLS** : DAL + RLS. **DB** : extension `pg_trgm`, index GIN `lower(name) gin_trgm_ops` sur entités recherchées.
- **UX** : palette avec groupes, icônes, navigation clavier.
- **Erreurs/edge** : aucun résultat → proposition de création ; fuite interdite (test isolation sur search).
- **Tests** : intégration pertinence + isolation ; perf index. **Dépendances** : E2-E4.
- **DoD** : E2E search. **Risque** : faible.

## E5-S3 — Command palette & création rapide

- **Objectif** : actions rapides ⌘K : naviguer, créer tâche/opp/projet/contact/compte, basculer org.
- **AC** : Given ⌘K, When « Nouvelle tâche », Then formulaire minimal (projet+titre) puis tâche créée sans quitter le contexte.
- **Règles métier** : actions filtrées par rôle (viewer : lecture seule). **Authz/RLS** : mutations via Server Actions existantes.
- **UX** : `cmdk`, raccourcis affichés, `c` contextuel.
- **Erreurs/edge** : action indisponible (pas de projet) → disabled avec hint.
- **Tests** : E2E création rapide. **Dépendances** : E5-S2, E3-S3.
- **DoD** : palette E2E. **Risque** : faible.

## E5-S4 — Dark mode, raccourcis, polish a11y

- **Objectif** : expérience premium cohérente (dark défaut, light dispo).
- **AC** : Given le toggle thème, When changement, Then persistance + aucun FOUC. Given clavier seul, When parcours app, Then focus visible et tous les flux accessibles.
- **Règles** : tokens sémantiques only ; `prefers-reduced-motion`.
- **UX** : cf. ux-design.md. **DB/RLS** : —.
- **Tests** : checks a11y automatisés (axe) sur pages clés. **Dépendances** : E1-S5.
- **DoD** : audit a11y vert sur dashboard/crm/projet. **Risque** : faible.
