'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { updateMyProfile, updateOrganizationName } from '@/app/actions/settings'
import type { JobRole, Organization } from '@/lib/types'

const JOB_ROLE_LABELS: Record<JobRole, string> = {
  dirigeant: 'Dirigeant',
  chef_projet: 'Chef de projet',
  redacteur: 'Rédacteur',
  charge_admin: 'Chargé administratif',
  chiffreur: 'Chiffreur',
  lecteur: 'Lecteur',
}

const NONE = '__none__'

type OrgChoice = Pick<Organization, 'id' | 'name'>

export function ProfileForm({
  orgSlug,
  initialFullName,
  initialJobRole,
  initialDefaultOrgId,
  orgs,
}: {
  orgSlug: string
  initialFullName: string
  initialJobRole: JobRole | null
  initialDefaultOrgId: string | null
  orgs: OrgChoice[]
}) {
  const [fullName, setFullName] = useState(initialFullName)
  const [jobRole, setJobRole] = useState<string>(initialJobRole ?? NONE)
  const [defaultOrg, setDefaultOrg] = useState<string>(initialDefaultOrgId ?? NONE)
  const [pending, startTransition] = useTransition()

  const dirty =
    fullName.trim() !== initialFullName.trim() ||
    jobRole !== (initialJobRole ?? NONE) ||
    defaultOrg !== (initialDefaultOrgId ?? NONE)

  function submit() {
    const fd = new FormData()
    fd.set('fullName', fullName)
    fd.set('jobRole', jobRole === NONE ? '' : jobRole)
    fd.set('defaultOrganizationId', defaultOrg === NONE ? '' : defaultOrg)
    startTransition(async () => {
      const res = await updateMyProfile(orgSlug, undefined, fd)
      if (res?.error) toast.error(res.error)
      else if (res?.fieldErrors) {
        toast.error(Object.values(res.fieldErrors)[0]?.[0] ?? 'Champ invalide')
      } else toast.success('Profil enregistré')
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="fullName">Nom affiché</Label>
        <Input
          id="fullName"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Prénom Nom"
          maxLength={120}
        />
        <p className="text-xs text-muted-foreground">
          Utilisé dans les membres, les tâches assignées et les documents générés.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="jobRole">Fonction dans l’entreprise</Label>
        <Select value={jobRole} onValueChange={(v) => v && setJobRole(v)}>
          <SelectTrigger id="jobRole">
            <SelectValue placeholder="Choisir…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>— Non renseignée —</SelectItem>
            {(Object.keys(JOB_ROLE_LABELS) as JobRole[]).map((r) => (
              <SelectItem key={r} value={r}>
                {JOB_ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Sert à qualifier les pièces produites (ex. signataire dirigeant sur
          DC1/mémoire).
        </p>
      </div>

      {orgs.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="defaultOrg">Organisation par défaut</Label>
          <Select value={defaultOrg} onValueChange={(v) => v && setDefaultOrg(v)}>
            <SelectTrigger id="defaultOrg">
              <SelectValue placeholder="Première organisation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— Première de la liste —</SelectItem>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Ouverte automatiquement à la connexion.
          </p>
        </div>
      )}

      <Button onClick={submit} disabled={pending || !dirty || fullName.trim().length < 2}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        Enregistrer
      </Button>
    </div>
  )
}

export function OrgNameForm({
  orgSlug,
  initialName,
}: {
  orgSlug: string
  initialName: string
}) {
  const [name, setName] = useState(initialName)
  const [pending, startTransition] = useTransition()
  const dirty = name.trim() !== initialName.trim()

  function submit() {
    const fd = new FormData()
    fd.set('name', name)
    startTransition(async () => {
      const res = await updateOrganizationName(orgSlug, undefined, fd)
      if (res?.error) toast.error(res.error)
      else toast.success('Organisation renommée')
    })
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="orgName">Nom de l’organisation</Label>
        <Input
          id="orgName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
      </div>
      <Button
        variant="outline"
        onClick={submit}
        disabled={pending || !dirty || name.trim().length < 2}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        Renommer
      </Button>
    </div>
  )
}
