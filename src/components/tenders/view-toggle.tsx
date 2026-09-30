'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Bascule liste ⇄ cartes via le paramètre d'URL `view` (partageable,
 *  conservé avec les autres filtres). */
export function ViewToggle() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = searchParams.get('view') === 'cards' ? 'cards' : 'list'

  const set = (v: 'list' | 'cards') => {
    const sp = new URLSearchParams(searchParams.toString())
    if (v === 'cards') sp.set('view', 'cards')
    else sp.delete('view')
    router.replace(`${pathname}?${sp.toString()}`)
  }

  return (
    <div
      role="group"
      aria-label="Mode d’affichage"
      className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      <Button
        variant={view === 'list' ? 'secondary' : 'ghost'}
        size="icon-sm"
        onClick={() => set('list')}
        aria-label="Vue liste"
        aria-pressed={view === 'list'}
        title="Vue liste"
      >
        <List className="size-4" />
      </Button>
      <Button
        variant={view === 'cards' ? 'secondary' : 'ghost'}
        size="icon-sm"
        onClick={() => set('cards')}
        aria-label="Vue cartes"
        aria-pressed={view === 'cards'}
        title="Vue cartes"
      >
        <LayoutGrid className="size-4" />
      </Button>
    </div>
  )
}
