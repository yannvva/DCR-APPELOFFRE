'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  ArrowUpDown,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Columns3,
  Euro,
  FileText,
  Flag,
  GripVertical,
  List,
  PenLine,
  Search,
  User,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  assignChecklistItem,
  setChecklistItemStatus,
} from '@/app/actions/tenders'
import { updateTask } from '@/app/actions/projects'
import { CHECKLIST_STATUS_LABELS } from '@/components/tenders/constants'
import { daysUntil, formatDate, isOverdue } from '@/lib/format'
import { tenderPath } from '@/lib/slug'
import { cn } from '@/lib/utils'
import type {
  ChecklistItemStatus,
  TaskPriority,
  TaskStatus,
} from '@/lib/types'
import type { TodoChecklistItem } from '@/lib/dal/tenders'
import type { TodoTask } from '@/lib/dal/projects'

/* ------------------------------------------------------------------ modèles */

export type TodoView = 'kanban' | 'liste' | 'echeancier'
export type DeadlineFilter = 'all' | 'late' | 'week' | 'none'
export type TodoSort = 'deadline' | 'context' | 'status' | 'label'
export type TodoSource = 'all' | 'pieces' | 'taches'

export interface TodoFilters {
  view: TodoView
  q: string
  tender: string
  assignee: string
  deadline: DeadlineFilter
  sort: TodoSort
  source: TodoSource
  showDone: boolean
}

/** Colonnes communes aux pièces de dossier et aux tâches de projet. */
const COLUMNS: { key: string; label: string; accent: string }[] = [
  { key: 'bloque', label: 'Bloqué', accent: 'border-t-red-500' },
  { key: 'todo', label: 'À faire', accent: 'border-t-slate-400' },
  { key: 'en_cours', label: 'En cours', accent: 'border-t-blue-500' },
  { key: 'a_verifier', label: 'À vérifier', accent: 'border-t-amber-500' },
  { key: 'valide', label: 'Terminé', accent: 'border-t-emerald-500' },
]
const COLUMN_ORDER = COLUMNS.map((c) => c.key)

const PIECE_COLUMN: Record<ChecklistItemStatus, string> = {
  bloque: 'bloque',
  non_commence: 'todo',
  en_cours: 'en_cours',
  a_verifier: 'a_verifier',
  valide: 'valide',
  non_requis: 'todo',
}
const TASK_COLUMN: Record<TaskStatus, string> = {
  backlog: 'todo',
  todo: 'todo',
  in_progress: 'en_cours',
  in_review: 'a_verifier',
  done: 'valide',
}
/** Colonne → statut de la pièce (direct) ou de la tâche (repli). */
const COLUMN_TO_PIECE: Record<string, ChecklistItemStatus> = {
  bloque: 'bloque',
  todo: 'non_commence',
  en_cours: 'en_cours',
  a_verifier: 'a_verifier',
  valide: 'valide',
}
const COLUMN_TO_TASK: Record<string, TaskStatus> = {
  bloque: 'todo',
  todo: 'todo',
  en_cours: 'in_progress',
  a_verifier: 'in_review',
  valide: 'done',
}
const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
}

/** Ligne unifiée : pièce de dossier ou tâche de projet. */
interface Row {
  kind: 'piece' | 'task'
  id: string
  label: string
  /** Contexte : dossier d'AO ou projet. */
  contextId: string
  contextLabel: string
  href: string
  /** Échéance de travail (échéance interne ou date d'échéance de la tâche). */
  deadline: string | null
  /** Date de remise de l'AO (sert de repli et de signal « en retard »). */
  tenderDeadline: string | null
  status: string
  column: string
  assigneeId: string | null
  assigneeName: string | null
  requirement?: string
  requiresSignature?: boolean
  requiresChiffrage?: boolean
  priority?: TaskPriority
  documentName?: string | null
  piece?: TodoChecklistItem
  task?: TodoTask
}

