// Remplit organizations.settings.company (org 'dcr') à partir des données
// extraites du PDF « SUIVI DES MARCHE A CHIFFRER… ». Usage : node scripts/fill-company.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const headers = {
  apikey: KEY,
  authorization: `Bearer ${KEY}`,
  'content-type': 'application/json',
  prefer: 'return=representation',
}

// 1. Org dcr + settings actuels
const orgRes = await fetch(
  `${URL}/rest/v1/organizations?slug=eq.dcr&select=id,name,slug,settings`,
  { headers },
)
const [org] = await orgRes.json()
if (!org) throw new Error('org dcr introuvable')
console.log('org:', org.name, org.id)

const company = {
  identite: {
    raison_sociale: 'DESIGN CONSTRUCTION ET RENOVATION',
    forme_juridique: 'SAS',
    capital_euros: '620 000',
    siren: '823633862',
    siret: '82363386200037',
    rcs_ville: 'Evry',
    code_ape: '4399C',
    tva_intracom: 'FR34823633862',
    date_creation: '08/11/2016',
  },
  siege: {
    adresse: '6 rue Jacquard, 91280 Saint-Pierre-du-Perray',
    telephone: '01 60 91 67 60',
    email: 'dcr@dcr-idf.fr',
  },
  dirigeant: {
    nom: 'Mathieu YILDIRIM',
    qualite: 'Gérant',
  },
  banque: {
    titulaire: 'DESIGN CONSTRUCTION ET RENOVATION',
    domiciliation:
      'Société Générale — SG Evry Montespan (00692), 1 rue Montespan, 91000 Evry — banque 30003, guichet 00692, compte 20321687, clé 66',
    iban: 'FR76 3000 3006 9200 0203 2168 766',
    bic: 'SOGEFRPP',
  },
  finance: {},
  assurances: {},
  certifications: [],
  equipe: ['Mathieu YILDIRIM — Gérant'],
  implantations: [],
  references: [],
  presentation:
    'Entreprise artisanale de bâtiment — travaux de maçonnerie générale et gros œuvre de bâtiment (code APE 4399C), SAS au capital de 620 000 € créée en 2016, siège à Saint-Pierre-du-Perray (91). Convention collective : bâtiment ouvriers plus de 10 salariés (1597).',
}

const settings = { ...(org.settings ?? {}), company }
const up = await fetch(
  `${URL}/rest/v1/organizations?id=eq.${org.id}`,
  { method: 'PATCH', headers, body: JSON.stringify({ settings }) },
)
if (!up.ok) throw new Error('PATCH settings: ' + (await up.text()).slice(0, 300))
console.log('profil société enregistré ✓')

// 2. PDF source → storage + pièce société réutilisable
const pdf = readFileSync(
  'C:/Users/pc-dcr1/Desktop/SUIVI DES MARCHE A CHIFFRER - DEMANDE DE COMPLEMENTAIRE - SUIVI DES DOSSIER.pdf',
)
const docId = crypto.randomUUID()
const storagePath = `org_${org.id}/societe/${docId}-donnees_societe_dcr.pdf`
const upSt = await fetch(`${URL}/storage/v1/object/documents/${storagePath}`, {
  method: 'POST',
  headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/pdf' },
  body: pdf,
})
if (!upSt.ok) throw new Error('storage: ' + (await upSt.text()).slice(0, 300))

const ins = await fetch(`${URL}/rest/v1/documents`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    id: docId,
    organization_id: org.id,
    name: 'SUIVI DES MARCHE A CHIFFRER - DEMANDE DE COMPLEMENTAIRE - SUIVI DES DOSSIER.pdf',
    folder_path: '/Société',
    storage_path: storagePath,
    mime_type: 'application/pdf',
    size_bytes: pdf.byteLength,
    category: 'societe',
    document_type: 'donnees_societe',
    is_reusable: true,
    uploaded_by: '397df572-9112-4f51-b00c-aa728fcd12e9',
  }),
})
if (!ins.ok) throw new Error('documents: ' + (await ins.text()).slice(0, 300))
console.log('PDF source rangé dans Documents / Société ✓')
