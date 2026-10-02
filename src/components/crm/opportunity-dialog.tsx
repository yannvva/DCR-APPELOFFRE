'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { opportunitySchema } from '@/lib/validation/domain'
import { createOpportunity, updateOpportunity } from '@/app/actions/crm'
import type { Opportunity } from '@/lib/types'
import type { z } from 'zod'

type Values = z.infer<typeof opportunitySchema>
type FormValues = z.input<typeof opportunitySchema>
type Option = { id: string; name: string }
type ContactOption = { id: string; name: string; accountId?: string | null }

export function OpportunityDialog({
  orgSlug,
  opportunity,
  accounts,
  contacts,
  defaultOpen,
  defaultAccountId,
  onOpenChange,
  trigger,
}: {
  orgSlug: string
  opportunity?: Opportunity
  accounts: Option[]
  contacts: ContactOption[]
  defaultOpen?: boolean
  /** Entreprise présélectionnée (création depuis une fiche entreprise). */
  defaultAccountId?: string
  /** Prévenu à la fermeture — le parent démonte alors le dialogue (édition
      depuis le kanban : pas de trigger, le dialogue vit sous `defaultOpen`). */
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactElement
}) {
  // Remonté via `key` par la page quand « ?new=1 » bascule (navigation SPA
  // depuis la palette ⌘K) — useState(defaultOpen) se réinitialise alors.
  const [open, setOpenState] = useState(defaultOpen ?? false)
  const setOpen = (v: boolean) => {
    setOpenState(v)
    if (!v) onOpenChange?.(v)
  }
  const [accountId, setAccountId] = useState(
    opportunity?.account_id ?? defaultAccountId ?? '',
  )
  const [contactId, setContactId] = useState(opportunity?.primary_contact_id ?? '')
  // Contacts limités à l'entreprise choisie (liste complète tant qu'aucune
  // n'est choisie). Changer d'entreprise réinitialise le contact s'il
  // n'appartient pas à la nouvelle entreprise.
  const filteredContacts = accountId
    ? contacts.filter((c) => !c.accountId || c.accountId === accountId)
    : contacts

  function onAccountChange(v: string | null) {
    const next = v ?? ''
    setAccountId(next)
    if (
      contactId &&
      next &&
      !contacts.some((c) => c.id === contactId && (!c.accountId || c.accountId === next))
    ) {
      setContactId('')
    }
  }
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, Values>({
    resolver: zodResolver(opportunitySchema),
    defaultValues: {
      title: opportunity?.title ?? '',
      valueEuros: opportunity?.value_cents != null ? opportunity.value_cents / 100 : undefined,
      expectedCloseDate: opportunity?.expected_close_date ?? '',
      accountId: opportunity?.account_id ?? '',
      primaryContactId: opportunity?.primary_contact_id ?? '',
    },
  })

  async function onSubmit(values: Values) {
    const input = { ...values, accountId, primaryContactId: contactId }
    const res = opportunity
      ? await updateOpportunity(orgSlug, opportunity.id, input)
      : await createOpportunity(orgSlug, input)
    if (res?.fieldErrors) {
      for (const [k, msgs] of Object.entries(res.fieldErrors)) {
        setError(k as keyof FormValues, { message: msgs?.[0] })
      }
      return
    }
    if (res?.error) {
      toast.error(res.error)
      return
    }
    toast.success(opportunity ? 'Opportunité mise à jour' : 'Opportunité créée')
    setOpen(false)
  }

  const triggerEl =
    trigger ??
    (opportunity ? undefined : (
      <Button>
        <Plus className="size-4" /> Nouvelle opportunité
      </Button>
    ))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerEl && <DialogTrigger render={triggerEl} />}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {opportunity ? 'Modifier l’opportunité' : 'Nouvelle opportunité'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="title">Titre *</Label>
            <Input id="title" placeholder="Ex. AO — Rénovation mairie" {...register('title')} autoFocus />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Entreprise</Label>
              <Select value={accountId} onValueChange={onAccountChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Aucune" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Aucune</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.accountId && (
                <p className="text-xs text-destructive">{errors.accountId.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Contact principal</Label>
              <Select value={contactId} onValueChange={(v) => setContactId(v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Aucun" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Aucun</SelectItem>
                  {filteredContacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {accountId && filteredContacts.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Aucun contact rattaché à cette entreprise.
                </p>
              )}
              {errors.primaryContactId && (
                <p className="text-xs text-destructive">
                  {errors.primaryContactId.message}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="valueEuros">Valeur (€)</Label>
              <Input id="valueEuros" type="number" min={0} step="100" {...register('valueEuros')} />
              {errors.valueEuros && (
                <p className="text-xs text-destructive">{errors.valueEuros.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expectedCloseDate">Échéance</Label>
              <Input id="expectedCloseDate" type="date" {...register('expectedCloseDate')} />
              {errors.expectedCloseDate && (
                <p className="text-xs text-destructive">
                  {errors.expectedCloseDate.message}
                </p>
              )}
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
