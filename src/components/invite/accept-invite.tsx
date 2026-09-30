'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { acceptInvitation } from '@/app/actions/organization'

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function accept() {
    setPending(true)
    setError(null)
    const res = await acceptInvitation(token)
    if ('error' in res && res.error) {
      setError(res.error)
      setPending(false)
      return
    }
    if ('slug' in res) {
      router.push(res.slug ? `/${res.slug}/dashboard` : '/')
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">Invitation</CardTitle>
        <CardDescription>
          Vous avez été invité à rejoindre une organisation sur Nexus.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={accept} disabled={pending} className="w-full">
          {pending ? 'Vérification…' : 'Rejoindre l’organisation'}
        </Button>
      </CardContent>
    </Card>
  )
}
