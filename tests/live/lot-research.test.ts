import { describe, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

vi.mock('server-only', () => ({}))

import { researchChapter, sanitizeFilename } from '@/lib/datasheets/research'
import { fetchPdf } from '@/lib/datasheets/download'
import { buildWorkbook } from '@/lib/datasheets/workbook'
import {
  buildDeliveryZip,
  classeurFilename,
  dedupeFilenames,
} from '@/lib/datasheets/deliverable'
import { tenderFolderOf } from '@/lib/doc-folders'
import type { ChapterResult } from '@/lib/datasheets/types'

config({ path: '.env.local' })

const RUN_ID = 'b804bbb5-4d79-4fbb-813c-1dca27fed44c'
const OWNER = '397df572-9112-4f51-b00c-aa728fcd12e9'

const storageSafeName = (n: string) =>
  n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.()\- ]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200)

describe('recherche complète du lot', () => {
  it('marques + fiches sur tous les chapitres', async () => {
    const s = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: run } = await s
      .from('tender_datasheet_runs')
      .select('*')
      .eq('id', RUN_ID)
      .single()
    const org = run.organization_id
    const tender = run.tender_id
    const result: Record<string, ChapterResult> = {}
    for (const [code, res] of Object.entries(
      run.result as Record<string, ChapterResult>,
    )) {
      result[code] = { ...res }
    }

    for (const code of Object.keys(run.chapters)) {
      const chapter = run.chapters[code]
      try {
        const { result: fresh } = await researchChapter({
          operation: (run.config.operation ?? []).join(' — '),
          lotLabel: run.lot_label,
          variantes: run.config.variantes ?? [],
          code,
          chapter,
          doutes: run.config.doutes ?? [],
        })
        // Report des drapeaux de téléchargement sur les documents identiques
        const prev = result[code]?.documents ?? []
        const prevByKey = new Map(prev.map((d) => [d.url || d.filename, d]))
        for (const doc of fresh.documents) {
          const old = prevByKey.get(doc.url || doc.filename)
          if (old?.downloaded || old?.document_id) {
            doc.downloaded = true
            doc.document_id = old.document_id ?? doc.document_id
            if (doc.filename === '—' && old.filename !== '—') doc.filename = old.filename
          }
        }
        result[code] = fresh
        const branded = fresh.produits.filter((p) => p.marque !== '—').length
        const urls = fresh.documents.filter((d) => d.url).length
        console.log(
          `[${code}] ${fresh.produits.length} produits (${branded} marqués) · ${fresh.documents.length} docs (${urls} URL)`,
        )
      } catch (e) {
        console.log(`[${code}] ÉCHEC : ${e instanceof Error ? e.message : e}`)
      }
      dedupeFilenames(result)
      await s
        .from('tender_datasheet_runs')
        .update({ result, updated_at: new Date().toISOString() })
        .eq('id', RUN_ID)
    }

    // Téléchargement des PDF trouvés
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
          doc.download_error = `upload impossible (${upErr.message.slice(0, 100)})`
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
        console.log(`  + ${doc.filename.slice(0, 80)}`)
      }
    }
    console.log(`TÉLÉCHARGÉS: ${ok} ok / ${failed} échec`)

    // Livrables régénérés
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
    const NORM =
      /^\s*(dtu|nf\b|nfen|nf en|nf p|en \d|iso|eurocode|ec\d|bael|reef|cstb|unm|u\.n\.m|afnor|setra|cerib|xpg?|xp p|dta|atec|règles? pro)/i
    const isProd = (d: { marque: string; reference: string }) => {
      const m = d.marque.trim()
      if (m && m !== '—' && !NORM.test(m)) return true
      const r = d.reference.trim()
      return !!r && r !== '—' && !NORM.test(r)
    }
    const prod = allDocs.filter(isProd)
    const stats = {
      produits: Object.values(result).reduce((n, r) => n + r.produits.length, 0),
      documents: allDocs.length,
      avecUrl: allDocs.filter((d) => d.url).length,
      pdfLivres: allDocs.filter((d) => d.downloaded || d.document_id).length,
      sansUrl: allDocs.filter((d) => !d.url).length,
      fichesFabricants: prod.length,
      fichesFabricantsLivrees: prod.filter((d) => d.downloaded || d.document_id).length,
      prescriptions: allDocs.filter((d) => !isProd(d)).length,
      pdfsEmbarques: pdfs.size,
      exporteLe: new Date().toISOString(),
    }
    await s
      .from('tender_datasheet_runs')
      .update({
        status: ok > 0 ? 'downloaded' : 'researched',
        result,
        download_report: report,
        deliverable_document_ids: deliverables.map((d) => d.id),
        config: { ...run.config, deliverables, deliverable_stats: stats },
        error: failed ? `${failed} PDF non téléchargé(s)` : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', RUN_ID)
    const marques = [
      ...new Set(
        Object.values(result)
          .flatMap((r) => r.produits)
          .map((p) => p.marque)
          .filter((m) => m && m !== '—'),
      ),
    ]
    console.log(`MARQUES PROPOSÉES (${marques.length}) : ${marques.join(', ')}`)
    console.log(`STATS: ${JSON.stringify(stats)}`)
  }, 3_600_000)
})
