'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  FileWarning,
  Search,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CRITICITE_ORDER,
  countByCriticite,
  ecartsToText,
  groupEcarts,
  groupToObtain,
} from '@/lib/datasheets/ecarts'
import { cn } from '@/lib/utils'
import type {
  DatasheetEcart,
  DatasheetToObtain,
  EcartCriticite,
} from '@/lib/datasheets/types'

const CRITICITE_STYLE: Record<EcartCriticite, string> = {
  BLOQUANT: 'bg-red-500/15 text-red-600 dark:text-red-400',
  MAJEUR: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  MINEUR: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
}

const CRITICITE_ACTIVE: Record<EcartCriticite, string> = {
  BLOQUANT: 'border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-400',
  MAJEUR: 'border-orange-500/60 bg-orange-500/10 text-orange-600 dark:text-orange-400',
  MINEUR: 'border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-400',
}

/**
 * Synthèse « Écarts et réserves ». Chaque chapitre est analysé séparément :
 * le même écart revient une fois par chapitre et par lot (≈90 constats pour
 * une quinzaine de sujets). On présente donc des **thèmes regroupés** avec
 * leur nombre d'occurrences, filtrables et dépliables — le constat détaillé
 * et les variantes restent accessibles, et la liste s'exporte pour la Q&R.
 */
