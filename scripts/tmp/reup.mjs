import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data: r } = await sb.from('tender_datasheet_runs')
  .select('result, download_report').eq('id', 'b804bbb5-4d79-4fbb-813c-1dca27fed44c').single()
// docs avec document_id — vérifier que la ligne documents existe
const ids = new Set()
for (const c of Object.values(r.result)) for (const d of c?.documents ?? []) if (d.document_id) ids.add(d.document_id)
const { data: existing } = await sb.from('documents').select('id').in('id', [...ids])
const exSet = new Set((existing ?? []).map(d => d.id))
for (const [chap, c] of Object.entries(r.result))
  for (const d of c?.documents ?? [])
    if (d.document_id && !exSet.has(d.document_id))
      console.log(`ORPHELIN [${chap}] ${d.filename} doc=${d.document_id.slice(0,8)}`)
// rapport : entrées avec reason suspectes
for (const [n, e] of Object.entries(r.download_report))
  if (e.reason && !/pur|page produit|partag/i.test(e.reason)) console.log('  report:', n, '—', e.reason)
console.log('done')
