'use client'

import { ParamSelect } from '@/components/list-toolbar'
import { TENDER_STATUS_LABELS } from '@/components/tenders/constants'
import type { TenderStatus } from '@/lib/types'

export function StatusFilter() {
  return (
    <ParamSelect
      param="status"
      placeholder="Tous les statuts"
      allLabel="Tous les statuts"
      className="w-48"
      options={(Object.keys(TENDER_STATUS_LABELS) as TenderStatus[]).map((s) => ({
        value: s,
        label: TENDER_STATUS_LABELS[s],
      }))}
    />
  )
}
