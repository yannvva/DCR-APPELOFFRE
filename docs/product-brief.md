# Product Brief — Nexus (nom de code provisoire)

> Artefact BMAD : phase **Clarify / Analysis** (équivalent `bmad-product-brief`).
> Statut : en validation — v1.0 — 2026-09-22.
> Consommé par : `bmad-prd` (phase Plan).

## Registre des décisions

| # | Décision | Valeur | Date |
|---|---|---|---|
| B1 | Workspace / repo | `C:\Users\pc-dcr1\projects\nexus` | 2026-09-22 |
| B2 | Premiers utilisateurs | Solo (dogfooding interne uniquement) | 2026-09-22 |
| B3 | Fenêtre MVP | ~1 mois → périmètre MVP resserré (voir §10bis) | 2026-09-22 |
| B4 | Langue | Français uniquement au MVP | 2026-09-22 |
| B5 | Région hébergement | À trancher (EU recommandé) | — |

---

## 1. Résumé exécutif

SaaS B2B multi-tenant combinant **CRM commercial** (entreprises, contacts, leads, opportunités, pipelines) et **exécution opérationnelle** (projets, tâches, documents, échéances) dans un seul système, avec une fondation native pour **agents IA et automatisations** par organisation. Positionnement UX premium inspiré de Linear / Attio / Notion / Vercel. Stratégie : **dogfooding solo d'abord** (activités bâtiment/AO, SEO, e-commerce du fondateur), puis commercialisation en abonnement par organisation. Stack : Next.js + Supabase + Vercel, multi-tenancy et RLS dès le jour 1.

## 2. Vision et proposition de valeur

**Vision** : le système d'exploitation des PME et indépendants multi-activités — là où le CRM s'arrête (la vente gagnée), Nexus continue (le projet livré, les documents, les échéances), et les agents IA exécutent le travail répétitif de manière traçable.

**Proposition de valeur** :
- Un seul tenant = un seul graphe : opportunité → projet → tâches → documents → facturation future, sans ressaisie ni intégrations fragiles.
- Productivité « Linear-grade » : command palette, raccourcis, création rapide, recherche globale, vues multiples.
- IA **gouvernée** : agents versionnés, scopés par organisation, approbation humaine et audit trail.
- Cas d'usage différenciant initial : réponse aux appels d'offres bâtiment (échéances, pièces, mémoire technique) comme **configuration**, pas comme code spécifique.

## 3. Personas

| Persona | Rôle | Besoins clés | Timing |
|---|---|---|---|
| P1 — Opérateur-fondateur | owner/admin | Vue consolidée, bascule entre orgs, pipeline + projets + documents, agents | MVP |
| P2 — Chargé d'affaires / chef de projet | member | Opportunités→projets, tâches, échéances AO, documents | V1 |
| P3 — Commercial | member | Pipeline, relances, contacts, interactions | V1 |
| P4 — Administratif | member | Documents, échéances administratives, commentaires | V1 |
| P5 — Client externe / observateur | viewer | Lecture seule projet/documents partagés | V1/V2 (question I2) |

## 4. Jobs-to-be-done

- **JTBD-1** : convertir une opportunité gagnée en projet avec documents et contacts, sans ressaisie.
- **JTBD-2** : à l'arrivée d'un AO, créer l'opportunité, fixer l'échéance, attacher les pièces, découper en tâches.
- **JTBD-3** : en début de journée, voir retards, échéances et pipeline en 30 secondes.
- **JTBD-4** : recherche globale instantanée sur tout le tenant.
- **JTBD-5** : déléguer les tâches répétitives à un agent supervisé (relance, extraction, classement).
- **JTBD-6** : inviter un collaborateur avec un rôle précis.

## 5. Problèmes résolus

- Fragmentation CRM / projet / documents / mails → perte de contexte, ressaisie.
- Échéances AO et administratives ratées.
- Outils généralistes sans permissions sérieuses ni auditabilité.
- CRM qui s'arrêtent à la vente ; outils projet sans pipeline.
- Automatisations/IA actuelles opaques, non versionnées, non bornées par tenant.

## 6. Hypothèses à valider

