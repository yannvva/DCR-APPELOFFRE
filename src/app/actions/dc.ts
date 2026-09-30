'use server'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { revalidateTenderPages } from '@/lib/revalidate'
import { z } from 'zod'
import { requireMembership } from '@/lib/dal/auth'
import { audit } from '@/lib/audit'
import {
  ensureTenderLot,
  getTender,
  listDceAnalyses,
  listTenderLots,
} from '@/lib/dal/tenders'
import { normalizeAnalysis } from '@/lib/dce/normalize'
import { parseCompanyProfile } from '@/lib/company'
import { fillDcTemplate, unfilledPlaceholders } from '@/lib/dc/fill'
import { syncChecklistItems } from '@/lib/checklist-attach'
import { storageSafeName } from '@/lib/storage-key'
import { dc1Vars, dc1Checks, dc2Vars, dc2Checks, type DcContext } from '@/lib/dc/data'
import { tenderFolderName } from '@/lib/doc-folders'

const BASE = join(process.cwd(), 'src', 'lib', 'dc', 'base')

const inputSchema = z.object({
  lotIds: z.array(z.uuid()).max(50).default([]),
})

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Génère DC1 (commun aux lots) + DC2 (un par lot sélectionné) et les
 *  enregistre comme documents liés au dossier d'AO. */
