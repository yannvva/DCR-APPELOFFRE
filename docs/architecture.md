# Architecture — Nexus (ARCHITECTURE-SPINE)

> Artefact BMAD : `bmad-architecture`. Décisions structurantes — tout écart doit être documenté ici.

## 1. Vue d'ensemble

```
┌─────────────────────────────────────────────────────────┐
│ Next.js (App Router, RSC par défaut)                    │
│  ├─ Server Components → DAL (fetch serveur)             │
│  ├─ Server Actions → DAL (mutations internes)           │
│  └─ Route Handlers → webhooks/intégrations/API future   │
├─────────────────────────────────────────────────────────┤
│ DAL (lib/dal) : auth + membership + Zod + requêtes      │
├─────────────────────────────────────────────────────────┤
│ Supabase : PostgreSQL + RLS + Auth + Storage (privé)    │
└─────────────────────────────────────────────────────────┘
   Vercel (hosting) · GitHub Actions (CI) · Inngest (jobs, V1)
```

Principes non négociables :
- **Trois lignes de défense** : (1) vérification auth+membership dans la DAL à chaque accès, (2) RLS PostgreSQL sur chaque table, (3) validation Zod de toute entrée. Chacune suffit à bloquer une fuite ; aucune n'est optionnelle.
- `organization_id` NOT NULL + FK sur toute table métier.
- Service role key : jamais dans le bundle client, usage confiné à `lib/supabase/admin.ts` (server-only) pour les opérations privilégiées (audit, invitations, jobs).
- Realtime : aucun au MVP. Inngest : tables prêtes, runtime à V1.

## 2. Stack arrêtée

| Domaine | Choix |
|---|---|
| Framework | Next.js 15+, App Router, TypeScript `strict` |
| UI | Tailwind CSS 4, shadcn/ui (tokens sémantiques), Lucide, next-themes |
| Forms | React Hook Form + Zod (`@hookform/resolvers`) |
| Tables | TanStack Table (pagination/tri/filtres serveur) |
| DnD | @dnd-kit/core + sortable (kanban) |
| Data | Supabase Postgres, `@supabase/ssr`, types générés |
| Mutations | Server Actions ; Route Handlers pour webhooks/API |
| Dates | date-fns (+ locale fr) |
| Jobs | **Inngest** (V1) — voir §7 |
| Observabilité | Sentry (env-gated), logs structurés pino-style |
| Qualité | ESLint, Prettier, Vitest (unit/intégration), Playwright (E2E ciblés) |
| CI | GitHub Actions : lint + typecheck + tests + build |

## 3. Modèle de données

Conventions : `id uuid pk default gen_random_uuid()`, `organization_id uuid not null references organizations(id) on delete cascade`, `created_at/updated_at timestamptz not null default now()`, `created_by uuid references profiles(id)`. `updated_at` via trigger générique.

### 3.1 Identité & organisations
- **profiles** : `id` (= auth.users.id, pk), `full_name`, `avatar_url`, `default_organization_id`, timestamps. Créé par trigger sur `auth.users` insert.
- **organizations** : `id`, `name`, `slug unique`, `logo_url`, `settings jsonb`, timestamps.
- **organization_members** : `organization_id` + `user_id` (pk composée), `role text check in (owner,admin,member,viewer)`, `invited_by`, `joined_at`. Index `(user_id)`, `(organization_id, role)`.
- **organization_invitations** : `id`, `organization_id`, `email`, `role`, `token unique`, `status (pending,accepted,expired,revoked)`, `expires_at`, `invited_by`.

### 3.2 CRM
- **accounts** : `organization_id`, `name`, `domain`, `industry`, `notes`, `website`, `phone`, `address jsonb`. Index `(organization_id, lower(name))`.
- **contacts** : `organization_id`, `account_id` nullable FK, `first_name`, `last_name`, `email`, `phone`, `role`, `notes`. Index `(organization_id, account_id)`, `(organization_id, lower(last_name))`.
- **pipelines** : `organization_id`, `name`, `is_default bool`. Index `(organization_id)`.
- **pipeline_stages** : `organization_id`, `pipeline_id` FK, `name`, `position int`, `probability int`, `is_won bool`, `is_lost bool`. Unique `(pipeline_id, position)`.
- **leads** : `organization_id`, `source`, `status`, `contact_id`, `account_id`, `notes`, `converted_opportunity_id`.
- **opportunities** : `organization_id`, `pipeline_id`, `stage_id`, `account_id`, `primary_contact_id`, `title`, `value_cents bigint`, `currency char(3) default 'EUR'`, `probability int`, `expected_close_date`, `status (open,won,lost)`, `lost_reason`, `won_project_id`. Index `(organization_id, status)`, `(organization_id, stage_id)`, `(organization_id, expected_close_date)`.
- **interactions** : `organization_id`, `type (note,call,email,meeting)`, `subject`, `body`, `occurred_at`, + lien polymorphe (voir 3.6 entity_links pattern) — MVP : `account_id`, `contact_id`, `opportunity_id` colonnes nullable ciblées.

