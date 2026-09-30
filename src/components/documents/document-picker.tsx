'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, FileText, Search, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { formatDate, truncateMiddle } from '@/lib/format'
import type { Document } from '@/lib/types'

type DocOption = Pick<Document, 'id' | 'name' | 'valid_until' | 'is_signed'>

/**
 * Sélecteur de document avec recherche — le Select natif affiche l'UUID
 * (Select.Value rend la valeur, pas le libellé) et devient inutilisable au
 * delà de quelques dizaines de pièces. La recherche porte sur le nom réel.
 */
export function DocumentPicker({
  documents,
  value,
  currentLabel,
  onSelect,
  disabled,
  placeholder = 'Attacher une pièce…',
  className,
}: {
  documents: DocOption[]
  value: string | null
  /** Nom affiché si le document lié n'est pas dans `documents` (hors liste). */
  currentLabel?: string | null
  onSelect: (id: string | null) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  const selected = documents.find((d) => d.id === value)
  const triggerText = selected?.name ?? currentLabel ?? null

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return documents
    return documents.filter((d) => d.name.toLowerCase().includes(needle))
  }, [documents, q])

  const today = new Date().toISOString().slice(0, 10)

  function pick(id: string | null) {
    onSelect(id)
    setOpen(false)
    setQ('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        title={triggerText ?? undefined}
        className={cn(
          'flex h-8 items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent px-2.5 text-xs whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50',
          className,
        )}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left',
            !triggerText && 'text-muted-foreground',
          )}
        >
          {triggerText ?? placeholder}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--anchor-width) min-w-72 gap-1.5 p-1.5"
      >
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher une pièce par son nom…"
            aria-label="Rechercher une pièce"
            className="h-7 w-full rounded-md border border-input bg-transparent pl-7 pr-7 text-xs outline-none focus-visible:border-ring"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Effacer la recherche"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <ul className="max-h-64 overflow-y-auto">
          {value && (
            <li>
              <button
                type="button"
                onClick={() => pick(null)}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-accent"
              >
                <X className="size-3" /> — Aucune pièce —
              </button>
            </li>
          )}
          {visible.length === 0 ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              Aucune pièce ne correspond à « {q} ».
            </li>
          ) : (
            visible.map((d) => {
              const expired = !!d.valid_until && d.valid_until < today
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => pick(d.id)}
                    title={d.name}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent',
                      d.id === value && 'bg-accent/60',
                    )}
                  >
                    {d.id === value ? (
                      <Check className="size-3 shrink-0 text-primary" />
                    ) : (
                      <FileText className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {truncateMiddle(d.name, 70)}
                    </span>
                    {expired && (
                      <span className="shrink-0 text-[10px] text-destructive">
                        expiré {formatDate(d.valid_until)}
                      </span>
                    )}
                  </button>
                </li>
              )
            })
          )}
        </ul>
        <p className="border-t border-border px-1.5 pt-1 text-[10px] text-muted-foreground">
          {visible.length}/{documents.length} pièce{documents.length > 1 ? 's' : ''}
        </p>
      </PopoverContent>
    </Popover>
  )
}
