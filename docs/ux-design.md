# UX Design Spec — Nexus

> Artefact BMAD : `bmad-ux` (condensé MVP). Langue UI : **français**.

## 1. Principes

- **Vitesse perçue** : skeletons partout, optimistic UI sur mutations simples, aucun spinner pleine page.
- **Clavier d'abord** : ⌘K command palette, `c` créer, `/` recherche, navigation `j/k` dans les listes.
- **Densité maîtrisée** : inspiration Linear/Attio — tables denses, espacement généreux ailleurs.
- **Vide utile** : chaque empty state propose l'action primaire + un raccourci.
- **Zéro modal bloquante** pour les mutations : drawer/panel latéral pour le détail, dialog seulement pour les destructif.

## 2. Design tokens (Tailwind + shadcn/ui)

- Thème : dark mode via `next-themes`, `class` strategy, défaut = dark (positionnement premium), light disponible.
- Palette : neutre zinc/gray en base, 1 couleur d'accent (indigo/violet) + sémantique (success/warning/destructive/info).
- Radius : `md` (6px) dominant. Typo : Inter ou Geist, `tabular-nums` pour les données.
- Tokens sémantiques uniquement (`bg-background`, `text-muted-foreground`…) — jamais de couleur brute dans les composants.
- Statuts métier = badges colorés cohérents (priorité : 4 niveaux ; statut tâche : backlog/todo/in_progress/in_review/done).

## 3. Layout

- App shell : sidebar gauche (org switcher en tête, nav modules, recherche, user menu), contenu central, panel détail en overlay droit.
- Sidebar collapsible (⌘B). Mobile : nav bottom ou drawer — responsive suffisant, pas d'optimisation dédiée au MVP.
- Header de page : titre + actions primaires + breadcrumb si profondeur > 2.

## 4. Patterns par module

| Module | Vues | Pattern détail | Création |
|---|---|---|---|
| CRM (accounts/contacts/opps) | table paginée + kanban opps | drawer droit | ⌘K / bouton / `c` |
| Projets | table + cards | page dédiée (tabs : tâches, docs, activité) | modal courte |
| Tâches | liste + kanban dans projet | drawer droit avec commentaires | inline + `c` |
| Documents | table + grille | drawer preview + métadonnées | drag & drop / bouton |
| Dashboard | widgets KPI + listes | liens vers entités | — |
| Membres/org | table | drawer | invitation par email |

- Kanban : `@dnd-kit`, colonnes = statuts/stages, drop = mutation optimiste.
- Tables : TanStack Table, pagination serveur, tri serveur, colonnes configurables (saved views → V1).
- Formulaires : React Hook Form + Zod, erreurs inline FR, `dirty` guard sur fermeture drawer.

## 5. États et erreurs

- Skeletons = forme exacte du contenu (table rows, cards).
- Empty states : icône + phrase + CTA (+ raccourci affiché).
- Erreurs serveur : toast + conservation de l'état du formulaire ; erreurs d'autorisation → page 403 dédiée sans leak d'info cross-tenant.
- Confirmations destructives : dialog avec nom de l'entité à ressaisir pour les suppressions d'entités majeures (org, projet).

## 6. Accessibilité

- WCAG AA visé : contrastes vérifiés en dark/light, focus visible, aria-labels sur icones-only, navigation clavier complète, `prefers-reduced-motion` respecté.

## 7. Recherche & command palette

- ⌘K : recherche globale fuzzy (debounced, serveur) + actions (créer tâche/opportunité/projet/contact, basculer org, naviguer).
- Résultats groupés par type avec icônes, récents en tête.
