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

export function OpportunityDialog({
  orgSlug,
  opportunity,
  accounts,
  contacts,
  defaultOpen,
  trigger,
}: {
  orgSlug: string
  opportunity?: Opportunity
  accounts: Option[]
  contacts: Option[]
  defaultOpen?: boolean
  trigger?: React.ReactElement
}) {
  // Remonté via `key` par la page quand « ?new=1 » bascule (navigation SPA
  // depuis la palette ⌘K) — useState(defaultOpen) se réinitialise alors.
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [accountId, setAccountId] = useState(opportunity?.account_id ?? '')
  const [contactId, setContactId] = useState(opportunity?.primary_contact_id ?? '')
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
              <Select value={accountId} onValueChange={(v) => setAccountId(v ?? '')}>
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
            </div>
            <div className="space-y-1.5">
              <Label>Contact principal</Label>
              <Select value={contactId} onValueChange={(v) => setContactId(v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Aucun" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Aucun</SelectItem>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="valueEuros">Valeur (€)</Label>
              <Input id="valueEuros" type="number" min={0} step="100" {...register('valueEuros')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expectedCloseDate">Échéance</Label>
              <Input id="expectedCloseDate" type="date" {...register('expectedCloseDate')} />
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
