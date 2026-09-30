'use client'

import { useEffect } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function OrgError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <CircleAlert className="size-8 text-destructive" />
      <h1 className="text-2xl font-semibold">Une erreur est survenue</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Le chargement de la page a échoué. Réessayez — si le problème persiste,
        rechargez la page ou contactez le support.
      </p>
      <Button onClick={reset}>Réessayer</Button>
    </div>
  )
}
