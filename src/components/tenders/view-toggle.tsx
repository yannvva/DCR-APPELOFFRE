'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'nexus.tenders.view'

/** Bascule liste ⇄ cartes via le paramètre d'URL `view` (partageable,
 *  conservé avec les autres filtres) — préférence persistée en
 *  localStorage quand l'URL n'explicite rien. */
export function ViewToggle() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = searchParams.get('view') === 'cards' ? 'cards' : 'list'

  // Sans `view` dans l'URL, restaurer la préférence mémorisée.
  useEffect(() => {
    if (searchParams.has('view')) return
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'cards') {
        const sp = new URLSearchParams(searchParams.toString())
        sp.set('view', 'cards')
        router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
      }
    } catch {
      // localStorage indisponible (navigation privée) — vue liste par défaut.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = (v: 'list' | 'cards') => {
    try {
      localStorage.setItem(STORAGE_KEY, v)
    } catch {
      // pas de persistance possible — l'URL suffit
    }
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
