# Audit ERP — Réponse aux appels d'offres publics

**Périmètre** : application Nexus (Next.js 16 + Supabase), auditée comme ERP de préparation / suivi / dépôt de dossiers de marchés publics.
**Méthode** : audit du code existant (pas de supposition silencieuse — les absences sont marquées explicitement).
**Verdict global** : le socle multi-tenant, la gestion documentaire privée, les tâches collaboratives et l'audit trail sont solides et réutilisables. En revanche **l'entité centrale du métier — le dossier d'appel d'offres — n'existe pas**. Tout le cœur de valeur (checklist de conformité, contrôles pré-dépôt, bibliothèque administrative réutilisable, dépôt final sécurisé) est à construire.

---

## Cartographie existant ↔ métier

| Existant (code) | Équivalent métier AO | Écart |
|---|---|---|
| `opportunities` + kanban | Dossier de candidature en pipeline | Aucun champ AO (réf. consultation, acheteur, date limite dépôt, lots, procédure) |
| `projects` + `tasks` | Suivi interne du dossier | Pas de notion "réponse AO", pas de sous-statuts dépôt |
| `documents` + `document_links` | Pièces du dossier | Pas de catégorie admin/tech/financier, pas d'expiration, pas de validation, pas de versions |
| `accounts` | Acheteurs publics | Champ `industry` générique, pas de plateforme/contact acheteur |
| `tasks` | Tâches dossier | Pas de génération automatique, pas de vue calendrier, pas de rappels |
| `activity_logs` | Historique | Fonctionnel — à étendre aux validations de pièces |
| Rôles owner/admin/member/viewer | — | Trop génériques : manque chef de projet, chiffreur, chargé admin, lecteur |
| `tags`, recherche, palette ⌘K | — | Réutilisables tels quels |

---

## 1. Tableau de bord

- **Objectif utilisateur** : voir en 10 s où sont les risques (deadlines, dossiers incomplets, pièces expirées).
- **Fonctionnalités existantes** : 4 KPI (entreprises, projets actifs, tâches ouvertes, documents), widgets « Tâches en retard », « Mes tâches », « Pipeline ouvert » (montant), « Activité récente ». <ref_snippet file="C:\Users\pc-dcr1\projects\nexus\src\app\[org]\dashboard\page.tsx" lines="83-225" />
- **Problèmes identifiés** :
  - Aucune notion d'échéance de dépôt AO — la métrique critique du métier est absente.
  - Pas de taux de complétude, pas de « prêt à déposer », pas d'alertes pièces expirées.
  - Pipeline affiche un montant générique, pas des dossiers AO triés par deadline.
  - Aucune action rapide (créer dossier, importer DCE).
- **Risques métier** : échéance de réponse manquée = dossier irrégulier/forclos. C'est le risque n°1 du métier.
- **Fonctionnalités à ajouter** :
  1. KPI : AO en cours / à compléter / J-7 deadline / incomplets / prêts / déposés / gagnés-perdus.
  2. Widget « Deadlines J-7 » trié par `response_deadline` avec badge J-x rouge/orange.
  3. Widget « Pièces expirées » (Kbis, attestations fiscales/sociales, assurances).
  4. Widget « Bloquants » (contrôles conformité en échec).
  5. Actions rapides : « Nouvel AO », « Importer un DCE », « Nouvelle tâche ».
- **Priorité** : Critique.
- **Reco technique** : nouvelle entité `tenders` (cf. §BDD) ; widget deadlines = `select tenders where response_deadline between today and today+7`; complétude = `% checklist_items validés / obligatoires`.

## 2. Liste des appels d'offres (existe partiellement via `/crm/opportunities`)

