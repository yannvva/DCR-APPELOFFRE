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
import { Checkbox } from '@/components/ui/checkbox'
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
import { taskSchema } from '@/lib/validation/domain'
import { createTask, updateTask } from '@/app/actions/projects'
import type { Task } from '@/lib/types'
import type { z } from 'zod'

type Values = z.infer<typeof taskSchema>
type FormValues = z.input<typeof taskSchema>
export type Member = { user_id: string; full_name: string | null }

export const TASK_STATUSES = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'À faire' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'in_review', label: 'En revue' },
  { value: 'done', label: 'Terminé' },
] as const

const PRIORITIES = [
  { value: 'urgent', label: 'Urgente' },
  { value: 'high', label: 'Haute' },
  { value: 'medium', label: 'Moyenne' },
  { value: 'low', label: 'Basse' },
] as const

export function TaskDialog({
  orgSlug,
  projectId,
  task,
  parentTaskId,
  members,
  trigger,
}: {
  orgSlug: string
  projectId: string
  task?: Task
  parentTaskId?: string
  members: Member[]
  trigger?: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<string>(task?.status ?? 'todo')
  const [priority, setPriority] = useState<string>(task?.priority ?? 'medium')
  const [assignees, setAssignees] = useState<string[]>(
    task?.assignees?.map((a) => a.user_id) ?? [],
  )
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, Values>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: task?.title ?? '',
      description: task?.description ?? '',
      status: task?.status ?? 'todo',
      priority: task?.priority ?? 'medium',
      dueDate: task?.due_date ?? '',
      parentTaskId: task?.parent_task_id ?? parentTaskId ?? '',
      assigneeIds: task?.assignees?.map((a) => a.user_id) ?? [],
    },
  })

  async function onSubmit(values: Values) {
    const input = { ...values, status, priority, assigneeIds: assignees }
    const res = task
      ? await updateTask(orgSlug, task.id, input)
      : await createTask(orgSlug, projectId, input)
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
    toast.success(task ? 'Tâche mise à jour' : 'Tâche créée')
    setOpen(false)
  }

  const triggerEl =
    trigger ??
    (task ? undefined : (
      <Button size="sm" variant="outline">
        <Plus className="size-4" /> Tâche
      </Button>
    ))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerEl && <DialogTrigger render={triggerEl} />}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task ? 'Modifier la tâche' : 'Nouvelle tâche'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="title">Titre *</Label>
            <Input id="title" {...register('title')} autoFocus />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={3} {...register('description')} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Statut</Label>
              <Select value={status} onValueChange={(v) => setStatus(v ?? 'todo')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priorité</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v ?? 'medium')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dueDate">Échéance</Label>
              <Input id="dueDate" type="date" {...register('dueDate')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Assignés</Label>
            <div className="flex flex-wrap gap-3 rounded-md border border-border p-2.5">
              {members.length === 0 && (
                <span className="text-xs text-muted-foreground">Aucun membre</span>
              )}
              {members.map((m) => (
                <label key={m.user_id} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={assignees.includes(m.user_id)}
                    onCheckedChange={(checked) =>
                      setAssignees((prev) =>
                        checked
                          ? [...prev, m.user_id]
                          : prev.filter((id) => id !== m.user_id),
                      )
                    }
                  />
                  {m.full_name ?? 'Membre'}
                </label>
              ))}
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
