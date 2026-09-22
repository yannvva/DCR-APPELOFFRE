'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createOrganization } from '@/app/actions/organization'

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(createOrganization, undefined)

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Nom de l’organisation</Label>
        <Input
          id="name"
          name="name"
          placeholder="Ex. DCR Bâtiment"
          autoFocus
          required
        />
        {state?.fieldErrors?.name && (
          <p className="text-sm text-destructive">{state.fieldErrors.name[0]}</p>
        )}
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Création…' : 'Créer l’organisation'}
      </Button>
    </form>
  )
}
