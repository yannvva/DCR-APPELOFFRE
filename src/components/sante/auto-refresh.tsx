'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Rafraîchit la page Santé tant qu'un workflow tourne (run non terminé vu
 * il y a moins de 6 h) — les pipelines durent des minutes, l'utilisateur ne
 * doit pas avoir à recharger à la main pour voir la progression.
 */
export function AutoRefresh({
  active,
  intervalMs = 45_000,
}: {
  active: boolean
  intervalMs?: number
}) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(t)
  }, [active, intervalMs, router])
  return null
}

export function RefreshButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [last, setLast] = useState<Date | null>(null)
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        startTransition(() => {
          router.refresh()
          setLast(new Date())
        })
      }
      title={last ? `Actualisé à ${last.toLocaleTimeString('fr-FR')}` : undefined}
    >
      <RefreshCw className={pending ? 'size-4 animate-spin' : 'size-4'} />
      Actualiser
    </Button>
  )
}
