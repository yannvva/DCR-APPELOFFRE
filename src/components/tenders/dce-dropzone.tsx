'use client'

import { useRef, useState } from 'react'
import { unzipSync } from 'fflate'
import { toast } from 'sonner'
import { FileWarning, FolderInput, Loader2, UploadCloud } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  ActionProgress,
  type ProgressItem,
} from '@/components/ui/action-progress'
import {
  importDcePackage,
  importStoredFile,
  type DceImportResult,
} from '@/app/actions/dce'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const ACCEPT = '.pdf,.zip,.rar,.docx,.txt,.md,.csv,.xlsx,.xlsm'
/** Garde-fou client : un fichier qui ne répond pas n'immobilise plus l'import. */
const FILE_TIMEOUT_MS = 150_000
/**
 * Au-delà de cette taille, le fichier part directement dans le storage
 * (org_/incoming/) puis le serveur le traite par téléchargement — la requête
 * de Server Action ne transporte que le chemin, jamais le contenu : plus de
 * limite de corps, plus de requête qui mouline sur un gros DCE.
 */
const DIRECT_UPLOAD_BYTES = 8 * 1024 * 1024
const IGNORED = /^(desktop\.ini|thumbs\.db|\.ds_store)$/i
const MAX_DEPTH = 6

interface PickedFile {
  file: File
  /** Chemin relatif — « LOT 3/DPGF.xlsx » porte le contexte du lot. */
  path: string
}

function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

/**
 * Traverse les dossiers déposés : `dataTransfer.files` ne contient PAS les
 * fichiers d'un dossier glissé (entrée vide → « aucune pièce importée ») —
 * il faut passer par webkitGetAsEntry + readEntries (paginé par lots).
 */
async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: PickedFile[],
  depth: number,
): Promise<void> {
  if (entry.isFile) {
    if (IGNORED.test(entry.name)) return
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    )
    out.push({ file, path: prefix + entry.name })
    return
  }
  if (entry.isDirectory && depth < MAX_DEPTH) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      )
      if (!batch.length) break
      for (const e of batch) {
        await walkEntry(e, `${prefix}${entry.name}/`, out, depth + 1)
      }
    }
  }
}

async function collectDropped(dt: DataTransfer): Promise<PickedFile[]> {
  const entries = Array.from(dt.items ?? [])
    .map((it) =>
      typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null,
    )
    .filter((e): e is FileSystemEntry => !!e)
  if (!entries.length) {
    return Array.from(dt.files)
      .filter((f) => !IGNORED.test(f.name))
      .map((file) => ({ file, path: file.name }))
  }
  const out: PickedFile[] = []
  for (const e of entries) await walkEntry(e, '', out, 0)
  return out
}

const MAX_ZIP_ENTRIES = 60

// Module + WASM mis en cache : chargés une fois si plusieurs archives.
let unrarCtx: Promise<
  [typeof import('node-unrar-js'), ArrayBuffer]
> | null = null

function loadUnrar() {
  unrarCtx ??= Promise.all([
    import('node-unrar-js'),
    fetch('/wasm/unrar.wasm').then((r) => {
      if (!r.ok) throw new Error(`unrar.wasm ${r.status}`)
      return r.arrayBuffer()
    }),
  ])
  return unrarCtx
}

/** Déplie un RAR dans le navigateur (WASM, 200 Ko) — le fichier ne part pas
 *  au serveur, chaque pièce interne suit le flux de progression normal. */
async function expandRar(
  p: PickedFile,
): Promise<{ items: PickedFile[]; dropped: number } | null> {
  try {
    const [{ createExtractorFromData }, wasmBinary] = await loadUnrar()
    const data = await p.file.arrayBuffer()
    const extractor = await createExtractorFromData({ wasmBinary, data })
    const headers = [...extractor.getFileList().fileHeaders].filter(
      (h) => !h.flags.directory,
    )
    const { files } = extractor.extract({
      files: headers.slice(0, MAX_ZIP_ENTRIES).map((h) => h.name),
    })
    const out: PickedFile[] = []
    for (const f of files) {
      const path = f.fileHeader.name
      out.push({
        file: new File(
          [new Uint8Array(f.extraction ?? new Uint8Array())],
          path.split('/').pop() ?? path,
        ),
        path,
      })
    }
    return { items: out, dropped: Math.max(0, headers.length - out.length) }
  } catch (e) {
    // Visible en console pour diagnostiquer — le serveur retentera en secours.
    console.warn(`Dépliage local du RAR impossible (${p.path}) :`, e)
    return null
  }
}