export function EcartsPanel({ ecarts }: { ecarts: DatasheetEcart[] }) {
  const [criticite, setCriticite] = useState<EcartCriticite | 'all'>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [variants, setVariants] = useState<Set<string>>(new Set())

  const groups = useMemo(() => groupEcarts(ecarts), [ecarts])
  const byCrit = useMemo(() => countByCriticite(groups), [groups])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return groups.filter((g) => {
      if (criticite !== 'all' && g.criticite !== criticite) return false
      if (!needle) return true
      const hay = `${g.theme} ${g.constat} ${g.action} ${g.codes.join(' ')}`.toLowerCase()
      return hay.includes(needle)
    })
  }, [groups, criticite, q])

  function toggle(set: Set<string>, key: string, apply: (s: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    apply(next)
  }

  async function copyList() {
    const text = ecartsToText(visible, ecarts.length)
    try {
      await navigator.clipboard.writeText(text)
      toast.success(
        `${visible.length} thème(s) copié(s) — prêt à coller dans la Q&R ou un courrier MOE`,
      )
    } catch {
      toast.error('Copie impossible — sélectionnez le texte à la main.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <AlertTriangle className="size-4" /> Écarts et réserves
          <Badge variant="secondary" className="text-[10px]">
            {ecarts.length} constats
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {groups.length} thèmes
          </Badge>
          {ecarts.length > 0 && (
            <span className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() =>
                  setOpen(
                    open.size === groups.length
                      ? new Set()
                      : new Set(groups.map((g) => g.key)),
                  )
                }
              >
                {open.size === groups.length ? 'Tout replier' : 'Tout déplier'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={copyList}
              >
                <ClipboardCopy className="size-3.5" /> Copier pour la Q&R
              </Button>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ecarts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Aucun écart relevé pour l’instant.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCriticite('all')}
                className={cn(
                  'h-7 rounded-full border px-3 text-xs transition-colors',
                  criticite === 'all'
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent/60',
                )}
              >
                Tous ({groups.length})
              </button>
              {CRITICITE_ORDER.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={byCrit[c] === 0}
                  onClick={() => setCriticite(criticite === c ? 'all' : c)}
                  className={cn(
                    'h-7 rounded-full border px-3 text-xs transition-colors disabled:opacity-40',
                    criticite === c
                      ? CRITICITE_ACTIVE[c]
                      : 'border-border text-muted-foreground hover:bg-accent/60',
                  )}
                >
                  {c} ({byCrit[c]})
                </button>
              ))}
              <div className="relative ml-auto">
                <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Rechercher un écart…"
                  className="h-7 w-52 rounded-md border border-input bg-transparent pl-7 pr-7 text-xs placeholder:text-muted-foreground"
                  aria-label="Rechercher un écart"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => setQ('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Effacer"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            {visible.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                Aucun écart ne correspond au filtre.
              </p>
            ) : (
              <ul className="space-y-2">
                {visible.map((g) => {
                  const isOpen = open.has(g.key)
                  const showVariants = variants.has(g.key)
                  return (
                    <li
                      key={g.key}
                      className={cn(
                        'rounded-md border border-border p-2.5',
                        g.criticite === 'BLOQUANT' && 'border-l-2 border-l-red-500',
                        g.criticite === 'MAJEUR' && 'border-l-2 border-l-orange-500',
                        g.criticite === 'MINEUR' && 'border-l-2 border-l-amber-500',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="secondary"
                          className={cn('text-[10px]', CRITICITE_STYLE[g.criticite])}
                        >
                          {g.criticite}
                        </Badge>
                        <span className="min-w-0 flex-1 text-sm font-medium">
                          {g.theme}
                        </span>
                        {g.occurrences.length > 1 && (
                          <Badge variant="outline" className="text-[10px] tabular-nums">
                            {g.occurrences.length} occurrences
                          </Badge>
                        )}
                        {g.lots.length > 0 && (
                          <Badge variant="outline" className="text-[10px]">
                            {g.lots.join(', ')}
                          </Badge>
                        )}
                      </div>

                      {g.codes.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {g.codes.slice(0, 8).map((c, i) => (
                            <span
                              key={i}
                              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                              title={c}
                            >
                              {c.length > 34 ? `${c.slice(0, 34)}…` : c}
                            </span>
                          ))}
                          {g.codes.length > 8 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{g.codes.length - 8}
                            </span>
                          )}
                        </p>
                      )}

                      {g.action && (
                        <p className="mt-1.5 text-xs">
                          <span className="font-medium">Action :</span> {g.action}
                        </p>
                      )}

                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggle(open, g.key, setOpen)}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {isOpen ? (
                            <ChevronDown className="size-3" />
                          ) : (
                            <ChevronRight className="size-3" />
                          )}
                          {isOpen ? 'Masquer le constat' : 'Voir le constat'}
                        </button>
                        {g.occurrences.length > 1 && (
                          <button
                            type="button"
                            onClick={() => toggle(variants, g.key, setVariants)}
                            className="ml-2 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            {showVariants
                              ? 'Masquer les variantes'
                              : `Voir les ${g.occurrences.length} variantes`}
                          </button>
                        )}
                      </div>

                      {isOpen && (
                        <p className="text-muted-foreground mt-1.5 text-xs whitespace-pre-line">
                          {g.constat}
                        </p>
                      )}

                      {showVariants && (
                        <ul className="mt-2 space-y-1.5 border-t border-border pt-2">
                          {g.occurrences.map((o, i) => (
                            <li key={i} className="text-xs">
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {o.code || '—'}
                              </span>{' '}
                              <span className="font-medium">{o.objet}</span>
                              {o.criticite !== g.criticite && (
                                <Badge
                                  variant="secondary"
                                  className={cn('ml-1 text-[10px]', CRITICITE_STYLE[o.criticite])}
                                >
                                  {o.criticite}
                                </Badge>
                              )}
                              <span className="text-muted-foreground block">
                                {o.constat}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Documents à obtenir — même logique de regroupement que les écarts (le
 *  manque est signalé par chaque chapitre et chaque lot). Deux colonnes :
 *  demandes à la MOE/MOA (clarifications, pièces DCE) et demandes aux
 *  fabricants (fiches produit). */
export function AObtenirPanel({ items }: { items: DatasheetToObtain[] }) {
  const [q, setQ] = useState('')
  const groups = useMemo(() => groupToObtain(items), [items])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return groups
    return groups.filter(
      (g) =>
        (g.theme ?? '').toLowerCase().includes(needle) ||
        g.document.toLowerCase().includes(needle) ||
        g.fabricants.some((f) => f.toLowerCase().includes(needle)) ||
        g.raisons.some((r) => r.toLowerCase().includes(needle)),
    )
  }, [groups, q])
  const moe = visible.filter((g) => g.origine === 'moe')
  const fab = visible.filter((g) => g.origine === 'fabricant')

  const section = (
    title: string,
    list: typeof visible,
    emptyHint: string,
  ) => (
    <section className="min-w-0">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        <Badge variant="secondary" className="text-[10px]">
          {list.length}
        </Badge>
      </h3>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {list.map((g, i) => (
            <li key={i} className="rounded-md border border-border/60 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-medium leading-snug">
                  {g.theme ?? g.document}
                </p>
                {g.count > 1 && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    ×{g.count}
                  </Badge>
                )}
              </div>
              {g.theme && g.theme !== g.document && (
                <p className="mt-0.5 text-xs text-muted-foreground">{g.document}</p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {g.fabricants.map((f) => (
                  <Badge key={f} variant="outline" className="text-[10px]">
                    {f}
                  </Badge>
                ))}
                {g.chaps.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    demandé dans : {g.chaps.slice(0, 6).join(', ')}
                    {g.chaps.length > 6 ? ` +${g.chaps.length - 6}` : ''}
                  </span>
                )}
              </div>
              {g.raisons[0] && (
                <p className="mt-1 text-xs text-muted-foreground">{g.raisons[0]}</p>
              )}
              {g.raisons.length > 1 && (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    {g.raisons.length - 1} autre(s) précision(s)
                  </summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                    {g.raisons.slice(1).map((r, j) => (
                      <li key={j}>{r}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <FileWarning className="size-4" /> Documents à obtenir
            <Badge variant="secondary" className="text-[10px]">
              {items.length} demandes
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {groups.length} sujets
            </Badge>
          </CardTitle>
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrer (document, fabricant…)…"
              className="h-8 w-full rounded-lg border border-input bg-transparent pl-8 pr-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune demande ne correspond au filtre.</p>
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            {section(
              'À demander aux fabricants / fournisseurs',
              fab,
              'Aucune fiche fabricant à obtenir.',
            )}
            {section(
              'À demander à la MOE / MOA',
              moe,
              'Aucune clarification ou pièce DCE à demander.',
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
