'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { FolderDown, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { exportFolderZip } from '@/app/actions/documents'

/** Télécharge le dossier courant (sous-dossiers inclus) en une archive ZIP.
 *  Le serveur assemble le ZIP et renvoie un lien signé à déclencher. */
export function FolderDownload({
  orgSlug,
  folder,
  label,
  iconOnly = false,
}: {
  orgSlug: string
  folder: string
  label: string
  /** Version icône seule (cartes de sous-dossiers). */
  iconOnly?: boolean
}) {
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const res = await exportFolderZip(orgSlug, folder)
      if ('error' in res && res.error) {
        toast.error(res.error)
        return
      }
      if (!('url' in res) || !res.url) {
        toast.error('Impossible de générer l’archive.')
        return
      }
      // Lien signé avec Content-Disposition: attachment — le navigateur
      // télécharge sans quitter la page.
      const a = document.createElement('a')
      a.href = res.url
      a.download = ''
      document.body.appendChild(a)
      a.click()
      a.remove()
      toast.success(
        res.missing
          ? `Archive prête : ${res.count - res.missing} fichier(s), ${res.missing} absent(s) du stockage.`
          : `Archive prête : ${res.count} fichier(s).`,
      )
    } catch {
      toast.error('Échec de la création de l’archive.')
    } finally {
      setBusy(false)
    }
  }

  return iconOnly ? (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={download}
      disabled={busy}
      aria-label={`Télécharger « ${label} » en ZIP`}
      title={`Télécharger « ${label} » et ses sous-dossiers en ZIP`}
    >
      {busy ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : (
        <FolderDown className="size-4" />
      )}
    </Button>
  ) : (
    <Button
      variant="outline"
      onClick={download}
      disabled={busy}
      title={`Télécharger « ${label} » et ses sous-dossiers en ZIP`}
    >
      {busy ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : (
        <FolderDown className="size-4" />
      )}
      {busy ? 'Préparation…' : 'Télécharger le dossier'}
    </Button>
  )
}
