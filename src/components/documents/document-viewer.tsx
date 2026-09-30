'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getDocumentUrl } from '@/app/actions/documents'
import { formatDate, formatRelative } from '@/lib/format'
import type { Document } from '@/lib/types'

type PreviewKind = 'frame' | 'image' | 'none'

/** Types affichables en navigateur : PDF et texte dans un iframe, images en <img>. */
function kindFor(mime: string): PreviewKind {
  if (mime === 'application/pdf' || mime.startsWith('text/')) return 'frame'
  if (mime.startsWith('image/')) return 'image'
  return 'none'
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

/**
 * Modale de visualisation d'un document, avec navigation ← → entre les
 * pièces de la liste. `useDocumentViewer` fournit l'état ; `viewerProps()`
 * les props à brancher sur le composant. L'URL signée est demandée au clic
 * (pas de requête par ligne affichée).
 *
 *   const v = useDocumentViewer(orgSlug)
 *   … <button onClick={() => v.open(docs, i)}>Aperçu</button>
 *   <DocumentViewer {...v.viewerProps()} />
 */
export function useDocumentViewer(orgSlug: string) {
  const [state, setState] = useState<{
    list: Document[]
    index: number
    url: string | null
    loading: boolean
  } | null>(null)

  const load = useCallback(
    async (list: Document[], index: number) => {
      setState({ list, index, url: null, loading: true })
      const res = await getDocumentUrl(orgSlug, list[index].id)
      setState((s) => {
        // Ne pas écraser une navigation plus récente
        if (!s || s.index !== index || s.list !== list) return s
        if ('error' in res) return null
        return { ...s, url: res.url, loading: false }
      })
      if ('error' in res) toast.error(res.error)
    },
    [orgSlug],
  )

  const open = useCallback(
    (list: Document[] | Document, index = 0) => {
      if (Array.isArray(list)) void load(list, index)
      else void load([list], 0)
    },
    [load],
  )

  const go = useCallback(
    (delta: number) => {
      if (!state) return
      const next = state.index + delta
      if (next < 0 || next >= state.list.length) return
      void load(state.list, next)
    },
    [state, load],
  )

  const close = useCallback(() => setState(null), [])

  // Navigation clavier quand la modale est ouverte
  const isOpen = !!state
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, go])

  return {
    open,
    viewerProps: () => ({
      doc: state ? state.list[state.index] : null,
      url: state?.url ?? null,
      loading: state?.loading ?? false,
      position: state ? `${state.index + 1} / ${state.list.length}` : null,
      canPrev: !!state && state.index > 0,
      canNext: !!state && state.index < state.list.length - 1,
      onPrev: () => go(-1),
      onNext: () => go(1),
      onClose: close,
    }),
  }
}

export function DocumentViewer({
  doc,
  url,
  loading,
  position,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onClose,
}: {
  doc: Document | null
  url: string | null
  loading: boolean
  position: string | null
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}) {
  const kind = doc ? kindFor(doc.mime_type) : 'none'

  return (
    <Dialog
      open={!!doc}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent className="flex h-[85vh] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader className="flex-row items-center gap-2 pr-8">
          {canPrev && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onPrev}
              aria-label="Document précédent"
            >
              <ChevronLeft className="size-4" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm">{doc?.name}</DialogTitle>
            {doc && (
              <p className="text-xs text-muted-foreground">
                {formatSize(doc.size_bytes)} · ajouté {formatRelative(doc.created_at)}
                {doc.valid_until &&
                  ` · ${new Date(doc.valid_until) < new Date() ? 'expiré le' : 'valable jusqu’au'} ${formatDate(doc.valid_until)}`}
              </p>
            )}
          </div>
          {position && (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {position}
            </span>
          )}
          {canNext && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onNext}
              aria-label="Document suivant"
            >
              <ChevronRight className="size-4" />
            </Button>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-muted/30">
          {loading || !url ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Chargement…
            </div>
          ) : kind === 'frame' ? (
            <iframe src={url} title={doc?.name} className="h-full w-full" />
          ) : kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={doc?.name ?? ''}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
              <FileText className="size-10 text-muted-foreground" />
              <p className="text-muted-foreground">
                Pas de prévisualisation pour ce type de fichier.
              </p>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener"
                    download={doc?.name}
                  />
                }
              >
                <Download className="size-4" />
                Télécharger {doc?.name}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
