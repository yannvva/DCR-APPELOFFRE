'use client'

import { ParamSelect } from '@/components/list-toolbar'
import type { ProjectStatus } from '@/lib/types'

const LABELS: Record<ProjectStatus, string> = {
  active: 'Actif',
  on_hold: 'En pause',
  done: 'Terminé',
  archived: 'Archivé',
}

export function ProjectStatusFilter() {
  return (
    <ParamSelect
      param="status"
      placeholder="Tous les statuts"
      allLabel="Tous les statuts"
      options={(Object.keys(LABELS) as ProjectStatus[]).map((s) => ({
        value: s,
        label: LABELS[s],
      }))}
    />
  )
}
