'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export function SearchInput({ placeholder = 'Rechercher…' }: { placeholder?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const paramQ = searchParams.get('q') ?? ''
  const [value, setValue] = useState(paramQ)
  const timer = useRef<ReturnType<typeof setTimeout>>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Raccourci « / » : focus du champ depuis n'importe où dans la page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
    <div className="relative w-64 max-w-full">
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="pl-8 pr-8"
      />
      {!value && (
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground"
        >
          /
        </kbd>
      )}
    </div>
  )
}

/** Filtre liste générique branché sur un paramètre d'URL (`?status=…`,
 *  `?account=…`). Réinitialise la pagination à chaque changement. */
export function ParamSelect({
  param,
  placeholder,
  options,
  allLabel = 'Tous',
  className,
}: {
  param: string
  placeholder: string
  options: { value: string; label: string }[]
  allLabel?: string
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const value = searchParams.get(param) ?? ''

  return (
    <Select
      value={value || 'all'}
      onValueChange={(v) => {
        const sp = new URLSearchParams(searchParams.toString())
        if (v && v !== 'all') sp.set(param, v)
        else sp.delete(param)
        sp.delete('page')
        router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
      }}
    >
      <SelectTrigger className={cn('w-44', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
          aria-label="Page précédente"
          title="Page précédente"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page >= pages}
          onClick={() => go(page + 1)}
          aria-label="Page suivante"
          title="Page suivante"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