- **Fonctionnalités existantes** : kanban drag&drop par stage, recherche serveur, pagination. Pas de vue tableau AO, pas de filtres métier, pas d'export.
- **Problèmes** : les colonnes métier (acheteur, deadline, lots, complétude, mode dépôt, visite obligatoire) n'existent nulle part dans le schéma.
- **Fonctionnalités à ajouter** :
  - Vue tableau (défaut) + kanban (par statut dossier : `detecte / analyse / en_preparation / a_deposer / depose / gagne / perdu / abandonne`).
  - Colonnes : intitulé, acheteur, réf. consultation, deadline (+ heure), montant estimé, lots, responsable, % complétude, badge risque, statut dépôt.
  - Filtres métier : deadline (plage), type procédure, type marché, région, budget, statut, complétude <100 %, documents manquants, responsable, marché réservé, visite obligatoire, groupement/sous-traitance.
  - Tri par deadline croissant par défaut. Export CSV/Excel.
- **Actions utilisateur** : actions groupées (assigner responsable, archiver, exporter).
- **États vides** : « Aucun AO — importez un avis ou créez un dossier ».
- **Priorité** : Critique.
- **Reco** : table `tenders` + `tender_lots` ; page `/{org}/tenders` avec `list-toolbar.tsx` étendu aux filtres multi-champs ; badges risque via `tender_completeness` (vue matérialisée ou calcul SQL).

## 3. Création d'un appel d'offres

- **Fonctionnalités existantes** : dialog opportunité (titre, compte, contact, montant, date clôture). Aucun champ AO.
- **Fonctionnalités à ajouter** — formulaire en 3 étapes (wizard) :
  1. **Identification** : intitulé*, réf. consultation*, acheteur* (combobox `accounts` + création rapide « Acheteur public »), plateforme (PLACE, AWS, Marchés Online…), URL DCE, date publication.
  2. **Échéances & procédure** : deadline réponse* + heure*, date limite questions, visite obligatoire (date), type procédure (AO ouvert/restreint/marché négocié/DC4…), type marché (travaux/fournitures/services), durée, lots.
  3. **Organisation** : montant estimé, critères d'attribution (prix %/technique %), responsable*, collaborateurs, mode de dépôt (électronique/papier/hybride), notes internes, checklist initiale (modèle).
- **Import** : zone « Importer depuis un DCE (ZIP/PDF) » — MVP : upload + pré-remplissage manuel ; V2 : extraction IA (table `ai_extractions` existe déjà, inerte).
- **Cas d'erreur** : deadline < date du jour → warning (pas blocage) ; URL invalide ; réf. dupliquée → suggérer fusion.
- **Priorité** : Critique.
- **Reco** : `tenderSchema` Zod (~25 champs) ; wizard `TenderDialog` 3 steps ; création atomique via RPC `create_tender` (tender + lots + checklist depuis `checklist_templates` + tâches auto J-x).

## 4. Fiche détaillée d'un dossier (page centrale — à construire)

- **Objectif** : vision complète + navigation par onglets.
- **Existant** : `projects/[id]` montre le pattern (header, tags, task board, documents liés) <ref_file file="C:\Users\pc-dcr1\projects\nexus\src\app\[org]\projects\[id]\page.tsx" /> — à répliquer pour `tenders/[id]` en beaucoup plus riche.
- **Structure cible** : header (intitulé, acheteur, deadline avec compte à rebours, badge statut, % complétude, boutons `Prêt à déposer` / `Exporter ZIP`) + onglets :
  - Vue d'ensemble (timeline échéances, alertes, prochaine action)
  - Infos marché / Lots / Documents DCE
  - Checklist de conformité (§6)
  - Documents administratifs / techniques / financiers
  - Mémoire technique (éditeur riche ou fichier lié)
  - Équipe / Sous-traitants & cotraitants
  - Tâches / Planning / Q&R acheteur
  - Contrôles (§7) / Historique / Dépôt (§9) / Résultat
- **Indicateurs visuels** : chaque onglet porte un point de statut (vert/orange/rouge) — conformité par rubrique ; jamais la couleur seule (icône + libellé).
- **Données à afficher** : J-x avant deadline, montant, critères d'attribution pondérés, responsable par rubrique.
- **Priorité** : Critique.

