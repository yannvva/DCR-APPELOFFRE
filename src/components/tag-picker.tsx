'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plus, Tag as TagIcon, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { applyTag, createTag, removeTag } from '@/app/actions/crm'
import type { Tag } from '@/lib/types'

export function TagPicker({
  orgSlug,
  entityType,
  entityId,
  allTags,
  appliedTags,
  canEdit,
}: {
  orgSlug: string
  entityType: string
  entityId: string
  allTags: Tag[]
  appliedTags: Tag[]
  canEdit: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [newName, setNewName] = useState('')
  const appliedIds = new Set(appliedTags.map((t) => t.id))
  const available = allTags.filter((t) => !appliedIds.has(t.id))

  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    startTransition(async () => {
      const res = await fn()
      if (res?.error) toast.error(res.error)
    })

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {appliedTags.map((t) => (
        <Badge key={t.id} variant="secondary" className="gap-1" style={{ borderColor: t.color }}>
          <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
          {t.name}
          {canEdit && (
            <button
              className="ml-0.5 rounded-full hover:text-destructive"
              disabled={pending}
              onClick={() => run(() => removeTag(orgSlug, t.id, entityType, entityId))}
              aria-label={`Retirer le tag ${t.name}`}
            >
              <X className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs">
                <TagIcon className="size-3" /> Tag
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-56">
            {available.map((t) => (
              <DropdownMenuItem
                key={t.id}
                disabled={pending}
                onClick={() => run(() => applyTag(orgSlug, t.id, entityType, entityId))}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
                {t.name}
              </DropdownMenuItem>
            ))}
            {available.length > 0 && <DropdownMenuSeparator />}
            <div className="flex items-center gap-1.5 p-1.5">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nouveau tag…"
                className="h-7 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    create()
                  }
                }}
              />
              <Button
                size="icon-sm"
                variant="outline"
                disabled={pending || !newName.trim()}
                onClick={create}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )

  function create() {
    const name = newName.trim()
    if (!name) return
    startTransition(async () => {
      const res = await createTag(orgSlug, { name })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      if (res?.tagId) await applyTag(orgSlug, res.tagId, entityType, entityId)
      setNewName('')
    })
  }
}
