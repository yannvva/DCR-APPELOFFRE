'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { moveOpportunity } from '@/app/actions/crm'
import { convertOpportunityToProject } from '@/app/actions/projects'
import { OpportunityDialog } from '@/components/crm/opportunity-dialog'
import { formatEuros, formatDate, isOverdue } from '@/lib/format'
import type { Opportunity, PipelineStage } from '@/lib/types'

type AccountOption = { id: string; name: string }
type ContactOption = { id: string; name: string; accountId?: string | null }

export function OpportunitiesKanban({
  orgSlug,
  stages,
  opportunities,
  accounts,
  contacts,
  canEdit,
}: {
  orgSlug: string
  stages: PipelineStage[]
  opportunities: Opportunity[]
  accounts: AccountOption[]
  contacts: ContactOption[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [items, setItems] = useState(opportunities)
  // Resynchronise quand le serveur renvoie de nouvelles opportunités —
  // sinon une opportunité créée via le dialogue n'apparaît pas au kanban.
  const [prevOpps, setPrevOpps] = useState(opportunities)
  if (opportunities !== prevOpps) {
    setPrevOpps(opportunities)
    setItems(opportunities)
  }
  const [active, setActive] = useState<Opportunity | null>(null)
  // Carte cliquée → dialogue d'édition (monté avec defaultOpen, démonté à
  // la fermeture via onOpenChange).
  const [editing, setEditing] = useState<Opportunity | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function onDragStart(e: DragStartEvent) {
    setActive(items.find((o) => o.id === e.active.id) ?? null)
  }

  async function onDragEnd(e: DragEndEvent) {
    setActive(null)
    const oppId = String(e.active.id)
    const stageId = e.over?.id ? String(e.over.id) : null
    if (!stageId || !stages.some((s) => s.id === stageId)) return

    const prev = items
    const opp = items.find((o) => o.id === oppId)
    if (!opp || opp.stage_id === stageId) return

    setItems(items.map((o) => (o.id === oppId ? { ...o, stage_id: stageId } : o)))
    const res = await moveOpportunity(orgSlug, oppId, stageId)
    if (res?.error) {
      setItems(prev)
      toast.error(res.error)
    }
  }

  async function convert(oppId: string) {
    const res = await convertOpportunityToProject(orgSlug, oppId)
    if (res?.error) {
      toast.error(res.error)
      return
    }
    if (res?.projectId) {
      setItems((prev) =>
        prev.map((o) => (o.id === oppId ? { ...o, won_project_id: res.projectId! } : o)),
      )
      toast.success('Projet créé', {
        action: {
          label: 'Ouvrir',
          onClick: () => router.push(`/${orgSlug}/projects/${res.projectId}`),
        },
      })
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto p-6 pb-8">
        {stages.map((stage) => (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            items={items.filter((o) => o.stage_id === stage.id)}
            canEdit={canEdit}
            onOpen={setEditing}
            onConvert={canEdit ? convert : undefined}
          />
        ))}
      </div>
      <DragOverlay>
        {active ? <OppCard opp={active} overlay /> : null}
      </DragOverlay>
      {editing && (
        <OpportunityDialog
          key={editing.id}
          orgSlug={orgSlug}
          opportunity={editing}
          accounts={accounts}
          contacts={contacts}
          defaultOpen
          onOpenChange={(o) => {
            if (!o) setEditing(null)
          }}
        />
      )}
    </DndContext>
  )
}

function KanbanColumn({
  stage,
  items,
  canEdit,
  onOpen,
  onConvert,
}: {
  stage: PipelineStage
  items: Opportunity[]
  canEdit: boolean
  onOpen: (o: Opportunity) => void
  onConvert?: (oppId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const total = items.reduce((s, o) => s + (o.value_cents ?? 0), 0)

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/40 transition-colors',
        isOver && 'border-primary/60 bg-accent/40',
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{stage.name}</span>
          <Badge variant="secondary" className="tabular-nums">
            {items.length}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatEuros(total)}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {items.map((opp) => (
          <DraggableCard
            key={opp.id}
            opp={opp}
            disabled={!canEdit}
            onOpen={onOpen}
            onConvert={onConvert}
          />
        ))}
        {items.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Déposez une opportunité ici
          </p>
        )}
      </div>
    </div>
  )
}

function DraggableCard({
  opp,
  disabled,
  onOpen,
  onConvert,
}: {
  opp: Opportunity
  disabled: boolean
  onOpen: (o: Opportunity) => void
  onConvert?: (oppId: string) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: opp.id,
    disabled,
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(isDragging && 'opacity-30')}
    >
      <OppCard opp={opp} onOpen={onOpen} onConvert={onConvert} />
    </div>
  )
}

function OppCard({
  opp,
  overlay,
  onOpen,
  onConvert,
}: {
  opp: Opportunity
  overlay?: boolean
  onOpen?: (o: Opportunity) => void
  onConvert?: (oppId: string) => void
}) {
  const convertible = opp.status === 'won' && !opp.won_project_id && onConvert
  return (
    <div
      onClick={onOpen && !overlay ? () => onOpen(opp) : undefined}
      className={cn(
        'cursor-grab rounded-lg border border-border bg-card p-3 text-sm shadow-sm transition-colors hover:border-foreground/25',
        overlay && 'rotate-2 shadow-lg',
        opp.status === 'lost' && 'opacity-60',
      )}
      title={overlay ? undefined : 'Cliquer pour modifier'}
    >
      <p className="font-medium leading-snug">{opp.title}</p>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate">{opp.account?.name ?? '—'}</span>
        <span className="tabular-nums">{formatEuros(opp.value_cents)}</span>
      </div>
      {opp.expected_close_date && (
        <p
          className={cn(
            'mt-1 text-xs',
            isOverdue(opp.expected_close_date, opp.status !== 'open')
              ? 'font-medium text-destructive'
              : 'text-muted-foreground',
          )}
        >
          Échéance : {formatDate(opp.expected_close_date)}
          {isOverdue(opp.expected_close_date, opp.status !== 'open') && ' — dépassée'}
        </p>
      )}
      {convertible && (
        <button
          className="mt-2 w-full rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onConvert(opp.id)
          }}
        >
          Convertir en projet
        </button>
      )}
    </div>
  )
}
