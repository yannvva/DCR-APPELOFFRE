'use client'

import {
  DocumentViewer,
  useDocumentViewer,
} from '@/components/documents/document-viewer'
import { DocumentRow } from '@/components/documents/document-row'
import type { Document } from '@/lib/types'

/** Liste des documents + modale de visualisation partagée (nav ← →). */
export function DocumentsList({
  orgSlug,
  docs,
  canEdit,
  usage,
  folderBase,
}: {
  orgSlug: string
  docs: Document[]
  canEdit: boolean
  /** Compteurs d'entités liées par document (document_links). */
  usage?: Map<string, number>
  /** Vue sous-arbre : affiche sur chaque ligne son sous-dossier d'origine. */
  folderBase?: string
}) {
  const viewer = useDocumentViewer(orgSlug)
  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {docs.map((doc, i) => (
          <DocumentRow
            key={doc.id}
            orgSlug={orgSlug}
            doc={doc}
            canEdit={canEdit}
            usageCount={usage?.get(doc.id) ?? 0}
            folderBase={folderBase}
            onPreview={() => viewer.open(docs, i)}
          />
        ))}
      </ul>
      <DocumentViewer {...viewer.viewerProps()} />
    </>
  )
}