### 3.3 Projets & tâches
- **projects** : `organization_id`, `name`, `code` (unique par org, généré `PRJ-####`), `description`, `status (active,on_hold,done,archived)`, `account_id`, `opportunity_id`, `start_date`, `due_date`. Index `(organization_id, status)`, `(organization_id, due_date)`.
- **project_members** : `organization_id`, `project_id`, `user_id`, `role (manager,member)`. PK `(project_id, user_id)`.
- **tasks** : `organization_id`, `project_id`, `parent_task_id` nullable (1 niveau), `title`, `description`, `status (backlog,todo,in_progress,in_review,done)`, `priority (urgent,high,medium,low)`, `due_date`, `position int` (ordre kanban), `completed_at`. Index `(organization_id, project_id, status)`, `(organization_id, project_id, due_date)`, `(organization_id, due_date) where status <> 'done'`, `(parent_task_id)`.
- **task_assignees** : `organization_id`, `task_id`, `user_id`. PK `(task_id, user_id)`.
- **task_comments** : `organization_id`, `task_id`, `author_id`, `body`, `edited_at`. Index `(task_id, created_at)`.

### 3.4 Tags
- **tags** : `organization_id`, `name`, `color`. Unique `(organization_id, lower(name))`.
- **entity_tags** : `organization_id`, `tag_id`, `entity_type text`, `entity_id uuid`. Unique `(tag_id, entity_type, entity_id)`. Index `(organization_id, entity_type, entity_id)`.

### 3.5 Documents
- **documents** : `organization_id`, `name`, `folder_path text default '/'`, `storage_path`, `mime_type`, `size_bytes`, `checksum`, `uploaded_by`. Index `(organization_id, folder_path)`, `(organization_id, created_at desc)`.
- **document_links** : `organization_id`, `document_id`, `entity_type`, `entity_id`. Unique `(document_id, entity_type, entity_id)`.
- Storage : bucket `documents` privé, path `org_{organization_id}/{document_id}/{filename}` — RLS storage policies calquées sur membership.

### 3.6 Activité & notifications
- **activity_logs** : `organization_id`, `actor_id`, `entity_type`, `entity_id`, `action`, `metadata jsonb`. Index `(organization_id, entity_type, entity_id, created_at desc)`.
- **notifications** : `organization_id`, `user_id`, `type`, `title`, `body`, `entity_type`, `entity_id`, `read_at`. Index `(user_id, read_at) where read_at is null`.
- **saved_views** : `organization_id`, `user_id`, `entity_type`, `name`, `config jsonb`. (Table au MVP, UI → V1.)

### 3.7 Agents & automatisations (fondation — inerte au MVP)
- **agent_definitions** : `organization_id`, `name`, `description`, `status (draft,active,paused,archived)`, `current_version_id`.
- **agent_versions** : `organization_id`, `agent_id`, `version int`, `system_prompt`, `model`, `tools jsonb`, `cost_limit_cents`, `timeout_seconds`, `concurrency int`, `triggers jsonb`, `approval_policy jsonb`, unique `(agent_id, version)`.
- **agent_tools** : `organization_id`, `agent_version_id`, `tool_key`, `config jsonb`, `enabled`.
- **agent_knowledge_sources** : `organization_id`, `agent_version_id`, `source_type`, `ref`, `config jsonb`.
- **agent_runs** : `organization_id`, `agent_id`, `agent_version_id`, `trigger_type`, `initiated_by`, `status (queued,running,awaiting_approval,succeeded,failed,cancelled)`, `context jsonb`, `result_ref`, `error`, `cost_cents`, `duration_ms`, `started_at`, `finished_at`, `idempotency_key unique`.
- **agent_run_steps** : `organization_id`, `run_id`, `step_index`, `type`, `tool_key`, `input jsonb`, `output jsonb`, `status`, `duration_ms`, `created_at`.
- **automation_rules** : `organization_id`, `name`, `trigger jsonb`, `conditions jsonb`, `actions jsonb`, `enabled`, `created_by`.
- **automation_runs** : `organization_id`, `rule_id`, `status`, `context jsonb`, `error`, `duration_ms`, `idempotency_key unique`.
- **integration_connections** : `organization_id`, `provider`, `status`, `credentials_ref` (référence vault/KMS — **jamais de secret en clair**), `scopes`, `connected_by`.
- **webhook_endpoints** : `organization_id`, `url`, `secret_hash`, `events text[]`, `enabled`, `last_delivered_at`.
- **audit_logs** : `organization_id`, `actor_id`, `action`, `entity_type`, `entity_id`, `metadata jsonb`, `ip`, `user_agent`. Index `(organization_id, created_at desc)`. Insert via fonction `SECURITY DEFINER` uniquement ; pas d'UPDATE/DELETE.

## 4. Stratégie RLS

Fonctions helper (`SECURITY DEFINER`, `search_path` fixé, `stable`) :
- `public.is_org_member(org_id uuid) → bool` : existe dans `organization_members` pour `auth.uid()`.
- `public.has_org_role(org_id uuid, roles text[]) → bool` : rôle ∈ liste.
- `public.current_org_ids() → setof uuid` (optimisation : jointure directe suffit au MVP).

