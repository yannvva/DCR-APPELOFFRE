'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { deleteDocument } from '@/app/actions/documents'

/**
 * Suppression d'un document — irréversible (fichier retiré du storage) donc
 * systématiquement confirmée, avec rappel du nombre d'éléments liés.
 */
export function DeleteDocumentButton({
  orgSlug,
  docId,
  docName,
  usageCount = 0,
}: {
  orgSlug: string
  docId: string
  docName: string
  /** Nombre d'entités liées (AO, comptes…) — mentionné dans la confirmation. */
  usageCount?: number
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        aria-label={`Supprimer ${docName}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {docName} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le fichier sera définitivement supprimé
              {usageCount > 0 &&
                ` et retiré de ${usageCount} élément${usageCount > 1 ? 's' : ''} lié${usageCount > 1 ? 's' : ''} (AO, compte, projet…)`}
              .
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteDocument(orgSlug, docId)
                  if (res?.error) toast.error(res.error)
                  else {
                    toast.success('Document supprimé')
                    setOpen(false)
                  }
                })
              }
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
