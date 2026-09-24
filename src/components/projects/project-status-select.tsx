'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { updateProjectStatus } from '@/app/actions/projects'
import type { Project, ProjectStatus } from '@/lib/types'

const OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'active', label: 'Actif' },
  { value: 'on_hold', label: 'En pause' },
  { value: 'done', label: 'Terminé' },
  { value: 'archived', label: 'Archivé' },
]

export function ProjectStatusSelect({
  orgSlug,
  project,
}: {
  orgSlug: string
  project: Project
}) {
  const [pending, startTransition] = useTransition()
  return (
    <Select
      value={project.status}
      disabled={pending}
      onValueChange={(v) =>
        startTransition(async () => {
          const res = await updateProjectStatus(orgSlug, project.id, v as ProjectStatus)
          if (res?.error) toast.error(res.error)
        })
      }
    >
      <SelectTrigger className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
