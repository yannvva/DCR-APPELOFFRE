'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FolderPlus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { uploadDocument } from '@/app/actions/documents'

export function DocumentUpload({ orgSlug, folder }: { orgSlug: string; folder: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [newFolder, setNewFolder] = useState('')

  function pick() {
    if (newFolder.trim()) {
      router.push(
        `/${orgSlug}/documents?folder=${encodeURIComponent(
          '/' + newFolder.trim().replace(/^\/+|\/+$/g, ''),
        )}`,
      )
      return
    }
    inputRef.current?.click()
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
        onKeyDown={(e) => e.key === 'Enter' && pick()}
        placeholder="dossier/nouveau…"
        className="h-8 w-36 rounded-md border border-input bg-transparent px-2 text-xs placeholder:text-muted-foreground"
        aria-label="Nom du nouveau dossier"
      />
      <Button variant="outline" size="sm" onClick={pick} disabled={pending}>
        {newFolder.trim() ? (
          <>
            <FolderPlus className="size-4" /> Créer le dossier
          </>
        ) : (
          <>
            <Upload className="size-4" /> Envoyer
          </>
        )}
      </Button>
    </div>
  )
}
