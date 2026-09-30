// Recherche un utilisateur Supabase Auth par fragment d'email.
// Usage: node scripts/find-user.mjs <fragment>
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL ou SERVICE_ROLE_KEY manquant dans .env.local')
  process.exit(1)
}

const admin = createClient(url, key, { auth: { persistSession: false } })
const needle = (process.argv[2] ?? '').toLowerCase()

const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (error) {
  console.error('Erreur:', error.message)
  process.exit(1)
}

const matches = data.users.filter((u) => u.email?.toLowerCase().includes(needle))
if (!matches.length) {
  console.log(`Aucun utilisateur ne correspond à "${needle}". Comptes existants :`)
  for (const u of data.users) console.log(` - ${u.email}`)
  process.exit(0)
}
for (const u of matches) {
  console.log(`${u.email}  (id=${u.id}, créé ${u.created_at}, dernier login ${u.last_sign_in_at ?? 'jamais'})`)
}