function toRows(items: TodoChecklistItem[], tasks: TodoTask[], orgSlug: string): Row[] {
  return [
    ...items.map<Row>((i) => ({
      kind: 'piece',
      id: i.id,
      label: i.label,
      contextId: i.tender_id,
      contextLabel: i.tender.title,
      href: `${tenderPath(orgSlug, i.tender)}?tab=checklist`,
      deadline: i.internal_deadline,
      tenderDeadline: i.tender.response_deadline,
      status: i.status,
      column: PIECE_COLUMN[i.status],
      assigneeId: i.assignee_id,
      assigneeName: i.assignee?.full_name ?? null,
      requirement: i.requirement,
      requiresSignature: i.requires_signature,
      requiresChiffrage: i.requires_chiffrage,
      documentName: i.document?.name ?? null,
      piece: i,
    })),
    ...tasks.map<Row>((t) => ({
      kind: 'task',
      id: t.id,
      label: t.title,
      contextId: t.project_id,
      contextLabel: t.project?.name ?? 'Projet',
      href: `/${orgSlug}/projects/${t.project_id}`,
      deadline: t.due_date,
      tenderDeadline: null,
      status: t.status,
      column: TASK_COLUMN[t.status],
      assigneeId: t.assignees?.[0]?.user_id ?? null,
      assigneeName: t.assignees?.[0]?.profile?.full_name ?? null,
      priority: t.priority,
      task: t,
    })),
  ]
}

const isLateRow = (r: Row) =>
  r.status !== 'valide' &&
  r.status !== 'done' &&
  ((r.deadline != null && isOverdue(r.deadline)) ||
    (r.tenderDeadline != null && isOverdue(r.tenderDeadline)))

/** Buckets de l'échéancier (ordre d'urgence). */
function bucketOf(r: Row): string {
  if (r.status === 'valide' || r.status === 'done') return 'done'
  const d = r.deadline ?? r.tenderDeadline
  if (!d) return 'none'
  const days = daysUntil(d)
  if (days < 0) return 'late'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days <= 7) return 'week'
  return 'later'
}

const BUCKETS: { key: string; label: string; tone: string }[] = [
  { key: 'late', label: 'En retard', tone: 'text-destructive' },
  { key: 'today', label: "Aujourd'hui", tone: 'text-amber-500' },
  { key: 'tomorrow', label: 'Demain', tone: 'text-foreground' },
  { key: 'week', label: 'Cette semaine', tone: 'text-foreground' },
  { key: 'later', label: 'Plus tard', tone: 'text-muted-foreground' },
  { key: 'none', label: 'Sans échéance', tone: 'text-muted-foreground' },
  { key: 'done', label: 'Terminé', tone: 'text-emerald-500' },
]

/* ------------------------------------------------------------------- briques */

function StatusPill({ row }: { row: Row }) {
  const label =
    row.kind === 'piece'
      ? CHECKLIST_STATUS_LABELS[row.status as ChecklistItemStatus]
      : ({ backlog: 'Backlog', todo: 'À faire', in_progress: 'En cours', in_review: 'À vérifier', done: 'Terminé' } as Record<string, string>)[row.status]
  const tone =
    row.column === 'valide'
      ? 'bg-emerald-500/15 text-emerald-600'
      : row.column === 'bloque'
        ? 'bg-red-500/15 text-red-600'
        : row.column === 'en_cours'
          ? 'bg-blue-500/15 text-blue-600'
          : row.column === 'a_verifier'
            ? 'bg-amber-500/15 text-amber-600'
            : 'bg-muted text-muted-foreground'
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', tone)}>
      {label}
    </span>
  )
}

