import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

vi.mock('server-only', () => ({}))

import {
  docFilename,
  searchMissingDocUrls,
  sanitizeFilename,
} from '@/lib/datasheets/research'
import { fetchPdf } from '@/lib/datasheets/download'
import { buildWorkbook } from '@/lib/datasheets/workbook'
import {
  buildDeliveryZip,
  classeurFilename,
  dedupeFilenames,
} from '@/lib/datasheets/deliverable'
import { EMPTY_CHAPTER_RESULT } from '@/lib/datasheets/types'
import { tenderFolderOf } from '@/lib/doc-folders'
import type { ChapterResult } from '@/lib/datasheets/types'

config({ path: '.env.local' })

const RUN_ID = 'b804bbb5-4d79-4fbb-813c-1dca27fed44c'
const OWNER = '397df572-9112-4f51-b00c-aa728fcd12e9'
const ONLY = process.env.AGENT_ONLY_CHAPTERS?.split(',') ?? null

const storageSafeName = (n: string) =>
  n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.()\- ]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200)

describe('agent — couverture PDF', () => {
  it('seconde passe + téléchargement sur le run Laval', async () => {
    const s = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: run } = await s
      .from('tender_datasheet_runs')
      .select('*')
      .eq('id', RUN_ID)
      .single()
    expect(run).toBeTruthy()
    const org = run.organization_id
    const tender = run.tender_id

    const result: Record<string, ChapterResult> = {}
    for (const [code, res] of Object.entries(
      run.result as Record<string, ChapterResult>,
    )) {
      result[code] = { ...EMPTY_CHAPTER_RESULT, ...res }
    }

    let found = 0
    for (const [code, chapter] of Object.entries(result)) {
      if (ONLY && !ONLY.includes(code)) continue
      const missing = chapter.documents.filter((d) => !d.url)
      if (!missing.length) continue
      for (let b = 0; b < missing.length; b += 6) {
        const batch = missing.slice(b, b + 6)
        try {
          const r = await searchMissingDocUrls({
            operation: (run.config.operation ?? []).join(' — '),
            lotLabel: run.lot_label,
            code,
            chapter: run.chapters[code] ?? { libelle: '', onglet: code, exigences: [] },
            docs: batch.map((d) => ({
              designation: d.designation,
              marque: d.marque,
              reference: d.reference,
              type_document: d.type_document,
            })),
          })
          for (const t of r.trouvailles) {
            const doc = batch[t.n - 1]
            if (!doc || !/^https?:\/\/\S+$/i.test(t.url)) continue
            doc.url = t.url.slice(0, 2000)
            if (t.source) doc.source = t.source.slice(0, 500)
            doc.statut = 'À VALIDER | URL trouvée en seconde passe'
            doc.filename = docFilename(doc)
            found++
            console.log(`  URL ${code}: ${doc.marque} ${doc.reference} → ${doc.url.slice(0, 90)}`)
          }
        } catch (e) {
          console.log(`  [${code}] lot ${b}: ${e instanceof Error ? e.message : e}`)
        }
      }
      console.log(`[${code}] terminé`)
      // Sauvegarde incrémentale : un run long ne doit rien perdre.
      dedupeFilenames(result)
      await s
        .from('tender_datasheet_runs')
        .update({ result, updated_at: new Date().toISOString() })
        .eq('id', RUN_ID)
    }
    console.log(`URL TROUVÉES: ${found}`)

    // Téléchargement de tout ce qui a une URL et n'est pas encore livré
    const report = { ...(run.download_report ?? {}) }
    const pending = Object.values(result)
      .flatMap((r) => r.documents)
      .filter((d) => d.url && d.filename !== '—' && !d.downloaded)
    console.log(`À TÉLÉCHARGER: ${pending.length}`)

    const fetchResults = new Map<string, Awaited<ReturnType<typeof fetchPdf>>>()
    const urls = [...new Set(pending.map((d) => d.url!))]
    for (let i = 0; i < urls.length; i += 4) {
      const batch = urls.slice(i, i + 4)
      const dls = await Promise.all(batch.map((u) => fetchPdf(u)))
      batch.forEach((u, j) => fetchResults.set(u, dls[j]))
    }
    const folder = await tenderFolderOf(
      s as never,
      org,
      tender,
      `Fiches techniques/${run.lot_label}`,
    )
    const urlToDocId = new Map<string, string>()
    let ok = 0
    let failed = 0
    for (const res of Object.values(result)) {
      for (const doc of res.documents) {
        if (!pending.includes(doc)) continue
        const dl = fetchResults.get(doc.url!)
        if (!dl?.data) {
          doc.download_error = dl?.error ?? 'échec'
          report[doc.filename] = { ok: false, reason: dl?.error }
          failed++
          continue
        }
        const sharedId = urlToDocId.get(doc.url!)
        if (sharedId) {
          await s.from('document_links').upsert(
            {
              organization_id: org,
              document_id: sharedId,
              entity_type: 'tender',
              entity_id: tender,
            },
            { onConflict: 'document_id,entity_type,entity_id' },
          )
          doc.downloaded = true
          doc.document_id = sharedId
          report[doc.filename] = { ok: true, document_id: sharedId, size: dl.size }
          ok++
          continue
        }
        const docId = crypto.randomUUID()
        const sp = `org_${org}/datasheets/${RUN_ID}/${docId}-${storageSafeName(sanitizeFilename(doc.filename))}`
        const { error: upErr } = await s.storage
          .from('documents')
          .upload(sp, dl.data, { contentType: 'application/pdf' })
        if (upErr) {
          doc.download_error = `upload impossible (${upErr.message.slice(0, 120)})`
          report[doc.filename] = { ok: false, reason: doc.download_error }
          failed++
          continue
        }
        const { error: dbErr } = await s.from('documents').insert({
          id: docId,
          organization_id: org,
          name: doc.filename.slice(0, 300),
          folder_path: folder,
          storage_path: sp,
          mime_type: 'application/pdf',
          size_bytes: dl.size!,
          category: 'technique',
          document_type: doc.type_document,
          uploaded_by: OWNER,
        })
        if (dbErr) {
          await s.storage.from('documents').remove([sp])
          doc.download_error = 'enregistrement impossible'
          report[doc.filename] = { ok: false, reason: 'enregistrement impossible' }
          failed++
          continue
        }
        await s.from('document_links').upsert(
          {
            organization_id: org,
            document_id: docId,
            entity_type: 'tender',
            entity_id: tender,
          },
          { onConflict: 'document_id,entity_type,entity_id' },
        )
        doc.downloaded = true
        doc.document_id = docId
        doc.download_error = undefined
        report[doc.filename] = { ok: true, document_id: docId, size: dl.size }
        urlToDocId.set(doc.url!, docId)
        ok++
        console.log(`  + ${doc.filename.slice(0, 85)}`)
      }
    }
    console.log(`TÉLÉCHARGÉS: ${ok} ok / ${failed} échec`)
    await s
      .from('tender_datasheet_runs')
      .update({
        status: ok > 0 ? 'downloaded' : 'researched',
        result,
        download_report: report,
        updated_at: new Date().toISOString(),
      })
      .eq('id', RUN_ID)

    // Livrables régénérés avec tous les PDF
    const { data: oldDocs } = await s
      .from('documents')
      .select('id, storage_path')
      .eq('organization_id', org)
      .in('id', run.deliverable_document_ids)
    if (oldDocs?.length) {
      await s.storage.from('documents').remove(oldDocs.map((d) => d.storage_path))
      await s.from('documents').delete().in('id', oldDocs.map((d) => d.id))
    }
    const docIds = new Set<string>()
    for (const r of Object.values(report)) {
      const id = (r as { document_id?: string }).document_id
      if (id) docIds.add(id)
    }
    for (const res of Object.values(result)) {
      for (const d of res.documents) if (d.document_id) docIds.add(d.document_id)
    }
    const { data: docRows } = await s
      .from('documents')
      .select('id, storage_path')
      .in('id', [...docIds])
    const bytesById = new Map<string, Uint8Array>()
    for (const d of docRows ?? []) {
      const { data: blob } = await s.storage.from('documents').download(d.storage_path)
      if (blob) bytesById.set(d.id, new Uint8Array(await blob.arrayBuffer()))
    }
    const pdfs = new Map<string, Uint8Array>()
    for (const res of Object.values(result)) {
      for (const d of res.documents) {
        const bytes = d.document_id ? bytesById.get(d.document_id) : undefined
        if (bytes && d.filename !== '—') pdfs.set(d.filename, bytes)
      }
    }
    const classeur = await buildWorkbook({
      operation: run.config.operation ?? [],
      variante: '',
      lotLabel: run.lot_label,
      chapitres: run.chapters,
      results: result,
      downloaded: new Set(
        Object.entries(report)
          .filter(([, r]) => (r as { ok?: boolean }).ok)
          .map(([f]) => f),
      ),
    })
    const classeurName = classeurFilename(run.lot_label, '', run.config.operationShort)
    const zip = buildDeliveryZip({
      dossierLot: sanitizeFilename(run.lot_label.replace(/^LOT\s*/i, 'LOT ')),
      variante: '',
      operation: run.config.operation ?? [],
      classeurFilename: classeurName,
      classeur,
      chapitres: run.chapters,
      results: result,
      pdfs,
    })
    const zipName = sanitizeFilename(
      `${run.lot_label.replace(/^LOT\s*/i, 'LOT ')} - Fiches techniques.zip`,
    )
    const deliverables: { id: string; name: string }[] = []
    for (const [name, bytes, mime, docType] of [
      [
        classeurName,
        new Uint8Array(classeur),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Classeur_DCR',
      ],
      [zipName, zip, 'application/zip', 'Arborescence_livraison'],
    ] as const) {
      const id = crypto.randomUUID()
      const sp = `org_${org}/datasheets/${RUN_ID}/${id}-${storageSafeName(name)}`
      const { error: up } = await s.storage
        .from('documents')
        .upload(sp, bytes, { contentType: mime })
      if (up) continue
      const { error: db } = await s.from('documents').insert({
        id,
        organization_id: org,
        name: name.slice(0, 300),
        folder_path: folder,
        storage_path: sp,
        mime_type: mime,
        size_bytes: bytes.byteLength,
        category: 'technique',
        document_type: docType,
        uploaded_by: OWNER,
      })
      if (db) continue
      await s.from('document_links').upsert(
        {
          organization_id: org,
          document_id: id,
          entity_type: 'tender',
          entity_id: tender,
        },
        { onConflict: 'document_id,entity_type,entity_id' },
      )
      deliverables.push({ id, name })
    }
    const allDocs = Object.values(result).flatMap((r) => r.documents)
    const stats = {
      produits: Object.values(result).reduce((n, r) => n + r.produits.length, 0),
      documents: allDocs.length,
      avecUrl: allDocs.filter((d) => d.url).length,
      pdfLivres: allDocs.filter((d) => d.downloaded || d.document_id).length,
      sansUrl: allDocs.filter((d) => !d.url).length,
      pdfsEmbarques: pdfs.size,
      exporteLe: new Date().toISOString(),
    }
    await s
      .from('tender_datasheet_runs')
      .update({
        deliverable_document_ids: deliverables.map((d) => d.id),
        config: { ...run.config, deliverables, deliverable_stats: stats },
        updated_at: new Date().toISOString(),
      })
      .eq('id', RUN_ID)
    console.log(`LIVRABLES: ${deliverables.length} — ${JSON.stringify(stats)}`)
  }, 3_600_000)
})
