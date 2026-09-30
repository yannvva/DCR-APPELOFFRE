import 'server-only'

import { completeResearchJson } from '@/lib/ai/deepseek'
import { DCR_RULES } from './rules'
import {
  LIMITS,
  articleNumber,
  condense,
  productName,
  shortReference,
  shortText,
} from '@/lib/naming'
import {
  DOC_TYPES,
  EMPTY_CHAPTER_RESULT,
  PDF_NON_TROUVE,
  isProductDocument,
} from './types'
import type {
  ChapterDef,
  ChapterRequirement,
  ChapterResult,
  DatasheetConformite,
  DatasheetDoc,
  DatasheetEcart,
  DatasheetProduct,
  DatasheetToObtain,
  DocType,
} from './types'

const SYSTEM = `Tu es un agent de recherche DCR (entreprise BTP française). Tu produis la
section d'un dossier « Liste des marques / fiches techniques » pour un lot de marché public.

OBJECTIF MÉTIER : pour CHAQUE exigence du CCTP, identifier des PRODUITS RÉELS du
marché français (marque + référence commerciale) qui y répondent, et récupérer
leurs fiches techniques PDF officielles. La liste des marques sert au chiffrage
et à l'agrément par la maîtrise d'œuvre : elle doit être exploitable, pas une
simple recopie des prescriptions du CCTP.

MÉTHODE, exigence par exigence :
1. Si le CCTP cite des marques imposées : retiens-les en priorité.
2. Sinon, PROPOSE 1 à 3 marques/références réellement commercialisées en France qui
   satisfont l'exigence (ex. clôture de chantier → HERAS M300 / Layher ; enduit
   chaux → PRB, Weber ; béton → BPE Lafarge, Cemex ; canalisation → PAM, Saint-Gobain
   PAM ; regard béton → préfa béton locale…). Ne propose JAMAIS une marque inventée
   ni un produit qui n'existe pas : dans le doute, laisse « — ».
3. Pour chaque produit proposé, cherche sa FICHE TECHNIQUE PDF OFFICIELLE du
   fabricant avec web_search (« marque référence fiche technique pdf »), OUVRE le
   lien avec web_fetch et vérifie qu'il correspond bien au produit.
   Quand une page fabricant est ouverte, elle se termine par une section
   « LIENS UTILES (PDF et documentation technique) » : ouvre DIRECTEMENT ces liens
   [PDF] — c'est ainsi qu'on atteint la fiche technique sans deviner d'URL.
   Ajoute aussi l'opérateur « filetype:pdf » aux requêtes quand le lien direct
   n'apparaît pas : les moteurs remontent alors le PDF officiel lui-même.
4. Vise 1 à 3 documents officiels par produit (fiche technique, notice, certificat,
   DoP, avis technique, FDES).
5. Les exigences qui ne désignent AUCUN produit (DTU, normes NF/EN, essais,
   terrassement/démolition génériques, gestion des déchets) restent sans marque :
   liste-les avec marque « — », url « », et le statut
   « À VALIDER | référence normative/prescription CCTP — document à joindre par
   l'entreprise ». N'invente JAMAIS de marque pour ces lignes.

RÈGLE DE PÉRIMÈTRE (impérative) : chaque ligne de "documents" est la fiche
technique PDF OFFICIELLE d'un PRODUIT/MATÉRIEL prescrit par le CCTP fourni.
- "code" doit être recopié MOT POUR MOT depuis la liste d'exigences fournie
  (jamais vide, jamais « — », jamais reformulé). Une fiche dont le § CCTP
  n'existe pas dans cette liste est retirée du dossier.
- "marque" et/ou "reference" identifient un PRODUIT fabricant réel : marque
  commerciale ou référence commerciale. Une norme, un DTU, un organisme
  (CSTB, AFNOR, U.N.M.…) ne sont JAMAIS une marque de produit.
- INTERDIT dans "documents" : documents génériques ou méthodologiques — DTU,
  NF, guides, procédures d'exécution, modes opératoires, plans, PV d'essais,
  notes de calcul, documents de chantier. Ces éléments se citent dans
  "conformite" / "ecarts" ou dans "a_obtenir" (origine « moe »).
- Les exigences qui décrivent un PROCÉDÉ, une norme, un plan ou un essai ne
  donnent AUCUNE ligne dans "documents" : il n'existe pas de fiche fabricant.
- Si aucun PDF officiel du produit n'est trouvé : la ligne RESTE dans
  "documents" avec "url": "" et le statut exact de la règle 7 ci-dessus, ET le
  produit est également déclaré dans "a_obtenir" (origine « fabricant »).

Tu disposes des outils web_search et web_fetch. Pour chaque produit :
- cherche la fiche technique PDF OFFICIELLE du fabricant (lien direct .pdf préféré) ;
- OUVRE l'URL avec web_fetch et vérifie que c'est bien un PDF du fabricant ;
- lis la fiche et compare chiffre par chiffre avec l'exigence du CCTP ;
- vise 1 à 3 documents officiels par produit (fiche technique, notice, certificat,
  déclaration UE, avis technique).

${DCR_RULES}

Réponds UNIQUEMENT en JSON valide, sans markdown ni commentaire.`

