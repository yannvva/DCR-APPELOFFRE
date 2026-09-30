'use client'

import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { toast } from 'sonner'
import { Flag, LayoutGrid, List } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { moveTask } from '@/app/actions/projects'
import { TaskDialog, TASK_STATUSES, type Member } from '@/components/projects/task-dialog'
import { TaskDetail } from '@/components/projects/task-detail'
import { formatDate, isOverdue } from '@/lib/format'
import type { Task, TaskStatus } from '@/lib/types'

const PRIORITY_STYLE: Record<string, string> = {
  urgent: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-yellow-500',
  low: 'text-muted-foreground',
}

export function TaskBoard({
  orgSlug,
  projectId,
  tasks,
  members,
  canEdit,
}: {
  orgSlug: string
  projectId: string
  tasks: Task[]
  members: Member[]
  canEdit: boolean
}) {
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [items, setItems] = useState(tasks)
  const [selected, setSelected] = useState<Task | null>(null)
  const [active, setActive] = useState<Task | null>(null)
  // Resynchronise quand le serveur renvoie de nouvelles tâches (création ou
  // édition via dialogue) — sinon l'état local masque les données fraîches.
  const [prevTasks, setPrevTasks] = useState(tasks)
  if (tasks !== prevTasks) {
    setPrevTasks(tasks)
    setItems(tasks)
    setSelected((s) => (s ? (tasks.find((t) => t.id === s.id) ?? s) : s))
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const parents = useMemo(() => items.filter((t) => !t.parent_task_id), [items])
  const subtasksByParent = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of items) {
      if (t.parent_task_id) {
        m.set(t.parent_task_id, [...(m.get(t.parent_task_id) ?? []), t])
      }
    }
    return m
  }, [items])

  function onDragStart(e: DragStartEvent) {
    setActive(items.find((t) => t.id === e.active.id) ?? null)
  }

  async function onDragEnd(e: DragEndEvent) {
    setActive(null)
    const taskId = String(e.active.id)
    const status = e.over?.id ? String(e.over.id) : null
    if (!status || !TASK_STATUSES.some((s) => s.value === status)) return
    const task = items.find((t) => t.id === taskId)
    if (!task || task.status === status) return

    const prev = items
    setItems(items.map((t) => (t.id === taskId ? { ...t, status: status as TaskStatus } : t)))
    const res = await moveTask(orgSlug, taskId, status, 0)
    if (res?.error) {
      setItems(prev)
      toast.error(res.error)
    }
  }

  const openTask = (t: Task) => setSelected(t)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex rounded-lg border border-border p-0.5">
          <Button
            variant={view === 'kanban' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('kanban')}
          >
            <LayoutGrid className="size-4" /> Kanban
          </Button>
          <Button
            variant={view === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('list')}
          >
            <List className="size-4" /> Liste
          </Button>
        </div>
        {canEdit && (
          <TaskDialog
            orgSlug={orgSlug}
            projectId={projectId}
            members={members}
            trigger={
              <Button size="sm">
                Nouvelle tâche
              </Button>
            }
          />
        )}
      </div>

      {view === 'kanban' ? (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {TASK_STATUSES.map((s) => (
              <TaskColumn
                key={s.value}
                status={s.value}
                label={s.label}
                items={parents.filter((t) => t.status === s.value)}
                subCount={subtasksByParent}
                onOpen={openTask}
                canEdit={canEdit}
              />
            ))}
          </div>
          <DragOverlay>{active ? <TaskCard task={active} overlay /> : null}</DragOverlay>
        </DndContext>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titre</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Priorité</TableHead>
                <TableHead>Assignés</TableHead>
                <TableHead>Échéance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Aucune tâche.
                  </TableCell>
                </TableRow>
              )}
              {parents.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer"
                  onClick={() => openTask(t)}
                >
                  <TableCell className="font-medium">{t.title}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {TASK_STATUSES.find((s) => s.value === t.status)?.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Flag className={cn('size-3.5', PRIORITY_STYLE[t.priority])} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.assignees?.map((a) => a.profile?.full_name).filter(Boolean).join(', ') ||
                      '—'}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-sm',
                      isOverdue(t.due_date, t.status === 'done')
                        ? 'text-destructive'
                        : 'text-muted-foreground',
                    )}
                  >
                    {formatDate(t.due_date)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <TaskDetail
        orgSlug={orgSlug}
        task={selected}
        subtasks={selected ? (subtasksByParent.get(selected.id) ?? []) : []}
        members={members}
        canEdit={canEdit}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}

function TaskColumn({
  status,
  label,
  items,
  subCount,
  onOpen,
  canEdit,
}: {
  status: string
  label: string
  items: Task[]
  subCount: Map<string, Task[]>
  onOpen: (t: Task) => void
  canEdit: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-64 shrink-0 flex-col rounded-lg border border-border bg-muted/40',
        isOver && 'border-primary/60 bg-accent/40',
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-medium">{label}</span>
        <Badge variant="secondary" className="tabular-nums">
          {items.length}
        </Badge>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {items.map((t) => (
          <DraggableTask
            key={t.id}
            task={t}
            subs={subCount.get(t.id) ?? []}
            onOpen={onOpen}
            disabled={!canEdit}
          />
        ))}
      </div>
    </div>
  )
}

function DraggableTask({
  task,
  subs,
  onOpen,
  disabled,
}: {
  task: Task
  subs: Task[]
  onOpen: (t: Task) => void
  disabled: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled,
  })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn(isDragging && 'opacity-30')}>
      <TaskCard task={task} subCount={subs.length} onClick={() => onOpen(task)} />
    </div>
  )
}

function TaskCard({
  task,
  subCount = 0,
  overlay,
  onClick,
}: {
  task: Task
  subCount?: number
  overlay?: boolean
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'cursor-grab rounded-lg border border-border bg-card p-3 text-sm shadow-sm',
        overlay && 'rotate-2 shadow-lg',
      )}
    >
      <p className="leading-snug font-medium">{task.title}</p>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Flag className={cn('size-3', PRIORITY_STYLE[task.priority])} />
          {subCount > 0 && <span>{subCount} sous-tâche{subCount > 1 ? 's' : ''}</span>}
        </div>
        <span
          className={cn(
            isOverdue(task.due_date, task.status === 'done') && 'font-medium text-destructive',
          )}
        >
          {task.due_date ? formatDate(task.due_date) : ''}
        </span>
      </div>
      {(task.assignees?.length ?? 0) > 0 && (
        <p className="mt-1.5 truncate text-xs text-muted-foreground">
          {task.assignees!.map((a) => a.profile?.full_name).filter(Boolean).join(', ')}
        </p>
      )}
    </div>
  )
}
