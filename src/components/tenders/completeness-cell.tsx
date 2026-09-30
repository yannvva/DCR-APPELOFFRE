'use client'

import Link from 'next/link'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { tenderPath } from '@/lib/slug'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ChecklistItemStatus } from '@/lib/types'

const STATUS_LABELS: Record<ChecklistItemStatus, string> = {
  non_commence: 'Non commencé',
  en_cours: 'En cours',
  a_verifier: 'À vérifier',
  valide: 'Validé',
  bloque: 'Bloqué',
  non_requis: 'Non requis',
}

export interface CompletenessData {
  required: number
  validated: number
  pct: number
  ready: boolean
  missing: { label: string; status: ChecklistItemStatus }[]
}

/**
 * Cellule « Complétude » de la liste des AO : pourcentage + barre de
 * progression, et infobulle listant concrètement les pièces obligatoires
 * manquantes avec leur statut (les plus bloquantes en premier).
 */
export function CompletenessCell({
  orgSlug,
  tender,
  completeness,
}: {
  orgSlug: string
  tender: { id: string; title: string }
  completeness?: CompletenessData
}) {
  const c = completeness ?? {
    required: 0,
    validated: 0,
    pct: 100,
    ready: true,
    missing: [],
  }
  const missing = c.missing ?? []
  const noRequirements = c.required === 0

  const cell = (
    <div className="min-w-32 space-y-1">
      <div className="flex items-baseline gap-1.5">
        {noRequirements ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <>
            <span
              className={cn(
                'text-sm font-medium tabular-nums',
                c.pct === 100
                  ? 'text-emerald-600 dark:text-emerald-300'
                  : c.pct >= 50
                    ? 'text-amber-600 dark:text-amber-300'
                    : 'text-red-600 dark:text-red-300',
              )}
            >
              {c.pct} %
            </span>
            <span className="text-xs text-muted-foreground">
              ({c.validated}/{c.required})
            </span>
          </>
        )}
        {missing.length > 0 && (
          <CircleAlert className="size-3.5 text-amber-500" aria-hidden />
        )}
        {!noRequirements && missing.length === 0 && (
          <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden />
        )}
      </div>
      {!noRequirements && (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={c.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Complétude des pièces obligatoires"
        >
          <div
            className={cn(
              'h-full rounded-full transition-all',
              c.pct === 100
                ? 'bg-emerald-500'
                : c.pct >= 50
                  ? 'bg-amber-500'
                  : 'bg-red-500',
            )}
            style={{ width: `${c.pct}%` }}
          />
        </div>
      )}
    </div>
  )

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="button"
            tabIndex={0}
            aria-label={
              noRequirements
                ? 'Aucune pièce obligatoire définie'
                : missing.length
                  ? `${c.pct} % — ${missing.length} pièce(s) obligatoire(s) non validée(s)`
                  : 'Dossier complet'
            }
            className="inline-flex cursor-help rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        }
      >
        {cell}
      </TooltipTrigger>
      <TooltipContent className="max-w-sm px-3 py-2">
        {noRequirements ? (
          <p>
            Aucune pièce obligatoire définie pour ce dossier. Renseignez la
            checklist pour suivre la complétude.
          </p>
        ) : missing.length === 0 ? (
          <p className="font-medium">
            Dossier complet — les {c.required} pièce
            {c.required > 1 ? 's' : ''} obligatoire
            {c.required > 1 ? 's sont' : ' est'} validée
            {c.required > 1 ? 's' : ''}.
          </p>
        ) : (
          <>
            <p className="mb-1.5 font-medium">
              {missing.length} pièce{missing.length > 1 ? 's' : ''} obligatoire
              {missing.length > 1 ? 's' : ''} non validée
              {missing.length > 1 ? 's' : ''} :
            </p>
            <ul className="space-y-1">
              {missing.slice(0, 12).map((m, i) => (
                <li
                  key={`${m.status}-${m.label}-${i}`}
                  className="flex items-start gap-1.5"
                >
                  <span
                    className={cn(
                      'mt-1.5 inline-block size-1.5 shrink-0 rounded-full',
                      m.status === 'bloque'
                        ? 'bg-red-400'
                        : m.status === 'a_verifier'
                          ? 'bg-amber-400'
                          : 'bg-background/50',
                    )}
                  />
                  <span className="min-w-0">
                    {m.label}
                    <span className="ml-1.5 text-background/60">
                      — {STATUS_LABELS[m.status] ?? m.status}
                    </span>
                  </span>
                </li>
              ))}
              {missing.length > 12 && (
                <li className="text-background/60">
                  … et {missing.length - 12} autre(s)
                </li>
              )}
            </ul>
          </>
        )}
        <Link
          href={`${tenderPath(orgSlug, tender)}?tab=checklist`}
          className="mt-1.5 inline-block underline underline-offset-2"
        >
          Ouvrir la checklist →
        </Link>
      </TooltipContent>
    </Tooltip>
  )
}