const USER_TEMPLATE = `Opération : %OPERATION%
Lot : %LOT%%VARIANTES%

TON PÉRIMÈTRE : chapitre %CODE% — %LIBELLE%.
Exigences relevées dans le CCTP (code = § CCTP, marques imposées éventuelles) :
%EXIGENCES%

%DOUTES%

Retourne un JSON de cette forme EXACTE :
{
  "produits": [
    { "code": "§ CCTP ou '' pour sous-titre",
      "designation": "désignation de l'ouvrage/produit du CCTP",
      "marque": "marque RÉELLE proposée (ou imposée par le CCTP), ou '—' si l'exigence ne désigne aucun produit",
      "reference": "référence commerciale du produit, ou '—'",
      "statut": "OK (marque imposée par le CCTP et conforme) | À VALIDER (proposition à faire agréer par la MOE) | NON CONFORME" }
  ],
  "documents": [
    { "chap": "%CODE%", "code": "§ CCTP de l'exigence (obligatoire, jamais '—')",
      "designation": "string", "marque": "string (produit réel)", "reference": "string",
      "type_document": "Fiche_technique | Notice_de_pose | Notice_produit | Documentation_technique | Guide | Avis_Technique | DTA | Certificat | Certification | DoP | Declaration_UE_conformite | PV | FDES | FDS",
      "url": "URL exacte du PDF vérifiée par web_fetch, ou '' si non trouvée (statut règle 7)",
      "source": "site fabricant / organisme officiel / miroir distributeur (détailler)",
      "statut": "OK | À VALIDER | NON CONFORME | À VALIDER | Fiche technique PDF officielle non trouvée à ce stade — validation fournisseur/fabricant nécessaire" }
  ],
  "conformite": [
    { "chap": "%CODE%", "code": "§ CCTP", "exigence": "exigence du CCTP",
      "donnee_fabricant": "donnée réelle lue dans le document fabricant",
      "conforme": "Oui | Non | À vérifier", "commentaire": "string" }
  ],
  "ecarts": [
    { "criticite": "BLOQUANT | MAJEUR | MINEUR", "code": "§ CCTP", "objet": "string",
      "constat": "string", "action": "string" }
  ],
  "a_obtenir": [
    { "origine": "moe | fabricant", "document": "string", "fabricant": "string",
      "raison": "string" }
  ]
}`

export interface ResearchResult {
  result: ChapterResult
  model: string
  usage: { inputTokens: number; outputTokens: number }
}

/** Nom de fichier DCR normalisé (sans accents ni caractères interdits).
 *  Les points de suspension « … » des troncatures sont retirés — un nom de
 *  fichier doit rester en ASCII propre. */
