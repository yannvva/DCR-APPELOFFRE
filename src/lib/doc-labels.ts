import { COMPANY_DOC_TYPE_LABELS } from '@/lib/company'
import { DCE_DOC_TYPE_LABELS } from '@/lib/dce/types'

/**
 * Libellé du badge « type de pièce » — dépend de la catégorie du document :
 * un « autre » dans un DCE n'est pas une « autre pièce société ».
 */
export function docTypeLabel(doc: {
  category?: string | null
  document_type?: string | null
}): string | null {
  const t = doc.document_type
  if (!t) return null
  if (doc.category === 'dce') return DCE_DOC_TYPE_LABELS[t as never] ?? t
  return (
    COMPANY_DOC_TYPE_LABELS[t] ?? DCE_DOC_TYPE_LABELS[t as never] ?? t
  )
}
