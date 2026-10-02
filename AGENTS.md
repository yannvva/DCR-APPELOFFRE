<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Nexus — contexte projet

SaaS B2B multi-tenant (CRM + gestion de projets + documents + fondation agents IA).
Delivery piloté par **BMAD Method** — artefacts dans `docs/` :
`product-brief.md`, `prd.md`, `ux-design.md`, `architecture.md`, `epics/`, `sprint-status.yaml`.

## Règles non négociables

- **Multi-tenancy** : `organization_id` NOT NULL sur toute table métier ; RLS complète (policies par opération). Toute nouvelle table métier DOIT avoir ses policies — pattern standard dans `supabase/migrations/0001_foundation.sql` §10.
- **Accès données** : uniquement via `src/lib/dal/` (`requireUser` / `requireMembership(orgSlug, minRole)`). RLS = filet, pas substitut.
- **Mutations** : Server Actions ; Route Handlers réservés webhooks/API publique. Zod sur toute entrée.
- **Service role** : jamais hors `src/lib/supabase/admin.ts` (server-only). Aucun secret côté client.
- **UI** : shadcn/ui preset Base UI — pas de prop `asChild`, utiliser `render={<Comp />}`. Tokens sémantiques uniquement, dark mode par défaut.
- **UI strings en français.**
- **Actions sensibles** (rôle, invitation, suppression, export, partage doc) → `audit()` dans `src/lib/audit.ts`.
- **Jointures PostgREST** : toujours nommer la FK quand la table cible est atteignable par plusieurs chemins — `organization_members` pointe DEUX fois vers `profiles` (`user_id`, `invited_by`) : sans indice (`profiles!organization_members_user_id_fkey(...)`) PostgREST renvoie PGRST201 et la liste ressort **vide en silence**. Ne jamais ignorer `error` dans un `select` imbriqué.
- **Nommage** : tout nom produit (dossier, classeur, ZIP, fiche, mémoire, DC) passe par `src/lib/naming.ts` — les titres d'AO et de lots sont des phrases entières, reprises telles quelles elles donnaient des chemins de 238 caractères. Règles : mots de liaison retirés, troncature aux frontières de mots (jamais au milieu), listes de corps d'état résumées en « +N ».
- **Nom des fiches PDF** (`docFilename`, `src/lib/datasheets/research.ts`) : `[Article CCTP] [Marque] [Référence/Désignation][ - Type].pdf` — ex. `5.5.3 Cemex CXB Voile.pdf`. L'article vient de `articleNumber()` (« Lot 1 Art. 5-5-3 » → « 5.5.3 ») ; sans numéro on retombe sur le préfixe de chapitre (`01i ACO Multidrain - DoP.pdf`). Le suffixe de type n'est ajouté que hors `Fiche_technique`. Migration des anciens noms : `scripts/normalize-datasheet-names.mjs`.
- **Purge à l'export fiches** : ne supprimer QUE `Classeur_DCR` / `Arborescence_livraison` — les PDF de fiches téléchargés vivent sous le même préfixe `org_<id>/datasheets/<runId>/` ; un filtre plus large les efface (incident déjà survenu).
- **« 1 produit = 1 fiche »** (`ensureProductDocRows`, `research.ts`) : chaque produit réel de `produits` obtient sa ligne `documents` même sans URL — sinon la couverture plafonne à ce que l'agent a émis (14 lignes pour 76 produits). Dédup par inclusion normalisée marque+référence ; les `— | —` (prescriptions/DTU) et `NON CONFORME` sont exclus ; un code citant le chapitre (« Ch. 01i ») est accepté quand le CCTP n'a pas de découpage en articles. Rattrapage d'un run : `scripts/complete-doc-rows.mjs`.
- **Rangement documents** : une seule convention de chemin (`src/lib/folder-tree.ts`, migration `0012`) — pas de slash initial, deux racines seulement : `Société` et un dossier par AO (`AO <réf> — <titre>/DCE|Fiches techniques|DC1-DC2|Mémoire technique`). Aucun document directement à la racine.
- **Fiches techniques — acquisition des PDF** : chaîne de repli en cascade, à respecter dans cet ordre :
  1. recherche web multi-moteurs (`src/lib/ai/web-tools.ts` : `SEARCH_API_URL` si configurée, puis Brave → DuckDuckGo → 6 instances SearXNG → Bing). Le fournisseur d'API est **détecté d'après l'URL** (SearxNG/Brave/Serper/Tavily) : méthode GET/POST et en-têtes d'auth adaptés, `count`/`num`/`max_results` ajoutés. Un échec d'API (401/403/quota) est **remonté** (`searchHealth().apiError`) — jamais confondu avec « aucun document ». Les requêtes identiques sont mises en cache 10 min (quota et rate-limit). SearxNG auto-hébergé : activer `search.formats: [html, json]` ;
  2. page produit → extraction du lien PDF (`resolvePdfFromPage`, `src/lib/datasheets/download.ts`) ;
  3. passe de rattrapage ciblée, relançable (`findMissingDocUrls`) ;
  4. **rattachement manuel garanti** (`attachDatasheetDocument` : import d'un PDF ou collage d'une URL, ligne par ligne dans le panneau).
  Constat vérifié : les sites fabricants français sont JS/anti-bot (Weber 403 Cloudflare, PRB documenthèque JS, SIKA PDF en JS) — sitemaps, chemins `/documentation`, API WordPress et agrégateurs BTP ne rendent AUCUN PDF. Seule la recherche (ou une API) trouve les fiches. Ne jamais présenter une absence de résultat comme « le document n'existe pas » : `searchHealth()` distingue « aucun document » de « moteurs indisponibles ».

