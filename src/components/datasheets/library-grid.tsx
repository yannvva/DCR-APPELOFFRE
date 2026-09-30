'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  ArrowUpDown,
  Building2,
  ExternalLink,
  FileText,
  Loader2,
  Search,
  Tag,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getDocumentUrl } from '@/app/actions/documents'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DatasheetLibraryItem } from '@/lib/dal/datasheet-library'

const TYPE_LABELS: Record<string, string> = {
  Fiche_technique: 'Fiche technique',
  Notice_de_pose: 'Notice de pose',
  Notice_produit: 'Notice produit',
  Documentation_technique: 'Doc. technique',
  Guide: 'Guide',
  Avis_Technique: 'Avis technique',
  DTA: 'DTA',
  Certificat: 'Certificat',
  Certification: 'Certification',
  DoP: 'DoP',
  Declaration_UE_conformite: 'Déclaration UE',
  PV: 'PV essai',
  FDES: 'FDES',
  FDS: 'FDS',
}

const STATUS_TONE: Record<string, string> = {
  OK: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  'À VALIDER': 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  'NON CONFORME': 'bg-red-500/15 text-red-600 dark:text-red-300',
}

const SORTS = [
  { value: 'brand', label: 'Marque' },
  { value: 'recent', label: 'Plus récentes' },
  { value: 'type', label: 'Type de document' },
] as const

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

/** Thème métier affiché compact : « CANALISATIONS ET V.R.D. » → « Canalisations et V.R.D. » */
function themeLabel(theme: string) {
  return theme
    .toLowerCase()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
    .replace(/\b(v\.?r\.?d\.?|cctp|dce|moe|moa)\b/gi, (m) => m.toUpperCase())
}

/**
 * Bibliothèque produits : toutes les fiches PDF collectées au fil des AO,
 * filtrables par marque, thème métier (chapitre CCTP) et type de document.
 * Le badge « N AO » montre les dossiers qui réutilisent le même PDF.
 */
