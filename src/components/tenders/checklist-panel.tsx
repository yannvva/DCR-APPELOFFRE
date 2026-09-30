'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Building2, Check, FileText, MessageSquare, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  addChecklistItem,
  assignChecklistItem,
  attachItemDocument,
  autoAttachCompanyDocs,
  deleteChecklistItem,
  runComplianceChecks,
  setChecklistItemStatus,
} from '@/app/actions/tenders'
import { checklistItemSchema } from '@/lib/validation/domain'
import {
  CHECKLIST_CATEGORY_LABELS,
  CHECKLIST_STATUS_LABELS,
  REQUIREMENT_LABELS,
} from './constants'
import { ChecklistItemDialog, STATUS_BADGE } from './checklist-item-dialog'
import { DocumentPicker } from '@/components/documents/document-picker'
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

const STATUS_DOT: Record<ChecklistItemStatus, string> = {
  non_commence: 'bg-zinc-400',
  en_cours: 'bg-blue-500',
  a_verifier: 'bg-amber-500',
  valide: 'bg-emerald-500',
  bloque: 'bg-red-500',
  non_requis: 'bg-zinc-300',
}

export function ChecklistPanel({
  orgSlug,
  tenderId,
  items,
  documents,
  members,
  canEdit,
}: {
  orgSlug: string
  tenderId: string
  items: TenderChecklistItem[]
  documents: Pick<Document, 'id' | 'name' | 'valid_until' | 'is_signed'>[]
  members: { user_id: string; full_name: string | null }[]
  canEdit: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [addOpen, setAddOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deleteItem, setDeleteItem] = useState<TenderChecklistItem | null>(null)
  const [category, setCategory] = useState<ChecklistCategory>('administratif')
  const [requirement, setRequirement] = useState<ChecklistRequirement>('obligatoire')
  const [assigneeId, setAssigneeId] = useState('')
  const [requiresSignature, setRequiresSignature] = useState(false)
  const [requiresChiffrage, setRequiresChiffrage] = useState(false)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, Values>({
    resolver: zodResolver(checklistItemSchema),
    defaultValues: {
      label: '',
      internalDeadline: '',
      riskLevel: 'moyen',
      comment: '',
    },
  })

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: items.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0)

  const act = (fn: () => Promise<{ error?: string } | null | undefined>, ok?: string) =>
    startTransition(async () => {
      const res = await fn()
      if (res?.error) toast.error(res.error)
      else if (ok) toast.success(ok)
    })

  async function onAdd(values: Values) {
    const res = await addChecklistItem(orgSlug, tenderId, {
      ...values,
      category,
      requirement,
      assigneeId,
      requiresSignature,
      requiresChiffrage,
    })
    if (res?.fieldErrors || res?.error) {
      toast.error(res.error ?? 'Formulaire invalide.')
      return
    }
    toast.success('Ligne ajoutée')
    reset()
    setCategory('administratif')
    setRequirement('obligatoire')
    setAssigneeId('')
    setRequiresSignature(false)
    setRequiresChiffrage(false)
    setAddOpen(false)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {items.filter((i) => i.status === 'valide').length}/{items.length} lignes validées
        </p>
        <div className="flex gap-2">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              title="Rattache les pièces du référentiel société (Kbis, URSSAF, attestations, DC1/DC2…) aux lignes correspondantes"
              onClick={() =>
                startTransition(async () => {
                  const res = await autoAttachCompanyDocs(orgSlug, tenderId)
                  if (res.error) toast.error(res.error)
                  else if (!res.attached)
                    toast.info('Aucune ligne à rattacher — les pièces société disponibles sont déjà liées ou aucun libellé ne correspond.')
                  else
                    toast.success(
                      `${res.attached} pièce${res.attached > 1 ? 's' : ''} société rattachée${res.attached > 1 ? 's' : ''} (${res.validated} validée${res.validated !== 1 ? 's' : ''})`,
                    )
                })
              }
            >
              <Building2 className="size-3.5" /> Rattacher les pièces société
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => act(() => runComplianceChecks(orgSlug, tenderId), 'Contrôles relancés')}
          >
            <RefreshCw className="size-3.5" /> Relancer les contrôles
          </Button>
          {canEdit && (
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger
                render={
                  <Button size="sm" variant="outline">
                    <Plus className="size-3.5" /> Ajouter une pièce
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Ajouter une ligne de checklist</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit(onAdd)} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ci-label">Libellé *</Label>
                    <Input id="ci-label" {...register('label')} autoFocus aria-required />
                    {errors.label && (
                      <p className="text-xs text-destructive">{errors.label.message}</p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Catégorie</Label>
                      <Select
                        value={category}
                        onValueChange={(v) => setCategory(v as ChecklistCategory)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORY_ORDER.map((c) => (
                            <SelectItem key={c} value={c} label={CHECKLIST_CATEGORY_LABELS[c]}>
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
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="obligatoire" label="Obligatoire">Obligatoire</SelectItem>
                          <SelectItem value="recommande" label="Recommandé">Recommandé</SelectItem>
                          <SelectItem value="facultatif" label="Facultatif">Facultatif</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Responsable</Label>
                      <Select value={assigneeId} onValueChange={(v) => setAssigneeId(v ?? '')}>
                        <SelectTrigger>
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {members.map((m) => (
                            <SelectItem
                              key={m.user_id}
                              value={m.user_id}
                              label={m.full_name ?? 'Membre'}
                            >
                              {m.full_name ?? 'Membre'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ci-deadline">Échéance interne</Label>
                      <Input id="ci-deadline" type="date" {...register('internalDeadline')} />
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={requiresSignature}
                        onCheckedChange={(v) => setRequiresSignature(v === true)}
                      />
                      Signature requise
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={requiresChiffrage}
                        onCheckedChange={(v) => setRequiresChiffrage(v === true)}
                      />
                      Chiffrage requis
                    </label>
                  </div>
                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? 'Ajout…' : 'Ajouter'}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {grouped.map(({ cat, items: rows }) => (
        <section key={cat}>
          <h3 className="mb-2 text-sm font-semibold">{CHECKLIST_CATEGORY_LABELS[cat]}</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((item) => {
              const expired =
                item.document?.valid_until != null &&
                new Date(item.document.valid_until) < new Date()
              const deadlineOverdue =
                item.internal_deadline != null &&
                new Date(item.internal_deadline) < new Date() &&
                item.status !== 'valide' &&
                item.status !== 'non_requis'
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span
                    className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[item.status])}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailId(item.id)}
                        className="text-left text-sm font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        {item.label}
                      </button>
                      <Badge
                        variant="secondary"
                        className={cn(
                          'text-[10px]',
                          item.requirement === 'obligatoire' &&
                            'bg-red-500/10 text-red-600 dark:text-red-300',
                        )}
                      >
                        {REQUIREMENT_LABELS[item.requirement]}
                      </Badge>
                      {item.requires_signature && (
                        <Badge variant="secondary" className="text-[10px]">
                          ✍ signature
                        </Badge>
                      )}
                      {item.requires_chiffrage && (
                        <Badge variant="secondary" className="text-[10px]">
                          € chiffrage
                        </Badge>
                      )}
                      {item.internal_deadline && (
                        <Badge
                          variant="secondary"
                          className={cn(
                            'text-[10px]',
                            deadlineOverdue &&
                              'bg-red-500/15 text-red-600 dark:text-red-300',
                          )}
                        >
                          éch. {formatDate(item.internal_deadline)}
                          {deadlineOverdue && ' — dépassée'}
                        </Badge>
                      )}
                      {item.comment && (
                        <MessageSquare
                          className="size-3.5 text-muted-foreground"
                          aria-label="Commentaire"
                        />
                      )}
                    </div>
                    {item.document && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <FileText className="size-3" />
                        {item.document.name}
                        {expired && <span className="text-destructive"> — expiré</span>}
                        {item.requires_signature && !item.document.is_signed && (
                          <span className="text-amber-600"> — non signé</span>
                        )}
                      </p>
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <DocumentPicker
                        className="w-64"
                        documents={documents}
                        value={item.document_id}
                        currentLabel={item.document?.name}
                        disabled={pending}
                        onSelect={(docId) =>
                          act(
                            () => attachItemDocument(orgSlug, item.id, tenderId, docId),
                            docId ? 'Pièce attachée' : 'Pièce détachée',
                          )
                        }
                      />
                      <Select
                        value={item.assignee_id ?? ''}
                        onValueChange={(v) =>
                          act(() => assignChecklistItem(orgSlug, item.id, tenderId, v || null))
                        }
                        disabled={pending}
                      >
                        <SelectTrigger className="h-8 w-32 text-xs">
                          <SelectValue placeholder="Responsable" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="" label="—">
                            —
                          </SelectItem>
                          {members.map((m) => (
                            <SelectItem
                              key={m.user_id}
                              value={m.user_id}
                              label={m.full_name ?? 'Membre'}
                            >
                              {m.full_name ?? 'Membre'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {item.status !== 'valide' && (
                        <Button
                          variant="outline"
                          size="icon-sm"
                          disabled={pending}
                          aria-label={`Valider ${item.label}`}
                          title="Marquer validé"
                          onClick={() =>
                            act(() =>
                              setChecklistItemStatus(orgSlug, item.id, tenderId, 'valide'),
                            )
                          }
                        >
                          <Check className="size-4 text-emerald-600" />
                        </Button>
                      )}
                      <Select
                        value={item.status}
                        onValueChange={(v) =>
                          act(() =>
                            setChecklistItemStatus(
                              orgSlug,
                              item.id,
                              tenderId,
                              v as ChecklistItemStatus,
                            ),
                          )
                        }
                        disabled={pending}
                      >
                        <SelectTrigger
                          aria-label={`Statut de ${item.label}`}
                          className={cn(
                            'h-7 w-auto gap-1 rounded-full border-0 px-2.5 text-[11px] font-medium',
                            STATUS_BADGE[item.status],
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            Object.keys(CHECKLIST_STATUS_LABELS) as ChecklistItemStatus[]
                          ).map((s) => (
                            <SelectItem key={s} value={s} label={CHECKLIST_STATUS_LABELS[s]}>
                              {CHECKLIST_STATUS_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={pending}
                        aria-label={`Supprimer ${item.label}`}
                        onClick={() => setDeleteItem(item)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {items.length === 0 && (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          Aucune ligne de checklist.
        </p>
      )}

      {/* Suppression d'une ligne : confirmation — la corbeille est à portée
          de clic des selects et la perte est irréversible. */}
      <AlertDialog open={deleteItem != null} onOpenChange={(o) => !o && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {deleteItem?.label} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              La ligne et son suivi seront retirés de la checklist du dossier.
              {deleteItem?.document && ' Le document joint restera dans la bibliothèque.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteChecklistItem(orgSlug, deleteItem!.id, tenderId)
                  if (res?.error) toast.error(res.error)
                  else {
                    toast.success('Ligne supprimée')
                    setDeleteItem(null)
                  }
                })
              }
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {detailId &&
        (() => {
          const item = items.find((i) => i.id === detailId)
          return item ? (
            <ChecklistItemDialog
              orgSlug={orgSlug}
              tenderId={tenderId}
              item={item}
              documents={documents}
              members={members}
              canEdit={canEdit}
              open
              onOpenChange={(o) => {
                if (!o) setDetailId(null)
              }}
            />
          ) : null
        })()}
    </div>
  )
}
