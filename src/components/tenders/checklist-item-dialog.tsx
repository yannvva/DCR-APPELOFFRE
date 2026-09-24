'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { CalendarClock, FileText, ShieldAlert, Upload } from 'lucide-react'
import { useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  attachItemDocument,
  setChecklistItemStatus,
  updateChecklistItem,
  uploadAndAttachToChecklistItem,
} from '@/app/actions/tenders'
import { checklistItemSchema } from '@/lib/validation/domain'
import {
  CHECKLIST_CATEGORY_LABELS,
  CHECKLIST_STATUS_LABELS,
  REQUIREMENT_LABELS,
} from './constants'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type {
  ChecklistCategory,
  ChecklistItemStatus,
  ChecklistRequirement,
  Document,
  TenderChecklistItem,
} from '@/lib/types'
import type { z } from 'zod'

type Values = z.output<typeof checklistItemSchema>
type FormValues = z.input<typeof checklistItemSchema>

const CATEGORY_ORDER: ChecklistCategory[] = [
  'dce',
  'administratif',
  'technique',
  'financier',
  'memoire',
  'depot',
  'autre',
]

export const STATUS_BADGE: Record<ChecklistItemStatus, string> = {
  non_commence: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300',
  en_cours: 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
  a_verifier: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  valide: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  bloque: 'bg-red-500/15 text-red-600 dark:text-red-300',
  non_requis: 'bg-zinc-400/15 text-zinc-500 dark:text-zinc-400',
}

const RISK_LABELS = { bas: 'Bas', moyen: 'Moyen', haut: 'Haut' } as const

