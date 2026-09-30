import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data: lib } = await sb.from('datasheet_library')
  .select('id, document_id').eq('reference', 'Leaflet C5107000 — Clôture Mobile M300').single()
const { data: r } = await sb.from('tender_datasheet_runs')
  .select('result, download_report').eq('id', 'b804bbb5-4d79-4fbb-813c-1dca27fed44c').single()
const { data: doc } = await sb.from('documents').select('name').eq('id', lib.document_id).single()
for (const c of Object.values(r.result))
  for (const d of c?.documents ?? [])
    if (!d.document_id && /cl[ôo]ture mobile heras/i.test(d.reference ?? '')) {
      d.document_id = lib.document_id
      d.library_id = lib.id
      d.downloaded = true
      d.filename = doc.name
      console.log('attaché:', d.reference, '→', doc.name)
    }
await sb.from('tender_datasheet_runs').update({ result: r.result }).eq('id', 'b804bbb5-4d79-4fbb-813c-1dca27fed44c')
