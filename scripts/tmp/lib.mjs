import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data } = await sb.from('datasheet_library')
  .select('dedup_key, brand, reference, doc_type, document_id, documents(name)')
  .order('brand')
for (const e of data ?? []) console.log(`${e.brand} | ${e.reference} | ${e.doc_type} | ${e.documents?.name}`)
