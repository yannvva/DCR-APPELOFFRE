# PRD — Nexus v1.0

> Artefact BMAD : phase **Plan** (`bmad-prd`, intent create). Source : `docs/product-brief.md` v1.0.
> Statut : approuvé par le fondateur (lancement projet). Date : 2026-09-22.
> Périmètre : **MVP-1mois** (§10bis du brief) — usage solo dogfooding, interface FR.

## 1. Objectif du produit

Construire un SaaS B2B multi-tenant fusionnant CRM et gestion de projet/documentaire, utilisable immédiatement en interne (solo) et commercialisable ensuite. Le MVP délivre la chaîne de valeur complète : opportunité → projet → tâches → documents → échéances, avec fondation agents IA versionnée (schéma seul).

## 2. Contexte et problème

Voir brief §5. Synthèse : fragmentation des outils, échéances AO ratées, absence d'auditabilité, CRM sans exécution et outils projet sans pipeline.

## 3. Utilisateurs et rôles

Rôles organisationnels : `owner`, `admin`, `member`, `viewer` (hiérarchie décroissante). Au MVP, usage solo = un seul `owner` par organisation, mais le modèle complet est implémenté (multi-org, membres, rôles, invitations — schéma + RLS).

| Capability | owner | admin | member | viewer |
|---|---|---|---|---|
| Gérer l'organisation (settings, suppression) | ✔ | — | — | — |
| Gérer membres & invitations | ✔ | ✔ | — | — |
| CRUD données métier | ✔ | ✔ | ✔ | — |
| Lecture données métier | ✔ | ✔ | ✔ | ✔ |
| Gérer agents/automatisations | ✔ | ✔ | — | — |

## 4. Exigences fonctionnelles (MVP-1mois)

### Epic 1 — Socle & identité
- FR-1.1 Signup/login/logout via Supabase Auth (email+password ; magic link optionnel).
- FR-1.2 Création automatique du `profile` au signup.
- FR-1.3 Onboarding : création de la première organisation.
- FR-1.4 Changement d'organisation active (cookie/session serveur).
- FR-1.5 Liste des membres de l'organisation ; invitations (création + acceptation par lien).
- FR-1.6 Schéma multi-tenant complet : toutes les tables du modèle cible (voir architecture.md §3) créées dès le MVP avec `organization_id` + RLS, y compris les tables agents/automatisations/intégrations (inertes).
- FR-1.7 Audit log des actions sensibles.

### Epic 2 — CRM cœur
- FR-2.1 CRUD entreprises (`accounts`) et contacts, liaison contact↔entreprise.
- FR-2.2 CRUD opportunités : titre, valeur, probabilité, stage, échéance, contact/compte lié.
- FR-2.3 Pipeline avec stages par défaut créés à la création d'org (personnalisation → V1).
- FR-2.4 Tags transverses (`tags`, `entity_tags` polymorphe).
- FR-2.5 Listes paginées serveur, tri, filtre, recherche debounced.

### Epic 3 — Projets & tâches
- FR-3.1 CRUD projets : nom, statut, dates, description, membres, lien opportunité/compte.
- FR-3.2 Conversion opportunité gagnée → projet (copie contexte).
- FR-3.3 CRUD tâches : titre, description, statut, priorité, échéance, assignés multiples, sous-tâches (1 niveau).
- FR-3.4 Commentaires de tâches.
- FR-3.5 Vues liste (TanStack Table) et kanban (drag & drop par statut).
- FR-3.6 Filtres : statut, priorité, assigné, échéance.

### Epic 4 — Documents
- FR-4.1 Upload fichiers privés Supabase Storage (bucket par tenant ou préfixe `org_id/`).
- FR-4.2 Métadonnées document : nom, type, taille, dossier virtuel.
- FR-4.3 Liens polymorphes `document_links` → account/contact/opportunity/project/task.
- FR-4.4 Téléchargement via signed URLs (TTL court, généré serveur).
- FR-4.5 Suppression (fichier + métadonnée) avec audit.

### Epic 5 — Pilotage & UX système
- FR-5.1 Dashboard : tâches en retard, échéances 7 jours, pipeline agrégé, activité récente.
- FR-5.2 Recherche globale (comptes, contacts, opportunités, projets, tâches, documents).
- FR-5.3 Command palette (⌘K) : navigation + création rapide.
- FR-5.4 Dark mode, skeletons, empty states, raccourcis clavier de base.
- FR-5.5 Activity log consultable par entité.

## 5. Exigences non fonctionnelles

Reprise du brief §9 : NFR-1 multi-tenancy/RLS, NFR-2 sécurité défense en profondeur, NFR-3 performance (p95 < 300 ms listes, index composites), NFR-4 qualité (TS strict, tests, CI, Sentry), NFR-5 UX (a11y, responsive), NFR-6 fondation jobs idempotente, NFR-7 Inngest (hypothèse validée à l'architecture).

## 6. Critères de succès MVP

- Utilisation quotidienne solo sur un cas réel (suivi AO bâtiment) sans friction majeure.
- Zéro fuite cross-tenant démontrée par tests d'intégration RLS.
- Temps de création d'une opportunité complète < 60 s.
- Toutes les actions sensibles tracées dans `audit_logs`.

## 7. Dépendances

- Supabase Cloud (projet à créer par le fondateur — région EU à confirmer, B5).
- Vercel (déploiement), GitHub (repo + Actions).
- Emails transactionnels : Supabase Auth natif au MVP (provider dédié → V1).

## 8. Hors périmètre MVP

Voir brief §10 + coupes §10bis : agents actifs, calendrier, saved views, notifications in-app, stages custom, invitations avancées, billing, intégrations, API publique, Gantt, portail client, i18n, import CSV.

## 9. Risques ouverts

- 1 mois solo : epics 4-5 réductibles (documents = upload+lien minimal ; dashboard = 3 widgets).
- B5 région Supabase encore ouverte (défaut recommandé : EU).
