'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { TENDER_PRESET_LABELS, type TenderPreset } from '@/components/tenders/constants'

const PRESETS: TenderPreset[] = ['open', 'due_soon', 'overdue', 'visit', 'incomplete']

/** Filtres métier rapides sous forme de chips — cumulables avec la recherche
 *  et le filtre de statut (paramètre `preset` dans l'URL, partageable). */
export function PresetChips({ mine }: { mine?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const active = searchParams.get('preset') ?? ''

  const apply = (preset: string) => {
    const sp = new URLSearchParams(searchParams.toString())
    if (preset && preset !== active) sp.set('preset', preset)
    else sp.delete('preset')
    sp.delete('page')
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }

  const presets: [string, string][] = [
    ...PRESETS.map((p) => [p, TENDER_PRESET_LABELS[p]] as [string, string]),
    ...(mine ? ([['mine', 'Mes dossiers']] as [string, string][]) : []),
  ]

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {presets.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => apply(value)}
          aria-pressed={active === value}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
            active === value
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
