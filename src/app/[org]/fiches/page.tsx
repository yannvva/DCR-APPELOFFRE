import { notFound } from 'next/navigation'
import { requireMembership } from '@/lib/dal/auth'
import {
  listDatasheetLibrary,
  listDatasheetLibraryFacets,
} from '@/lib/dal/datasheet-library'
import { LibraryGrid } from '@/components/datasheets/library-grid'

export default async function FichesPage({
  params,
}: PageProps<'/[org]/fiches'>) {
  const { org: orgSlug } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const [items, facets] = await Promise.all([
    listDatasheetLibrary(ctx),
    listDatasheetLibraryFacets(ctx),
  ])

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Fiches techniques</h1>
        <p className="text-sm text-muted-foreground">
          Bibliothèque des documents fabricants téléchargés au fil de vos
          appels d’offres — un même produit se réutilise d’un dossier à
          l’autre sans re-téléchargement.
        </p>
      </div>
      <LibraryGrid
        orgSlug={orgSlug}
        items={items}
        brands={facets.brands}
        themes={facets.themes}
        docTypes={facets.docTypes}
      />
    </div>
  )
}
