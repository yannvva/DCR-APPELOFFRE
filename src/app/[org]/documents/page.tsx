import { notFound } from 'next/navigation'
import { requireMembership } from '@/lib/dal/auth'
import { listDocuments, listFolders } from '@/lib/dal/documents'
import { SearchInput, Pagination } from '@/components/list-toolbar'
import { DocumentUpload } from '@/components/documents/document-upload'
import { DocumentRow } from '@/components/documents/document-row'
import { Folder } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export default async function DocumentsPage({
  params,
  searchParams,
}: PageProps<'/[org]/documents'>) {
  const { org: orgSlug } = await params
  const sp = await searchParams
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const q = typeof sp.q === 'string' ? sp.q : ''
  const folder = typeof sp.folder === 'string' ? sp.folder : '/'
  const page = Math.max(1, Number(sp.page ?? 1) || 1)
  const [{ rows, count, pageSize }, folders] = await Promise.all([
    listDocuments(ctx, { q, page, folder: q ? undefined : folder }),
    listFolders(ctx),
  ])
  const canEdit = ctx.role !== 'viewer'

  return (
    <div className="flex h-full">
      <aside className="w-52 shrink-0 border-r border-border p-4">
        <p className="mb-2 px-2 text-xs font-semibold uppercase text-muted-foreground">Dossiers</p>
        <nav className="space-y-0.5">
          {folders.map((f) => (
            <Link
              key={f}
              href={`/${orgSlug}/documents?folder=${encodeURIComponent(f)}`}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                f === folder && !q
                  ? 'bg-accent font-medium'
                  : 'text-muted-foreground hover:bg-accent/60',
              )}
            >
              <Folder className="size-3.5" />
              <span className="truncate">{f === '/' ? 'Racine' : f}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Documents</h1>
            <p className="text-sm text-muted-foreground">
              Fichiers privés de l’organisation — accès par liens signés
            </p>
          </div>
          {canEdit && <DocumentUpload orgSlug={orgSlug} folder={folder} />}
        </div>

        <SearchInput placeholder="Rechercher un fichier…" />

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center">
            <p className="font-medium">Aucun document</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {q ? 'Aucun résultat.' : 'Envoyez votre premier fichier (25 Mo max).'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((doc) => (
              <DocumentRow key={doc.id} orgSlug={orgSlug} doc={doc} canEdit={canEdit} />
            ))}
          </ul>
        )}
        <Pagination count={count} page={page} pageSize={pageSize} />
      </div>
    </div>
  )
}
