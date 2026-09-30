'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function SearchInput({ placeholder = 'Rechercher…' }: { placeholder?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const paramQ = searchParams.get('q') ?? ''
  const [value, setValue] = useState(paramQ)
  const timer = useRef<ReturnType<typeof setTimeout>>(null)

  // L'URL peut changer sans saisie (retour navigateur, lien partagé) —
  // ajustement d'état pendant le rendu (pattern React documenté).
  const [lastParamQ, setLastParamQ] = useState(paramQ)
  if (paramQ !== lastParamQ) {
    setLastParamQ(paramQ)
    setValue(paramQ)
  }

  useEffect(() => {
    if (value === paramQ) return // rien à pousser dans l'URL (montage inclus)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      // Lu au moment du tir : le snapshot de searchParams du render pourrait
      // écraser un autre filtre modifié entre-temps.
      const sp = new URLSearchParams(window.location.search)
      if (value) sp.set('q', value)
      else sp.delete('q')
      sp.delete('page')
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
    }, 250)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value, paramQ, pathname, router])

  return (
    <div className="relative w-64">
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
      />
    </div>
  )
}

export function Pagination({
  count,
  page,
  pageSize,
}: {
  count: number
  page: number
  pageSize: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const pages = Math.max(1, Math.ceil(count / pageSize))
  if (pages <= 1) return null

  const go = (p: number) => {
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('page', String(p))
    router.push(`${pathname}?${sp.toString()}`)
  }

  return (
    <div className="flex items-center justify-between pt-4 text-sm text-muted-foreground">
      <span>
        {count} résultat{count > 1 ? 's' : ''} — page {page}/{pages}
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => go(page - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page >= pages}
          onClick={() => go(page + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