## 5. Gestion documentaire

- **Fonctionnalités existantes** : upload privé 25 Mo, MIME allowlist, dossiers, signed URLs, liens polymorphes vers 6 types d'entités, suppression uploader/admin. <ref_file file="C:\Users\pc-dcr1\projects\nexus\src\app\[org]\documents\page.tsx" />
- **Manques critiques** :
  - Pas de **catégorisation métier** (DCE / administratif / technique / financier / mémoire / dépôt).
  - Pas de **dates de validité/expiration** → impossible de détecter un Kbis périmé ou une attestation fiscale >6 mois.
  - Pas de **validation/refus** de pièce avec motif.
  - Pas de **versions** (V1/V2 d'un mémoire).
  - Pas d'**export ZIP final** structuré.
  - Pas de **bibliothèque réutilisable** : un Kbis doit être attachable à N dossiers sans re-upload (la table `document_links` permet déjà le multi-lien — il manque l'UI « attacher une pièce existante » et la notion de « document organisation vs document dossier »).
  - Pas de drag&drop, pas d'import ZIP, pas de prévisualisation, pas de doublons (checksum existe — non exploité).
- **Fonctionnalités à ajouter** :
  1. Champs `documents` : `category` (enum), `document_type` (kbis, attestation_fiscale, dc1, dc2, ae, ccap, cctp, bpu, dpgf, dqe, memoire_tech…), `valid_until`, `status` (brouillon/a_valider/valide/refuse/archive), `rejection_reason`, `version`, `is_signed`, `is_reusable` (bibliothèque org).
  2. `DocumentRow` : badge catégorie, badge expiration (rouge si dépassé, orange <15 j), indicateur signé/validé.
  3. Dialog « Attacher depuis la bibliothèque » (recherche docs réutilisables).
  4. Drag&drop multi-fichiers (react-dropzone ou natif).
  5. Export ZIP par dossier : `GET /api/[org]/tenders/[id]/export` → zip en streaming (lib `fflate` ou `jszip` côté serveur), structure `/Administratif/`, `/Technique/`, `/Financier/`.
  6. Alerte quotidienne (cron Supabase/Inngest) : documents `valid_until < today+15` → notification.
- **Priorité** : Critique.

## 6. Checklist de conformité — **module absent, cœur du produit**

- **Fonctionnalités à créer** :
  - Table `tender_checklist_items` : `tender_id`, `label`, `category` (admin/tech/financier/dce/depot), `requirement` (obligatoire/recommande/facultatif), `status` (non_commence/en_cours/a_verifier/valide/bloque/non_requis), `assignee_id`, `internal_deadline`, `document_id` (lien pièce), `comment`, `risk_level`, `requires_signature`, `requires_chiffrage`, `auto_rule` (ex: `doc_type=kbis AND valid_until>deadline`).
  - Checklist générée à la création depuis `checklist_templates` (modèles par type de marché/procédure).
  - Score de complétude : `% obligatoires validés` — affiché partout (fiche, liste, dashboard).
  - **Règle métier incontournable** : `tenders.ready_to_submit = false` tant qu'un item `obligatoire` n'est pas `valide`, est expiré, non signé (si `requires_signature`) ou non chiffré. Enforcer en SQL (fonction `compute_tender_readiness`) + côté UI (bouton « Prêt à déposer » désactivé avec liste des bloquants).
- **Priorité** : Critique — c'est LA fonctionnalité différenciante.

## 7. Contrôles et détection d'erreurs — **absent**

- **À créer** : table `tender_alerts` (`tender_id`, `severity` bloquante/critique/importante/info, `check`, `element_ref`, `message`, `action_recommandee`, `assignee_id`, `due_date`, `resolved_at`) + moteur `run_compliance_checks(tender_id)` exécuté : à chaque mutation document/checklist, quotidiennement (cron), et avant dépôt.
- **Règles MVP** : deadline dépassée/proche (J-3, J-1), pièce obligatoire manquante, pièce expirée à la date de dépôt, document non signé, aucun lot sélectionné, mémoire technique absent, aucun document financier, visite obligatoire non justifiée, attestation fiscale/sociale >6 mois, assurance décennale expirée, échéance interne dépassée.
- **Règles V2 (IA)** : incohérence montants AE vs DQE, pièces demandées par le RC non couvertes, critères non traités dans le mémoire.
- **Priorité** : Critique.

## 8. Tâches et collaboration — bonne base, 4 manques

- **Existant** : kanban + liste, sous-tâches, assignés multiples, priorités, échéances, commentaires, audit. Solide.
- **Manques** :
  1. **Tâches automatiques** : à la création d'un AO → générer « Préparer mémoire », « Vérifier prix », « Relire dossier », « Signer pièces », « Déposer avant JJ HH:mm », « Télécharger récépissé » (table `task_templates` ou génération dans `create_tender`).
  2. **Vue calendrier** : absente (vue liste/kanban seulement) — indispensable pour échéances AO.
  3. **Rappels/notifications** : table `notifications` existe (inerte) — brancher rappels J-7/J-3/J-1.
  4. **Mentions @** et pièces jointes sur commentaires : absents.
- **Priorité** : Haute.

## 9. Dépôt final — **absent, à construire comme un wizard sécurisé**

- **Parcours « Prêt à déposer »** (page `tenders/[id]/depot`) :
  1. Résultat `run_compliance_checks` — bloquants affichés, bouton continuer **désactivé** si `severity=bloquante` non résolu.
  2. Checklist finale affichée + confirmation explicite du responsable (checkbox « Je certifie le dossier complet » + nom horodaté → `tender_submissions.validated_by`).
  3. Export ZIP conforme (structure normalisée, noms de fichiers assainis, poids total affiché).
  4. Enregistrement dépôt : `submitted_at`, `platform`, `receipt_document_id` (récépissé uploadé), `submission_ref`.
  5. Historique des dépôts + possibilité « version corrigée » (nouvelle ligne `tender_submissions`) avant deadline.
  6. Archivage : statut `depose` → `gagne/perdu/sans_suite` via `tender_results` (montant attribué, date, motif perte).
- **Important produit** : ne pas promettre de dépôt automatique sur les plateformes publiques sans API — livrer « prêt à déposer + ZIP conforme + checklist finale ».
- **Priorité** : Critique.

## 10. Modales et formulaires — audit transversal

- **Constat** : dialogs existants (account, contact, lead, opportunity, project, task, upload) — titre clair, Zod + `fieldErrors`, état pending. <ref_snippet file="C:\Users\pc-dcr1\projects\nexus\src\lib\validation\domain.ts" lines="3-59" />
- **Manques transversaux** :
  - Champs obligatoires non marqués visuellement (`*` + `aria-required`).
  - Fermeture = perte de saisie sans avertissement → ajouter `onOpenChange` + confirm si formulaire dirty (`form.formState.isDirty`).
  - Pas de brouillon auto (acceptable MVP, documenter).
  - Confirmations destructives : présentes via `AlertDialog` (suppressions) — OK.
  - Erreurs serveur : message générique unique — prévoir mapping codes→messages métier.
  - Modales à créer : `TenderDialog` (wizard), `TenderLotDialog`, `ChecklistItemDialog`, `AttachLibraryDocDialog`, `ValidateDocumentDialog` (valider/refuser + motif), `SubmissionDialog`, `TenderResultDialog`, `ImportDceDialog`.
- **Priorité** : Haute.

## Exigences transverses — écarts

| Exigence | État | Action |
|---|---|---|
| Rôles métier | owner/admin/member/viewer seulement | Ajouter colonne `job_role` (dirigeant, chef_projet, redacteur, chargé_admin, chiffreur, lecteur) + matrice de permissions (chiffreur : édite financier seul ; chargé admin : checklist admin) |
| Historique/journal validations | `activity_logs` OK | Ajouter événements `document.validated`, `checklist.validated`, `tender.submitted` |
| Modèles de dossiers/mémoires | Absent | `checklist_templates`, `document_templates` (org-scoped) |
| Bibliothèque réutilisable | `document_links` le permet, UI absente | `is_reusable` + dialog d'attachement |
| Rappels auto | `notifications` inerte | Cron + edge function ou Inngest (architecture déjà prévue) |
| Exports | Absent | CSV liste AO, PDF fiche dossier, ZIP dépôt |
| Corbeille | Absent | `deleted_at` soft-delete + page corbeille |
| Recherche globale | Fonctionnelle (`/api/[org]/search`) | Ajouter `tenders`, `checklist_items`, recherche dans noms de docs |
| Accessibilité | Base OK | `aria-required`, focus traps vérifiés, contrastes badges statut + libellés |
| Prêt pour IA | Tables agents/automations inertes | Brancher : extraction DCE, résumé RC, détection pièces demandées, cohérence montants |

---

## Priorisation

### MVP indispensable (avant mise en production)
1. Entité `tenders` + champs AO complets + création wizard.
2. Checklist de conformité par dossier + score + règle « jamais prêt si obligatoire manquant ».
3. Catégories/expiration/validation des documents + bibliothèque réutilisable.
4. Dashboard deadlines + pièces expirées.
5. Page dépôt : contrôles + confirmation + ZIP + récépissé.
6. Fiche dossier multi-onglets.

### Forte valeur (rapidement après MVP)
7. Alertes/contrôles automatiques (`tender_alerts` + moteur).
8. Tâches automatiques à la création + rappels notifications.
9. Vue tableau liste AO avec filtres métier + export CSV.
10. Versions de documents, drag&drop, doublons via checksum.

### V2
11. Vue calendrier, mentions, modèles de mémoires.
12. Rôles métier fins (chiffreur, rédacteur).
13. Résultats/statistiques (taux de gain, CA remporté).
14. Corbeille, archivage, Q&R acheteur.

### IA / automatisations progressives
15. Extraction DCE (ZIP/PDF → champs + checklist), résumé RC.
16. Détection pièces demandées, incohérences AE↔DQE.
17. Aide rédaction mémoire technique.

### Quick wins UX
18. `*` sur champs obligatoires, confirm fermeture modale dirty, compte à rebours deadline dans le header fiche, badges statut avec icône+libellé partout.

---

## Top 10 problèmes critiques

1. **Pas d'entité « appel d'offres »** — le produit est un CRM générique, pas un ERP AO.
2. **Aucune date limite de dépôt gérée** → risque de forclusion invisible.
3. **Pas de checklist de conformité** → impossible de savoir si un dossier est complet.
4. **Documents sans validité ni validation** → Kbis/attestations périmés indétectables.
5. **Pas de moteur de contrôle pré-dépôt** → erreurs découvertes trop tard.
6. **Pas de flux de dépôt** (ZIP, confirmation, récépissé, archivage).
7. **Documents non réutilisables en UI** → re-upload des mêmes pièces admin à chaque AO.
8. **Pas de lots** — les AO multi-lots sont la norme, non gérés.
9. **Rôles trop génériques** — pas de séparation chiffreur/rédacteur/admin.
10. **Aucun rappel automatique** → dépend de la mémoire humaine.

## Roadmap proposée (séquencement)

- **S1–S2** : `tenders` + lots + wizard création + liste tableau + fiche onglets (coquille).
- **S3** : `tender_checklist_items` + templates + score + readiness rule.
- **S4** : documents v2 (catégories, validité, validation, réutilisation) + dashboard deadlines.
- **S5** : `run_compliance_checks` + `tender_alerts` + page dépôt + ZIP + submissions.
- **S6** : tâches auto + rappels + exports + résultats.
- **V2** : calendrier, rôles fins, IA extraction DCE.

## Écrans à créer en priorité

`/{org}/tenders` (liste), `/{org}/tenders/[id]` (onglets), `TenderDialog` (wizard 3 steps), `/{org}/tenders/[id]/depot`, `/{org}/bibliotheque` (documents réutilisables), dashboard v2.

## Règles métier indispensables (anti-dépôt-incomplet)

- `ready_to_submit` = vrai **s s** 0 item obligatoire non validé ET 0 alerte bloquante ET deadline non dépassée.
- Document `obligatoire` + `valid_until < response_deadline` → alerte bloquante.
- `requires_signature` → statut `valide` impossible sans `is_signed`.
- Deadline passée → passage auto en `perdu (forclos)` sauf flag `depot_manuel_confirme`.
- `create_tender` atomique : tender + lots + checklist template + tâches auto.
- Récépissé requis pour passer `depose → clos`.

## Schéma de données proposé (extension, pas refonte)

```text
tenders (id, org_id, title, reference, buyer_account_id→accounts,
  platform, dce_url, published_at, response_deadline, questions_deadline,
  site_visit_at, site_visit_mandatory, procedure_type, market_type,
  duration_months, estimated_amount_cents, region, award_criteria jsonb,
  deposit_mode, status, responsible_id, notes, completeness_pct,
  ready_to_submit, created_by, timestamps)
tender_lots (id, tender_id, number, title, amount_cents, selected)
tender_members (tender_id, user_id, role_on_tender)
tender_checklist_items (… cf §6)
tender_alerts (… cf §7)
tender_submissions (id, tender_id, submitted_at, platform, ref,
  receipt_document_id, validated_by, version)
tender_results (tender_id, outcome gagne/perdu/sans_suite/annule,
  awarded_amount_cents, awarded_to, decided_at, loss_reason)
tender_documents → document_links (entity_type='tender') + 
  checklist_item_id pour rattacher une pièce à une ligne de checklist
checklist_templates / checklist_template_items (org-scoped, par type marché)
documents += category, document_type, valid_until, status, version,
  is_signed, is_reusable, rejection_reason
organization_members += job_role
```

## User stories prêtes pour dev

1. *En tant que chef de projet, je crée un AO en 3 étapes (identification, échéances, organisation) pour démarrer un dossier en <2 min.* — AC : wizard validé par `tenderSchema`, checklist + tâches auto générées, redirection vers la fiche.
2. *En tant que chargé administratif, je vois la checklist du dossier avec statut par pièce pour savoir ce qui manque.* — AC : items groupés par catégorie, filtres par statut, assignation + deadline interne par ligne.
3. *En tant que dirigeant, je vois sur le dashboard les AO à J-7 et les pièces expirées.* — AC : widget deadlines trié asc, widget docs `valid_until < +15j`, badges rouge/orange avec libellé.
4. *En tant que rédacteur, j'attache un Kbis de la bibliothèque à un nouveau dossier sans le re-uploader.* — AC : dialog recherche docs `is_reusable`, création `document_links`, pas de duplication storage.
5. *En tant que responsable, je ne peux pas marquer « prêt à déposer » si une pièce obligatoire manque ou est expirée.* — AC : bouton désactivé + liste bloquants, enforcé côté SQL.
6. *En tant que chef de projet, j'exporte un ZIP structuré et j'enregistre le récépissé après dépôt.* — AC : ZIP `/Admin/Technique/Financier`, `tender_submissions` avec receipt obligatoire.
7. *En tant qu'utilisateur, je reçois un rappel J-3/J-1 avant deadline.* — AC : `notifications` créées par cron, affichage in-app.
8. *En tant que chiffreur, je ne peux modifier que les documents financiers.* — AC : `job_role` + RLS/action checks sur `category='financier'`.
9. *En tant qu'admin, je définis des modèles de checklist par type de marché.* — AC : CRUD `checklist_templates`, appliqué à `create_tender`.
10. *En tant que chef de projet, je vois les alertes de conformité du dossier avec gravité et action recommandée.* — AC : onglet Contrôles, `run_compliance_checks` rejoué à chaque mutation.
