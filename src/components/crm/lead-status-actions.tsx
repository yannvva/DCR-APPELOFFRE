'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { convertLead, updateLeadStatus } from '@/app/actions/crm'
import type { Lead } from '@/lib/types'

export function LeadStatusActions({ orgSlug, lead }: { orgSlug: string; lead: Lead }) {
  const [pending, startTransition] = useTransition()
  const [convertOpen, setConvertOpen] = useState(false)

  if (lead.status === 'converted') {
    return <span className="text-xs text-muted-foreground">Converti en opportunité</span>
  }

  const run = (fn: () => Promise<{ error?: string } | undefined>, okMsg: string) =>
    startTransition(async () => {
      const res = await fn()
      if (res?.error) toast.error(res.error)
      else toast.success(okMsg)
    })

  return (
    <div className="flex items-center justify-end gap-1.5">
      {lead.status === 'new' && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => updateLeadStatus(orgSlug, lead.id, 'contacted'), 'Lead contacté')
          }
        >
          Contacté
        </Button>
      )}
      {lead.status === 'contacted' && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => updateLeadStatus(orgSlug, lead.id, 'qualified'), 'Lead qualifié')
          }
        >
          Qualifier
        </Button>
      )}
      {lead.status !== 'lost' && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setConvertOpen(true)}
          >
            Convertir
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => updateLeadStatus(orgSlug, lead.id, 'lost'), 'Lead perdu')}
          >
            Perdu
          </Button>
          <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Convertir en opportunité</DialogTitle>
                <DialogDescription>
                  Le lead sera marqué « Converti » et une opportunité « {lead.title} » sera créée
                  dans le pipeline par défaut.
                </DialogDescription>
              </DialogHeader>
              <Button
                className="w-full"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await convertLead(orgSlug, lead.id)
                    if (res?.error) {
                      toast.error(res.error)
                      return
                    }
                    toast.success('Opportunité créée')
                    setConvertOpen(false)
                  })
                }
              >
                {pending ? 'Conversion…' : 'Créer l’opportunité'}
              </Button>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
