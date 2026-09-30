'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const EXT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  zip: 'ZIP',
  xlsx: 'Excel',
  xls: 'Excel',
  csv: 'CSV',
  txt: 'Texte',
  docx: 'Word',
  doc: 'Word',
  png: 'Image',
  jpg: 'Image',
  jpeg: 'Image',
  webp: 'Image',
  gif: 'Image',
}

const SORTS = [
  { value: 'recent', label: 'Plus récents' },
  { value: 'name', label: 'Nom A → Z' },
  { value: 'size', label: 'Taille' },
] as const

/**
 * Barre de filtres de la page Documents : format de fichier, type de pièce
 * métier et tri — pilotés par l'URL (partageables, compatibles recherche).
 */
export function DocumentFilters({
  exts,
  types,
}: {
  /** Extensions présentes dans le dossier courant (« pdf », « zip »…). */
  exts: string[]
  /** Types de pièces présents { valeur stockée, libellé affiché }. */
  types: { value: string; label: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const set = (key: string, v: string | null) => {
    const p = new URLSearchParams(searchParams.toString())
    if (v && v !== '__all') p.set(key, v)
    else p.delete(key)
    p.delete('page')
    router.replace(`${pathname}?${p.toString()}`, { scroll: false })
  }

  const ext = searchParams.get('ext') ?? '__all'
  const dtype = searchParams.get('type') ?? '__all'
  const sort = searchParams.get('sort') ?? 'recent'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={ext} onValueChange={(v) => set('ext', v)}>
        <SelectTrigger size="sm" className="min-w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">Tous formats</SelectItem>
          {exts.map((e) => (
            <SelectItem key={e} value={e}>
              {EXT_LABELS[e] ?? e.toUpperCase()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {types.length > 0 && (
        <Select value={dtype} onValueChange={(v) => set('type', v)}>
          <SelectTrigger size="sm" className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Tous types</SelectItem>
            {types.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={sort} onValueChange={(v) => set('sort', v)}>
        <SelectTrigger size="sm" className="min-w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
