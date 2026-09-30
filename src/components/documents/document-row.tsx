'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Download,
  Eye,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  Link2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DeleteDocumentButton } from '@/components/documents/delete-document-button'
import { getDocumentUrl } from '@/app/actions/documents'
import { docTypeLabel } from '@/lib/doc-labels'
import { formatDate, formatRelative, truncateMiddle } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Document } from '@/lib/types'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

/** Icône adaptée au format : les fiches DCR se ressemblent toutes au premier
 *  coup d'œil — l'icône distingue immédiatement ZIP, classeur et PDF. */
function docIcon(name: string) {
  const ext = name.match(/\.([a-z0-9]{2,6})$/i)?.[1]?.toLowerCase()
  if (ext === 'zip') return { Icon: FileArchive, cls: 'text-amber-500' }
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv')
    return { Icon: FileSpreadsheet, cls: 'text-emerald-500' }
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext ?? ''))
    return { Icon: FileImage, cls: 'text-sky-500' }
  return { Icon: FileText, cls: 'text-muted-foreground' }
}

export function DocumentRow({
  orgSlug,
  doc,
  canEdit,
  onPreview,
  usageCount = 0,
  folderBase,
}: {
  orgSlug: string
  doc: Document
  canEdit: boolean
  onPreview: () => void
  /** Nombre d'entités liées (AO, comptes…) via document_links. */
  usageCount?: number
  /** Vue sous-arbre : dossier courant — sert à afficher le sous-dossier
   *  relatif des fichiers venus de descendants. */
  folderBase?: string
}) {
  const [downloading, setDownloading] = useState(false)
  const expired =
    !!doc.valid_until && doc.valid_until < new Date().toISOString().slice(0, 10)
  const typeLabel = docTypeLabel(doc)
  // Vue sous-arbre / recherche : sous-dossier d'origine du fichier,
  // relatif au dossier consulté (chemin complet depuis la racine).
  const relFolder =
    folderBase != null && doc.folder_path && doc.folder_path !== folderBase
      ? folderBase === '/'
        ? doc.folder_path
        : doc.folder_path.startsWith(`${folderBase}/`)
          ? doc.folder_path.slice(folderBase.length + 1)
          : null
      : null
  const { Icon: DocIcon, cls: docIconCls } = docIcon(doc.name)

  async function download() {
    setDownloading(true)
    const res = await getDocumentUrl(orgSlug, doc.id, { download: true })
    setDownloading(false)
    if ('error' in res) {
      toast.error(res.error)
      return
    }
    window.open(res.url, '_blank', 'noopener')
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <DocIcon className={cn('size-4 shrink-0', docIconCls)} />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onPreview}
          className="block max-w-full truncate text-left font-medium hover:underline"
          title={doc.name}
        >
          {truncateMiddle(doc.name, 88)}
        </button>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {formatSize(doc.size_bytes)} · {formatRelative(doc.created_at)}
          {relFolder && (
            <span
              className="inline-flex min-w-0 items-center gap-1"
              title={doc.folder_path ?? undefined}
            >
              {' '}
              · <Folder className="size-3 shrink-0" />
              <span className="max-w-56 truncate">{relFolder}</span>
            </span>
          )}
        </p>
      </div>
      {typeLabel && (
        <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
          {typeLabel}
        </Badge>
      )}
      {usageCount > 0 && (
        <Badge
          variant="secondary"
          className="shrink-0 text-[10px] font-normal"
          title={`Lié à ${usageCount} entité${usageCount > 1 ? 's' : ''} (AO, compte, projet…)`}
        >
          <Link2 className="size-3" />
          {usageCount}
        </Badge>
      )}
      {doc.valid_until && (
        <Badge
          variant="secondary"
          className={cn(
            'shrink-0 text-[10px]',
            expired
              ? 'bg-red-500/15 text-red-600 dark:text-red-300'
              : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
          )}
        >
          {expired
            ? `Expiré le ${formatDate(doc.valid_until)}`
            : `Jusqu’au ${formatDate(doc.valid_until)}`}
        </Badge>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onPreview}
        aria-label={`Voir ${doc.name}`}
        title="Aperçu"
      >
        <Eye className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={downloading}
        onClick={download}
        aria-label={`Télécharger ${doc.name}`}
      >
        <Download className="size-4" />
      </Button>
      {canEdit && (
        <DeleteDocumentButton
          orgSlug={orgSlug}
          docId={doc.id}
          docName={doc.name}
          usageCount={usageCount}
        />
      )}
    </li>
  )
}
