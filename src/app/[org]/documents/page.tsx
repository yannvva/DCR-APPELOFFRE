import { notFound } from 'next/navigation'
import { requireMembership } from '@/lib/dal/auth'
import {
  countDocumentUsage,
  listDocumentFacets,
  listDocuments,
  listFolders,
} from '@/lib/dal/documents'
import { listTenders } from '@/lib/dal/tenders'
import { tenderFolderName } from '@/lib/doc-folders'
import { docTypeLabel } from '@/lib/doc-labels'
import { SearchInput, Pagination } from '@/components/list-toolbar'
import { Button } from '@/components/ui/button'
import { DocumentUpload } from '@/components/documents/document-upload'
import { FolderDownload } from '@/components/documents/folder-download'
import { DocumentFilters } from '@/components/documents/document-filters'
import { DocumentsList } from '@/components/documents/documents-list'
import { FolderTree } from '@/components/documents/folder-tree'
import {
  buildFolderTree,
  flattenFolders,
  folderSegments,
  normalizeFolderPath,
  parentFolder,
  SOCIETE_FOLDER,
} from '@/lib/folder-tree'
import { Folder, ChevronRight, Home, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
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
  const rawFolder = typeof sp.folder === 'string' ? sp.folder : '/'
  // ?subtree=1 : liste le dossier courant ET ses descendants — la vue par
  // défaut n'affiche que les fichiers rangés directement dans le dossier.
  const subtreeView = sp.subtree === '1'
  const ext = typeof sp.ext === 'string' ? sp.ext : ''
  const dtype = typeof sp.type === 'string' ? sp.type : ''
  const sort = sp.sort === 'name' || sp.sort === 'size' ? sp.sort : 'recent'
  const page = Math.max(1, Number(sp.page ?? 1) || 1)
  const requested = normalizeFolderPath(rawFolder)
  // L'arbre des dossiers d'abord : la validation du chemin demandé en dépend
  // (un dossier n'est accepté que s'il est peuplé ou descend d'un dossier
  // peuplé — sinon la liste interrogerait un chemin sans rapport avec le
  // fil d'Ariane affiché).
  const folderRows = await listFolders(ctx)

  // Arborescence reconstruite à partir des dossiers réellement peuplés.
  const tree = buildFolderTree(folderRows)
  const all = flattenFolders(tree)
  const known = new Set(all.map((n) => n.path))
  // Dossier accepté s'il est peuplé OU s'il descend d'un dossier peuplé —
  // un sous-dossier fraîchement créé (bouton « Sous-dossier ») est vide et
  // n'existe pas encore dans l'arbre : sans ça on rebondissait à la racine.
  // Les nouvelles RACINES restent refusées (convention : Société + AO).
  let folderOk = known.has(requested)
  for (let p = parentFolder(requested); !folderOk && p; p = parentFolder(p)) {
    if (known.has(p)) folderOk = true
    if (p === '/') break
  }
  const folder = requested === '/' || folderOk ? requested : '/'

  const [{ rows, count, pageSize }, tenders, facets] = await Promise.all([
    // Sans recherche ni vue sous-arbre : dossier exact. Avec l'un des deux :
    // sous-arbre du dossier courant (racine = toute l'organisation).
    listDocuments(ctx, {
      q,
      page,
      folder:
        folder === '/' ? (q || subtreeView ? undefined : '/') : folder,
      subtree: (subtreeView || !!q) && folder !== '/',
      ext,
      dtype,
      sort,
    }),
    listTenders(ctx, { pageSize: 200 }),
    listDocumentFacets(ctx, folder, subtreeView || !!q),
  ])
  const usage = await countDocumentUsage(ctx, rows.map((d) => d.id))
  const canEdit = ctx.role !== 'viewer'

  const node = all.find((n) => n.path === folder)
  const subfolders = folder === '/' ? tree : (node?.children ?? [])
  const rootCount = folderRows.find((r) => r.path === '/')?.count ?? 0
  const segments = folderSegments(folder)

  // Dossiers racine hors convention : ni « Société » ni le dossier d'un AO
  // existant. Cas typique : des pièces importées avant la mise en place du
  // rangement « AO <référence> — <titre>/… », qui restent visibles à la racine
  // alors qu'elles appartiennent à un dossier.
  const tenderRoots = new Set(tenders.rows.map((t) => tenderFolderName(t)))
  const unfiledRoots = new Set(
    tree
      .filter((n) => n.name !== SOCIETE_FOLDER && !tenderRoots.has(n.name))
      .map((n) => n.path),
  )
  const unfiledHere = unfiledRoots.has(folder)

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Mobile : l'arborescence se replie derrière un volet natif — la
          colonne fixe w-64 écrasait tout le contenu sur téléphone. */}
      <details className="border-b border-border px-3 py-2 md:hidden">
        <summary className="cursor-pointer text-xs font-semibold uppercase text-muted-foreground">
          Dossiers
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <FolderTree
            orgSlug={orgSlug}
            nodes={tree}
            current={folder}
            rootCount={rootCount}
            query={q}
            unfiled={[...unfiledRoots]}
          />
        </div>
      </details>
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-border p-3 md:block">
        <p className="mb-2 px-2 text-xs font-semibold uppercase text-muted-foreground">
          Dossiers
        </p>
        <FolderTree
          orgSlug={orgSlug}
          nodes={tree}
          current={folder}
          rootCount={rootCount}
          query={q}
          unfiled={[...unfiledRoots]}
        />
      </aside>

      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <Link
            href={`/${orgSlug}/documents`}
            className="flex items-center gap-1 hover:text-foreground"
          >
            <Home className="size-3" /> Racine
          </Link>
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="size-3" />
              <Link
                href={`/${orgSlug}/documents?folder=${encodeURIComponent(
                  segments.slice(0, i + 1).join('/'),
                )}`}
                className={cn(
                  'max-w-64 truncate hover:text-foreground',
                  i === segments.length - 1 && 'font-medium text-foreground',
                )}
                title={seg}
              >
                {seg}
              </Link>
            </span>
          ))}
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">
              {folder === '/' ? 'Documents' : segments[segments.length - 1]}
            </h1>
            <p className="text-sm text-muted-foreground">
              {folder === '/'
                ? 'Fichiers privés de l’organisation — accès par liens signés'
                : node?.total
                  ? `${node.count} fichier(s) ici · ${node.total} au total dans ce dossier`
                  : 'Fichiers privés — accès par liens signés'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canEdit && (
              <FolderDownload
                orgSlug={orgSlug}
                folder={folder}
                label={folder === '/' ? 'Tous les documents' : segments[segments.length - 1]}
              />
            )}
            {canEdit && <DocumentUpload orgSlug={orgSlug} folder={folder} />}
          </div>
        </div>

        {unfiledHere && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              Ce dossier n’est rattaché à aucun appel d’offres — les pièces
              qu’il contient ne sont pas rangées sous leur dossier. La
              convention est « Société » ou « AO &lt;référence&gt; — &lt;titre&gt; » :
              un DCE réimporté depuis l’onglet d’un dossier se range
              automatiquement dedans.
            </p>
          </div>
        )}

        {subfolders.length > 0 && (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {subfolders.map((f) => (
              <li
                key={f.path}
                className="flex items-center rounded-lg border border-border transition-colors hover:bg-accent/60"
              >
                <Link
                  href={`/${orgSlug}/documents?folder=${encodeURIComponent(f.path)}`}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5"
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium" title={f.path}>
                        {f.name}
                      </span>
                      {unfiledRoots.has(f.path) && (
                        <span
                          className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                          title="Dossier racine hors convention — non rattaché à un appel d’offres"
                        >
                          non rattaché
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {f.total} fichier{f.total > 1 ? 's' : ''}
                      {f.children.length > 0 && ` · ${f.children.length} sous-dossier(s)`}
                    </span>
                  </span>
                </Link>
                {canEdit && (
                  <span className="shrink-0 pr-1">
                    <FolderDownload
                      orgSlug={orgSlug}
                      folder={f.path}
                      label={f.name}
                      iconOnly
                    />
                  </span>
                )}
                <Link
                  href={`/${orgSlug}/documents?folder=${encodeURIComponent(f.path)}`}
                  aria-label={`Ouvrir ${f.name}`}
                  className="shrink-0 p-2 text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Suspense>
            <SearchInput
              placeholder={
                folder === '/'
                  ? 'Rechercher un fichier…'
                  : 'Rechercher dans ce dossier…'
              }
            />
            <DocumentFilters
              exts={facets.exts}
              types={facets.types.map((t) => ({
                value: t,
                label: docTypeLabel({ document_type: t }) ?? t,
              }))}
            />
          </Suspense>
          {(q || ext || dtype || sort !== 'recent' || subtreeView) && (
            <span className="text-xs text-muted-foreground">
              {count} résultat{count > 1 ? 's' : ''}
              {(q || subtreeView) && folder !== '/' && (
                <>
                  {' '}
                  (dossier + sous-dossiers —{' '}
                  <Link
                    href={`/${orgSlug}/documents?folder=${encodeURIComponent(folder)}`}
                    className="underline hover:text-foreground"
                  >
                    ce dossier uniquement
                  </Link>
                  )
                </>
              )}
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          !q && !subtreeView && subfolders.length > 0 ? (
            // Dossier sans fichier direct mais avec des sous-dossiers
            // peuplés : l'ancien bloc « Envoyez votre premier fichier »
            // laissait croire à un dossier vide.
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Aucun fichier directement dans ce dossier — {node?.total ?? 0}{' '}
                fichier(s) sont rangés dans les sous-dossiers ci-dessus.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                nativeButton={false}
                render={
                  <Link
                    href={`/${orgSlug}/documents?folder=${encodeURIComponent(folder)}&subtree=1`}
                  />
                }
              >
                Voir tout le contenu ({node?.total ?? 0} fichier
                {(node?.total ?? 0) > 1 ? 's' : ''})
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <p className="font-medium">Aucun document</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {q
                  ? 'Aucun résultat.'
                  : folder === '/'
                    ? 'Ouvrez un dossier (Société ou un appel d’offres) pour envoyer un fichier.'
                    : 'Envoyez votre premier fichier dans ce dossier (25 Mo max).'}
              </p>
            </div>
          )
        ) : (
          <DocumentsList
            orgSlug={orgSlug}
            docs={rows}
            canEdit={canEdit}
            usage={usage}
            folderBase={subtreeView || q ? folder : undefined}
          />
        )}
        <Suspense>
          <Pagination count={count} page={page} pageSize={pageSize} />
        </Suspense>
      </div>
    </div>
  )
}
