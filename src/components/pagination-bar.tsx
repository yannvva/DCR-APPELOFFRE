'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Pagination client-side pour les longues listes déjà chargées en mémoire
 * (résultats d'agents : produits, documents, écarts…). Le hook borne la page
 * si la liste rétrécit (filtre) et PaginationBar se masque sous une page.
 */
export function usePager<T>(items: T[], pageSize = 15) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const clamped = Math.min(page, pageCount - 1)
  const slice = useMemo(
    () => items.slice(clamped * pageSize, clamped * pageSize + pageSize),
    [items, clamped, pageSize],
  )
  return { page: clamped, setPage, pageCount, pageSize, slice }
}

/** Fenêtre de pages numérotées : 1 … 4 5 6 … 12 */
function pageWindow(page: number, count: number): (number | '…')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i)
  const keep = new Set(
    [0, count - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < count),
  )
  const sorted = [...keep].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  let prev = -1
  for (const p of sorted) {
    if (prev !== -1 && p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
}

export function PaginationBar({
  page,
  pageCount,
  onPage,
  total,
  pageSize,
  className,
}: {
  page: number
  pageCount: number
  onPage: (p: number) => void
  total: number
  pageSize: number
  className?: string
}) {
  if (pageCount <= 1) return null
  const from = page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  const btn =
    'inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-[11px] tabular-nums transition-colors'
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground',
        className,
      )}
    >
      <span>
        {from}–{to} sur {total}
      </span>
      <nav className="flex items-center gap-0.5" aria-label="Pagination">
        <button
          type="button"
          className={cn(btn, 'hover:bg-accent disabled:opacity-40')}
          onClick={() => onPage(page - 1)}
          disabled={page === 0}
          aria-label="Page précédente"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        {pageWindow(page, pageCount).map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className={cn(btn, 'cursor-default')}>
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
              className={cn(
                btn,
                p === page
                  ? 'bg-primary/15 font-medium text-primary'
                  : 'hover:bg-accent',
              )}
            >
              {p + 1}
            </button>
          ),
        )}
        <button
          type="button"
          className={cn(btn, 'hover:bg-accent disabled:opacity-40')}
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount - 1}
          aria-label="Page suivante"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </nav>
    </div>
  )
}