export function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/…+/g, '')
    .replace(/[/:*?"<>|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 220)
}

/**
 * Nom de livraison DCR reconstruit à partir des champs normalisés —
 * « 5.5.3 Cemex CXB Voile.pdf », « 3.3 KP1 Longrine - DoP.pdf ».
 * Format : « [Article CCTP] [Marque] [Référence/Désignation][ - Type].pdf ».
 * Le § CCTP remplace le verbiage « Lot 1 Art. » ; la désignation longue du
 * produit n'entre pas dans le nom (elle reste dans le classeur) — les noms
 * complets donnaient des fichiers de 220 caractères illisibles. Le suffixe de
 * type n'est ajouté que pour les documents autres que la fiche technique :
 * c'est la fiche qui porte le nom « canonique » du produit.
 * On ne fait pas confiance au nom renvoyé par l'agent.
 */
export function docFilename(d: {
  chap: string
  code: string
  designation: string
  marque: string
  reference: string
  type_document: string
}): string {
  const art = articleNumber(d.code)
  // Sans numéro d'article : le préfixe de chapitre suffit (le nom du produit
  // identifie déjà la fiche) — « 01i ACO Multidrain - DoP.pdf ». Reprendre le
  // code entier (« Lot 1 Ch. 01i — Canalisations ») rendait le nom illisible.
  const head =
    art ?? (d.chap.trim() || condense(d.code, 24) || 'fiche')
  const brand =
    d.marque.trim() && d.marque.trim() !== '—'
      ? shortText(d.marque, LIMITS.brand)
      : ''
  const ref =
    d.reference.trim() && d.reference.trim() !== '—'
      ? shortReference(d.reference)
      : ''
  // « ACO » + « ACO Multidrain » : la référence porte déjà la marque.
  const refHasBrand =
    !!brand &&
    (ref.toLowerCase().startsWith(brand.toLowerCase() + ' ') ||
      ref.toLowerCase().startsWith(brand.toLowerCase() + '-'))
  const product = (
    ref
      ? refHasBrand
        ? ref
        : [brand, ref].filter(Boolean).join(' ')
      : [brand, productName(d.designation)].filter(Boolean).join(' ')
    // Référence tronquée sur un mot de liaison (« ACO Self 100 et … ») :
    // le connecteur orphelin en fin de nom est retiré.
  ).replace(/\s+(et|de|du|des|le|la|les|the|and|&|d'|l')$/i, '')
  const typeSuffix =
    d.type_document && d.type_document !== 'Fiche_technique'
      ? ` - ${d.type_document}`
      : ''
  const name = [head, product].filter((p) => p && p !== '—').join(' ')
  return sanitizeFilename(name + typeSuffix) + '.pdf'
}

/** Normalisation d'un code § CCTP pour comparaison (accents/ponctuation/espaces). */
const normCode = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * Le § CCTP cité par une fiche existe-t-il vraiment dans le dépouillement du
 * DCE ? Garde-fou de traçabilité : une fiche rattachée à une exigence inventée
 * (ou d'un autre chapitre) sort du périmètre du dossier.
 */
export function matchesExigenceCode(code: string, exigenceCodes: string[]): boolean {
  const c = normCode(code)
  if (!c) return false
  return exigenceCodes.some((e) => {
    const n = normCode(e)
    return !!n && (n === c || n.includes(c) || c.includes(n))
  })
}

/**
 * Règle de périmètre du workflow fiches techniques : une ligne « documents »
 * n'est conservée que si c'est la fiche d'un PRODUIT réel (marque fabricant ou
 * référence commerciale — jamais une norme/DTU/organisme, cf.
 * `isProductDocument`) rattachée à une exigence du CCTP du DCE. Les documents
 * génériques (DTU, NF, guides, modes opératoires, plans, PV) sont écartés :
 * ils relèvent de la conformité / de « à obtenir », pas du dossier de fiches.
 */
export function isProductFiche(d: {
  code: string
  designation: string
  marque: string
  reference: string
}): boolean {
  const hasExigence = !!d.code.trim() && d.code.trim() !== '—'
  return hasExigence && isProductDocument(d) && !!d.designation.trim()
}

const DOC_TYPE_SET = new Set<string>(DOC_TYPES)

/**
 * Complétion « 1 produit = 1 fiche » : chaque produit réel de la liste des
 * marques (marque ou référence commerciale, statut ≠ NON CONFORME, rattaché à
 * une exigence du chapitre) DOIT avoir sa ligne « documents » — même sans URL
 * trouvée. Sinon la couverture plafonne aux fiches que l'agent a bien voulu
 * émettre (14 lignes pour 76 produits observés) : les autres produits
 * n'apparaissaient ni dans le compteur, ni dans « documents à obtenir », et
 * la passe de recherche ciblée ne les cherchait jamais.
 */
export function ensureProductDocRows(
  res: ChapterResult,
  chap: string,
  exigenceCodes?: string[],
): number {
  const normKey = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '')
  const refOf = (d: { reference: string; designation: string }) =>
    d.reference?.trim() && d.reference !== '—' ? d.reference : d.designation
  // Couverture par inclusion normalisée : « ACO Multidrain 100/150/200/300
  // (béton polymère…) » et « ACO Multidrain 100150200300 » désignent le même
  // produit — la même marque avec une référence qui en contient une autre.
  const have = res.documents.map((d) => ({
    m: normKey(d.marque || '—'),
    r: normKey(refOf(d)),
  }))
  const covered = (marque: string, refNorm: string) =>
    have.some(
      (k) =>
        k.m === normKey(marque || '—') &&
        k.r.length >= 4 &&
        refNorm.length >= 4 &&
        (k.r.includes(refNorm) || refNorm.includes(k.r)),
    )
  const obtainKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const obtain = new Set(res.a_obtenir.map((o) => obtainKey(o.document)))
  let added = 0
  for (const p of res.produits) {
    if (p.statut === 'NON CONFORME' || !isProductDocument(p)) continue
    const code = p.code.trim()
    if (!code || code === '—' || !p.designation.trim()) continue
    // Traçabilité : § d'exigence requis — sauf si le code cite le chapitre
    // lui-même (« Lot 1 Ch. 01i — Canalisations ») quand le CCTP n'a pas de
    // découpage en articles pour ce chapitre.
    if (
      exigenceCodes?.length &&
      !matchesExigenceCode(code, exigenceCodes) &&
      !normCode(code).includes(normCode(chap))
    )
      continue
    const refNorm = normKey(refOf(p))
    if (covered(p.marque, refNorm)) continue
    have.push({ m: normKey(p.marque || '—'), r: refNorm })
    res.documents.push({
      chap,
      code,
      designation: p.designation,
      marque: p.marque,
      reference: p.reference,
      type_document: 'Fiche_technique',
      filename: '—',
      url: '',
      source: '',
      statut: `À VALIDER | ${PDF_NON_TROUVE}`,
    })
    added++
    const label =
      `${p.marque !== '—' ? `${p.marque} ` : ''}${p.reference !== '—' ? p.reference : p.designation}`
    if (!obtain.has(obtainKey(label))) {
      obtain.add(obtainKey(label))
      res.a_obtenir.push({
        origine: 'fabricant',
        document: label.slice(0, 300),
        fabricant: p.marque !== '—' ? p.marque.slice(0, 120) : undefined,
        raison: 'Fiche technique officielle à obtenir pour le produit proposé',
        chap,
      })
    }
  }
  return added
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter(
        (x): x is Record<string, unknown> => !!x && typeof x === 'object',
      )
    : []
}
const s = (v: unknown, max = 500) => String(v ?? '').slice(0, max)

/** Normalise la sortie brute de l'agent en ChapterResult fiable.
 *  `exigences` (dépouillement du CCTP) active le contrôle de traçabilité : un
 *  document dont le § CCTP n'existe pas dans le chapitre est écarté. */
export function normalizeChapterResult(
  raw: unknown,
  chap: string,
  exigences?: ChapterRequirement[],
): ChapterResult {
  const r = (raw ?? {}) as Record<string, unknown>
  const out: ChapterResult = { ...EMPTY_CHAPTER_RESULT }

  out.produits = arr(r.produits)
    // Une exigence peut donner 1 à 3 marques proposées : 19 exigences × 3 = 57.
    .slice(0, 120)
    .map<DatasheetProduct>((p) => ({
      code: s(p.code, 30),
      designation: s(p.designation, 300),
      marque: s(p.marque || '—', 120),
      reference: s(p.reference || '—', 300),
      statut: (['OK', 'À VALIDER', 'NON CONFORME'] as const).includes(
        p.statut as never,
      )
        ? (p.statut as DatasheetProduct['statut'])
        : 'À VALIDER',
    }))

  const codes = (exigences ?? []).map((e) => e.code).filter((c) => c.trim())
  const usedNames = new Set<string>()
  out.documents = arr(r.documents)
    // Plusieurs documents officiels par marque proposée (fiche + notice + DoP).
    .slice(0, 140)
    .map<DatasheetDoc>((d) => {
      const t = DOC_TYPE_SET.has(String(d.type_document))
        ? (d.type_document as DocType)
        : 'Fiche_technique'
      const url = s(d.url, 2000)
      const doc: DatasheetDoc = {
        chap: s(d.chap || chap, 10),
        code: s(d.code, 30),
        designation: s(d.designation, 300),
        marque: s(d.marque || '—', 120),
        reference: s(d.reference || '—', 300),
        type_document: t,
        filename: '—',
        url,
        source: s(d.source, 500),
        statut: s(d.statut || 'À VALIDER', 300),
      }
      if (url) {
        // Nom de livraison reconstruit (format DCR) + dédup au sein du chapitre
        const base = docFilename(doc)
        let name = base
        for (let n = 2; usedNames.has(name); n++) {
          name = base.replace(/\.pdf$/i, ` (${n}).pdf`)
        }
        usedNames.add(name)
        doc.filename = name
      } else {
        // Règle DCR 7 : statut exact quand aucun PDF officiel n'a été trouvé
        doc.statut = `À VALIDER | ${PDF_NON_TROUVE}`
      }
      return doc
    })
    .filter((d) => {
      if (!isProductFiche(d)) return false
      // Traçabilité : le § CCTP cité doit exister dans le dépouillement.
      return !codes.length || matchesExigenceCode(d.code, codes)
    })

  out.conformite = arr(r.conformite)
    .slice(0, 150)
    .map<DatasheetConformite>((c) => ({
      chap: s(c.chap || chap, 10),
      code: s(c.code, 30),
      exigence: s(c.exigence, 1000),
      donnee_fabricant: s(c.donnee_fabricant, 1000),
      conforme: ['Oui', 'Non', 'À vérifier'].includes(String(c.conforme))
        ? (c.conforme as DatasheetConformite['conforme'])
        : 'À vérifier',
      commentaire: s(c.commentaire, 1000),
    }))

  out.ecarts = arr(r.ecarts)
    .slice(0, 50)
    .map<DatasheetEcart>((e) => ({
      criticite: ['BLOQUANT', 'MAJEUR', 'MINEUR'].includes(String(e.criticite))
        ? (e.criticite as DatasheetEcart['criticite'])
        : 'MINEUR',
      code: s(e.code, 30),
      objet: s(e.objet, 300),
      constat: s(e.constat, 2000),
      action: s(e.action, 2000),
    }))

  out.a_obtenir = arr(r.a_obtenir)
    .slice(0, 50)
    .map<DatasheetToObtain>((o) => ({
      origine: o.origine === 'fabricant' ? 'fabricant' : 'moe',
      document: s(o.document, 300),
      fabricant: s(o.fabricant, 120) || undefined,
      raison: s(o.raison, 500),
      chap: s(o.chap || chap, 10),
    }))

  // « 1 produit = 1 fiche » : toute marque/référence proposée obtient sa ligne
  // « documents » — la couverture vise les ~76 produits, pas les 14 fiches
  // que l'agent avait spontanément émises.
  ensureProductDocRows(out, chap, codes)

  return out
}

const MISSING_SYSTEM = `Tu es un agent de recherche DCR (entreprise BTP française).
Ta mission UNIQUE : retrouver l'URL du PDF de CHAQUE document listé — un
premier passage de recherche n'a rien trouvé. Tu es PERSÉVÉRANT : pour chaque
document, enchaîne plusieurs stratégies avant d'abandonner.

Deux natures de documents :
- FICHE PRODUIT FABRICANT (marque/référence commerciale) : le PDF officiel de
  l'éditeur (fiche technique, notice, DoP, avis technique, certificat).
- RÉFÉRENCE NORMATIVE / PRESCRIPTION (DTU, NF EN, NF P, guide CSTB, Eurocode,
  PV d'essais…) : cherche l'ÉDITION OFFICIELLE — CSTB, AFNOR, UNM, CERIB,
  Legifrance, site de l'organisme — ou un MIROIR PUBLIC qui héberge le document
  de l'éditeur. Précise alors la source exacte (« miroir <site> du document
  <éditeur> »). Beaucoup de DTU et guides sont diffusés librement : ne conclus
  pas trop vite à l'indisponibilité.
- Dans les deux cas : jamais de contournement d'anti-robot, jamais de lien
  douteux — si seul un document payant existe, ne renvoie rien pour cette ligne.

Tu disposes des outils web_search et web_fetch. Pour chaque produit :
1. « "marque" "référence" pdf » puis « "marque" "référence" fiche technique » ;
2. si la référence est imprécise : « "marque" "désignation" fiche technique » ;
3. cherche directement sur le site du fabricant (« site:fr fabricant + produit ») ;
4. si la marque est « — » ou inconnue : déduis-la de la désignation et cherche
   « "désignation" fiche technique pdf fabricant » ;
5. en dernier recours : distributeurs/catalogues officiels français
   (Point P, Gedimat, Cedeo, Batiproduits, DocThéo, techni-contact…) — note la
   source « distributeur » dans le champ source ;
6. OUVRE le candidat avec web_fetch pour vérifier qu'il s'agit bien du
   document du produit demandé ; le lien DIRECT du PDF (.pdf, download.aspx,
   scene7…) est prioritaire — en dernier recours seulement, une page produit
   officielle avec fiche téléchargeable est acceptable (note-le dans source) ;
7. si vraiment rien de fiable après 3-4 requêtes : ne renvoie rien pour ce
   produit — ne devine JAMAIS une URL.

Réponds UNIQUEMENT en JSON valide de cette forme :
{ "trouvailles": [ { "n": 1, "url": "https://…", "source": "site fabricant …" } ] }`

export interface MissingDocSearchResult {
  trouvailles: { n: number; url: string; source: string }[]
  model: string
  usage: { inputTokens: number; outputTokens: number }
}

/** Seconde passe ciblée : retrouver les URL PDF officielles des documents
 *  d'un chapitre pour lesquels la recherche principale n'a rien trouvé. */
export async function searchMissingDocUrls(opts: {
  operation: string
  lotLabel: string
  code: string
  chapter: ChapterDef
  docs: { designation: string; marque: string; reference: string; type_document: string }[]
}): Promise<MissingDocSearchResult> {
  const liste = opts.docs
    .map((d, i) => {
      const normative = !isProductDocument(d)
      return (
        `${i + 1}. ${d.designation} — marque « ${d.marque} », réf. « ${d.reference} »` +
        ` (document attendu : ${d.type_document.replace(/_/g, ' ')})` +
        (normative
          ? ' — RÉFÉRENCE NORMATIVE : édition officielle (CSTB/AFNOR/UNM/Legifrance) ou miroir public du document éditeur.'
          : ' — FICHE PRODUIT FABRICANT : PDF officiel de l’éditeur.')
      )
    })
    .join('\n')

  const prompt = `Opération : ${opts.operation}
Lot : ${opts.lotLabel}
Chapitre ${opts.code} — ${opts.chapter.libelle || opts.chapter.onglet}

Produits dont la fiche PDF officielle n'a pas été trouvée au premier passage —
retrouve le maximum d'URL de documents OFFICIELS (fiche technique, notice,
avis technique, certificat, DoP…) :

${liste}

JSON attendu : { "trouvailles": [ { "n": <numéro de la liste>, "url": "…", "source": "…" } ] }`

  const { data, model, usage } = await completeResearchJson<unknown>({
    system: MISSING_SYSTEM,
    prompt,
    maxTokens: 16_000,
    // ~5 recherches + 4 ouvertures par produit : la persévérance coûte du
    // budget, c'est assumé — chaque produit mérite plusieurs tentatives.
    maxSearches: Math.min(36, opts.docs.length * 5),
    maxFetches: Math.min(30, opts.docs.length * 4),
    // ~4 tours par produit + marge pour la rédaction finale.
    maxTurns: Math.min(30, 8 + opts.docs.length * 4),
  })
  return { trouvailles: extractTrouvailles(data), model, usage }
}

/** L'agent ne respecte pas toujours le schéma demandé : on accepte plusieurs
 *  formes (clé `trouvailles`/`resultats`/`results`, tableau racine, `n` en
 *  chaîne, url sous `url`/`lien`/`pdf`). Un schéma strict perdait toutes les
 *  trouvailles d'un lot entier. */
export function extractTrouvailles(raw: unknown): MissingDocSearchResult['trouvailles'] {
  const candidates: unknown[] = []
  if (Array.isArray(raw)) candidates.push(...raw)
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    for (const key of ['trouvailles', 'resultats', 'résultats', 'results', 'documents', 'urls']) {
      if (Array.isArray(o[key])) {
        candidates.push(...(o[key] as unknown[]))
        break
      }
    }
  }
  const out: MissingDocSearchResult['trouvailles'] = []
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const n = Number(o.n ?? o.numero ?? o.numéro ?? o.index ?? o.id)
    const url = String(o.url ?? o.lien ?? o.pdf ?? o.link ?? '').trim()
    if (!Number.isFinite(n) || n < 1 || !/^https?:\/\//i.test(url)) continue
    out.push({
      n: Math.trunc(n),
      url,
      source: String(o.source ?? o.site ?? o.fabricant ?? '').slice(0, 500),
    })
  }
  return out
}