export async function generateDcForms(
  orgSlug: string,
  tenderId: string,
  input: unknown,
): Promise<{
  success?: boolean
  error?: string
  /** Placeholders {{…}} restés vides dans les gabarits générés. */
  warnings?: string[]
}> {
  const ctx = await requireMembership(orgSlug, 'member')
  if (!ctx) return { error: 'Accès refusé.' }
  const parsed = inputSchema.safeParse(input ?? {})
  if (!parsed.success) return { error: 'Paramètres invalides.' }

  const tender = await getTender(ctx, tenderId)
  if (!tender) return { error: 'Appel d’offres introuvable.' }

  const profile = parseCompanyProfile(ctx.org.settings)
  let allLots = await listTenderLots(ctx, tenderId)
  // Analyse DCE faite mais jamais appliquée → aucun lot en base : on sème
  // ceux détectés par l'analyse pour pouvoir produire les DC2.
  if (!allLots.length) {
    const analyses = await listDceAnalyses(ctx, tenderId)
    const done = analyses.find((a) => a.status === 'done' && a.result)
    const detected = done ? normalizeAnalysis(done.result).lots : []
    for (const l of detected) {
      await ensureTenderLot(ctx.supabase, ctx.org.id, tenderId, {
        number: l.number,
        title: l.title,
        amount_cents:
          l.amount_euros != null ? Math.round(l.amount_euros * 100) : null,
      })
    }
    if (detected.length) allLots = await listTenderLots(ctx, tenderId)
  }
  const selected =
    parsed.data.lotIds.length > 0
      ? allLots.filter((l) => parsed.data.lotIds.includes(l.id))
      : allLots.filter((l) => l.selected)

  // Adresse de l'acheteur (JSONB libre : street/postal_code/city…)
  let buyerAddress: string[] = []
  if (tender.buyer_account_id) {
    const { data: acc } = await ctx.supabase
      .from('accounts')
      .select('address')
      .eq('organization_id', ctx.org.id)
      .eq('id', tender.buyer_account_id)
      .single()
    const a = (acc?.address ?? {}) as Record<string, string>
    buyerAddress = [
      [a.street, a.complement].filter(Boolean).join(' '),
      [a.postal_code ?? a.zip, a.city].filter(Boolean).join(' '),
    ].filter(Boolean)
  }

  const dcCtx: DcContext = {
    profile,
    tender: {
      title: tender.title,
      reference: tender.reference,
      market_type: tender.market_type,
    },
    buyerName: tender.buyer?.name,
    buyerAddress,
    lots: selected,
    totalLots: allLots.length,
  }

  const short = tender.reference ?? tender.title.slice(0, 60)
  const unfilled = new Set<string>()
  const toUpload: { name: string; data: Uint8Array; lotNumber?: number }[] = []
  const push = (name: string, data: Uint8Array, lotNumber?: number) => {
    for (const tag of unfilledPlaceholders(data)) unfilled.add(tag)
    toUpload.push({ name, data, lotNumber })
  }
  push(
    `DC1 — ${short}.docx`,
    fillDcTemplate(
      readFileSync(join(BASE, 'dc1.docx')),
      dc1Vars(dcCtx),
      dc1Checks(dcCtx),
    ),
  )
  const dc2Targets = selected.length > 0 ? selected : [undefined]
  for (const lot of dc2Targets) {
    push(
      lot ? `DC2 — Lot ${lot.number} — ${short}.docx` : `DC2 — ${short}.docx`,
      fillDcTemplate(
        readFileSync(join(BASE, 'dc2.docx')),
        dc2Vars(dcCtx, lot),
        dc2Checks(dcCtx),
      ),
      lot?.number,
    )
  }

  // Régénération propre : supprime les DC1/DC2 précédemment générés pour ce
  // dossier (marqueur : chemin /dc/ + type dc1/dc2) — sinon chaque clic
  // empilerait une nouvelle version dans l'onglet Documents. Les DC signés
  // téléversés à la main (chemin hors /dc/) sont préservés.
  // Restreint aux fichiers téléversés par l'utilisateur courant : la policy
  // RLS n'autorise la suppression qu'à l'uploader (ou admin+) — supprimer le
  // storage d'un fichier dont la ligne resterait créerait un orphelin.
  const { data: prev } = await ctx.supabase
    .from('documents')
    .select('id, storage_path, document_links!inner(entity_id)')
    .eq('organization_id', ctx.org.id)
    .eq('uploaded_by', ctx.user.id)
    .in('document_type', ['dc1', 'dc2'])
    .like('storage_path', '%/dc/%')
    .eq('document_links.entity_type', 'tender')
    .eq('document_links.entity_id', tenderId)
  const prevIds = (prev ?? []).map((d) => d.id)
  if (prevIds.length) {
    await ctx.supabase.storage
      .from('documents')
      .remove((prev ?? []).map((d) => d.storage_path))
    await ctx.supabase
      .from('documents')
      .delete()
      .eq('organization_id', ctx.org.id)
      .in('id', prevIds)
  }

  const folder = tenderFolderName(tender, 'DC1-DC2')
  for (const f of toUpload) {
    const docId = crypto.randomUUID()
    // Préfixe /dc/ : marque le fichier comme sortie de pipeline — les
    // analyses DCE/mémoire/fiches excluent ces documents du corpus.
    const storagePath = `org_${ctx.org.id}/dc/${docId}/${storageSafeName(f.name)}`
    const { error: upErr } = await ctx.supabase.storage
      .from('documents')
      .upload(storagePath, f.data, { contentType: DOCX_MIME })
    if (upErr) return { error: 'Échec de l’envoi du fichier.' }

    const { error: dbErr } = await ctx.supabase
      .from('documents')
      .insert({
        id: docId,
        organization_id: ctx.org.id,
        name: f.name,
        folder_path: folder,
        storage_path: storagePath,
        mime_type: DOCX_MIME,
        size_bytes: f.data.byteLength,
        category: 'administratif',
        document_type: f.name.startsWith('DC1') ? 'dc1' : 'dc2',
        is_reusable: false,
        uploaded_by: ctx.user.id,
      })
    if (dbErr) {
      await ctx.supabase.storage.from('documents').remove([storagePath])
      return { error: 'Échec de l’enregistrement du document.' }
    }

    await ctx.supabase.from('document_links').insert({
      organization_id: ctx.org.id,
      document_id: docId,
      entity_type: 'tender',
      entity_id: tenderId,
    })

    // La ligne de checklist reçoit le livrable généré : elle pointait
    // auparavant sur le gabarit société (« DC1 - TEMPLATE.doc »), qui n'est
    // pas la pièce déposée. « À vérifier » : signature humaine requise.
    await syncChecklistItems(
      ctx.supabase,
      ctx.org.id,
      tenderId,
      [
        f.name.startsWith('DC1')
          ? /\bdc1\b|lettre de candidature/i
          : /\bdc2\b|d[ée]claration du candidat/i,
      ],
      { document_id: docId, status: 'a_verifier' },
      { lotNumber: f.lotNumber ?? null },
    )

    await audit(ctx.supabase, {
      organizationId: ctx.org.id,
      action: 'dc.generated',
      entityType: 'document',
      entityId: docId,
      metadata: { tenderId, name: f.name },
    })
  }

  if (unfilled.size) {
    await audit(ctx.supabase, {
      organizationId: ctx.org.id,
      action: 'dc.unfilled_placeholders',
      entityType: 'tender',
      entityId: tenderId,
      metadata: { placeholders: [...unfilled] },
    })
  }
  revalidateTenderPages(orgSlug)
  return { success: true, warnings: unfilled.size ? [...unfilled] : undefined }
}
