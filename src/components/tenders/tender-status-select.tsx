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
import { setTenderStatus } from '@/app/actions/tenders'
import { TENDER_STATUS_LABELS } from './constants'
import type { TenderStatus } from '@/lib/types'

export function TenderStatusSelect({
  orgSlug,
  tenderId,
  status,
}: {
  orgSlug: string
  tenderId: string
  status: TenderStatus
}) {
  const [pending, startTransition] = useTransition()

  return (
    <Select
      value={status}
      onValueChange={(v) => {
        if (!v) return
        startTransition(async () => {
          const res = await setTenderStatus(orgSlug, tenderId, v as TenderStatus)
          if (res?.error) toast.error(res.error)
          else toast.success('Statut mis à jour')
        })
      }}
      disabled={pending}
    >
      <SelectTrigger className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(TENDER_STATUS_LABELS) as TenderStatus[]).map((s) => (
          <SelectItem key={s} value={s}>
            {TENDER_STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
