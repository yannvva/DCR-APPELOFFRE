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
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          const fd = new FormData()
          fd.set('file', file)
          fd.set('folder', folder)
          startTransition(async () => {
            const res = await uploadDocument(orgSlug, fd)
            if (res?.error) toast.error(res.error)
            else toast.success(`${file.name} envoyé`)
          })
          e.target.value = ''
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
