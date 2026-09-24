'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Pencil, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  addComment,
  deleteComment,
  deleteTask,
  getTaskComments,
} from '@/app/actions/projects'
import { TaskDialog, TASK_STATUSES, type Member } from '@/components/projects/task-dialog'
import { formatDate, formatRelative } from '@/lib/format'
import type { Task, TaskComment } from '@/lib/types'

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgente',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
}

export function TaskDetail({
  orgSlug,
  task,
  subtasks,
  members,
  canEdit,
  onClose,
}: {
  orgSlug: string
  task: Task | null
  subtasks: Task[]
  members: Member[]
  canEdit: boolean
  onClose: () => void
}) {
  const [commentsState, setCommentsState] = useState<{
    taskId: string | null
    comments: TaskComment[]
  }>({ taskId: null, comments: [] })
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!task) return
    let cancelled = false
    getTaskComments(orgSlug, task.id).then((res) => {
      if (!cancelled && 'comments' in res)
        setCommentsState({ taskId: task.id, comments: res.comments as TaskComment[] })
    })
    return () => {
      cancelled = true
    }
  }, [task, orgSlug])

  const comments = commentsState.taskId === task?.id ? commentsState.comments : []

  if (!task) return null

  const refresh = () =>
    getTaskComments(orgSlug, task.id).then((res) => {
      if ('comments' in res)
        setCommentsState({ taskId: task.id, comments: res.comments as TaskComment[] })
    })

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-8">{task.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {TASK_STATUSES.find((s) => s.value === task.status)?.label}
            </Badge>
            <Badge variant="outline">{PRIORITY_LABELS[task.priority]}</Badge>
            {task.due_date && <span>Échéance : {formatDate(task.due_date)}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          {task.description && (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {task.description}
            </p>
          )}

          {subtasks.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Sous-tâches ({subtasks.filter((s) => s.status === 'done').length}/
                {subtasks.length})
              </h3>
              <ul className="space-y-1.5">
                {subtasks.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    <span
                      className={
                        s.status === 'done'
                          ? 'text-muted-foreground line-through'
                          : undefined
                      }
                    >
                      {s.title}
                    </span>
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      {TASK_STATUSES.find((x) => x.value === s.status)?.label}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Commentaires ({comments.length})
            </h3>
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {c.author?.full_name ?? 'Membre'}
                    </span>
                    <span className="flex items-center gap-1">
                      {formatRelative(c.created_at)}
                      {canEdit && (
                        <button
                          className="rounded p-0.5 hover:text-destructive"
                          aria-label="Supprimer le commentaire"
                          onClick={() =>
                            startTransition(async () => {
                              const res = await deleteComment(orgSlug, c.id)
                              if (res?.error) toast.error(res.error)
                              else refresh()
                            })
                          }
                        >
                          <Trash2 className="size-3" />
                        </button>
                      )}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
              {comments.length === 0 && (
                <p className="text-sm text-muted-foreground">Aucun commentaire.</p>
              )}
            </ul>
            {canEdit && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!body.trim()) return
                  startTransition(async () => {
                    const res = await addComment(orgSlug, task.id, { body })
                    if (res?.error) {
                      toast.error(res.error)
                      return
                    }
                    setBody('')
                    refresh()
                  })
                }}
              >
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Écrire un commentaire…"
                  rows={2}
                  className="flex-1"
                />
                <Button type="submit" size="icon" disabled={pending || !body.trim()}>
                  <Send className="size-4" />
                </Button>
              </form>
            )}
          </section>
        </div>

        {canEdit && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteTask(orgSlug, task.id)
                  if (res?.error) toast.error(res.error)
                  else {
                    toast.success('Tâche supprimée')
                    onClose()
                  }
                })
              }
            >
              <Trash2 className="size-4" /> Supprimer
            </Button>
            <TaskDialog
              orgSlug={orgSlug}
              projectId={task.project_id}
              task={task}
              members={members}
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil className="size-3.5" /> Modifier
                </Button>
              }
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