| # | Hypothèse | Validation |
|---|---|---|
| H1 | Un MVP solo dogfoodable en ~1 mois est atteignable avec le périmètre resserré | Usage quotidien dès l'epic 2 |
| H2 | Le marché paiera pour CRM+projet fusionné | Interviews/landing V1 |
| H3 | Supabase RLS seule garantit l'isolation tenant sans friction perf | Tests charge + audit epic 1 |
| H4 | Les agents IA sont un différenciateur vendeur, pas une distraction | Reporter l'exécution post-MVP |
| H5 | RSC + Server Actions couvre les besoins sans Realtime généralisé | Revoir si besoins live émergent |
| H6 | Bâtiment/AO = beachhead en configuration, pas en code | Aucune table/champ spécifique AO |

## 7. Questions de cadrage — état

**Bloquantes**
- ~~B1 Workspace~~ → `C:\Users\pc-dcr1\projects\nexus` ✔
- ~~B2 Premiers utilisateurs~~ → solo ✔
- ~~B3 Fenêtre MVP~~ → ~1 mois ✔
- ~~B4 Langue~~ → FR ✔
- **B5 Région Supabase : EU obligatoire ? (recommandé : oui, RGPD + clients futurs)** ← reste ouverte

**Importantes**
- I1 Modèle de facturation envisagé (par siège / par org) → data model billing futur
- I2 Viewer externe (P5) : V1 ou V2 ?
- I3 Provider emails transactionnels (Resend, Postmark) — pertinent seulement si invitations au MVP
- I4 Import CSV de données existantes au MVP ?
- I5 Realtime : présence collaborative ou notifications/refresh suffisent ?
- I6 Budget infra mensuel acceptable
- I7 Mobile : responsive suffisant (recommandé au MVP) ?

**Différables**
- D1 Marketplace d'intégrations ; D2 SSO/SCIM ; D3 API publique + OAuth ; D4 Gantt/charge ; D5 Migrations depuis outils existants

## 8. Exigences fonctionnelles — cible complète

- F-1 Orgs & identité : auth, onboarding, orgs, invitations, rôles owner/admin/member/viewer, paramètres.
- F-2 CRM : companies, contacts, leads, opportunités, pipelines/stages personnalisables, tags, interactions, recherche.
- F-3 Projets & tâches : membres, statuts, sous-tâches, assignations, échéances, priorités, commentaires, vues liste/kanban/calendrier, saved views.
- F-4 Documents : upload privé, métadonnées, liens polymorphes, signed URLs, dossiers.
- F-5 Activité & notifications : activity_logs, notifications in-app.
- F-6 Dashboard : retards, échéances, pipeline, activité.
- F-7 Fondation agents : schéma `agent_*`, `automation_*`, runs — sans exécution au MVP.
- F-8 Transverse : audit_logs, recherche globale, command palette, dark mode, raccourcis.

## 9. Exigences non fonctionnelles

