import { format, formatDistanceToNow, isPast, isWithinInterval, addDays } from 'date-fns'
import { fr } from 'date-fns/locale'

export function formatDate(d: string | Date | null | undefined) {
  if (!d) return '—'
  return format(new Date(d), 'dd MMM yyyy', { locale: fr })
}

export function formatRelative(d: string | Date | null | undefined) {
  if (!d) return '—'
  return formatDistanceToNow(new Date(d), { locale: fr, addSuffix: true })
}

export function formatEuros(cents: number | null | undefined) {
  if (cents == null) return '—'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export function isOverdue(due: string | null | undefined, done?: boolean) {
  if (!due || done) return false
  return isPast(new Date(due))
}

export function isDueSoon(due: string | null | undefined, days = 7) {
  if (!due) return false
  return isWithinInterval(new Date(due), { start: new Date(), end: addDays(new Date(), days) })
}

/** Jours restants avant une échéance (négatif si dépassée). */
export function daysUntil(d: string | Date | null | undefined) {
  if (!d) return 0
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)
}
