'use client'

import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Download,
  Eye,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Folder,
  Link2Off,
  Loader2,
  Lock,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getDocumentUrl,
  unlinkDocumentByEntity,
  uploadDocument,
} from '@/app/actions/documents'
import {
  DocumentViewer,
  useDocumentViewer,
} from '@/components/documents/document-viewer'
import { docTypeLabel } from '@/lib/doc-labels'
import { isPipelineManagedDoc } from '@/lib/pipeline-docs'
import { formatDate } from '@/lib/format'
import { normalizeFolderPath } from '@/lib/folder-tree'
import { shortText, shortenLotLabel } from '@/lib/naming'
import type { Document } from '@/lib/types'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

function docIcon(name: string) {
  if (/\.zip$/i.test(name)) return FileArchive
  if (/\.(xlsx?|csv)$/i.test(name)) return FileSpreadsheet
  return FileText
}

/**
 * Libellé de groupe compact : un chemin peut rester entier quand il a été
 * rangé sous une ancienne convention (titre complet tronqué « …et Sa ») —
 * on ne garde alors que la queue parlante (2 derniers segments) et les
 * libellés de lot sont raccourcis (« LOT 01 - DÉMOLITIONS, … +6 »). Deux
 * dossiers dont le libellé affiché est identique fusionnent en un seul groupe.
 */
function displayGroupLabel(label: string): string {
  if (label === 'Sans dossier') return label
  const segs = label.split('/')
  const tail = segs.length > 2 ? segs.slice(-2) : segs
  return tail
    .map((s) => (/^lot\b/i.test(s) ? shortenLotLabel(s) : shortText(s, 60)))
    .join(' / ')
}

/** Regroupe les documents par dossier, chemin relatif à la racine fournie.
 *  L'index d'origine est conservé pour la navigation ← → de la visionneuse. */
function groupByFolder(documents: Document[], root: string) {
  const base = normalizeFolderPath(root)
  const prefix = base === '/' ? '' : `${base}/`
  const groups = new Map<string, { doc: Document; index: number }[]>()
  documents.forEach((doc, index) => {
    const full = normalizeFolderPath(doc.folder_path)
    const label =
      prefix && full.startsWith(prefix)
        ? full.slice(prefix.length)
        : full === base
          ? ''
          : full
    const key = displayGroupLabel(label || 'Sans dossier')
    groups.set(key, [...(groups.get(key) ?? []), { doc, index }])
  })
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr'))
    .map(([label, items]) => ({
      label,
      // Tri par nom avec collation numérique : « 5.4.1 … » avant « 5.5.3 … »
      // et « 5.4.10 » après « 5.4.2 » — l'ordre suit les articles du CCTP.
      items: items.sort((a, b) =>
        a.doc.name.localeCompare(b.doc.name, 'fr', { numeric: true }),
      ),
    }))
}

export function EntityDocuments({
  orgSlug,
  entityType,
  entityId,
  documents,
  canEdit,
  folder,
  folderRoot,
}: {
  orgSlug: string
  entityType: string
  entityId: string
  documents: Document[]
  canEdit: boolean
  /** Dossier de rangement des fichiers joints ici (convention doc-folders). */
  folder?: string
  /** Racine retirée de l'affichage des chemins (ex. dossier de l'AO) —
   *  fournie ⇒ la liste est regroupée par dossier. */
  folderRoot?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [downloading, setDownloading] = useState<string | null>(null)
  const viewer = useDocumentViewer(orgSlug)

  async function download(doc: Document) {
    setDownloading(doc.id)
    const res = await getDocumentUrl(orgSlug, doc.id, { download: true })
    setDownloading(null)
    if ('error' in res) {
      toast.error(res.error)
      return
    }
    window.open(res.url, '_blank', 'noopener')
  }

  function renderRow(doc: Document, i: number) {
    const typeLabel = docTypeLabel(doc)
    const expired = !!doc.valid_until && new Date(doc.valid_until) < new Date()
    const Icon = docIcon(doc.name)
    return (
      <li key={doc.id} className="flex items-center gap-3 px-3 py-2 text-sm">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <button
          type="button"
          title={doc.name}
          className="min-w-0 flex-1 truncate text-left hover:underline"
          onClick={() => viewer.open(documents, i)}
        >
          {doc.name}
          {!folderRoot && doc.folder_path && doc.folder_path !== '/' && (
            <span className="ml-2 text-xs text-muted-foreground">
              {doc.folder_path}
            </span>
          )}
        </button>
        {typeLabel && (
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {typeLabel}
          </span>
        )}
        {doc.valid_until && (
          <span
            className={`shrink-0 text-[10px] ${expired ? 'font-medium text-red-600' : 'text-muted-foreground'}`}
          >
            {expired ? 'Expiré le ' : 'jusqu’au '}
            {formatDate(doc.valid_until)}
          </span>
        )}
        <span className="hidden shrink-0 text-[10px] text-muted-foreground tabular-nums sm:inline">
          {formatDate(doc.created_at)}
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums md:inline">{formatSize(doc.size_bytes)}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => viewer.open(documents, i)}
          aria-label={`Aperçu de ${doc.name}`}
        >
          <Eye className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={downloading === doc.id}
          onClick={() => download(doc)}
          aria-label={`Télécharger ${doc.name}`}
        >
          {downloading === doc.id ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
        </Button>
        {canEdit &&
          (isPipelineManagedDoc(doc) ? (
            // Document produit par un workflow : délier le retirerait de
            // l'onglet alors que le run continue de le livrer — icône
            // informative au lieu d'une action incohérente.
            <span
              className="inline-flex size-6 items-center justify-center text-muted-foreground/60"
              title="Document géré par un workflow (fiches, mémoire…) — non déliable ici"
              aria-label="Document géré par un workflow"
            >
              <Lock className="size-3.5" />
            </span>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pending}
              aria-label={`Délier ${doc.name}`}
              onClick={() =>
              startTransition(async () => {
                const res = await unlinkDocumentByEntity(
                  orgSlug,
                  doc.id,
                  entityType,
                  entityId,
                )
                if (res?.error) toast.error(res.error)
              })
            }
          >
            <Link2Off className="size-4" />
          </Button>
          ))}
      </li>
    )
  }

  const groups = folderRoot ? groupByFolder(documents, folderRoot) : null

  return (
    <div className="space-y-2">
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun document lié.</p>
      ) : groups ? (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Folder className="size-3.5" />
                <span className="truncate" title={g.label}>
                  {g.label}
                </span>
                <span className="shrink-0 font-normal">
                  ({g.items.length} ·{' '}
                  {formatSize(
                    g.items.reduce((n, x) => n + x.doc.size_bytes, 0),
                  )})
                </span>
              </p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {g.items.map(({ doc, index }) => renderRow(doc, index))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {documents.map((doc, i) => renderRow(doc, i))}
        </ul>
      )}
      <DocumentViewer {...viewer.viewerProps()} />
      {canEdit && (
        <>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const fd = new FormData()
              fd.set('file', file)
              fd.set('entityType', entityType)
              fd.set('entityId', entityId)
              if (folder) fd.set('folder', folder)
              startTransition(async () => {
                const res = await uploadDocument(orgSlug, fd)
                if (res?.error) toast.error(res.error)
                else toast.success(`${file.name} envoyé`)
              })
              e.target.value = ''
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-4" /> Joindre un fichier
          </Button>
        </>
      )}
    </div>
  )
}
