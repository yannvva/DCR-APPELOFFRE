import type {
  AlertSeverity,
  ChecklistCategory,
  ChecklistItemStatus,
  ChecklistRequirement,
  TenderStatus,
} from '@/lib/types'

export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = {
  detecte: 'Détecté',
  analyse: 'Analyse',
  en_preparation: 'En préparation',
  a_deposer: 'Prêt à déposer',
  depose: 'Déposé',
  gagne: 'Gagné',
  perdu: 'Perdu',
  abandonne: 'Abandonné',
  annule: 'Annulé',
}

export const TENDER_STATUS_COLORS: Record<TenderStatus, string> = {
  detecte: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  analyse: 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
  en_preparation: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  a_deposer: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  depose: 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-300',
  gagne: 'bg-green-600/15 text-green-700 dark:text-green-300',
  perdu: 'bg-red-500/15 text-red-600 dark:text-red-300',
  abandonne: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
  annule: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
}

export const CHECKLIST_STATUS_LABELS: Record<ChecklistItemStatus, string> = {
  non_commence: 'Non commencé',
  en_cours: 'En cours',
  a_verifier: 'À vérifier',
  valide: 'Validé',
  bloque: 'Bloqué',
  non_requis: 'Non requis',
}

export const CHECKLIST_CATEGORY_LABELS: Record<ChecklistCategory, string> = {
  dce: 'Documents du DCE',
  administratif: 'Administratif',
  technique: 'Technique',
  financier: 'Financier',
  memoire: 'Mémoire',
  depot: 'Dépôt',
  autre: 'Autre',
}

export const REQUIREMENT_LABELS: Record<ChecklistRequirement, string> = {
  obligatoire: 'Obligatoire',
  recommande: 'Recommandé',
  facultatif: 'Facultatif',
}

export const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  bloquante: 'Bloquante',
  critique: 'Critique',
  importante: 'Importante',
  info: 'Info',
}

export const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  bloquante: 'bg-red-600/15 text-red-700 dark:text-red-300',
  critique: 'bg-red-500/15 text-red-600 dark:text-red-300',
  importante: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  info: 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
}
