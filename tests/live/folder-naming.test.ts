import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { tenderFolderName } from '@/lib/doc-folders'
import { shortenLotLabel } from '@/lib/naming'
import { normalizeFolderPath } from '@/lib/folder-tree'

/**
 * Renommage des dossiers existants vers la politique de nommage courte.
 *
 * Les dossiers créés avant `src/lib/naming.ts` portent le titre complet de
 * l'appel d'offres (98 car.) et le libellé de lot entier (238 car.) : sans
 * renommage, les nouveaux fichiers partiraient dans un second dossier d'AO et
 * l'arborescence se dédoublerait.
 *
 * Par défaut : DRY-RUN (aucune écriture) + invariants. Pour appliquer :
 *   APPLY_RENAME=1 npx vitest run -c vitest.live.config.ts tests/live/folder-naming.test.ts
 * Le renommage utilise les MÊMES fonctions que l'application — les noms
 * produits sont donc identiques au caractère près.
 */
config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const APPLY = process.env.APPLY_RENAME === '1'
const live = url && key ? describe : describe.skip

interface Doc {
  id: string
  name: string
  folder_path: string
}

live('Nommage des dossiers — renommage court', () => {
  const supabase = createClient(url!, key!, { auth: { persistSession: false } })

  async function plan(): Promise<{ id: string; from: string; to: string; name: string }[]> {
    const { data: orgs } = await supabase.from('organizations').select('id')
    const out: { id: string; from: string; to: string; name: string }[] = []

    for (const org of orgs ?? []) {
      const { data: tenders } = await supabase
        .from('tenders')
        .select('id, title, reference')
        .eq('organization_id', org.id)
      const { data: docs } = await supabase
        .from('documents')
        .select('id, name, folder_path')
        .eq('organization_id', org.id)
      const { data: links } = await supabase
        .from('document_links')
        .select('document_id, entity_id')
        .eq('organization_id', org.id)
        .eq('entity_type', 'tender')
      const { data: runs } = await supabase
        .from('tender_datasheet_runs')
        .select('lot_label')
        .eq('organization_id', org.id)

      const all = (docs ?? []) as Doc[]
      const tenderOf = new Map(
        (links ?? []).map((l) => [l.document_id as string, l.entity_id as string]),
      )

      // 1. Racine d'AO : ancienne racine déduite des documents déjà rangés.
      //    (remplacement de PRÉFIXE : « <ancienne racine>/… »)
      const baseRenames: { from: string; to: string }[] = []
      for (const t of tenders ?? []) {
        const newBase = tenderFolderName({ title: t.title, reference: t.reference })
        const oldBase = all
          .filter((d) => tenderOf.get(d.id) === t.id)
          .map((d) => normalizeFolderPath(d.folder_path).split('/')[0])
          .find((seg) => seg && !['DCE', 'Société'].includes(seg))
        if (oldBase && oldBase !== newBase) {
          baseRenames.push({ from: oldBase, to: newBase })
        }
      }

      // 2. Sous-dossiers de lot des fiches techniques : le segment est AU
      //    MILIEU du chemin (« <AO>/Fiches techniques/<libellé> ») → on
      //    remplace la sous-chaîne, pas le préfixe.
      const segRenames: { from: string; to: string }[] = []
      for (const r of runs ?? []) {
        const label = r.lot_label as string
        const short = shortenLotLabel(label)
        if (short !== label) {
          segRenames.push({
            from: `Fiches techniques/${label}`,
            to: `Fiches techniques/${short}`,
          })
        }
      }

      for (const d of all) {
        const current = normalizeFolderPath(d.folder_path)
        let next = current
        const base = baseRenames.find(
          (r) => next === r.from || next.startsWith(`${r.from}/`),
        )
        if (base) next = `${base.to}${next.slice(base.from.length)}`
        for (const seg of segRenames) {
          if (next.includes(seg.from)) next = next.replace(seg.from, seg.to)
        }
        if (next !== current) {
          out.push({ id: d.id, from: current, to: next, name: d.name })
        }
      }
    }
    return out
  }

  it('renomme les chemins trop longs sans rien perdre', async () => {
    const changes = await plan()
    console.log(`\n${changes.length} document(s) à reclasser`)
    const seen = new Map<string, number>()
    for (const c of changes) seen.set(c.to, (seen.get(c.to) ?? 0) + 1)
    for (const [folder, n] of seen) {
      console.log(`  ${String(folder.length).padStart(3)} car. · ${n} doc. | ${folder}`)
    }

    for (const c of changes) {
      expect(c.to.length).toBeLessThan(c.from.length)
      expect(c.to.startsWith('/')).toBe(false)
    }

    if (APPLY && changes.length) {
      for (const c of changes) {
        const { error } = await supabase
          .from('documents')
          .update({ folder_path: c.to })
          .eq('id', c.id)
        if (error) throw error
      }
      console.log(`Appliqué : ${changes.length} document(s).`)
      expect(await plan()).toHaveLength(0)
    } else if (!APPLY) {
      console.log('(dry-run — APPLY_RENAME=1 pour appliquer)')
    }
  })
})