export function LibraryGrid({
  orgSlug,
  items,
  brands,
  themes,
  docTypes,
}: {
  orgSlug: string
  items: DatasheetLibraryItem[]
  brands: string[]
  themes: string[]
  docTypes: string[]
}) {
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [theme, setTheme] = useState('')
  const [docType, setDocType] = useState('')
  const [withPdf, setWithPdf] = useState(false)
  const [sort, setSort] = useState<(typeof SORTS)[number]['value']>('brand')
  const [opening, startOpening] = useTransition()

  // Un document_id pointant un document supprimé = pas de PDF disponible.
  const hasPdf = (i: DatasheetLibraryItem) => !!i.document?.name

  const filtered = useMemo(() => {
    const nq = norm(q.trim())
    const list = items.filter(
      (i) =>
        (!brand || i.brand === brand) &&
        (!theme || i.theme === theme) &&
        (!docType || i.doc_type === docType) &&
        (!withPdf || hasPdf(i)) &&
        (!nq ||
          norm(`${i.designation} ${i.brand} ${i.reference} ${i.document?.name ?? ''}`).includes(nq)),
    )
    const by = {
      brand: (a: DatasheetLibraryItem, b: DatasheetLibraryItem) =>
        (a.brand || 'zzz').localeCompare(b.brand || 'zzz', 'fr') ||
        a.designation.localeCompare(b.designation, 'fr'),
      recent: (a: DatasheetLibraryItem, b: DatasheetLibraryItem) =>
        b.created_at.localeCompare(a.created_at),
      type: (a: DatasheetLibraryItem, b: DatasheetLibraryItem) =>
        a.doc_type.localeCompare(b.doc_type, 'fr') ||
        (a.brand || '').localeCompare(b.brand || '', 'fr'),
    }[sort]
    return [...list].sort(by)
  }, [items, q, brand, theme, docType, withPdf, sort])

  const hasFilter = q || brand || theme || docType || withPdf
  const pdfCount = items.filter(hasPdf).length
  const brandCount = new Set(items.map((i) => i.brand).filter(Boolean)).size

  function openPdf(documentId: string) {
    startOpening(async () => {
      const res = await getDocumentUrl(orgSlug, documentId)
      if ('error' in res && res.error) toast.error(res.error)
      else if ('url' in res && res.url) window.open(res.url, '_blank', 'noopener')
    })
  }

  return (
    <div className="space-y-4">
      {/* Synthèse de la bibliothèque */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full border border-border bg-card px-2.5 py-1 font-medium text-foreground">
          {items.length} fiche{items.length > 1 ? 's' : ''}
        </span>
        <span className="rounded-full border border-border bg-card px-2.5 py-1">
          {brandCount} marque{brandCount > 1 ? 's' : ''}
        </span>
        <span className="rounded-full border border-border bg-card px-2.5 py-1">
          {pdfCount} PDF disponible{pdfCount > 1 ? 's' : ''}
        </span>
        {pdfCount < items.length && (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-600 dark:text-amber-300">
            {items.length - pdfCount} sans fichier
          </span>
        )}
      </div>

      {/* Barre de filtres */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher produit, marque, référence…"
            className="pl-8"
          />
        </div>
        <Select value={brand} onValueChange={(v) => setBrand(v ?? '')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Marque" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Toutes les marques</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={theme} onValueChange={(v) => setTheme(v ?? '')}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Thème" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Tous les thèmes</SelectItem>
            {themes.map((t) => (
              <SelectItem key={t} value={t}>
                {themeLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={docType} onValueChange={(v) => setDocType(v ?? '')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Type de document" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Tous les types</SelectItem>
            {docTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABELS[t] ?? t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => setWithPdf((v) => !v)}
          className={cn(
            'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
            withPdf
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          <FileText className="mr-1 inline size-3" />
          Avec PDF
        </button>
        {hasFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('')
              setBrand('')
              setTheme('')
              setDocType('')
              setWithPdf(false)
            }}
          >
            <X className="size-3.5" /> Réinitialiser
          </Button>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {filtered.length} / {items.length}
          </span>
          <Select
            value={sort}
            onValueChange={(v) => setSort((v as typeof sort) ?? 'brand')}
          >
            <SelectTrigger className="h-7 w-36 gap-1 text-xs">
              <ArrowUpDown className="size-3" />
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
        </span>
      </div>

      {/* Grille */}
      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {items.length === 0
            ? 'Aucune fiche en bibliothèque — les PDF téléchargés lors des dossiers de fiches techniques s’y rangent automatiquement.'
            : 'Aucune fiche ne correspond aux filtres.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((i) => {
            const pdf = hasPdf(i)
            return (
              <article
                key={i.id}
                className={cn(
                  'group flex flex-col rounded-lg border bg-card shadow-sm transition-colors',
                  pdf ? 'border-border hover:border-primary/40' : 'border-dashed border-border',
                )}
              >
                <div className="flex items-start justify-between gap-2 p-4 pb-0">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Building2 className="size-3.5 shrink-0" />
                    <span className="truncate">{i.brand || 'Sans marque'}</span>
                  </p>
                  <Badge
                    variant="secondary"
                    className={cn(
                      'shrink-0 text-[10px]',
                      STATUS_TONE[i.statut?.split('|')[0].trim()] ?? '',
                    )}
                  >
                    {i.statut?.split('|')[0].trim() || 'OK'}
                  </Badge>
                </div>
                <div className="flex-1 px-4">
                  <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug">
                    {i.designation || 'Document produit'}
                  </p>
                  {i.reference && i.reference !== '—' && (
                    <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground" title={i.reference}>
                      <Tag className="size-3 shrink-0" /> {i.reference}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Badge variant="secondary" className="text-[10px]">
                      {TYPE_LABELS[i.doc_type] ?? i.doc_type}
                    </Badge>
                    {i.theme && (
                      <Badge
                        variant="outline"
                        className="max-w-44 truncate text-[10px] text-muted-foreground"
                        title={i.theme}
                      >
                        {themeLabel(i.theme)}
                      </Badge>
                    )}
                    {i.usage_count > 0 && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-primary"
                        title="Dossiers d’AO utilisant ce document"
                      >
                        {i.usage_count} AO
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="mt-3 border-t border-border/60 px-4 py-2.5">
                  {pdf ? (
                    <>
                      <p
                        className="truncate font-mono text-[10px] text-muted-foreground"
                        title={i.document!.name}
                      >
                        {i.document!.name}
                      </p>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {formatSize(i.document!.size_bytes)} · {formatDate(i.created_at)}
                        </span>
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={opening}
                          onClick={() => openPdf(i.document_id!)}
                        >
                          {opening ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <FileText className="size-3" />
                          )}
                          Ouvrir
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        PDF non récupéré · {formatDate(i.created_at)}
                      </span>
                      {i.source_url ? (
                        <a
                          href={i.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                          title={i.source_url}
                        >
                          <ExternalLink className="size-3" /> Source
                        </a>
                      ) : null}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
