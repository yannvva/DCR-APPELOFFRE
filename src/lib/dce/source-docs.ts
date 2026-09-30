import 'server-only'

import { extractDceFiles } from './extract'
import type { ExtractedDoc, SkippedDoc } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pièces produites par les pipelines de génération — jamais des pièces du
 * DCE. Leur renvoi dans le corpus d'analyse polluerait les agents (le DC1
 * généré contient l'identité DCR et serait classé « acte d'engagement »).
 * Le `document_type` est le critère fiable : les anciens fichiers peuvent
 * avoir un chemin de stockage sans préfixe pipeline.
 */
const GENERATED_DOC_TYPES = new Set([
  'dc1',
  'dc2',
  'content_py',
  'memoire_docx',
  'Classeur_DCR',
  'Arborescence_livraison',
  'Livrable_importe',
])

/** Préfixes de stockage réservés aux sorties de pipelines. */
const GENERATED_PATHS = ['/datasheets/', '/memoire/', '/dc/']

/**
 * Catégories qui ne sont jamais des pièces du DCE : le kit candidature
 * société (Kbis, URSSAF, références — rattaché auto à la checklist via
 * document_links) et les mémoires produits. Sans cette exclusion, ces
 * documents liés entreraient dans le corpus d'analyse et consommeraient
 * le budget de contexte avec des données hors DCE.
 */
const NON_DCE_CATEGORIES = new Set(['societe', 'memoire'])

export function isGeneratedDoc(d: {
  storage_path: string
  document_type?: string | null
  category?: string | null
}): boolean {
  return (
    GENERATED_DOC_TYPES.has(d.document_type ?? '') ||
    NON_DCE_CATEGORIES.has(d.category ?? '') ||
    GENERATED_PATHS.some((p) => d.storage_path.includes(p))
  )
}

const ANALYZABLE_MIME = new Set([
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

export function isAnalyzable(mime: string | null, name: string) {
  return (
    (mime && ANALYZABLE_MIME.has(mime)) ||
    /\.(pdf|zip|docx|txt|csv|md|xlsx|xlsm)$/i.test(name)
  )
}

export interface TenderSourceFiles {
  /** Pièces sources retenues pour extraction (nombre avant parsing). */
  candidates: number
  /** Textes extraits et classés, prêts pour le budget du prompt. */
  docs: ExtractedDoc[]
  /** Pièces écartées (illisible, téléchargement impossible, non analysable). */
  skipped: SkippedDoc[]
}

/**
 * Charge les pièces du DCE d'un dossier d'AO : documents liés moins les
 * sorties des pipelines de génération, téléchargement storage puis
 * extraction/classification. Point d'entrée unique utilisé par l'analyse
 * DCE, le dépouillage des fiches techniques et l'analyse mémoire.
 */
export async function loadTenderSourceFiles(
  supabase: SupabaseClient,
  orgId: string,
  tenderId: string,
): Promise<TenderSourceFiles> {
  const { data: links } = await supabase
    .from('document_links')
    .select('document:documents(id, name, storage_path, mime_type, category, document_type)')
    .eq('organization_id', orgId)
    .eq('entity_type', 'tender')
    .eq('entity_id', tenderId)

  const linked = (links ?? [])
    .map((l) => (Array.isArray(l.document) ? l.document[0] : l.document))
    .filter(
      (d): d is {
        id: string
        name: string
        storage_path: string
        mime_type: string | null
        category: string | null
        document_type: string | null
      } => !!d && !isGeneratedDoc(d),
    )

  const docs = linked.filter((d) => isAnalyzable(d.mime_type, d.name))
  const skipped: SkippedDoc[] = linked
    .filter((d) => !isAnalyzable(d.mime_type, d.name))
    .map((d) => ({ name: d.name, reason: 'format non analysable' }))

  const files: { name: string; data: Uint8Array; mime?: string }[] = []
  for (const d of docs) {
    const { data: blob } = await supabase.storage
      .from('documents')
      .download(d.storage_path)
    if (!blob) {
      skipped.push({ name: d.name, reason: 'téléchargement impossible' })
      continue
    }
    files.push({
      name: d.name,
      data: new Uint8Array(await blob.arrayBuffer()),
      mime: d.mime_type ?? undefined,
    })
  }

  const { docs: extracted, skipped: extractSkipped } =
    await extractDceFiles(files)
  return {
    candidates: docs.length,
    docs: extracted,
    skipped: [...skipped, ...extractSkipped],
  }
}
