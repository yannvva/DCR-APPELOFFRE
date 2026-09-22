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

## Commandes

- `npm run dev` / `build` / `lint` / `typecheck` / `test` (vitest) / `test:e2e` (playwright)
- Types DB : `npx supabase gen types --linked > src/lib/database.types.ts` (à générer après `supabase link`)
- Migrations : fichiers `supabase/migrations/NNNN_*.sql` versionnés, appliqués via `supabase db push`

## Décidé / différé

- Next.js 16 : `proxy.ts` (pas `middleware.ts`), `cookies()`/`params`/`searchParams` async obligatoires.
- Jobs/agents : Inngest retenu (hypothèse à revalider en V1) — tables `agent_*`/`automation_*` déjà créées, inertes.
- Hors MVP : agents actifs, calendrier, saved views, notifications in-app, billing, Gantt, intégrations.