/**
 * Déplie les archives côté client : un DCE de 100 Mo+ ne traverse plus le
 * réseau — chaque pièce interne part dans sa propre requête (suivi réel).
 * ZIP → fflate, RAR → node-unrar-js (WASM servi depuis /wasm/unrar.wasm).
 * Si le dépliage local échoue, le fichier part entier au serveur en secours.
 */
async function expandArchives(
  list: PickedFile[],
): Promise<{ items: PickedFile[]; warnings: { name: string; reason: string }[] }> {
  const out: PickedFile[] = []
  const warnings: { name: string; reason: string }[] = []
  for (const p of list) {
    if (/\.rar$/i.test(p.path)) {
      const expanded = await expandRar(p)
      if (!expanded || !expanded.items.length) {
        // Vide ou illisible → on envoie le fichier entier : le serveur
        // retente et produit le motif exact (« RAR illisible… »).
        out.push(p)
        continue
      }
      out.push(...expanded.items)
      if (expanded.dropped > 0) {
        warnings.push({
          name: p.path,
          reason: `archive tronquée — ${expanded.dropped} entrée(s) ignorée(s), renvoyez-les séparément`,
        })
      }
      continue
    }
    if (!/\.zip$/i.test(p.path)) {
      out.push(p)
      continue
    }
    try {
      const entries = unzipSync(new Uint8Array(await p.file.arrayBuffer()))
      const names = Object.keys(entries)
        .filter((n) => !n.endsWith('/'))
        .filter((n) => !IGNORED.test(n.split('/').pop() ?? n))
      for (const n of names.slice(0, MAX_ZIP_ENTRIES)) {
        out.push({
          file: new File([entries[n] as BlobPart], n.split('/').pop() ?? n),
          path: n,
        })
      }
      if (names.length > MAX_ZIP_ENTRIES) {
        warnings.push({
          name: p.path,
          reason: `archive tronquée — ${names.length - MAX_ZIP_ENTRIES} entrée(s) ignorée(s), renvoyez-les séparément`,
        })
      }
    } catch {
      out.push(p) // illisible — le serveur renverra « ZIP illisible »
    }
  }
  return { items: out, warnings }
}

/**
 * Zone de dépôt du DCE complet : ZIP ou sélection de fichiers.
 * Chaque pièce est classée et rangée dans DCE/<type> (RC, CCTP, …).
 * L'import est orchestré fichier par fichier côté client pour rendre la
 * progression visible (quelle pièce est en cours, ce qui a réussi/échoué).
 */
