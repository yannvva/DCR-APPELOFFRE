'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Download, FileText, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { deleteDocument, getDocumentUrl } from '@/app/actions/documents'
import { formatRelative } from '@/lib/format'
import type { Document } from '@/lib/types'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

export function DocumentRow({
  orgSlug,
  doc,
  canEdit,
}: {
  orgSlug: string
  doc: Document
  canEdit: boolean
}) {
  const [downloading, setDownloading] = useState(false)
  const [pending, startTransition] = useTransition()

  async function download() {
    setDownloading(true)
    const res = await getDocumentUrl(orgSlug, doc.id)
    setDownloading(false)
    if ('error' in res) {
      toast.error(res.error)
      return
    }
    window.open(res.url, '_blank', 'noopener')
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{doc.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatSize(doc.size_bytes)} · {formatRelative(doc.created_at)}
        </p>
      </div>
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
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label={`Supprimer ${doc.name}`}
          onClick={() =>
            startTransition(async () => {
              const res = await deleteDocument(orgSlug, doc.id)
              if (res?.error) toast.error(res.error)
              else toast.success('Document supprimé')
            })
          }
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </li>
  )
}