function DeadlineCell({ row }: { row: Row }) {
  const d = row.deadline ?? row.tenderDeadline
  if (!d) return <span className="text-xs text-muted-foreground">—</span>
  const late = isLateRow(row)
  const days = daysUntil(d)
  return (
    <span className={cn('text-xs tabular-nums', late && 'font-medium text-destructive')}>
      {formatDate(d)}
      {!late && days >= 0 && days <= 7 && (
        <span className="ml-1 text-muted-foreground">
          {days === 0 ? "auj." : `J-${days}`}
        </span>
      )}
      {late && <span className="ml-1">· retard</span>}
    </span>
  )
}

function RowFlags({ row }: { row: Row }) {
  return (
    <>
      {row.kind === 'task' && row.priority && row.priority !== 'medium' && (
        <Badge
          variant="outline"
          className={cn(
            'gap-0.5',
            row.priority === 'urgent' && 'border-red-500/50 text-red-600',
            row.priority === 'high' && 'border-amber-500/50 text-amber-600',
          )}
        >
          <Flag className="size-2.5" /> {PRIORITY_LABELS[row.priority]}
        </Badge>
      )}
      {row.kind === 'piece' && row.requirement === 'obligatoire' && (
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          Obligatoire
        </Badge>
      )}
      {row.requiresSignature && (
        <Badge variant="outline" className="gap-0.5">
          <PenLine className="size-2.5" /> Signature
        </Badge>
      )}
      {row.requiresChiffrage && (
        <Badge variant="outline" className="gap-0.5">
          <Euro className="size-2.5" /> Chiffrage
        </Badge>
      )}
    </>
  )
}

/* --------------------------------------------------------------------- board */