/** Agent de recherche web pour UN chapitre (exigences CCTP déjà extraites). */
export async function researchChapter(opts: {
  operation: string
  lotLabel: string
  variantes: string[]
  code: string
  chapter: ChapterDef
  doutes: string[]
}): Promise<ResearchResult> {
  const exigences = opts.chapter.exigences
    .map(
      (e, i) =>
        `${i + 1}. [${e.code || '§'}] ${e.texte}` +
        (e.marques_imposees.length
          ? ` — marque(s) imposée(s) par le CCTP : ${e.marques_imposees.join(', ')}`
          : ' — aucune marque imposée (propose un produit conforme si l’exigence porte sur un matériau)'),
    )
    .join('\n')

  const prompt = USER_TEMPLATE.replaceAll('%OPERATION%', opts.operation)
    .replaceAll('%LOT%', opts.lotLabel)
    .replace(
      '%VARIANTES%',
      opts.variantes.length
        ? ` — variantes : ${opts.variantes.join(', ')}`
        : '',
    )
    .replaceAll('%CODE%', opts.code)
    .replace('%LIBELLE%', opts.chapter.libelle || opts.chapter.onglet)
    .replace(
      '%EXIGENCES%',
      exigences || '(aucune exigence extraite — déduis-les du contexte)',
    )
    .replace(
      '%DOUTES%',
      opts.doutes.length
        ? `ÉCARTS PRESSENTIS à vérifier et développer (cite les textes officiels) :\n${opts.doutes
            .map((d) => `- ${d}`)
            .join('\n')}`
        : '',
    )

  // Budget proportionnel au nombre d'exigences : proposer une marque par
  // exigence ET retrouver sa fiche demande ~2 recherches + 2 lectures chacune.
  const nEx = opts.chapter.exigences.length
  const { data, model, usage } = await completeResearchJson<unknown>({
    system: SYSTEM,
    prompt,
    maxTokens: 32_000,
    maxSearches: Math.min(44, 8 + nEx * 2),
    maxFetches: Math.min(40, 10 + nEx * 2),
    maxTurns: Math.min(40, 12 + nEx * 3),
  })
  return {
    result: normalizeChapterResult(data, opts.code, opts.chapter.exigences),
    model,
    usage,
  }
}