- **NFR-1 Multi-tenancy** : `organization_id` + FK + index sur toute table métier ; RLS complète (politiques SELECT/INSERT/UPDATE/DELETE explicites, WITH CHECK) ; zéro fuite cross-tenant (URLs, recherche, exports, logs, erreurs).
- **NFR-2 Sécurité** : défense en profondeur (serveur → DAL → RLS), Zod sur toute entrée, rate limiting, webhooks signés, secrets jamais en clair ni côté navigateur, audit trail des actions sensibles.
- **NFR-3 Performance** : pagination/filtres/tris serveur, index composites `(organization_id, created_at desc)`, `(organization_id, status)`, `(organization_id, project_id, due_date)`, EXPLAIN ANALYZE sur requêtes critiques ; budgets : p95 < 300 ms listes, LCP < 2,5 s.
- **NFR-4 Qualité** : TS strict, ESLint/Prettier, tests unitaires + intégration + E2E ciblés, GitHub Actions, Sentry, logs structurés, validation env par Zod.
- **NFR-5 UX** : responsive, dark mode, skeletons, empty states, a11y WCAG AA visé, raccourcis.
- **NFR-6 Fondation agents/jobs** : idempotent, rejouable, observable, quotas par org, approbation humaine pour actions irréversibles, aucune tâche longue dans une requête Next.js.
- **NFR-7 Orchestrateur de jobs — préliminaire** : **Inngest** (fit Next.js/Vercel, durabilité, retries, scheduling, observabilité, pas d'infra). Second : Trigger.dev. Écartés au MVP : BullMQ (Redis à opérer), Temporal (surdimensionné). À confirmer par `bmad-deep-recon` en phase architecture.

## 10. Exclusions du périmètre global MVP

- Exécution d'agents / builder visuel ; automatisations actives.
- Gantt, timeline, capacity planning.
- Billing (Stripe).
- Portail client externe (sauf I2 contraire).
- Intégrations tierces, API publique, webhooks entrants exploités.
- App mobile native, SSO, reporting avancé/matérialisé.
- Recherche full-text/embeddings dans documents (schéma préparé seulement).

## 10bis. Périmètre MVP-1mois (resserré, suite B2/B3)

Proposition de découpage en epics — à valider :

- **Epic 1 — Socle & identité** : repo, toolchain, déploiement, schéma multi-tenant complet (toutes les tables de la liste obligatoire), auth, onboarding, org unique fonctionnelle (bascule multi-org prête mais invitations dégradées ou différées), RLS + tests d'isolation.
- **Epic 2 — CRM cœur** : companies, contacts, opportunités, pipeline avec stages par défaut (personnalisation V1), tags simples, liste + recherche.
- **Epic 3 — Projets & tâches** : projets, tâches + sous-tâches, assignation, échéances, priorités, commentaires ; vues **liste + kanban uniquement** (calendrier → V1).
- **Epic 4 — Documents** : upload privé, liens polymorphes, signed URLs (dossiers simples).
- **Epic 5 — Pilotage** : dashboard minimal (retards, échéances, pipeline), recherche globale, command palette, dark mode, activity log de base.

Différés de fait à V1 : invitations avancées, notifications in-app, saved views, vue calendrier, stages personnalisables, import CSV.

## 11. Roadmap

| Phase | Contenu | Sortie |
|---|---|---|
| MVP (~1 mois) | §10bis | Usage quotidien solo sur un cas réel (suivi AO) |
| V1 | Invitations, calendrier, saved views, notifications, billing, import CSV, portail viewer (si I2), 1-2 agents supervisés, landing/pricing | 1er client externe payant self-serve |
| V2 | Builder agents/workflows, intégrations, API publique + webhooks, Gantt, reporting avancé, templates verticaux (bâtiment/AO) | Self-serve complet |

## 12. Risques

| Type | Risque | Mitigation |
|---|---|---|
| Produit | Scope creep (CRM+projet+docs+IA) | §10/§10bis stricts ; agents = schéma seul |
| Produit | Pas de différenciation | Fusion CRM↔projet + UX + AO en configuration |
| Technique | Erreur RLS → fuite cross-tenant | Tests d'isolation obligatoires par story ; audit dédié |
| Technique | Server Actions mal bornées | DAL centralisée, checklist authz par story |
| Technique | Choix jobs prématuré | Tables versionnées au MVP, runtime différé V1 |
| Sécurité | Storage/signed URLs mal scopés | Bucket policies par tenant + tests |
| Delivery | 1 mois solo = très serré pour §10bis | Epic 4/5 réductibles ; revue hebdo d'avancement |
| Delivery | Lock-in Supabase | Migrations versionnées, DAL isolée — acceptable |

## 13. Prochain workflow

**→ `bmad-prd` (intent : create)** après validation. `bmad-deep-recon` orchestrateur de jobs recommandé en parallèle (verrouille NFR-7 avant architecture).

Séquence : PRD → `bmad-ux` → `bmad-architecture` (data model + RLS) → `bmad-spec`/`bmad-create-epics-and-stories` → `bmad-sprint-planning` → builds.

## 14. Validation requise

- [ ] Périmètre MVP-1mois (§10bis) — accepter ou ajuster les coupes
- [ ] B5 : région EU Supabase
- [ ] Inngest comme hypothèse d'architecture (NFR-7)
- [ ] I1–I7 peuvent rester ouvertes jusqu'au PRD
