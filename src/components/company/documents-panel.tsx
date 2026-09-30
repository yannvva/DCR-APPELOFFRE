'use client'

import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2,
  CircleAlert,
  Download,
  Eye,
  FileText,
  Loader2,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getDocumentUrl,
  setDocumentValidity,
  uploadDocument,
} from '@/app/actions/documents'
import { DeleteDocumentButton } from '@/components/documents/delete-document-button'
import {
  DocumentViewer,
  useDocumentViewer,
} from '@/components/documents/document-viewer'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Document } from '@/lib/types'

import {
  COMPANY_DOC_TYPE_LABELS as TYPE_LABELS,
  COMPANY_DOC_TYPES as DOC_TYPES,
} from '@/lib/company'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

export interface DocCoverage {
  type: string
  label: string
  present: boolean
  expired: boolean
  until: string | null
}

/** Pièces de la société (category='societe', dossier « Société ») —
 *  servent de référentiel aux agents (DC1/DC2, mémoire, dépôt). */
export function CompanyDocumentsPanel({
  orgSlug,
  documents,
  coverage,
  canEdit,
}: {
  orgSlug: string
  documents: Document[]
  coverage: DocCoverage[]
  canEdit: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingType = useRef<string | null>(null)
  const [docType, setDocType] = useState<string>('presentation')
  const [validUntil, setValidUntil] = useState('')
  const [pending, startTransition] = useTransition()
  const [downloading, setDownloading] = useState<string | null>(null)
  const viewer = useDocumentViewer(orgSlug)

  // Pièces expirées épinglées en tête, puis ordre d'ajout.
  const sorted = [...documents].sort(
    (a, b) =>
      Number(
        !!b.valid_until && b.valid_until < new Date().toISOString().slice(0, 10),
      ) -
      Number(
        !!a.valid_until && a.valid_until < new Date().toISOString().slice(0, 10),
      ),
  )

  /** Chip « manquante/expirée » → présélectionne le type et ouvre le picker. */
  function pickType(type: string) {
    pendingType.current = type
    setDocType(type)
    inputRef.current?.click()
  }

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

  return (
    <div className="space-y-3">
      {/* Couverture du kit — clic sur une pièce manquante/expirée =
          type présélectionné + sélecteur de fichier ouvert. */}
      <div className="flex flex-wrap gap-1.5">
        {coverage.map((d) => {
          const cls =
            'gap-1 font-normal ' +
            (canEdit ? 'cursor-pointer' : 'cursor-default')
          const label = d.expired
            ? `${d.label} — expirée${d.until ? ` le ${formatDate(d.until)}` : ''}`
            : !d.present
              ? `${d.label} — manquante`
              : d.until
                ? `${d.label} · jusqu’au ${formatDate(d.until)}`
                : d.label
          const inner = (
            <>
              {d.expired ? (
                <TriangleAlert className="size-3" />
              ) : d.present ? (
                <CheckCircle2 className="size-3" />
              ) : (
                <CircleAlert className="size-3 text-amber-500" />
              )}
              {label}
            </>
          )
          const actionable = canEdit && (!d.present || d.expired)
          return (
            <Badge
              key={d.label}
              variant={
                d.expired
                  ? 'destructive'
                  : d.present
                    ? 'secondary'
                    : 'outline'
              }
              className={cls}
              render={actionable ? <button type="button" /> : undefined}
              title={actionable ? 'Cliquer pour téléverser la pièce' : undefined}
              onClick={actionable ? () => pickType(d.type) : undefined}
            >
              {inner}
            </Badge>
          )
        })}
      </div>

      {documents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Aucune pièce société — ajoutez la plaquette, le Kbis, le RIB, les
          attestations URSSAF et d’assurance, les DC1/DC2…
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {sorted.map((doc, docIndex) => {
            const expired = doc.valid_until && new Date(doc.valid_until) < new Date()
            return (
              <li key={doc.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{doc.name}</span>
                {doc.document_type && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {TYPE_LABELS[doc.document_type] ?? doc.document_type}
                  </Badge>
                )}
                {canEdit ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    {expired && (
                      <span className="text-xs font-medium text-destructive">
                        Expiré
                      </span>
                    )}
                    <input
                      key={doc.valid_until ?? 'none'}
                      type="date"
                      defaultValue={doc.valid_until ?? ''}
                      disabled={pending}
                      title="Échéance de la pièce (laisser vide si sans)"
                      aria-label={`Échéance de ${doc.name}`}
                      className={cn(
                        'h-7 w-36 rounded-md border border-input bg-transparent px-2 text-xs',
                        expired && 'border-destructive/50 text-destructive',
                      )}
                      onChange={(e) =>
                        startTransition(async () => {
                          const res = await setDocumentValidity(
                            orgSlug,
                            doc.id,
                            e.target.value || null,
                          )
                          if (res?.error) toast.error(res.error)
                          else toast.success('Échéance mise à jour')
                        })
                      }
                    />
                  </span>
                ) : (
                  doc.valid_until && (
                    <span
                      className={cn(
                        'shrink-0 text-xs',
                        expired ? 'font-medium text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {expired ? 'Expiré le ' : 'Expire le '}
                      {formatDate(doc.valid_until)}
                    </span>
                  )
                )}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatSize(doc.size_bytes)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => viewer.open(sorted, docIndex)}
                  aria-label={`Voir ${doc.name}`}
                  title="Aperçu"
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
                {canEdit && (
                  <DeleteDocumentButton
                    orgSlug={orgSlug}
                    docId={doc.id}
                    docName={doc.name}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Type de pièce</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v ?? 'presentation')}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Valable jusqu’au (optionnel)
            </Label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="flex h-9 w-44 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const fd = new FormData()
              fd.set('file', file)
              fd.set('category', 'societe')
              fd.set('documentType', pendingType.current ?? docType)
              pendingType.current = null
              fd.set('folder', 'Société')
              fd.set('isReusable', 'true')
              if (validUntil) fd.set('validUntil', validUntil)
              startTransition(async () => {
                const res = await uploadDocument(orgSlug, fd)
                if (res?.error) toast.error(res.error)
                else {
                  toast.success(`${file.name} rangé dans Société`)
                  setValidUntil('')
                }
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
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Ajouter une pièce
          </Button>
        </div>
      )}
      <DocumentViewer {...viewer.viewerProps()} />
    </div>
  )
}
