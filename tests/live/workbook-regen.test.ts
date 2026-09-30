import { describe, expect, it } from 'vitest'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { buildWorkbook } from '@/lib/datasheets/workbook'
import {
  buildDeliveryZip,
  dedupeFilenames,
  lotShortLabel,
} from '@/lib/datasheets/deliverable'
import type { ChapterResult } from '@/lib/datasheets/types'

// Régénère les livrables d'un run existant (classeur + ZIP) avec le code
// courant, sans relancer le pipeline IA ni ré-importer les PDF : on réutilise
// les documents déjà téléchargés dans le bucket.
config({ path: '.env.local' })

const RUN_ID = process.env.REGEN_RUN_ID ?? 'b804bbb5-4d79-4fbb-813c-1dca27fed44c'
const DRY_RUN = process.env.REGEN_DRY !== '0'

describe('regen deliverables (live)', () => {
  it('réécrit le classeur et le ZIP du run avec la structure courante', async () => {
    const s = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data, error } = await s
      .from('tender_datasheet_runs')
      .select('id, organization_id, tender_id, result, chapters, config, lot_label, download_report')
      .eq('id', RUN_ID)
      .single()
    expect(error).toBeNull()
    if (!data) throw new Error(`Run ${RUN_ID} introuvable`)
    const run = data

    const results = (run.result ?? {}) as Record<string, ChapterResult>
    // PDFs déjà téléchargés : filename → octets
    const docIds = new Set<string>()
    for (const res of Object.values(results))
      for (const d of res.documents ?? []) if (d.document_id) docIds.add(d.document_id)
    const { data: docs } = await s
      .from('documents')
      .select('id, storage_path')
      .eq('organization_id', run.organization_id)
      .in('id', [...docIds])
    const bytesById = new Map<string, Uint8Array>()
    for (const d of docs ?? []) {
      const { data: blob } = await s.storage.from('documents').download(d.storage_path)
      if (blob) bytesById.set(d.id, new Uint8Array(await blob.arrayBuffer()))
    }
    const pdfs = new Map<string, Uint8Array>()
    for (const res of Object.values(results))
      for (const d of res.documents ?? []) {
        const bytes = d.document_id ? bytesById.get(d.document_id) : undefined
        if (bytes && d.filename !== '—') pdfs.set(d.filename, bytes)
      }
    console.log(`PDFs embarqués : ${pdfs.size}`)

    dedupeFilenames(results)
    const lotShort = lotShortLabel(run.lot_label)
    const classeurName = `Fiche technique - ${lotShort}.xlsx`
    const zipName = `Fiches techniques - ${lotShort}.zip`

    const classeur = await buildWorkbook({
      operation: run.config?.operation ?? [run.lot_label],
      variante: '',
      lotLabel: run.lot_label,
      chapitres: run.chapters,
      results,
      downloaded: new Set(
        Object.entries(run.download_report ?? {})
          .filter(([, r]) => (r as { ok?: boolean }).ok)
          .map(([f]) => f),
      ),
    })
    const zip = buildDeliveryZip({
      dossierLot: lotShort,
      variante: '',
      operation: run.config?.operation ?? [],
      classeurFilename: classeurName,
      classeur,
      chapitres: run.chapters,
      results,
      pdfs,
    })

    // Réécrit les lignes livrables existantes (même storage_path, nouveau blob)
    const delIds = (
      (run.config?.deliverables ?? []) as { id: string; name: string }[]
    ).map((d) => d.id)
    const { data: livrables } = await s
      .from('documents')
      .select('id, name, storage_path, document_type')
      .eq('organization_id', run.organization_id)
      .in('id', delIds.length ? delIds : ['00000000-0000-0000-0000-000000000000'])
    const payload: Record<string, { bytes: Uint8Array; name: string }> = {}
    for (const d of livrables ?? []) {
      if (d.document_type === 'Classeur_DCR')
        payload[d.id] = { bytes: classeur, name: classeurName }
      else if (d.document_type === 'Arborescence_livraison')
        payload[d.id] = { bytes: zip, name: zipName }
    }
    for (const [id, p] of Object.entries(payload)) {
      const row = (livrables ?? []).find((d) => d.id === id)!
      if (DRY_RUN) {
        console.log(`[dry] ${row.name} → ${p.name} (${p.bytes.length} o)`)
        continue
      }
      const { error: upErr } = await s.storage
        .from('documents')
        .update(row.storage_path, p.bytes, {
          contentType: row.name.endsWith('.zip')
            ? 'application/zip'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      if (upErr) {
        console.log(`✗ upload ${p.name} : ${upErr.message}`)
        continue
      }
      await s
        .from('documents')
        .update({ name: p.name, size_bytes: p.bytes.length })
        .eq('organization_id', run.organization_id)
        .eq('id', id)
      console.log(`✓ ${row.name} → ${p.name} (${p.bytes.length} o)`)
    }
    expect(Object.keys(payload).length).toBeGreaterThan(0)
  }, 120_000)
})
