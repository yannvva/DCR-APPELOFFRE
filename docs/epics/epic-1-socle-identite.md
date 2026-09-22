# Epic 1 — Socle & identité multi-tenant

> BMAD `bmad-create-epics-and-stories`. Résultat cohérent : un utilisateur peut s'inscrire, créer une organisation et naviguer dans une app sécurisée multi-tenant déployée.

## E1-S1 — Bootstrap projet & toolchain

- **Objectif** : en tant que développeur, disposer du socle Next.js+Supabase déployable.
- **Contexte** : premier commit ; tout le reste en dépend.
- **AC** : Given le repo cloné, When `npm install && npm run dev`, Then l'app démarre ; `npm run lint`, `typecheck`, `test`, `build` passent en CI.
- **Règles métier** : — | **Authz** : — | **RLS** : — | **DB** : —
- **UX** : page d'accueil placeholder FR.
- **Erreurs/edge** : env manquantes → erreur Zod explicite au boot, jamais de fallback silencieux.
- **Tests** : `env.ts` rejette une var manquante (unit). **Dépendances** : aucune.
- **DoD** : CI verte, Vercel preview déployée. **Risque** : faible.

## E1-S2 — Schéma multi-tenant + RLS (migration 0001)

- **Objectif** : en tant que système, isoler toutes les données par organisation.
- **Contexte** : fondation de sécurité — toute la donnée future repose dessus.
- **AC** : Given deux orgs A et B avec un user dans chacune, When le user A exécute SELECT/INSERT/UPDATE/DELETE sur chaque table métier, Then il ne voit/ne modifie que les données de A (même avec un id connu de B).
- **Règles métier** : `organization_id` obligatoire ; dernier owner non supprimable ; `audit_logs` append-only.
- **Authz** : policies par rôle selon architecture §4. **RLS** : activée + policies sur les ~30 tables. **DB** : migration complète + index composites.
- **UX** : — | **Erreurs/edge** : membership révoquée en cours de session → accès refusé dès la requête suivante.
- **Tests** : suite d'intégration RLS (matrice tables × opérations × cross-tenant). **Dépendances** : E1-S1.
- **DoD** : tests d'isolation verts + `EXPLAIN` sur 3 requêtes types documenté. **Risque** : élevé — fonctions helper `SECURITY DEFINER` à relire (récursion RLS sur `organization_members`).

## E1-S3 — Auth (signup / login / logout)

- **Objectif** : en tant que visiteur, créer un compte et me connecter.
- **Contexte** : Supabase Auth, cookies httpOnly via `@supabase/ssr`.
- **AC** : Given un email+mot de passe valides, When signup, Then profile créé + session posée + redirect onboarding. Given identifiants invalides, When login, Then message d'erreur générique FR (pas d'énumération).
- **Règles métier** : mot de passe ≥ 8 ; confirmation email si activée Supabase.
- **Authz** : routes `/login`, `/signup` publiques ; `(app)` protégé par middleware + DAL. **RLS** : trigger `handle_new_user`. **DB** : `profiles` + trigger.
- **UX** : formulaires RHF+Zod, erreurs inline, dark par défaut.
- **Erreurs/edge** : email déjà pris → erreur générique ; session expirée → redirect login + retour à l'URL d'origine.
- **Tests** : unit sur schémas ; E2E signup→onboarding (Playwright). **Dépendances** : E1-S2.
- **DoD** : E2E vert, aucun secret client. **Risque** : moyen (pièges cookies SSR — suivre doc `@supabase/ssr`).

## E1-S4 — Onboarding & création d'organisation

- **Objectif** : en tant que nouvel utilisateur, créer ma première organisation.
- **Contexte** : premier org = pipeline par défaut seedé.
- **AC** : Given un utilisateur sans org, When il soumet le formulaire onboarding, Then org créée + membership `owner` + stages par défaut + redirect `/[slug]/dashboard`.
- **Règles métier** : slug unique (dérivé du nom, suffixe aléatoire si collision) ; un user peut créer plusieurs orgs.
- **Authz** : INSERT org = tout authentifié ; membership owner via transaction/fonction. **RLS** : policies orgs + members. **DB** : `organizations`, `organization_members`, seed `pipelines`+`pipeline_stages`.
- **UX** : single-step form, skeleton au submit.
- **Erreurs/edge** : double-submit → idempotent (slug unique DB) ; échec seed pipeline → rollback complet.
- **Tests** : intégration création org + membership + pipeline atomiques. **Dépendances** : E1-S3.
- **DoD** : E2E onboarding complet. **Risque** : faible.