export function DceDropzone({
  orgSlug,
  orgId,
  tenderId,
  canEdit,
}: {
  orgSlug: string
  orgId: string
  tenderId: string
  canEdit: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [running, setRunning] = useState(false)
  const [items, setItems] = useState<ProgressItem[]>([])
  const [result, setResult] = useState<DceImportResult | null>(null)

  if (!canEdit) return null

  function patchItem(i: number, p: Partial<ProgressItem>) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...p } : it)))
  }

  async function importPicked(
    list: PickedFile[],
    warnings: { name: string; reason: string }[] = [],
  ) {
    if (running || (!list.length && !warnings.length)) return

    setResult(null)
    setItems(
      list.map((p) => ({
        name: p.path,
        status: 'queued',
        detail: fmtSize(p.file.size),
      })),
    )
    setRunning(true)

    const agg: DceImportResult = { imported: [], skipped: [...warnings] }

    /** Fichier lourd → upload direct dans le storage puis traitement
     *  serveur : le corps de la Server Action reste minuscule (le chemin). */
    async function importOne(p: PickedFile) {
      if (p.file.size > DIRECT_UPLOAD_BYTES) {
        const supabase = createClient()
        const tmpPath = `org_${orgId}/incoming/${crypto.randomUUID()}`
        // Fichier temporaire supprimé après traitement : contentType 'zip'
        // déclaré pour rester dans la whitelist du bucket tant que la
        // migration 0011 (types libres) n'est pas poussée.
        const { error: upErr } = await supabase.storage
          .from('documents')
          .upload(tmpPath, p.file, { contentType: 'application/zip' })
        if (upErr) throw new Error(`envoi : ${upErr.message}`)
        return importStoredFile(orgSlug, tenderId, tmpPath, p.path)
      }
      const fd = new FormData()
      fd.append('files', p.file)
      // Le chemin relatif voyage à côté : le serveur l'utilise comme nom de
      // pièce → classification et détection de lot voient « LOT 3/… ».
      fd.append('paths', p.path)
      return importDcePackage(orgSlug, tenderId, fd)
    }

    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      const isArchive = /\.(zip|rar)$/i.test(p.path)
      patchItem(i, {
        status: 'active',
        detail:
          p.file.size > DIRECT_UPLOAD_BYTES
            ? 'envoi direct → traitement serveur…'
            : isArchive
              ? 'envoi, dépliage et classement…'
              : 'envoi et classement…',
      })
      try {
        const res = await Promise.race([
          importOne(p),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('timeout')),
              FILE_TIMEOUT_MS,
            ),
          ),
        ])
        const d = res.data
        if (d) {
          agg.imported.push(...d.imported)
          agg.skipped.push(...d.skipped)
        }
        if (d && d.imported.length) {
          patchItem(i, {
            status: 'done',
            detail:
              d.imported.length === 1
                ? `→ ${d.imported[0].folder}`
                : `${d.imported.length} pièces rangées`,
          })
        } else {
          patchItem(i, {
            status: 'error',
            detail:
              d?.skipped[0]?.reason ?? res.error ?? 'aucune pièce importée',
          })
        }
      } catch (e) {
        // Timeout ou rejet réseau/serveur (corps trop volumineux, coupure…) :
        // l'erreur reste visible sur la ligne au lieu d'un spinner infini.
        console.error(`Import impossible (${p.path}) :`, e)
        patchItem(i, {
          status: 'error',
          detail:
            e instanceof Error && e.message && e.message !== 'timeout'
              ? e.message.slice(0, 120)
              : 'échec ou délai dépassé — réessayez ce fichier',
        })
        agg.skipped.push({
          name: p.path,
          reason: 'échec de l’import (délai dépassé ou erreur serveur)',
        })
      }
    }

    setResult(agg)
    setRunning(false)
    const n = agg.imported.length
    if (n) {
      toast.success(`${n} pièce${n > 1 ? 's' : ''} rangée${n > 1 ? 's' : ''} dans le DCE`)
    } else {
      toast.error('Aucune pièce importée — voir le détail ci-dessous.')
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={running}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void collectDropped(e.dataTransfer)
            .then(expandArchives)
            .then(({ items, warnings }) => {
              if (!items.length && !warnings.length) {
                toast.error('Aucun fichier lisible dans la sélection déposée.')
                return
              }
              return importPicked(items, warnings)
            })
            .catch((err) => {
              console.error('Lecture de la sélection impossible :', err)
              toast.error(
                'Impossible de lire la sélection — réessayez ou choisissez les fichiers.',
              )
            })
        }}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-muted/50',
          running && 'opacity-60',
        )}
      >
        {running ? (
          <Loader2 className="size-8 animate-spin text-primary" />
        ) : (
          <UploadCloud className="size-8 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">
          {running
            ? 'Import et rangement en cours…'
            : 'Glissez le DCE complet ici (dossier, ZIP, RAR ou fichiers)'}
        </span>
        <span className="text-xs text-muted-foreground">
          ou cliquez pour choisir — PDF, ZIP, RAR, DOCX, XLSX, TXT. Chaque pièce est classée
          et rangée automatiquement (RC, CCTP, CCAP, AE, BPU, annexes…).
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            void expandArchives(
              Array.from(e.target.files).map((file) => ({
                file,
                path: file.name,
              })),
            )
              .then(({ items, warnings }) => {
                if (!items.length && !warnings.length) {
                  toast.error('Aucun fichier lisible dans la sélection.')
                  return
                }
                return importPicked(items, warnings)
              })
              .catch((err) => {
                console.error('Lecture de la sélection impossible :', err)
                toast.error('Impossible de lire la sélection — réessayez.')
              })
          }
          e.target.value = ''
        }}
      />

      {(running || items.length > 0) && (
        <ActionProgress
          title={
            running
              ? `Import en cours — ${items.filter((i) => i.status === 'done' || i.status === 'error').length}/${items.length} fichier${items.length > 1 ? 's' : ''} traité${items.length > 1 ? 's' : ''}`
              : `Import terminé — ${items.filter((i) => i.status === 'done').length} fichier${items.length > 1 ? 's' : ''} rangé${items.length > 1 ? 's' : ''}`
          }
          steps={[
            'Envoi (direct au storage si > 8 Mo)',
            'Dépliage archive (ZIP/RAR)',
            'Classification nom + contenu',
            'Rangement DCE/<type> + lien au dossier',
          ]}
          items={items}
        />
      )}

      {result && result.imported.length > 0 && (
        <div className="rounded-lg border border-border px-4 py-3">
          <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FolderInput className="size-3.5" /> Dossier rangé :
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {result.imported.map((f) => (
              <li key={f.name}>
                <Badge variant="secondary" className="max-w-80 gap-1 font-normal">
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-muted-foreground">→ {f.folder}</span>
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && result.skipped.length > 0 && (
        <ul className="space-y-1">
          {result.skipped.map((s, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400"
            >
              <FileWarning className="size-3.5" /> {s.name} — {s.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
