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
import { projectSchema } from '@/lib/validation/domain'
import { createProject, updateProject } from '@/app/actions/projects'
import type { Project } from '@/lib/types'
import type { z } from 'zod'

type Values = z.infer<typeof projectSchema>

export function ProjectDialog({
  orgSlug,
  project,
  accounts,
  defaultOpen,
  trigger,
}: {
  orgSlug: string
  project?: Project
  accounts: { id: string; name: string }[]
  defaultOpen?: boolean
  trigger?: React.ReactElement
}) {
  // Remonté via `key` par la page quand « ?new=1 » bascule (navigation SPA
  // depuis la palette ⌘K) — useState(defaultOpen) se réinitialise alors.
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [accountId, setAccountId] = useState(project?.account_id ?? '')
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: project?.name ?? '',
      description: project?.description ?? '',
      startDate: project?.start_date ?? '',
      dueDate: project?.due_date ?? '',
      accountId: project?.account_id ?? '',
    },
  })

  async function onSubmit(values: Values) {
    const input = { ...values, accountId }
    const res = project
      ? await updateProject(orgSlug, project.id, input)
      : await createProject(orgSlug, input)
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
    toast.success(project ? 'Projet mis à jour' : 'Projet créé')
    setOpen(false)
  }

  const triggerEl =
    trigger ??
    (project ? undefined : (
      <Button>
        <Plus className="size-4" /> Nouveau projet
      </Button>
    ))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerEl && <DialogTrigger render={triggerEl} />}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{project ? 'Modifier le projet' : 'Nouveau projet'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nom *</Label>
            <Input id="name" {...register('name')} autoFocus />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={3} {...register('description')} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Select value={accountId} onValueChange={(v) => setAccountId(v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Aucun" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Aucun</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="startDate">Début</Label>
              <Input id="startDate" type="date" {...register('startDate')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dueDate">Échéance</Label>
              <Input id="dueDate" type="date" {...register('dueDate')} />
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
