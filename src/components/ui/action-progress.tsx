'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, CircleDashed, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ProgressItem {
  name: string
  status: 'queued' | 'active' | 'done' | 'error'
  detail?: string
}

/**
 * Bandeau de progression des actions longues (import DCE, analyse IA,
 * générations…). Deux niveaux de visibilité :
 * - `steps` : les phases effectuées côté serveur (informatif — une action
 *   serveur ne peut pas streamer sa phase exacte),
 * - `items` : suivi temps réel quand le client orchestre le traitement
 *   (ex. import fichier par fichier).
 * Le chronomètre permet de repérer immédiatement un traitement bloqué.
 */
export function ActionProgress({
  title,
  steps,
  items,
  activeStep,
  stepDetail,
  className,
}: {
  title: string
  steps?: string[]
  items?: ProgressItem[]
  /** Index de l'étape en cours (0-based) — les précédentes sont cochées. */
  activeStep?: number
  /** Détail de l'étape en cours (ex. « chapitre 32.10 — 2/5 »). */
  stepDetail?: string
  className?: string
}) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  const mm = Math.floor(elapsed / 60)
  const ss = String(elapsed % 60).padStart(2, '0')

  return (
    <div
      className={cn(
        'rounded-lg border border-primary/30 bg-primary/5 px-4 py-3',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="size-4 animate-spin text-primary" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
          {mm}:{ss}
        </span>
      </div>

      {steps && steps.length > 0 && (
        <ol className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {steps.map((s, i) => {
            const done = activeStep != null && i < activeStep
            const active = activeStep != null && i === activeStep
            return (
              <li
                key={i}
                className={cn(
                  'flex items-center gap-1.5',
                  done && 'text-emerald-600 dark:text-emerald-400',
                  active && 'font-medium text-foreground',
                )}
              >
                {done ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : active ? (
                  <Loader2 className="size-4 animate-spin text-primary" />
                ) : (
                  <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                    {i + 1}
                  </span>
                )}
                {s}
                {active && stepDetail && (
                  <span className="text-muted-foreground">— {stepDetail}</span>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {items && items.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2">
              {it.status === 'active' ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
              ) : it.status === 'done' ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
              ) : it.status === 'error' ? (
                <CircleAlert className="size-3.5 shrink-0 text-destructive" />
              ) : (
                <CircleDashed className="size-3.5 shrink-0 text-muted-foreground/50" />
              )}
              <span
                className={cn(
                  'min-w-0 truncate',
                  it.status === 'queued' && 'text-muted-foreground/60',
                  it.status === 'error' && 'text-destructive',
                )}
              >
                {it.name}
              </span>
              {it.detail && (
                <span className="ml-auto shrink-0 text-muted-foreground">
                  {it.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