## Comptes, emails & monitoring

- **Réinitialisation de mot de passe** : `/mot-de-passe-oublie` → email Supabase → `/auth/callback?next=/auth/update-password`. Ces chemins sont dans `PUBLIC_PATHS` (`src/proxy.ts`) — toute nouvelle page publique doit y être ajoutée, sinon redirection vers `/login`.
- **Emails transactionnels** (`src/lib/email.ts`) : Resend via API REST, **sans dépendance**. Sans `RESEND_API_KEY` + `EMAIL_FROM`, `sendEmail` renvoie false et l'app garde son repli manuel (lien d'invitation à copier). Ne jamais faire dépendre une fonctionnalité de l'envoi d'email.
- **Notifications in-app** (`src/lib/dal/notifications.ts`) : la table `notifications` n'a **aucune policy INSERT** — l'écriture passe par `notifyUsers()` (service role, `src/lib/supabase/admin.ts`). Dédupliqué sur (user, type, titre, entité) non lu : rappeler `notifyUsers` est idempotent. Rappels d'échéance générés au chargement du tableau de bord (`syncDeadlineNotifications`), email envoyé uniquement si une notification vient d'être créée.
- **Monitoring** : Sentry opt-in (`src/instrumentation.ts`, `src/instrumentation-client.ts`) — inerte sans `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`. Pas de `withSentryConfig` dans `next.config.ts` (compatibilité Turbopack) : les source maps ne sont pas téléversées.
- **Conformité** : export JSON complet de l'organisation (Paramètres → Données & conformité, owner/admin) et suppression d'organisation (owner, confirmation par saisie du nom exact). Pages publiques `/mentions-legales` et `/confidentialite` — champs entre crochets à compléter avant commercialisation.

## Commandes

- `npm run dev` / `build` / `lint` / `typecheck` / `test` (vitest) / `test:live` (appels réels API/BDD) / `test:e2e` (playwright)
- Tests **live** (réseau + service role) : uniquement dans `tests/live/`, jamais dans `tests/unit/` — `npm test` doit rester hermétique et hors-ligne.
- e2e : `npx playwright install chromium` (une fois) puis `npm run test:e2e`. Les specs vivent dans `tests/e2e/` — parcours non authentifiés uniquement (pas de compte de test).
- `maxDuration = 300` déclaré sur les segments qui déclenchent des traitements longs (page AO, page fiches) : les Server Actions héritent de la config du segment sur un hébergeur serverless.
- Types DB : `npx supabase gen types --linked > src/lib/database.types.ts` (à générer après `supabase link`)
- Migrations : fichiers `supabase/migrations/NNNN_*.sql` versionnés, appliqués via `supabase db push`

## Décidé / différé

- Next.js 16 : `proxy.ts` (pas `middleware.ts`), `cookies()`/`params`/`searchParams` async obligatoires.
- Jobs/agents : Inngest retenu (hypothèse à revalider en V1) — tables `agent_*`/`automation_*` déjà créées, inertes.
- Hors MVP : agents actifs, calendrier, saved views, billing, Gantt, intégrations.
- **Vulnérabilités npm connues** (2 modérées, transitives) : `uuid < 11.1.1` via `exceljs` — le correctif impose un downgrade breaking d'exceljs. Le vecteur (buffer fourni à uuid v3/v5/v6) n'est pas emprunté par nos usages.

