# Epic 4 — Documents

> Résultat cohérent : fichiers privés centralisés, liés aux entités métier, servis par signed URLs.

## E4-S1 — Upload & stockage privé

- **Objectif** : uploader des fichiers privés scopés par organisation.
- **Contexte** : bucket `documents` privé, path `org_{organization_id}/{document_id}/{filename}`.
- **AC** : Given un fichier < 25 Mo de type autorisé, When upload depuis un drawer/page documents, Then ligne `documents` + objet storage + activité. Given membre org B, When il tente d'uploader vers path org A, Then refus policy storage.
- **Règles métier** : MIME whitelist (pdf, images, office, zip, txt) ; taille max 25 Mo ; `storage_path` unique ; nom affiché éditable sans renommer l'objet.
- **Authz** : member+ ; storage policies sur préfixe org. **RLS** : `documents` + `storage.objects`. **DB** : `documents`, bucket + policies.
- **UX** : drag & drop + progress, liste fichiers du drawer/projet.
- **Erreurs/edge** : fichier refusé (type/taille) → message clair ; échec storage après insert → transaction compensée (delete métadonnée).
- **Tests** : intégration policies storage cross-tenant ; unit whitelist. **Dépendances** : E1-S5.
- **DoD** : E2E upload+visibilité. **Risque** : moyen (policies storage — tester explicitement).

## E4-S2 — Signed URLs & téléchargement

- **Objectif** : télécharger uniquement via URL signée courte durée.
- **AC** : Given membre de l'org, When clic télécharger, Then URL signée TTL 60 s générée côté serveur. Given URL expirée ou org différente, When accès, Then refus.
- **Règles métier** : jamais d'URL publique ; URL régénérée à chaque demande (pas de cache persistant).
- **Authz** : DAL `getSignedUrl(docId)` → `requireMembership`. **RLS** : storage select policy. **DB** : —
- **UX** : bouton télécharger + aperçu images/pdf (V1 légère).
- **Erreurs/edge** : document supprimé entre liste et clic → 404 propre.
- **Tests** : intégration non-membre refusé, TTL. **Dépendances** : E4-S1.
- **DoD** : E2E download. **Risque** : faible.

## E4-S3 — Liens polymorphes & page Documents

- **Objectif** : lier des documents à comptes, contacts, opps, projets, tâches ; vue globale par dossiers.
- **AC** : Given un document, When je le lie à une opportunité et un projet, Then il apparaît dans les deux drawers. Given la page Documents, When je navigue un `folder_path`, Then listing paginé filtré.
- **Règles métier** : `entity_type` whitelist Zod+CHECK ; lien unique (doc, type, id) ; suppression entité → liens supprimés (cascade), document conservé sauf si dernier contexte (choix : conservé, visible dans « Non classés »).
- **Authz** : member+ ; cohérence `organization_id` du lien = celle du document (CHECK via trigger). **RLS/DB** : `document_links`.
- **UX** : page documents (table + dossiers virtuels), section fichiers dans drawers entités, drop direct sur drawer.
- **Erreurs/edge** : liaison vers entité d'une autre org → impossible (FK/trigger + DAL) ; `folder_path` normalisé.
- **Tests** : trigger cohérence org, unicité lien, isolation. **Dépendances** : E4-S1, E2/E3.
- **DoD** : E2E liaison croisée. **Risque** : faible.

## E4-S4 — Suppression & audit

- **Objectif** : supprimer un document proprement (objet + métadonnée + audit).
- **AC** : Given uploader ou admin+, When suppression confirmée, Then objet storage + ligne + liens supprimés + audit. Given member non-uploader, When suppression, Then refus.
- **Règles métier** : DELETE policy `uploaded_by = auth.uid() OR owner/admin` ; échec suppression objet → métadonnée marquée `pending_delete` + retry job (V1) — MVP : tentative synchrone + erreur explicite.
- **Authz/RLS/DB** : cf. règles. **UX** : confirmation destructive.
- **Tests** : policy auteur vs admin ; audit écrit. **Dépendances** : E4-S3, E1-S7.
- **DoD** : E2E delete. **Risque** : faible.
