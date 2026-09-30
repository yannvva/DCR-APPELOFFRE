import { beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Pilote le pipeline fiches techniques sur un dossier RÉEL :
 *   1. findMissingDocUrls — seconde passe de recherche d'URL officielles
 *      pour les fiches restées sans lien ;
 *   2. downloadRunPdfs — télécharge les PDF manquants UNIQUEMENT
 *      (drapeau `downloaded` + bibliothèque produits : aucun re-téléchargement).
 *
 * Les Server Actions sont exécutées avec un ctx service-role (auth mockée,
 * revalidatePath neutralisé). → `npm run test:live`
 */
config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const ORG_SLUG = process.env.LIVE_ORG ?? 'dcr'
const TENDER_ID =
  process.env.LIVE_TENDER_ID ??
  '8ea38978-1a5f-4d3b-9e09-7af97b17e504'
const RUN_ID =
  process.env.LIVE_RUN_ID ?? 'b804bbb5-4d79-4fbb-813c-1dca27fed44c'

const h = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('@/lib/dal/auth', () => ({
  requireMembership: vi.fn(async () => h.ctx),
}))
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}))

const live = url && key && process.env.DEEPSEEK_API_KEY ? describe : describe.skip

live('Pipeline fiches — recherche d’URL puis téléchargement des manquants', () => {
  const supabase = createClient(url!, key!, {
    auth: { persistSession: false },
  }) as unknown as SupabaseClient

  const allDocs = (result: Record<string, { documents?: unknown[] }>) =>
    Object.values(result ?? {}).flatMap(
      (c) => (c.documents ?? []) as {
        filename: string
        url: string
        downloaded?: boolean
        document_id?: string
        statut?: string
        marque?: string
        reference?: string
        designation?: string
        type_document?: string
      }[],
    )

  beforeAll(async () => {
    const { data: org, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('slug', ORG_SLUG)
      .single()
    if (error || !org) throw error ?? new Error('org introuvable')
    const { data: member } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', org.id)
      .limit(1)
      .single()
    h.ctx = {
      supabase,
      org,
      user: { id: member?.user_id },
      profile: null,
      role: 'member',
    }
  })

  it(
    'trouve les URL manquantes puis télécharge sans re-télécharger l’existant',
    async () => {
      const { data: before } = await supabase
        .from('tender_datasheet_runs')
        .select('result, download_report')
        .eq('id', RUN_ID)
        .single()
      const docsBefore = allDocs(before?.result ?? {})
      const dlBefore = docsBefore.filter((d) => d.downloaded || d.document_id)
      const reportBefore = Object.keys(before?.download_report ?? {})
      console.log(
        `AVANT: ${docsBefore.length} lignes documents, ${dlBefore.length} téléchargées, ${reportBefore.length} entrées rapport`,
      )

      const { findMissingDocUrls, downloadRunPdfs } = await import(
        '@/app/actions/datasheets'
      )

      if (!process.env.SKIP_SEARCH) {
        const t0 = Date.now()
        const found = await findMissingDocUrls(ORG_SLUG, TENDER_ID, RUN_ID)
        const tSearch = ((Date.now() - t0) / 1000).toFixed(1)
        console.log(`findMissingDocUrls (${tSearch}s) →`, JSON.stringify(found))
      }

      const t1 = Date.now()
      const dl = await downloadRunPdfs(ORG_SLUG, TENDER_ID, RUN_ID)
      const tDl = ((Date.now() - t1) / 1000).toFixed(1)
      console.log(`downloadRunPdfs (${tDl}s) →`, JSON.stringify(dl))
      expect(dl.error).toBeUndefined()

      const { data: after } = await supabase
        .from('tender_datasheet_runs')
        .select('result, download_report')
        .eq('id', RUN_ID)
        .single()
      const docsAfter = allDocs(after?.result ?? {})
      const downloaded = docsAfter.filter((d) => d.downloaded || d.document_id)
      const failedWithUrl = docsAfter.filter(
        (d) => d.url && d.filename !== '—' && !d.downloaded,
      )
      const noUrl = docsAfter.filter((d) => !d.url)
      console.log(
        `APRÈS: ${downloaded.length}/${docsAfter.length} téléchargées | ` +
          `${noUrl.length} sans URL | ${failedWithUrl.length} URL en échec`,
      )
      for (const d of failedWithUrl) {
        console.log(`  ÉCHEC DL: ${d.filename} — ${d.url}`)
      }
      for (const d of noUrl.slice(0, 30)) {
        console.log(
          `  SANS URL: ${d.type_document} | ${d.marque} ${d.reference} | ${d.designation?.slice(0, 60)}`,
        )
      }

      // Invariants :
      // 1. Aucun orphelin — tout document_id pointe sur une ligne `documents`.
      const ids = docsAfter
        .map((d) => d.document_id)
        .filter(Boolean) as string[]
      const { data: existing } = await supabase
        .from('documents')
        .select('id')
        .in('id', [...new Set(ids)])
      const existingIds = new Set((existing ?? []).map((d) => d.id as string))
      const orphans = docsAfter.filter(
        (d) => d.document_id && !existingIds.has(d.document_id),
      )
      for (const d of orphans) console.log(`  ORPHELIN: ${d.filename}`)
      expect(orphans).toEqual([])

      // 2. Pas de re-upload d'un fichier vivant : si un doc avait déjà un
      //    document_id valide avant, il doit le conserver.
      const reUploaded = docsAfter.filter((d) => {
        const prev = dlBefore.find(
          (b) =>
            b.document_id &&
            ((d.filename !== '—' && b.filename === d.filename) ||
              (b.url && b.url === d.url)),
        )
        return (
          prev?.document_id &&
          existingIds.has(prev.document_id) &&
          d.document_id !== prev.document_id
        )
      })
      for (const d of reUploaded) console.log(`  RE-UPLOAD: ${d.filename}`)
      expect(reUploaded).toEqual([])
      // Toute URL connue doit être téléchargée.
      expect(failedWithUrl.length).toBe(0)
    },
    900_000,
  )
})
