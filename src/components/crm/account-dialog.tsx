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
import { accountSchema } from '@/lib/validation/domain'
import { createAccount, updateAccount } from '@/app/actions/crm'
import type { Account } from '@/lib/types'
import type { z } from 'zod'

type Values = z.infer<typeof accountSchema>

export function AccountDialog({
  orgSlug,
  account,
  defaultOpen,
  trigger,
}: {
  orgSlug: string
  account?: Account
  defaultOpen?: boolean
  trigger?: React.ReactElement
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: account?.name ?? '',
      domain: account?.domain ?? '',
      industry: account?.industry ?? '',
      website: account?.website ?? '',
      phone: account?.phone ?? '',
      notes: account?.notes ?? '',
    },
  })

  async function onSubmit(values: Values) {
    const res = account
      ? await updateAccount(orgSlug, account.id, values)
      : await createAccount(orgSlug, values)
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
    toast.success(account ? 'Entreprise mise à jour' : 'Entreprise créée')
    setOpen(false)
  }

  const triggerEl =
    trigger ??
    (account ? undefined : (
      <Button>
        <Plus className="size-4" /> Nouvelle entreprise
      </Button>
    ))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerEl && <DialogTrigger render={triggerEl} />}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? 'Modifier l’entreprise' : 'Nouvelle entreprise'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nom *</Label>
            <Input id="name" {...register('name')} autoFocus />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="domain">Domaine</Label>
              <Input id="domain" placeholder="acme.fr" {...register('domain')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="industry">Secteur</Label>
              <Input id="industry" {...register('industry')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="website">Site web</Label>
              <Input id="website" placeholder="https://…" {...register('website')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" {...register('phone')} />
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
