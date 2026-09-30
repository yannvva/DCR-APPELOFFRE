'use client'

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/**
 * Navigation du dossier d'AO : les onglets sont présentés comme des
 * tuiles de statut (chiffre clé + pictogramme + progression), cliquables
 * et synchronisées avec l'URL via `TenderTabs`. Reste horizontal — pas de
 * sidebar — et passe sur 2/4 colonnes selon la largeur disponible.
 */
export function TenderNavList({ children }: { children: ReactNode }) {
  return (
    <TabsPrimitive.List
      aria-label="Sections du dossier"
      className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-8"
    >
      {children}
    </TabsPrimitive.List>
  )
}

type Tone = 'default' | 'accent' | 'ok' | 'warn' | 'danger'

const toneChip: Record<Tone, string> = {
  default: 'bg-muted text-muted-foreground',
  accent: 'bg-primary/10 text-primary',
  ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger: 'bg-red-500/15 text-red-600 dark:text-red-400',
}

const toneStat: Record<Tone, string> = {
  default: 'text-foreground',
  accent: 'text-primary',
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
}

export function TenderNavTab({
  value,
  icon,
  label,
  stat,
  sub,
  badge,
  tone = 'default',
  progress,
}: {
  value: string
  icon: ReactNode
  label: string
  /** Chiffre ou état affiché en grand (« 3/13 », « Appliquée », « — »). */
  stat?: string | number
  /** Complément discret accolé au libellé (« pièces », « fichiers »…). */
  sub?: string
  /** Petit indicateur en haut à droite (ex. compteur d'alertes). */
  badge?: ReactNode
  tone?: Tone
  /** 0-100 : affiche une barre de progression sous la tuile. */
  progress?: number
}) {
  return (
    <TabsPrimitive.Tab
      value={value}
      className={cn(
        'group/nav relative flex flex-col gap-2.5 rounded-xl border border-border/60 bg-card p-3 text-left transition-all',
        'hover:-translate-y-px hover:border-foreground/25 hover:shadow-md',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'data-active:border-primary/50 data-active:bg-primary/[0.05] data-active:shadow-sm data-active:ring-1 data-active:ring-primary/25',
      )}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span
          className={cn(
            'flex size-7 items-center justify-center rounded-lg transition-colors [&_svg]:size-4',
            toneChip[tone],
          )}
        >
          {icon}
        </span>
        {badge}
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            'truncate text-lg leading-tight font-semibold tabular-nums',
            toneStat[tone],
          )}
        >
          {stat ?? '—'}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {label}
          {sub ? <span className="opacity-70"> · {sub}</span> : null}
        </p>
      </div>
      {progress != null && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              progress >= 100 ? 'bg-emerald-500' : 'bg-primary',
            )}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </TabsPrimitive.Tab>
  )
}