export function ChecklistItemDialog({
  orgSlug,
  tenderId,
  item,
  documents,
  members,
  canEdit,
  open,
  onOpenChange,
}: {
  orgSlug: string
  tenderId: string
  item: TenderChecklistItem
  documents: Pick<Document, 'id' | 'name' | 'valid_until' | 'is_signed'>[]
  members: { user_id: string; full_name: string | null }[]
  canEdit: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [pending, startTransition] = useTransition()
  const [category, setCategory] = useState<ChecklistCategory>(item.category)
  const [requirement, setRequirement] = useState<ChecklistRequirement>(item.requirement)
  const [riskLevel, setRiskLevel] = useState(item.risk_level)
  const [requiresSignature, setRequiresSignature] = useState(item.requires_signature)
  const [requiresChiffrage, setRequiresChiffrage] = useState(item.requires_chiffrage)
  const [forceValid, setForceValid] = useState(false)
  const [forceReason, setForceReason] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, Values>({
    resolver: zodResolver(checklistItemSchema),
    defaultValues: {
      label: item.label,
      internalDeadline: item.internal_deadline ?? '',
      riskLevel: item.risk_level,
      comment: item.comment ?? '',
    },
  })

  const expired =
    item.document?.valid_until != null && new Date(item.document.valid_until) < new Date()
  const validatorName = item.validated_by
    ? members.find((m) => m.user_id === item.validated_by)?.full_name
    : null

  const setStatus = (status: ChecklistItemStatus) =>
    startTransition(async () => {
      const res = await setChecklistItemStatus(
        orgSlug,
        item.id,
        tenderId,
        status,
        status === 'valide' ? forceValid : false,
        status === 'valide' ? forceReason : '',
      )
      if (res?.error) toast.error(res.error)
      else toast.success(`Statut : ${CHECKLIST_STATUS_LABELS[status]}`)
    })

  async function handleUpload(file: File) {
    setUploading(true)
    const fd = new FormData()
    fd.set('file', file)
    fd.set('category', category)
    const res = await uploadAndAttachToChecklistItem(orgSlug, item.id, tenderId, fd)
    setUploading(false)
    if (res?.error) toast.error(res.error)
    else toast.success(`${file.name} attaché`)
  }

  async function onSave(values: Values) {
    const res = await updateChecklistItem(orgSlug, item.id, tenderId, {
      ...values,
      category,
      requirement,
      riskLevel,
      requiresSignature,
      requiresChiffrage,
    })
    if (res?.fieldErrors || res?.error) {
      toast.error(res.error ?? 'Formulaire invalide.')
      return
    }
    toast.success('Ligne mise à jour')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-6">{item.label}</DialogTitle>
        </DialogHeader>

        {/* Statut — badges cliquables */}
        <div className="space-y-1.5">
          <Label>Statut</Label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Statut de la ligne">
            {(Object.keys(CHECKLIST_STATUS_LABELS) as ChecklistItemStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                disabled={!canEdit || pending}
                onClick={() => setStatus(s)}
                aria-pressed={item.status === s}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium transition-opacity',
                  STATUS_BADGE[s],
                  item.status === s
                    ? 'ring-2 ring-current'
                    : 'opacity-55 hover:opacity-100',
                  (!canEdit || pending) && 'cursor-not-allowed',
                )}
              >
                {CHECKLIST_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          {item.validated_at && (
            <p className="text-xs text-muted-foreground">
              Validé {validatorName ? `par ${validatorName} ` : ''}le{' '}
              {formatDate(item.validated_at)}
            </p>
          )}
        </div>

        {/* Pièce jointe — drag & drop + upload + select */}
        <div className="space-y-1.5">
          <Label>Pièce associée</Label>
          {item.document ? (
            <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{item.document.name}</span>
              {expired && (
                <Badge variant="secondary" className="bg-red-500/15 text-[10px] text-red-600">
                  Expirée le {formatDate(item.document.valid_until)}
                </Badge>
              )}
              {item.requires_signature && !item.document.is_signed && (
                <Badge
                  variant="secondary"
                  className="bg-amber-500/15 text-[10px] text-amber-700"
                >
                  Non signée
                </Badge>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Aucune pièce attachée.</p>
          )}

          {canEdit && (
            <>
              {/* Zone drag & drop */}
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f) void handleUpload(f)
                }}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-4 text-sm transition-colors',
                  dragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-foreground/30',
                  uploading && 'pointer-events-none opacity-60',
                )}
              >
                <Upload className="size-4 text-muted-foreground" />
                {uploading
                  ? 'Envoi…'
                  : dragOver
                    ? 'Déposez le fichier ici'
                    : 'Glissez-déposez un fichier ou cliquez pour parcourir'}
              </div>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleUpload(f)
                  e.target.value = ''
                }}
              />

              {/* Ou attacher un document existant */}
              {documents.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Ou attacher un document existant…
                  </summary>
                  <Select
                    value={item.document_id ?? ''}
                    onValueChange={(v) =>
                      startTransition(async () => {
                        const res = await attachItemDocument(orgSlug, item.id, tenderId, v || null)
                        if (res?.error) toast.error(res.error)
                      })
                    }
                    disabled={pending}
                  >
                    <SelectTrigger className="mt-1.5 h-8 text-xs">
                      <SelectValue placeholder="Choisir un document…" />
                    </SelectTrigger>
                    <SelectContent>
                      {documents.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </details>
              )}
            </>
          )}
        </div>

        {/* Forcer la validation */}
        {canEdit && item.status !== 'valide' && (
          <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={forceValid}
                onCheckedChange={(v) => setForceValid(v === true)}
              />
              Forcer la validation sans pièce signée
            </label>
            {forceValid && (
              <Input
                placeholder="Motif du forçage (ex : pièce déjà transmise par email, en cours de signature…)"
                value={forceReason}
                onChange={(e) => setForceReason(e.target.value)}
                className="text-xs"
              />
            )}
            {forceValid && (
              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={pending}
                onClick={() => setStatus('valide')}
              >
                Valider en forçant
              </Button>
            )}
          </div>
        )}
        {item.forced_valid && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ Validité forcée{item.force_reason ? ` : ${item.force_reason}` : ''}
          </p>
        )}

        {/* Détails éditables */}
        <form onSubmit={handleSubmit(onSave)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="d-label">Libellé *</Label>
            <Input id="d-label" {...register('label')} disabled={!canEdit} aria-required />
            {errors.label && (
              <p className="text-xs text-destructive">{errors.label.message}</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Catégorie</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as ChecklistCategory)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_ORDER.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CHECKLIST_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Caractère</Label>
              <Select
                value={requirement}
                onValueChange={(v) => setRequirement(v as ChecklistRequirement)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(REQUIREMENT_LABELS) as ChecklistRequirement[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {REQUIREMENT_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                <ShieldAlert className="size-3.5" /> Risque
              </Label>
              <Select
                value={riskLevel}
                onValueChange={(v) => setRiskLevel(v as typeof riskLevel)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RISK_LABELS) as (keyof typeof RISK_LABELS)[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {RISK_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-deadline" className="flex items-center gap-1">
              <CalendarClock className="size-3.5" /> Échéance interne
            </Label>
            <Input
              id="d-deadline"
              type="date"
              {...register('internalDeadline')}
              disabled={!canEdit}
            />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={requiresSignature}
                onCheckedChange={(v) => setRequiresSignature(v === true)}
                disabled={!canEdit}
              />
              Signature requise
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={requiresChiffrage}
                onCheckedChange={(v) => setRequiresChiffrage(v === true)}
                disabled={!canEdit}
              />
              Chiffrage requis
            </label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-comment">Commentaire interne</Label>
            <Textarea
              id="d-comment"
              rows={3}
              placeholder="Notes de revue, motifs de blocage, remarques…"
              {...register('comment')}
              disabled={!canEdit}
            />
          </div>
          {canEdit && (
            <Button type="submit" className="w-full" disabled={isSubmitting || pending}>
              {isSubmitting ? 'Enregistrement…' : 'Enregistrer les détails'}
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
