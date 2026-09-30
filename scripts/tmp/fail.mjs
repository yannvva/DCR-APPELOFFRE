import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data: r } = await sb.from('tender_datasheet_runs')
  .select('result, download_report').eq('id', 'b804bbb5-4d79-4fbb-813c-1dca27fed44c').single()
let done = 0, total = 0
for (const [chap, c] of Object.entries(r.result))
  for (const d of c?.documents ?? []) {
    total++
    if (d.downloaded) done++
    else if (!d.downloaded) console.log(`PENDING [${chap}] ${d.filename} | url=${d.url ?? '—'} | ${d.download_error ?? ''}`)
  }
console.log(`\n${done}/${total}`)
for (const [n, e] of Object.entries(r.download_report ?? {}))
  if (e.reason) console.log('RAISON:', n, '—', e.reason)
