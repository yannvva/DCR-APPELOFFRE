'use client'

import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Download, FileText, Link2Off, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getDocumentUrl,
  unlinkDocumentByEntity,
  uploadDocument,
} from '@/app/actions/documents'
import type { Document } from '@/lib/types'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

export function EntityDocuments({
  orgSlug,
  entityType,
  entityId,
  documents,
  canEdit,
}: {
  orgSlug: string
  entityType: string
  entityId: string
  documents: Document[]
  canEdit: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [downloading, setDownloading] = useState<string | null>(null)

  async function download(doc: Document) {
    setDownloading(doc.id)
    const res = await getDocumentUrl(orgSlug, doc.id)
    setDownloading(null)
    if ('error' in res) {
      toast.error(res.error)
      return
    }
    window.open(res.url, '_blank', 'noopener')
  }

  return (
    <div className="space-y-2">
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun document lié.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{doc.name}</span>
              <span className="text-xs text-muted-foreground">{formatSize(doc.size_bytes)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={downloading === doc.id}
                onClick={() => download(doc)}
                aria-label={`Télécharger ${doc.name}`}
              >
                <Download className="size-4" />
              </Button>
              {canEdit && (
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
              )}
            </li>
          ))}
        </ul>
      )}
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
