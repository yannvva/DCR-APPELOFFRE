'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FolderPlus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { uploadDocument } from '@/app/actions/documents'
import { isRootFolder } from '@/lib/folder-tree'

export function DocumentUpload({ orgSlug, folder }: { orgSlug: string; folder: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [newFolder, setNewFolder] = useState('')

  const atRoot = isRootFolder(folder)

  function createFolder() {
    const name = newFolder.trim().replace(/^\/+|\/+$/g, '')
    if (!name) return
    // Toujours RELATIF au dossier courant : jamais de dossier direct à la
    // racine (les seules racines sont Société et les dossiers d'AO).
    const path = `${folder === '/' ? '' : folder + '/'}${name}`
    router.push(`/${orgSlug}/documents?folder=${encodeURIComponent(path)}`)
    setNewFolder('')
  }

  // À la racine : pas d'envoi ni de création — on guide vers un dossier.
  if (atRoot) {
    return (
      <p className="max-w-xs text-right text-xs text-muted-foreground">
        Ouvrez un dossier (Société ou un appel d’offres) pour envoyer un fichier.
      </p>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (!files.length) return
          // Envoi séquentiel : évite de saturer la connexion et permet un
          // bilan par fichier (refus de type, taille > 25 Mo…).
          startTransition(async () => {
            let ok = 0
            const failed: string[] = []
            for (const file of files) {
              const fd = new FormData()
              fd.set('file', file)
              fd.set('folder', folder)
              const res = await uploadDocument(orgSlug, fd)
              if (res?.error) failed.push(file.name)
              else ok++
            }
            if (ok) toast.success(`${ok} fichier${ok > 1 ? 's' : ''} envoyé${ok > 1 ? 's' : ''}`)
            if (failed.length) {
              toast.error(
                failed.length === 1
                  ? `${failed[0]} refusé`
                  : `${failed.length} fichiers refusés : ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`,
              )
            }
          })
        }}
      />
      <input
        value={newFolder}
        onChange={(e) => setNewFolder(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && createFolder()}
        placeholder="sous-dossier…"
        className="h-8 w-36 rounded-md border border-input bg-transparent px-2 text-xs placeholder:text-muted-foreground"
        aria-label="Nom du sous-dossier"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={createFolder}
        disabled={pending || !newFolder.trim()}
      >
        <FolderPlus className="size-4" /> Sous-dossier
      </Button>
      <Button
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
      >
        <Upload className="size-4" /> Envoyer
      </Button>
    </div>
  )
}
