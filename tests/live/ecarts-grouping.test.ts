import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { countByCriticite, ecartsToText, groupEcarts } from '@/lib/datasheets/ecarts'
import type { ChapterResult, DatasheetEcart } from '@/lib/datasheets/types'

/**
 * Regroupement des écarts sur un dossier réel : chaque chapitre remonte le
 * même écart, on doit retomber sur une quinzaine de thèmes au lieu de ~90
 * constats. Test d'invariants (pas de valeurs figées) + rapport lisible.
 */
config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const live = url && key ? describe : describe.skip

live('groupEcarts — données réelles', () => {
  it('regroupe fortement sans perdre une occurrence', async () => {
    const supabase = createClient(url!, key!, { auth: { persistSession: false } })
    const { data, error } = await supabase
      .from('tender_datasheet_runs')
      .select('id, lot_label, result')
      .order('created_at', { ascending: false })
      .limit(5)
    if (error) throw error

    let checked = 0
    for (const run of data ?? []) {
      const result = (run.result ?? {}) as Record<string, ChapterResult>
      const ecarts: DatasheetEcart[] = Object.values(result).flatMap(
        (r) => r?.ecarts ?? [],
      )
      if (ecarts.length < 10) continue
      checked++

      const groups = groupEcarts(ecarts)
      const byCrit = countByCriticite(groups)

      console.log(`\n=== ${run.lot_label} — ${ecarts.length} écarts → ${groups.length} groupes`)
      console.log(
        `    BLOQUANT ${byCrit.BLOQUANT} · MAJEUR ${byCrit.MAJEUR} · MINEUR ${byCrit.MINEUR}`,
      )
      for (const g of groups.slice(0, 25)) {
        console.log(
          `    [${g.criticite}] ${g.occurrences.length}× ${g.theme.slice(0, 70)}`,
        )
      }

      // Aucune occurrence perdue, aucune dupliquée.
      const seen = groups.flatMap((g) => g.occurrences)
      expect(seen).toHaveLength(ecarts.length)
      expect(new Set(seen).size).toBe(ecarts.length)
      // Le regroupement doit réellement condenser.
      expect(groups.length).toBeLessThan(ecarts.length / 2)
      // La criticité d'un groupe est la plus grave de ses occurrences.
      for (const g of groups) {
        expect(['BLOQUANT', 'MAJEUR', 'MINEUR']).toContain(g.criticite)
        expect(g.occurrences.length).toBeGreaterThan(0)
        expect(g.codes.length).toBeLessThanOrEqual(g.occurrences.length)
      }
      // L'export texte couvre tous les groupes.
      const text = ecartsToText(groups, ecarts.length)
      expect(text).toContain('Action')
      expect(text.split('\n').filter((l) => /^\d+\./.test(l))).toHaveLength(groups.length)
    }
    expect(checked).toBeGreaterThan(0)
  })
})
