// Importe les pièces société DCR (category='societe', is_reusable) et met à
// jour le profil (finance, équipe, références, certifications, assurances).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
const ORG = '390bf68d-d189-45b4-b340-7a3a5f96ded0'
const USER = '397df572-9112-4f51-b00c-aa728fcd12e9'
const BASE = 'C:/Users/pc-dcr1/Desktop/Yann/DOSSIER COMPLET/DCR - COMPLET - DC1 DC2 ECT'

const headers = {
  apikey: KEY,
  authorization: `Bearer ${KEY}`,
  'content-type': 'application/json',
}

const FILES = [
  ['CANDIDATURE/DCR - Kbis 15 05 2026.pdf', 'kbis', '2026-08-15'],
  ['CANDIDATURE/DCR - Attestation URSSAF - 05 03 2026.pdf', 'urssaf', '2026-09-05'],
  ['CANDIDATURE/DCR - Attestation de régularité fiscale 01 04 2026.pdf', 'attestation_fiscale', '2026-10-01'],
  ['CANDIDATURE/DCR - Attestation assurance RC & D 2026.pdf', 'assurance', '2026-12-31'],
  ['CANDIDATURE/DCR - Attestation PRO BTP 27 02 2026.PDF', 'assurance', '2027-02-27'],
  ['CANDIDATURE/DCR - Attestation CIBTP à jour au 03-04-2026.pdf', 'autre', '2026-10-03'],
  ['CANDIDATURE/DCR - Attestation SIRET INPI.pdf', 'autre', null],
  ['CANDIDATURE/DCR - Attestation sur l\'honneur.pdf', 'autre', null],
  ['CANDIDATURE/DCR - Attestations QUALIBAT 2026.pdf', 'qualification', null],
  ['CANDIDATURE/DCR - Attestations de travaux - GO.pdf', 'reference', null],
  ['CANDIDATURE/DCR - Attestations de travaux - Second oeuvre.pdf', 'reference', null],
  ['CANDIDATURE/DCR - Références Gros Oeuvre.pdf', 'reference', null],
  ['CANDIDATURE/DCR - Références illustrées - Second oeuvre.pdf', 'reference', null],
  ['CANDIDATURE/DCR - Références illustrées - TCE.pdf', 'reference', null],
  ['CANDIDATURE/DCR - Références Second oeuvre.pdf', 'reference', null],
  ['CANDIDATURE/DCR - Tableau de qualifications et CV Personnel - Gros oeuvre.pdf', 'reference', null],
  ['CANDIDATURE/DCR - Tableau de qualifications et CV Personnel - Second oeuvre.pdf', 'reference', null],
  ['CANDIDATURE/DCR - Tableau effectifs moyens annuels.pdf', 'autre', null],
  ['DCR - RIB SG.pdf', 'rib', null],
  ['DC1 - TEMPLATE.doc', 'dc1', null],
  ['DC2 - TEMPLATE.doc', 'dc2', null],
  ['Dossier DC4 COMPLET.pdf', 'autre', null],
  ['SEUL ELEMENT A CHANGER -.docx', 'autre', null],
]

const MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

for (const [rel, type, validUntil] of FILES) {
  const abs = join(BASE, rel)
  const name = rel.split('/').pop()
  let buf
  try {
    buf = readFileSync(abs)
  } catch {
    console.log('SKIP (introuvable):', rel)
    continue
  }
  const ext = name.split('.').pop().toLowerCase()
  const mime = MIME[ext] ?? 'application/octet-stream'
  const docId = crypto.randomUUID()
  const storagePath = `org_${ORG}/societe/${docId}-${name.replace(/[^\w.()-]/g, '_')}`

  const up = await fetch(`${URL}/storage/v1/object/documents/${storagePath}`, {
    method: 'POST',
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': mime },
    body: buf,
  })
  if (!up.ok) {
    console.log('ERR storage', name, (await up.text()).slice(0, 120))
    continue
  }
  const ins = await fetch(`${URL}/rest/v1/documents`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: docId,
      organization_id: ORG,
      name,
      folder_path: '/Société',
      storage_path: storagePath,
      mime_type: mime,
      size_bytes: buf.byteLength,
      category: 'societe',
      document_type: type,
      is_reusable: true,
      valid_until: validUntil,
      uploaded_by: USER,
    }),
  })
  if (!ins.ok) {
    console.log('ERR insert', name, (await ins.text()).slice(0, 200))
    continue
  }
  console.log('OK', type.padEnd(20), name)
}

