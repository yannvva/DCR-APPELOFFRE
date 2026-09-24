'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { justifySiteVisit } from '@/app/actions/tenders'

export function SiteVisitButton({ orgSlug, tenderId }: { orgSlug: string; tenderId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      className="w-full"
      onClick={() =>
        startTransition(async () => {
          const res = await justifySiteVisit(orgSlug, tenderId)
          if (res?.error) toast.error(res.error)
          else toast.success('Visite de site justifiée')
        })
      }
    >
      <MapPin className="size-3.5" /> Marquer la visite comme justifiée
    </Button>
  )
}