## E1-S5 — App shell, org switcher & DAL

- **Objectif** : en tant qu'utilisateur, naviguer dans l'app avec mon org active et basculer entre orgs.
- **Contexte** : org dans l'URL `/[org]/...` ; layout valide membership une fois.
- **AC** : Given membre de 2 orgs, When je bascule via le switcher, Then l'URL change et toutes les données affichées appartiennent à la nouvelle org. Given non-membre de `/acme`, When j'accède à l'URL, Then 404/403 uniforme.
- **Règles métier** : — | **Authz** : `requireMembership` dans layout + chaque DAL call. **RLS** : backstop existant. **DB** : —
- **UX** : sidebar (nav modules, org switcher, user menu), dark mode, ⌘K placeholder, skeletons layout.
- **Erreurs/edge** : slug inconnu → 404 ; membership révoquée → redirect sélecteur d'org.
- **Tests** : intégration `requireMembership` refuse non-membre ; E2E bascule org. **Dépendances** : E1-S4.
- **DoD** : app shell livré, bascule E2E verte. **Risque** : moyen (cache RSC après bascule — `router.refresh()` + revalidation par path).

## E1-S6 — Membres & invitations

- **Objectif** : en tant qu'owner/admin, voir les membres et inviter par email.
- **Contexte** : usage solo au MVP → invitations minimales mais fonctionnelles (lien token).
- **AC** : Given owner, When j'invite `x@y.com` en `member`, Then invitation `pending` avec token signé + page membres mise à jour. Given le lien `/invite/[token]`, When un utilisateur authentifié avec cet email l'ouvre, Then membership créée, invitation `accepted`, audit loggé.
- **Règles métier** : un seul membership par (org,user) ; invitation expirée 7 j ; relance = nouveau token ; rôle à l'invitation ≤ rôle de l'inviteur.
- **Authz** : gestion = owner/admin ; acceptation via fonction `accept_invitation` SECURITY DEFINER vérifiant email+expiry. **RLS** : policies invitations/members. **DB** : `organization_invitations`, fonction.
- **UX** : page membres (table), dialog invitation, copie du lien (pas d'email transactionnel au MVP — Supabase Auth emails natifs pour signup).
- **Erreurs/edge** : email déjà membre → erreur claire ; token expiré/révoqué → page dédiée ; auto-promotion interdite.
- **Tests** : intégration accept_invitation (token valide/expiré/mauvais email) + audit. **Dépendances** : E1-S5.
- **DoD** : flux complet E2E, audit écrit. **Risque** : moyen (fonction SECURITY DEFINER — revue obligatoire).

## E1-S7 — Audit log service

- **Objectif** : en tant que système, tracer les actions sensibles.
- **Contexte** : fondation transverse utilisée par toutes les stories suivantes.
- **AC** : Given une action sensible (invitation, changement rôle, suppression, partage, export), When elle aboutit, Then une ligne `audit_logs` existe (actor, action, entity, metadata, ip/ua).
- **Règles métier** : append-only ; échec d'écriture audit ≠ échec métier (log d'erreur + alerte) sauf actions destructives majeures (suppression org).
- **Authz** : SELECT owner/admin ; INSERT fonction `log_audit` SECURITY DEFINER. **RLS** : pas d'UPDATE/DELETE. **DB** : `audit_logs`, fonction.
- **UX** : — | **Erreurs/edge** : payload metadata borné (pas de secrets, taille < 8 Ko).
- **Tests** : unit fonction + RLS (membre simple ne lit pas). **Dépendances** : E1-S2.
- **DoD** : audit visible en DB pour chaque action E1. **Risque** : faible.
