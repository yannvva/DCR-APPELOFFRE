'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { contactSchema } from '@/lib/validation/domain'
import { createContact, updateContact } from '@/app/actions/crm'
import type { Contact } from '@/lib/types'
import type { z } from 'zod'

type Values = z.infer<typeof contactSchema>
type AccountOption = { id: string; name: string }

export function ContactDialog({
  orgSlug,
  contact,
  accounts,
  defaultOpen,
  trigger,
}: {
  orgSlug: string
  contact?: Contact
  accounts: AccountOption[]
  defaultOpen?: boolean
  trigger?: React.ReactElement
}) {
  // Remonté via `key` par la page quand « ?new=1 » bascule (navigation SPA
  // depuis la palette ⌘K) — useState(defaultOpen) se réinitialise alors.
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [accountId, setAccountId] = useState(contact?.account_id ?? '')
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      firstName: contact?.first_name ?? '',
      lastName: contact?.last_name ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      role: contact?.role ?? '',
      notes: contact?.notes ?? '',
      accountId: contact?.account_id ?? '',
    },
  })

  async function onSubmit(values: Values) {
    const input = { ...values, accountId }
    const res = contact
      ? await updateContact(orgSlug, contact.id, input)
      : await createContact(orgSlug, input)
    if (res?.fieldErrors) {
      for (const [k, msgs] of Object.entries(res.fieldErrors)) {
        setError(k as keyof Values, { message: msgs?.[0] })
      }
      return
    }
    if (res?.error) {
      toast.error(res.error)
      return
    }
    toast.success(contact ? 'Contact mis à jour' : 'Contact créé')
    setOpen(false)
  }

  const triggerEl =
    trigger ??
    (contact ? undefined : (
      <Button>
        <Plus className="size-4" /> Nouveau contact
      </Button>
    ))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerEl && <DialogTrigger render={triggerEl} />}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? 'Modifier le contact' : 'Nouveau contact'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">Prénom</Label>
              <Input id="firstName" {...register('firstName')} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Nom *</Label>
              <Input id="lastName" {...register('lastName')} />
              {errors.lastName && (
                <p className="text-xs text-destructive">{errors.lastName.message}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register('email')} />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" {...register('phone')} />
            </div>
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
              <Label htmlFor="role">Fonction</Label>
              <Input id="role" {...register('role')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} {...register('notes')} />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
