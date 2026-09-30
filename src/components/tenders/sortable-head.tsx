'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/** Bouton de tri générique : pilote `sort`/`order` dans l'URL et
 *  réinitialise la pagination. Utilisable hors <table> (listes modernes). */
export function SortButton({
  field,
  children,
  className,
}: {
  field: string
  children: React.ReactNode
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const active = searchParams.get('sort') === field
  const desc = active && searchParams.get('order') === 'desc'

  const toggle = () => {
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('sort', field)
    sp.set('order', active && !desc ? 'desc' : 'asc')
    sp.delete('page')
    router.replace(`${pathname}?${sp.toString()}`)
  }

  const Icon = !active ? ArrowUpDown : desc ? ArrowDown : ArrowUp
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        active ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
      aria-label={`Trier par ${typeof children === 'string' ? children : field}`}
    >
      {children}
      <Icon className={cn('size-3.5', !active && 'opacity-50')} />
    </button>
  )
}

/** En-tête de colonne triable (variante <table>). */
export function SortableHead({
  field,
  children,
  className,
}: {
  field: string
  children: React.ReactNode
  className?: string
}) {
  const searchParams = useSearchParams()
  const active = searchParams.get('sort') === field
  const desc = active && searchParams.get('order') === 'desc'
  return (
    <TableHead
      className={className}
      aria-sort={active ? (desc ? 'descending' : 'ascending') : undefined}
    >
      <SortButton field={field}>{children}</SortButton>
    </TableHead>
  )
}
