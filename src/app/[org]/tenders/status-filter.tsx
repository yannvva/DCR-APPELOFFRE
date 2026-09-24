'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TENDER_STATUS_LABELS } from '@/components/tenders/constants'
import type { TenderStatus } from '@/lib/types'

export function StatusFilter() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const value = searchParams.get('status') ?? ''

  return (
    <Select
      value={value || 'all'}
      onValueChange={(v) => {
        const sp = new URLSearchParams(searchParams.toString())
        if (v && v !== 'all') sp.set('status', v)
        else sp.delete('status')
        sp.delete('page')
        router.replace(`${pathname}?${sp.toString()}`)
      }}
    >
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Tous les statuts" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tous les statuts</SelectItem>
        {(Object.keys(TENDER_STATUS_LABELS) as TenderStatus[]).map((s) => (
          <SelectItem key={s} value={s}>
            {TENDER_STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