// ---- Profil : finance, équipe, références, certifications, assurances ----
const [org] = await fetch(`${URL}/rest/v1/organizations?id=eq.${ORG}&select=settings`, { headers }).then((r) => r.json())
const company = {
  ...org.settings.company,
  finance: {
    chiffre_affaires: [
      '2023 — 3 304 274 € HT (part marchés travaux : 43 %)',
      '2024 — 3 696 185 € HT (part marchés travaux : 48 %)',
      '2025 — 13 897 070 € HT (part marchés travaux : 54 %)',
    ],
    effectif:
      '34 salariés en 2025 (29 en 2024, 27 en 2023) — 1 gérant, 2 directeurs travaux, 5 conducteurs de travaux, 5 chefs de chantier, 2 chargés d’affaires études, 2 assistants administratifs, 17 compagnons',
  },
  certifications: [
    'QUALIBAT 2111 — Maçonnerie et ouvrage en béton armé (technicité courante)',
    'QUALIBAT 4132 — Plaques de plâtre (technicité confirmée)',
    'QUALIBAT 6112 — Peinture et ravalement (technicité confirmée)',
    'QUALIBAT 6222 — Revêtements résilients PVC (technicité confirmée)',
    'QUALIBAT 6311 — Carrelages et revêtements (technicité courante)',
  ],
  equipe: [
    'Mathieu YILDIRIM — Gérant',
    'Direction travaux : 2 directeurs travaux',
    'Conduite : 5 conducteurs de travaux',
    'Chantier : 5 chefs de chantier',
    'Études : 2 chargés d’affaires études',
    'Production : 17 compagnons',
    'Administratif : 2 assistants',
  ],
  references: [
    'École maternelle Les Alliers de Chavannes — Mairie de Mantes-la-Ville — Lot 01 Gros œuvre — 2 163 373 € HT',
    'Maison des associations, Villevaude — JEK Architecture — Lot 02 Gros œuvre — 1 295 000 € HT',
    'ENSAPC Cergy — CA Cergy-Pontoise — Lot 06 Finitions intérieures — 1 112 237 € HT',
    '13 logements, Jouy-en-Josas — 1001 Vies Habitat — Lot 01 Gros œuvre — 1 070 000 € HT',
    'Campus TBS Education, Paris — Toulouse Business School — Lot 3 Gros œuvre — 1 030 000 € HT',
    'Lycée Jean Moulin, Torcy — Région Île-de-France — Lot 07 Revêtements sols — 836 111 € HT',
    'Centre nautique Eurocéane — Ville de Mont-Saint-Aignan — Lot 08 Revêtements sols souples — 711 741 € HT',
    'Police municipale, Charenton-le-Pont — Lot 01 Démolition et terrassement — 572 776 € HT',
    'Salle polyvalente Belle Alliance — Marniquet Aubouin — Lot 1 Gros œuvre — 552 280 € HT',
    'Centre Technique Municipal, Gif-sur-Yvette — Lot 02 Démolition-Curage-Maçonnerie-Ravalement — 499 841 € HT',
    'Centre dramatique national Nanterre-Amandiers — Mairie de Nanterre — Lot 3D Revêtement de sol — 348 618 € HT',
    'Ateliers Médicis, Clichy-sous-Bois/Montfermeil — Lot 13 Revêtements sols durs — 314 085 € HT',
    'Groupe scolaire Bois du Fay, Le Mesnil-Saint-Denis — Lot 10 Revêtements sols et muraux — 288 046 € HT',
  ],
  assurances: {
    lignes: [
      'RC professionnelle & Décennale — attestation 2026 (fichier société)',
      'PRO BTP — attestation du 27/02/2026',
      'CIBTP — attestation à jour au 03/04/2026',
    ],
  },
}
const up2 = await fetch(`${URL}/rest/v1/organizations?id=eq.${ORG}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ settings: { ...org.settings, company } }),
})
console.log(up2.ok ? 'profil complété ✓' : 'ERR profil ' + (await up2.text()).slice(0, 200))