Politiques par table métier (pattern) :
- `SELECT` : `using (is_org_member(organization_id))`
- `INSERT` : `with check (is_org_member(organization_id) and role ≠ viewer)` → `has_org_role(organization_id, '{owner,admin,member}')`
- `UPDATE` : `using + with check` idem INSERT.
- `DELETE` : `has_org_role(organization_id, '{owner,admin}')` sauf tables à suppression membre (comments par l'auteur, documents par uploader — règles affinées par table).

Cas particuliers :
- `profiles` : SELECT soi-même + membres des mêmes orgs ; UPDATE soi-même uniquement.
- `organizations` : SELECT si membre ; INSERT tout utilisateur authentifié (devient owner via trigger/fonction) ; UPDATE owner/admin ; DELETE owner.
- `organization_members` : SELECT membres de l'org ; INSERT/UPDATE/DELETE owner/admin (owner ne peut se retirer s'il est le dernier owner — contrainte applicative + trigger).
- `organization_invitations` : SELECT/INSERT/DELETE owner/admin ; acceptation via fonction `accept_invitation(token)` SECURITY DEFINER (vérifie token, expiry, email = auth email).
- `audit_logs` : SELECT owner/admin ; INSERT via fonction `log_audit(...)` SECURITY DEFINER ; aucun UPDATE/DELETE.
- `agent_*`, `automation_*`, `integration_*`, `webhook_*` : SELECT membres ; écriture owner/admin.
- Storage `documents` : policies sur `bucket_id = 'documents'` + `is_org_member((storage.foldername(name))[1]::text::uuid dérivé du préfixe)`.

Tests d'isolation obligatoires : suite d'intégration qui, pour chaque table métier, vérifie qu'un utilisateur d'une org A ne peut SELECT/INSERT/UPDATE/DELETE aucune donnée de l'org B (y compris par id direct).

## 5. Couche accès données (DAL)

```
lib/
  supabase/{client,server,admin,middleware}.ts
  dal/{auth,organizations,members,accounts,contacts,opportunities,
       projects,tasks,documents,activity,search}.ts
  validation/*.ts (schémas Zod)
  env.ts (validation env au boot)
  audit.ts, rate-limit.ts
```

Contrat DAL : chaque fonction commence par `requireUser()` puis `requireMembership(orgId, minRole?)`. RLS reste le filet — la DAL fournit erreurs UX propres (`UnauthorizedError`, `ForbiddenError` → 401/403 sans leak).

Org active : **segment d'URL `/[org]/...`** — explicite, bookmarkable, impossible d'agir sur une org non résolue. Chaque page/layout valide `slug → membership` une fois. Org switcher = navigation vers `/[otherOrg]/dashboard`.

## 6. Sécurité — mesures actives

- Cookies Supabase `httpOnly secure sameSite=lax` via `@supabase/ssr`.
- Middleware : refresh session + redirect `/login` si non authentifié sur routes `[org]` ; rien d'autre (autorisation = DAL/RLS).
- Rate limiting : actions sensibles (invitations, login attempts, exports) via compteur DB ou Upstash (V1) — MVP : table `rate_limits` simple + fonction.
- Webhooks entrants (futur) : vérification HMAC `secret_hash`, Zod sur payload.
- Signed URLs : TTL 60 s, générés serveur après check membership, jamais persistés.
- Audit trail : rôle changé, invitation, suppression, export, partage doc, connexion intégration, exécution agent, action agent.
- Pas d'énumération : erreurs 403/404 uniformes cross-tenant.

## 7. Jobs & agents — décision

**Inngest** retenu (hypothèse à re-valider avant implémentation V1) :
- Serverless, pas d'infra (vs BullMQ+Redis à opérer).
- Intégration Next.js first-class (route handler `/api/inngest`), dev local via `inngest dev`.
- Durable functions : retries, steps memoïsés, idempotence native, scheduling/cron, observabilité UI — tout ce que NFR-6 exige.
- Trigger.dev : très proche, choix arbitraire — Inngest plus mature sur workflows longs et concurrency/throttling par clé (par org).
- Temporal : puissance inutile au stade V1, coût cognitif et infra élevés.

Préparation au MVP : tables §3.7 + `idempotency_key` + `agent_run_steps`. Exécution différée.

## 8. Structure du repo

```
nexus/
  docs/            (artefacts BMAD)
  supabase/migrations/
  src/
    app/(auth)/login|signup
    app/(app)/[org]/{dashboard,crm,projects,documents,members,settings}
    app/api/...
    components/{ui,layout,modules}
    lib/{dal,supabase,validation}
    middleware.ts, env.ts
  tests/{unit,integration,e2e}
  .github/workflows/ci.yml
```

## 9. Variables d'environnement (validées Zod)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), `SENTRY_DSN` (opt), `APP_URL`. Toute variable `NEXT_PUBLIC_*` whitelistée — jamais de clé service.