export function TodoBoard({
  orgSlug,
  items,
  tasks,
  members,
  meId,
  canEdit,
  initial,
}: {
  orgSlug: string
  items: TodoChecklistItem[]
  tasks: TodoTask[]
  members: { user_id: string; full_name: string | null }[]
  meId: string
  canEdit: boolean
  initial: TodoFilters
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [view, setView] = useState<TodoView>(initial.view)
  const [q, setQ] = useState(initial.q)
  const [tender, setTender] = useState(initial.tender)
  const [assignee, setAssignee] = useState(initial.assignee)
  const [deadline, setDeadline] = useState<DeadlineFilter>(initial.deadline)
  const [sort, setSort] = useState<TodoSort>(initial.sort)
  const [source, setSource] = useState<TodoSource>(initial.source)
  const [showDone, setShowDone] = useState(initial.showDone)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)
  // Statut affiché immédiatement après une action, tant que le serveur n'a pas
  // renvoyé la donnée fraîche (l'override devient caduc tout seul).
  const [overrides, setOverrides] = useState<Record<string, { from: string; to: string }>>({})

  // Filtres reflétés dans l'URL sans aller-retour serveur (History API).
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams()
      if (view !== 'kanban') p.set('vue', view)
      if (q) p.set('q', q)
      if (tender !== 'all') p.set('dossier', tender)
      if (assignee !== 'all') p.set('assigne', assignee)
      if (deadline !== 'all') p.set('echeance', deadline)
      if (sort !== 'deadline') p.set('tri', sort)
      if (source !== 'all') p.set('source', source)
      if (showDone) p.set('faites', '1')
      const qs = p.toString()
      window.history.replaceState(null, '', qs ? `?${qs}` : location.pathname)
    }, 200)
    return () => clearTimeout(t)
  }, [view, q, tender, assignee, deadline, sort, source, showDone])

  // Vue mémorisée (même convention que la liste des AO) : restaurée quand
  // l'URL n'impose pas de vue, réécrite à chaque bascule.
  const VIEW_KEY = 'todo-vue'
  useEffect(() => {
    if (initial.view !== 'kanban') return
    try {
      const stored = localStorage.getItem(VIEW_KEY)
      if (stored === 'kanban' || stored === 'liste' || stored === 'echeancier')
        setView(stored)
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {}
  }, [view])

  // « / » focalise la recherche du board (raccourci global des listes).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        e.key === '/' &&
        !e.metaKey &&
        !e.ctrlKey &&
        t?.tagName !== 'INPUT' &&
        t?.tagName !== 'TEXTAREA' &&
        !t?.isContentEditable
      ) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hasFilters =
    q !== '' ||
    tender !== 'all' ||
    assignee !== 'all' ||
    deadline !== 'all' ||
    source !== 'all' ||
    showDone ||
    sort !== 'deadline'
  function resetFilters() {
    setQ('')
    setTender('all')
    setAssignee('all')
    setDeadline('all')
    setSource('all')
    setShowDone(false)
    setSort('deadline')
  }

  const rows = useMemo(() => toRows(items, tasks, orgSlug), [items, tasks, orgSlug])

  const effectiveStatus = (r: Row) => {
    const o = overrides[r.id]
    return o && o.from === r.status ? o.to : r.status
  }
  const effectiveColumn = (r: Row) => {
    const s = effectiveStatus(r)
    return r.kind === 'piece'
      ? PIECE_COLUMN[s as ChecklistItemStatus]
      : TASK_COLUMN[s as TaskStatus]
  }

  const tenderOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of items) m.set(i.tender_id, i.tender.title)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'))
  }, [items])

  // Tous les filtres SAUF l'échéance : sert aux compteurs des chips
  // (« Tout » doit afficher le vrai total, pas le sous-ensemble filtré).
  const baseFiltered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (source === 'pieces' && r.kind !== 'piece') return false
      if (source === 'taches' && r.kind !== 'task') return false
      if (r.kind === 'piece' && r.status === 'non_requis') return false
      if (!showDone && (effectiveStatus(r) === 'valide' || effectiveStatus(r) === 'done'))
        return false
      if (tender !== 'all' && r.contextId !== tender) return false
      if (assignee === 'me' && r.assigneeId !== meId) return false
      if (assignee === 'none' && r.assigneeId) return false
      if (assignee !== 'all' && assignee !== 'me' && assignee !== 'none' && r.assigneeId !== assignee)
        return false
      if (needle) {
        const hay = `${r.label} ${r.contextLabel} ${r.assigneeName ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, source, showDone, tender, assignee, q, meId, overrides])

  const filtered = useMemo(() => {
    return baseFiltered.filter((r) => {
      if (deadline === 'late' && !isLateRow(r)) return false
      if (deadline === 'week' && !(r.deadline && daysUntil(r.deadline) >= 0 && daysUntil(r.deadline) <= 7))
        return false
      if (deadline === 'none' && (r.deadline || r.tenderDeadline)) return false
      return true
    })
  }, [baseFiltered, deadline])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const dOf = (r: Row) => r.deadline ?? r.tenderDeadline ?? '9999-12-31'
    arr.sort((a, b) => {
      if (sort === 'context') return a.contextLabel.localeCompare(b.contextLabel, 'fr')
      if (sort === 'status') return COLUMN_ORDER.indexOf(effectiveColumn(a)) - COLUMN_ORDER.indexOf(effectiveColumn(b))
      if (sort === 'label') return a.label.localeCompare(b.label, 'fr')
      return dOf(a).localeCompare(dOf(b)) || a.label.localeCompare(b.label, 'fr')
    })
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, overrides])

  const counts = useMemo(() => {
    const st = (r: Row) => {
      const o = overrides[r.id]
      return o && o.from === r.status ? o.to : r.status
    }
    // Compteurs calculés hors filtre d'échéance : les chips « En retard » /
    // « Tout » affichent les vrais totaux quel que soit le filtre actif.
    const late = baseFiltered.filter(isLateRow).length
    const open = baseFiltered.filter((r) => st(r) !== 'valide' && st(r) !== 'done').length
    const week = baseFiltered.filter(
      (r) => r.deadline && daysUntil(r.deadline) >= 0 && daysUntil(r.deadline) <= 7,
    ).length
    const none = baseFiltered.filter((r) => !r.deadline && !r.tenderDeadline).length
    const mine = baseFiltered.filter((r) => r.assigneeId === meId).length
    return { late, open, week, none, mine }
  }, [baseFiltered, meId, overrides])

  /* ------------------------------------------------------------- actions */

  function setPieceStatus(item: TodoChecklistItem, status: ChecklistItemStatus, force = false) {
    setOverrides((o) => ({ ...o, [item.id]: { from: item.status, to: status } }))
    start(async () => {
      const res = await setChecklistItemStatus(
        orgSlug,
        item.id,
        item.tender_id,
        status,
        force,
        force ? 'Forcé depuis la page À faire' : '',
      )
      if (res?.error) {
        setOverrides((o) => {
          const n = { ...o }
          delete n[item.id]
          return n
        })
        if (res.error.includes('Forcer')) {
          toast.error(res.error, {
            action: { label: 'Forcer', onClick: () => setPieceStatus(item, status, true) },
          })
        } else {
          toast.error(res.error)
        }
        return
      }
      toast.success(`« ${item.label} » → ${CHECKLIST_STATUS_LABELS[status]}`)
      router.refresh()
    })
  }

  function setTaskStatus(task: TodoTask, status: TaskStatus) {
    setOverrides((o) => ({ ...o, [task.id]: { from: task.status, to: status } }))
    start(async () => {
      const res = await updateTask(orgSlug, task.id, { status })
      if (res?.error) {
        toast.error(res.error)
        setOverrides((o) => {
          const n = { ...o }
          delete n[task.id]
          return n
        })
        return
      }
      toast.success(`« ${task.title} » → ${status === 'done' ? 'Terminé' : 'mis à jour'}`)
      router.refresh()
    })
  }

  function moveTo(row: Row, column: string) {
    if (row.kind === 'piece') {
      const next = COLUMN_TO_PIECE[column]
      if (next && effectiveColumn(row) !== column) setPieceStatus(row.piece!, next)
    } else {
      const next = COLUMN_TO_TASK[column]
      if (next && effectiveColumn(row) !== column) setTaskStatus(row.task!, next)
    }
  }

  function step(row: Row, dir: -1 | 1) {
    const col = effectiveColumn(row)
    const next = COLUMN_ORDER[COLUMN_ORDER.indexOf(col) + dir]
    if (next) moveTo(row, next)
  }

  function complete(row: Row) {
    if (row.kind === 'piece') setPieceStatus(row.piece!, 'valide')
    else setTaskStatus(row.task!, 'done')
  }

  function assignToMe(row: Row) {
    start(async () => {
      if (row.kind === 'piece') {
        const res = await assignChecklistItem(orgSlug, row.id, row.piece!.tender_id, meId)
        if (res?.error) {
          toast.error(res.error)
          return
        }
      } else {
        const ids = (row.task!.assignees ?? []).map((a) => a.user_id)
        const res = await updateTask(orgSlug, row.id, {
          assigneeIds: ids.includes(meId) ? ids : [...ids, meId],
        })
        if (res?.error) {
          toast.error(res.error)
          return
        }
      }
      toast.success('Assigné à vous')
      router.refresh()
    })
  }

  /* ---------------------------------------------------------------- vues */

  function Kanban() {
    if (sorted.length === 0)
      return (
        <EmptyState />
      )
    const byColumn = new Map<string, Row[]>()
    for (const c of COLUMNS) byColumn.set(c.key, [])
    for (const r of sorted) {
      const col = effectiveColumn(r)
      byColumn.get(col)?.push(r)
    }
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {COLUMNS.map((col) => {
          const list = byColumn.get(col.key) ?? []
          const isTarget = overCol === col.key
          const shown = expanded.has(col.key) ? list : list.slice(0, 15)
          const hidden = list.length - shown.length
          return (
            <section
              key={col.key}
              onDragOver={(e) => {
                if (!canEdit || !dragId) return
                e.preventDefault()
                setOverCol(col.key)
              }}
              onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
              onDrop={(e) => {
                e.preventDefault()
                setOverCol(null)
                const row = sorted.find((r) => r.id === dragId)
                setDragId(null)
                if (row) moveTo(row, col.key)
              }}
              className={cn(
                'flex min-h-40 flex-col rounded-lg border border-border border-t-2 bg-muted/30 p-2 transition-colors',
                col.accent,
                isTarget && 'border-primary/60 bg-primary/5 ring-1 ring-primary/30',
              )}
            >
              <header className="mb-2 flex items-center justify-between px-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {col.label}
                </h3>
                <Badge variant="secondary" className="text-[10px] tabular-nums">
                  {list.length}
                </Badge>
              </header>
              <div className="space-y-2">
                {shown.map((r) => (
                  <article
                    key={r.id}
                    draggable={canEdit}
                    onDragStart={(e) => {
                      setDragId(r.id)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', r.id)
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setOverCol(null)
                    }}
                    className={cn(
                      'group rounded-md border border-border bg-card p-2.5 text-sm shadow-sm',
                      canEdit && 'cursor-grab active:cursor-grabbing',
                      dragId === r.id && 'opacity-40',
                      isLateRow(r) && 'border-l-2 border-l-destructive',
                    )}
                  >
                    <div className="flex items-start gap-1">
                      {canEdit && (
                        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug">{r.label}</p>
                        <Link
                          href={r.href}
                          className="mt-0.5 flex items-center gap-1 truncate text-xs text-primary hover:underline"
                        >
                          {r.kind === 'task' && (
                            <CircleDashed className="size-2.5 shrink-0" />
                          )}
                          <span className="truncate">{r.contextLabel}</span>
                        </Link>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
                          <RowFlags row={r} />
                        </div>
                        {r.documentName && (
                          <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <FileText className="size-3 shrink-0" />
                            {r.documentName}
                          </p>
                        )}
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <DeadlineCell row={r} />
                          {r.assigneeName && (
                            <span className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                              <User className="size-2.5" />
                              {r.assigneeName}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {canEdit && (
                      <div className="mt-1.5 flex items-center justify-between opacity-60 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={pending || COLUMN_ORDER.indexOf(effectiveColumn(r)) === 0}
                          onClick={() => step(r, -1)}
                          aria-label="Statut précédent"
                        >
                          <ChevronLeft className="size-3.5" />
                        </Button>
                        <span className="flex items-center gap-0.5">
                          {r.assigneeId !== meId && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              disabled={pending}
                              onClick={() => assignToMe(r)}
                              aria-label="M'assigner"
                              title="M'assigner"
                            >
                              <User className="size-3.5" />
                            </Button>
                          )}
                          {effectiveColumn(r) !== 'valide' && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              disabled={pending}
                              onClick={() => complete(r)}
                              aria-label="Marquer terminé"
                              title="Marquer terminé"
                            >
                              <Check className="size-3.5" />
                            </Button>
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={pending || effectiveColumn(r) === 'valide'}
                          onClick={() => step(r, 1)}
                          aria-label="Statut suivant"
                        >
                          <ChevronRight className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </article>
                ))}
                {hidden > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground"
                    onClick={() => setExpanded((s) => new Set(s).add(col.key))}
                  >
                    Afficher les {hidden} autre{hidden > 1 ? 's' : ''}
                  </Button>
                )}
                {list.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                    {isTarget ? 'Déposer ici' : '—'}
                  </p>
                )}
              </div>
            </section>
          )
        })}
      </div>
    )
  }

  function RowLine({ r }: { r: Row }) {
    return (
      <li
        className={cn(
          'group flex items-center gap-3 px-3 py-2 text-sm',
          isLateRow(r) && 'border-l-2 border-l-destructive',
        )}
      >
        <button
          type="button"
          disabled={!canEdit || pending || effectiveColumn(r) === 'valide'}
          onClick={() => complete(r)}
          aria-label="Marquer terminé"
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full border border-border transition-colors',
            effectiveColumn(r) === 'valide'
              ? 'border-emerald-500 bg-emerald-500/20 text-emerald-600'
              : 'hover:border-emerald-500 hover:text-emerald-600',
          )}
        >
          {effectiveColumn(r) === 'valide' && <Check className="size-3" />}
        </button>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <Link href={r.href} className="truncate font-medium hover:underline">
              {r.label}
            </Link>
            {r.kind === 'task' && (
              <Badge variant="outline" className="shrink-0 gap-0.5 text-[10px]">
                <CircleDashed className="size-2.5" /> Projet
              </Badge>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Link href={r.href} className="truncate hover:underline">
              {r.contextLabel}
            </Link>
            <RowFlags row={r} />
          </span>
        </span>
        <span className="hidden w-32 shrink-0 sm:block">
          <DeadlineCell row={r} />
        </span>
        <span className="hidden w-24 shrink-0 md:block">
          <StatusPill row={r} />
        </span>
        <span className="hidden w-28 shrink-0 truncate text-xs text-muted-foreground lg:block">
          {r.assigneeName ?? '—'}
        </span>
        {canEdit && (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {r.assigneeId !== meId && (
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={pending}
                onClick={() => assignToMe(r)}
                aria-label="M'assigner"
                title="M'assigner"
              >
                <User className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={pending || COLUMN_ORDER.indexOf(effectiveColumn(r)) === 0}
              onClick={() => step(r, -1)}
              aria-label="Statut précédent"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={pending || effectiveColumn(r) === 'valide'}
              onClick={() => step(r, 1)}
              aria-label="Statut suivant"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </span>
        )}
      </li>
    )
  }

  function Liste() {
    return (
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="size-4 shrink-0" />
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1 hover:text-foreground"
            onClick={() => setSort('label')}
          >
            Pièce / tâche <ArrowUpDown className="size-3" />
          </button>
          <button
            type="button"
            className="hidden w-32 shrink-0 items-center gap-1 hover:text-foreground sm:flex"
            onClick={() => setSort('deadline')}
          >
            Échéance <ArrowUpDown className="size-3" />
          </button>
          <button
            type="button"
            className="hidden w-24 shrink-0 items-center gap-1 hover:text-foreground md:flex"
            onClick={() => setSort('status')}
          >
            Statut <ArrowUpDown className="size-3" />
          </button>
          <span className="hidden w-28 shrink-0 lg:block">Assigné</span>
          <span className="w-20 shrink-0" />
        </div>
        <ul className="divide-y divide-border">
          {sorted.map((r) => (
            <RowLine key={r.id} r={r} />
          ))}
          {sorted.length === 0 && (
            <li className="px-3 py-10 text-center text-sm text-muted-foreground">
              Aucune ligne ne correspond aux filtres.
            </li>
          )}
        </ul>
      </div>
    )
  }

  function Echeancier() {
    if (sorted.length === 0) return <EmptyState />
    const groups = BUCKETS.map((b) => ({
      ...b,
      rows: sorted.filter((r) => bucketOf(r) === b.key),
    })).filter((g) => g.rows.length > 0 || g.key !== 'done')
    return (
      <div className="space-y-4">
        {groups.map((g) => (
          <section key={g.key}>
            <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <span className={g.tone}>{g.label}</span>
              <Badge variant="secondary" className="text-[10px] tabular-nums">
                {g.rows.length}
              </Badge>
            </h3>
            {g.rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                Rien à traiter.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {g.rows.map((r) => (
                  <RowLine key={r.id} r={r} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    )
  }

  function EmptyState() {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center">
        <p className="text-sm font-medium">Aucune ligne ne correspond aux filtres</p>
        {hasFilters ? (
          <button
            type="button"
            onClick={resetFilters}
            className="mt-2 text-xs text-primary underline-offset-2 hover:underline"
          >
            Réinitialiser les filtres
          </button>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Les pièces de checklist et les tâches de projet ouvertes
            apparaîtront ici.
          </p>
        )}
      </div>
    )
  }

  /* ------------------------------------------------------------- toolbar */

  const chip = (active: boolean) =>
    cn(
      'h-8 rounded-full border px-3 text-xs transition-colors',
      active
        ? 'border-primary bg-primary/10 font-medium text-primary'
        : 'border-border text-muted-foreground hover:bg-accent/60',
    )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher une pièce, un dossier…"
            className="h-8 w-56 rounded-md border border-input bg-transparent pl-7 pr-9 text-xs placeholder:text-muted-foreground"
            aria-label="Rechercher"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Effacer la recherche"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1 text-[10px] text-muted-foreground sm:block">
              /
            </kbd>
          )}
        </div>

        <Select value={tender} onValueChange={(v) => setTender(v ?? 'all')}>
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder="Tous les dossiers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les dossiers ({tenderOptions.length})</SelectItem>
            {tenderOptions.map(([id, title]) => (
              <SelectItem key={id} value={id}>
                {title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={assignee} onValueChange={(v) => setAssignee(v ?? 'all')}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Tout le monde" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tout le monde</SelectItem>
            <SelectItem value="me">Mes lignes ({counts.mine})</SelectItem>
            <SelectItem value="none">Non assignées</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.user_id} value={m.user_id}>
                {m.full_name ?? m.user_id.slice(0, 8)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={source} onValueChange={(v) => setSource((v ?? 'all') as TodoSource)}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="Tout" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Pièces + tâches</SelectItem>
            <SelectItem value="pieces">Pièces de dossier</SelectItem>
            <SelectItem value="taches">Tâches de projet</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sort} onValueChange={(v) => setSort((v ?? 'deadline') as TodoSort)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Tri" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="deadline">Tri : échéance</SelectItem>
            <SelectItem value="context">Tri : dossier</SelectItem>
            <SelectItem value="status">Tri : statut</SelectItem>
            <SelectItem value="label">Tri : libellé</SelectItem>
          </SelectContent>
        </Select>

        <span className="ml-auto flex items-center gap-1">
          <Button
            variant={view === 'kanban' ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => setView('kanban')}
          >
            <Columns3 className="size-3.5" /> Kanban
          </Button>
          <Button
            variant={view === 'liste' ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => setView('liste')}
          >
            <List className="size-3.5" /> Liste
          </Button>
          <Button
            variant={view === 'echeancier' ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => setView('echeancier')}
          >
            <CalendarDays className="size-3.5" /> Échéancier
          </Button>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chip(deadline === 'all')} onClick={() => setDeadline('all')}>
          Toutes ({baseFiltered.length})
        </button>
        <button
          type="button"
          className={cn(
            chip(deadline === 'late'),
            counts.late > 0 && deadline !== 'late' && 'border-red-500/50 text-red-600',
          )}
          onClick={() => setDeadline(deadline === 'late' ? 'all' : 'late')}
        >
          En retard ({counts.late})
        </button>
        <button
          type="button"
          className={chip(deadline === 'week')}
          onClick={() => setDeadline(deadline === 'week' ? 'all' : 'week')}
        >
          ≤ 7 jours ({counts.week})
        </button>
        <button
          type="button"
          className={chip(deadline === 'none')}
          onClick={() => setDeadline(deadline === 'none' ? 'all' : 'none')}
        >
          Sans échéance ({counts.none})
        </button>
        <button
          type="button"
          className={chip(showDone)}
          onClick={() => setShowDone((v) => !v)}
        >
          + Terminées
        </button>
        {hasFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" /> Réinitialiser
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {sorted.length} affichée{sorted.length > 1 ? 's' : ''}
          {counts.late > 0 && ` · ${counts.late} en retard`}
        </span>
      </div>

      {view === 'kanban' && Kanban()}
      {view === 'liste' && Liste()}
      {view === 'echeancier' && Echeancier()}
    </div>
  )
}
