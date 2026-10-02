'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Copy, UserPlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  inviteMember,
  updateMemberRole,
  removeMember,
  revokeInvitation,
} from '@/app/actions/organization'
import type { MembershipRole, OrganizationInvitation, OrganizationMember } from '@/lib/types'

const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
  viewer: 'Observateur',
}

export function MembersClient({
  orgSlug,
  canManage,
  currentUserId,
  members,
  invitations,
}: {
  orgSlug: string
  canManage: boolean
  currentUserId: string
  members: OrganizationMember[]
  invitations: OrganizationInvitation[]
}) {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Membres</h1>
          <p className="text-sm text-muted-foreground">
            {members.length} membre{members.length > 1 ? 's' : ''}
          </p>
        </div>
        {canManage && <InviteDialog orgSlug={orgSlug} />}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Membre</TableHead>
            <TableHead>Rôle</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <MemberRow
              key={m.user_id}
              member={m}
              orgSlug={orgSlug}
              canManage={canManage}
              isSelf={m.user_id === currentUserId}
            />
          ))}
        </TableBody>
      </Table>

      {invitations.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-medium">Invitations en attente</h2>
          <Table>
            <TableBody>
              {invitations.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{inv.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROLE_LABELS[inv.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const res = await revokeInvitation(orgSlug, inv.id)
                        if (res?.error) toast.error(res.error)
                        else toast.success('Invitation révoquée')
                      }}
                    >
                      Révoquer
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function MemberRow({
  member,
  orgSlug,
  canManage,
  isSelf,
}: {
  member: OrganizationMember
  orgSlug: string
  canManage: boolean
  isSelf: boolean
}) {
  const name = member.profile?.full_name || member.user_id.slice(0, 8)
  const canEditRole = canManage && !isSelf && member.role !== 'owner'
  // Contrôlé + resync : si la mise à jour échoue côté serveur, le Select
  // revient au rôle réel au lieu d'afficher un rôle non appliqué.
  const [role, setRole] = useState(member.role)
  const [prevRole, setPrevRole] = useState(member.role)
  if (member.role !== prevRole) {
    setPrevRole(member.role)
    setRole(member.role)
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">
              {name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium">
            {name}
            {isSelf && <span className="text-muted-foreground"> (vous)</span>}
          </span>
        </div>
      </TableCell>
      <TableCell>
        {canEditRole ? (
          <Select
            value={role}
            onValueChange={async (next) => {
              if (!next || next === role) return
              setRole(next as MembershipRole)
              const fd = new FormData()
              fd.set('userId', member.user_id)
              fd.set('role', next)
              const res = await updateMemberRole(orgSlug, undefined, fd)
              if (res?.error) {
                setRole(member.role)
                toast.error(res.error)
              } else toast.success('Rôle mis à jour')
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['admin', 'member', 'viewer'] as const).map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        {(canManage || isSelf) && member.role !== 'owner' && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="ghost" size="icon" aria-label="Retirer">
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {isSelf ? 'Quitter l’organisation ?' : 'Retirer ce membre ?'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Cette action est immédiate et tracée dans le journal d’audit.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    const res = await removeMember(orgSlug, member.user_id)
                    if (res?.error) toast.error(res.error)
                    else toast.success('Membre retiré')
                  }}
                >
                  Confirmer
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </TableCell>
    </TableRow>
  )
}

function InviteDialog({ orgSlug }: { orgSlug: string }) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState('member')
  const action = inviteMember.bind(null, orgSlug)
  const [state, formAction, pending] = useActionState(action, undefined)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset()
    }
  }, [state])

  const inviteLink = state?.inviteUrl
    ? `${window.location.origin}${state.inviteUrl}`
    : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <UserPlus className="size-4" /> Inviter
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inviter un membre</DialogTitle>
          <DialogDescription>
            Un lien d’invitation sera généré — transmettez-le à la personne.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
            {state?.fieldErrors?.email && (
              <p className="text-sm text-destructive">{state.fieldErrors.email[0]}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">Rôle</Label>
            <input type="hidden" name="role" value={role} />
            <Select value={role} onValueChange={(v) => v && setRole(v)}>
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Membre</SelectItem>
                <SelectItem value="viewer">Observateur</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Création…' : 'Générer le lien'}
          </Button>
        </form>

        {inviteLink && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted p-2">
            <code className="flex-1 truncate text-xs">{inviteLink}</code>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copier le lien d'invitation"
              title="Copier le lien"
              onClick={() => {
                void navigator.clipboard.writeText(inviteLink)
                toast.success('Lien copié')
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
