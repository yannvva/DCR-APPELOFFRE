'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Download, Loader2, KeyRound, Mail, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  changeEmail,
  changePassword,
  deleteOrganization,
  exportOrganizationData,
} from '@/app/actions/settings'

/** Mot de passe + email du compte connecté. */
export function SecurityForm({
  orgSlug,
  currentEmail,
}: {
  orgSlug: string
  currentEmail: string
}) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, startTransition] = useTransition()

  const [newEmail, setNewEmail] = useState('')
  const [emailPending, startEmail] = useTransition()

  function submitPassword() {
    const fd = new FormData()
    fd.set('current', current)
    fd.set('password', password)
    fd.set('confirm', confirm)
    startTransition(async () => {
      const res = await changePassword(orgSlug, undefined, fd)
      const fieldError = res?.fieldErrors && Object.values(res.fieldErrors)[0]?.[0]
      if (res?.error) toast.error(res.error)
      else if (fieldError) toast.error(fieldError)
      else {
        toast.success('Mot de passe mis à jour')
        setCurrent('')
        setPassword('')
        setConfirm('')
      }
    })
  }

  function submitEmail() {
    const fd = new FormData()
    fd.set('email', newEmail)
    startEmail(async () => {
      const res = await changeEmail(orgSlug, undefined, fd)
      const fieldError = res?.fieldErrors && Object.values(res.fieldErrors)[0]?.[0]
      if (res?.error) toast.error(res.error)
      else if (fieldError) toast.error(fieldError)
      else {
        toast.success('Confirmation envoyée à la nouvelle adresse')
        setNewEmail('')
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4 text-muted-foreground" /> Mot de passe
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="current">Actuel</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">Nouveau</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirmation</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        <Button
          variant="outline"
          onClick={submitPassword}
          disabled={pending || !current || password.length < 8 || password !== confirm}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Mettre à jour le mot de passe
        </Button>
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Mail className="size-4 text-muted-foreground" /> Adresse email
        </p>
        <p className="text-xs text-muted-foreground">
          Actuelle : <span className="font-medium text-foreground">{currentEmail}</span> — un
          lien de confirmation sera envoyé à la nouvelle adresse.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-72">
            <Label htmlFor="newEmail">Nouvelle adresse</Label>
            <Input
              id="newEmail"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            onClick={submitEmail}
            disabled={emailPending || !newEmail.includes('@') || newEmail === currentEmail}
          >
            {emailPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Changer l’adresse
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Export RGPD + suppression définitive de l'organisation. */
export function DangerZone({
  orgSlug,
  orgName,
  isOwner,
}: {
  orgSlug: string
  orgName: string
  isOwner: boolean
}) {
  const [exporting, startExport] = useTransition()
  const [open, setOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [deleting, startDelete] = useTransition()

  function exportData() {
    startExport(async () => {
      const res = await exportOrganizationData(orgSlug)
      if (res.error || !res.json) {
        toast.error(res.error ?? 'Export impossible')
        return
      }
      const blob = new Blob([res.json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nexus-export-${orgSlug}-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      if (res.warning) toast.warning(res.warning)
      else toast.success('Export téléchargé')
    })
  }

  function submitDelete() {
    const fd = new FormData()
    fd.set('confirmName', confirmName)
    startDelete(async () => {
      const res = await deleteOrganization(orgSlug, undefined, fd)
      const fieldError = res?.fieldErrors && Object.values(res.fieldErrors)[0]?.[0]
      if (res?.error) toast.error(res.error)
      else if (fieldError) toast.error(fieldError)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Exporter les données</p>
          <p className="text-xs text-muted-foreground">
            Dump JSON complet de l’organisation (RGPD / portabilité).
          </p>
        </div>
        <Button variant="outline" onClick={exportData} disabled={exporting}>
          {exporting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Exporter (JSON)
        </Button>
      </div>

      {isOwner && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-destructive">
              Supprimer l’organisation
            </p>
            <p className="text-xs text-muted-foreground">
              Action irréversible — toutes les données (AO, documents, projets) sont
              définitivement effacées.
            </p>
          </div>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <Trash2 className="size-4" /> Supprimer
          </Button>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer « {orgName} » ?</DialogTitle>
            <DialogDescription>
              Cette action est définitive et supprime l’ensemble des données de
              l’organisation. Saisissez le nom exact pour confirmer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={orgName}
              aria-label="Nom de l’organisation à confirmer"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={submitDelete}
                disabled={deleting || confirmName.trim() !== orgName}
              >
                {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
                Supprimer définitivement
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
