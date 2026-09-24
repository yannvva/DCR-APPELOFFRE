'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { addLot, deleteLot, toggleLotSelected } from '@/app/actions/tenders'
import { formatEuros } from '@/lib/format'
import type { TenderLot } from '@/lib/types'

export function LotsPanel({
  orgSlug,
  tenderId,
  lots,
  canEdit,
}: {
  orgSlug: string
  tenderId: string
  lots: TenderLot[]
  canEdit: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [number, setNumber] = useState('')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')

  function add() {
    if (!number || !title.trim()) {
      toast.error('Numéro et intitulé du lot requis.')
      return
    }
    startTransition(async () => {
      const res = await addLot(orgSlug, tenderId, {
        number: Number(number),
        title: title.trim(),
        amountEuros: amount === '' ? undefined : Number(amount),
      })
      if (res?.error || res?.fieldErrors) {
        toast.error(res.error ?? 'Lot invalide.')
        return
      }
      toast.success('Lot ajouté')
      setNumber('')
      setTitle('')
      setAmount('')
    })
  }

  return (
    <div className="space-y-3">
      {lots.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          Aucun lot — marché alloti non déclaré ou lot unique.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {lots.map((lot) => (
            <li key={lot.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Checkbox
                checked={lot.selected}
                disabled={!canEdit || pending}
                aria-label={`Répondre au lot ${lot.number}`}
                onCheckedChange={(v) =>
                  startTransition(async () => {
                    const res = await toggleLotSelected(
                      orgSlug,
                      lot.id,
                      tenderId,
                      v === true,
                    )
                    if (res?.error) toast.error(res.error)
                  })
                }
              />
              <span className="w-10 shrink-0 text-xs font-medium text-muted-foreground">
                Lot {lot.number}
              </span>
              <span className="min-w-0 flex-1 truncate">{lot.title}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatEuros(lot.amount_cents)}
              </span>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending}
                  aria-label={`Supprimer le lot ${lot.number}`}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await deleteLot(orgSlug, lot.id, tenderId)
                      if (res?.error) toast.error(res.error)
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex items-center gap-2">
          <Input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            type="number"
            min={1}
            placeholder="N°"
            className="w-20"
            aria-label="Numéro du lot"
          />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Intitulé du lot"
            className="flex-1"
            aria-label="Intitulé du lot"
          />
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            min={0}
            placeholder="Montant €"
            className="w-32"
            aria-label="Montant estimé du lot"
          />
          <Button variant="outline" size="sm" onClick={add} disabled={pending}>
            <Plus className="size-3.5" /> Ajouter
          </Button>
        </div>
      )}
    </div>
  )
}
