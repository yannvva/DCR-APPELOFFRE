import 'server-only'

import { complete } from '@/lib/ai/deepseek'
import type { MemoireAnalysis } from './types'
import TEMPLATE_TEXTS from './base/template_texts.json'

/**
 * Pipeline DCR — génération du fichier content_<AFFAIRE>.py (étape 1).
 * Le fichier suit la « carte des blocs » de base/tpl.docx (gabarit complet
 * 7 sections, 150 blocs — la charte graphique du mémoire type Compans) et
 * n'utilise que les fonctions de helpers_pa.py. Il est produit en 7 parties
 * (limite de tokens de sortie du LLM) puis assemblé et validé statiquement.
 *
 * Carte des blocs (vérifiée sur tpl.docx) :
 *   0   couverture        5   bannière « 1. PRÉSENTATION »
 *   8/10/12/15/17/19      contenus section 1 (boilerplate DCR — conservés)
 *   23  bannière « 2. COMPRÉHENSION DU PROJET »
 *   25  2.1 conteneur     27  2.2 conteneur (le tableau de risques est CLONÉ
 *                          depuis blk[74] et inséré via addnext — le gabarit
 *                          n'en contient pas en bloc séparé)
 *   29  bannière « 3. MOYENS HUMAINS »   31…61 contenus §3
 *   63  bannière « 4. MÉTHODOLOGIE »     65…96 contenus §4
 *   98  bannière « 5. PLANNING & DÉLAIS » 100…112 contenus §5
 *   117 bannière « 6. ENVIRONNEMENT »    119…133 contenus §6
 *   137 bannière « 7. SÉCURITÉ »         139…147 contenus §7
 *   149 sectPr
 *
 * Chaque tableau-conteneur a une bande colorée à gauche (cellule vide) et la
 * cellule de contenu à droite : set_content / cell_paras ciblent tc[-1].
 */

// ---------------------------------------------------------------------------
// Référence imposée au LLM : API helpers_pa.py + carte des blocs + interdits
// ---------------------------------------------------------------------------

const HELPERS_API = `API DISPONIBLE (helpers_pa.py — déjà importé, tu n'écris que le contenu) :
- chip(texte, couleur) → titre small-caps. Couleurs : A = NAVY (sections 2, 3, 4, 7), G = GREEN (sections 5 et 6), AD = NAVYD pour les sous-titres.
- body([("texte", False), ("gras", True), ...]) ou body("texte") → paragraphe courant. Mets en gras les données décisives (chiffres, dates, pénalités, exigences du RC).
- mini(texte, AD) → sous-titre marine gras.
- tags([items], couleur) → ligne de puces-étiquettes (5-6 items courts avec chiffres clés).
- set_content(blk[i], [paras]) → remplit la cellule de contenu (dernière ligne, dernière cellule) du tableau-conteneur.
- cell_paras(blk[i].findall('w:tr', ns)[N].findall('w:tc', ns)[-1], [paras]) → remplit la ligne N d'un conteneur multi-lignes.
- para_replace(blk[i], list(chip(...))) ou list(body([...])) → remplace un paragraphe en place.
- rewrite_header_row(blk[i], ['COL1','COL2',...]) → en-têtes de tableau (autant de labels que de colonnes).
- fill_table(blk[i], [[c1, c2, ...], ...]) → lignes de données ; purge les lignes existantes et reconstruit depuis la 1re ligne-modèle (une chaîne par cellule).
- copy.deepcopy(blk[74]) + blk[28].addnext(tbl) → insertion autorisée : le tableau des risques §2.2 (3 colonnes, même charte que le phasage).
- copy.deepcopy(blk[102]) + blk[105].addnext(tbl) → insertion autorisée : le tableau des effectifs §5.2 (3 colonnes, même charte que les jalons).
- to_delete = [blk[i], ...] puis boucle de suppression → SEULES suppressions autorisées : sections non notées par le RC.
Déjà définis : etree, copy, DIR, ns, blk (dict i→élément), A/AD/G, set_content, cell_paras, para_replace, rewrite_header_row, fill_table, fix_red_headers.`

const INTERDITS = `INTERDITS ABSOLUS :
- Éviter le caractère « & » dans les chaînes — écrire « et » (règle du pipeline).
- JAMAIS de markdown, de commentaire introductif ou de texte hors code.
- JAMAIS d'invention : chaque chiffre, date, pénalité, poste DPGF ou marque
  provient de la fiche d'analyse ; une donnée absente → formulation générique.
  Le « CONTENU ACTUEL DU GABARIT » fourni est du vrai contenu DCR — tu peux
  reprendre ses formulations et données entreprise (équipe, BET, parc, EPI),
  mais jamais ses données projet (site, MOA, planning, lots, montants).
- Ne pas déplacer de blocs ; ne toucher à aucun autre indice. La seule
  insertion autorisée est le tableau de risques cloné ; les seules
  suppressions passent par to_delete.
- Français uniquement (aucun caractère non français), première personne du
  pluriel (« nous »), phrases denses, zéro remplissage, gras sur les données
  décisives.
- Chips de section titrées sur les critères réels du RC quand ils existent :
  ex. chip('MÉTHODOLOGIE ET ORGANISATION (CRITÈRE — 20 PTS)', A).`

// Les chaînes de couverture et de pied de page sont FIXES (squelette tpl.docx).
export const COVER_SOURCES = [
  'Mairie de Rambouillet — 2, place de la Libération, 78120 Rambouillet',
  "Rénovation de l'école maternelle La Gommerie",
  'Lot 3 — Sols / Revêtements muraux / Maçonnerie',
  '[ N° de consultation / AO ]',
  '[ JJ / MM / AAAA ]',
  '[ Adresse — Téléphone — Email — Site web ]',
] as const
export const FOOTER_SOURCES = [
  "Rénovation de l'école maternelle La ",
  '<w:t>Gommerie</w:t>',
  '<w:t>ot</w:t>',
  ' 3 : Sols / Revêtements Muraux / Maçonnerie',
] as const

const SYSTEM = `Tu es l'assistant technique de DCR (entreprise générale de bâtiment).
Tu rédiges UNE PARTIE du fichier Python content_<AFFAIRE>.py qui remplit le
mémoire technique Word (le format vient du gabarit tpl.docx — charte DCR
complète ; tu n'écris que du contenu, via les helpers). Réponds UNIQUEMENT
avec le code Python de la partie demandée — pas de fences, pas de texte autour.

${HELPERS_API}

${INTERDITS}`

interface PartSpec {
  id: string
  consignes: string
  anchors: RegExp[]
  /** Blocs du gabarit dont le texte actuel est injecté dans le prompt. */
  tplRefs: number[]
}

const PARTS: PartSpec[] = [
  {
    id: 'partie 1/7 — section 2 (2.1, 2.2 + tableau des risques)',
    tplRefs: [25, 27],
    consignes: `Écris EXACTEMENT ces appels, dans cet ordre, avec le contenu rédigé :

# ======================= 2.1 =======================
set_content(blk[25], [
    chip('ANALYSE DU SITE ET DES CONTRAINTES OPÉRATIONNELLES', A),
    body([("…opération, MOA/MOE, allotissement, notre lot, critères de jugement avec points, visite de site…", False)]),
    mini('Contexte du projet et spécificités du site', AD),
    body([… site occupé ou non, accès, voisinage, phénomènes structurels …]),
    tags(['…chiffres clés : durée, surface, date de remise, pénalités…'], A),
    mini('Consistance technique du lot', AD),
    body([… postes DPGF détaillés …]),
    mini('Interfaces avec les autres lots', AD),
    body([…]),
    tags([…], A),
])
# ======================= 2.2 =======================
set_content(blk[27], [
    chip('IDENTIFICATION DES RISQUES ET SOLUTIONS PROPOSÉES', A),
    body([("…analyse croisée des pièces du DCE, axes de risques propres à l'opération…", False)]),
])
# Le gabarit n'a pas de tableau de risques séparé : on clone le tableau 3
# colonnes du phasage (blk[74]) — même charte — et on l'insère après le
# paragraphe d'espacement blk[28], suivi d'un espacement cloné (ordre exact
# du mémoire type : conteneur 2.2, espace, tableau, espace, bandeau §3).
risk_tbl = copy.deepcopy(blk[74])
blk[28].addnext(risk_tbl)
risk_tbl.addnext(copy.deepcopy(blk[28]))
rewrite_header_row(risk_tbl, ['RISQUE IDENTIFIÉ', 'CONSÉQUENCE POTENTIELLE', 'SOLUTION PROPOSÉE'])
fill_table(risk_tbl, [
    ["risque", "conséquence", "solution détaillée"],  # EXACTEMENT 10 lignes de risques,
    # du plus spécifique au site vers le contractuel : contrainte site n°1, risque
    # géotechnique/structurel, risque planning avec pénalité chiffrée, interfaces,
    # options/PSE à chiffrer, pièges du RC (offre irrégulière, note éliminatoire).
])`,
    anchors: [
      /set_content\(blk\[25\]/, /set_content\(blk\[27\]/,
      /copy\.deepcopy\(blk\[74\]\)/, /blk\[28\]\.addnext\(risk_tbl\)/,
      /rewrite_header_row\(risk_tbl/, /fill_table\(risk_tbl/,
    ],
  },
  {
    id: 'partie 2/7 — section 3 (3.1 organigramme/équipe, 3.2 CV, 3.3 BET)',
    tplRefs: [31, 33, 37, 39, 41],
    consignes: `Écris EXACTEMENT ces appels, dans cet ordre. L'équipe et les BET
sont des données ENTREPRISE du gabarit : reprends-les telles quelles, adapte
seulement les affectations/missions à cette opération.

# ======================= 3.1 =======================
set_content(blk[31], [
    chip("ORGANISATION DE L'ÉQUIPE ET ENGAGEMENTS", A),
    body([("…équipe mobilisée pour CETTE opération, présence permanente exigée par le RC si mentionnée…", False)]),
    tags(['Chef de chantier permanent', 'Organigramme annexé'], A),
])
rewrite_header_row(blk[33], ['INTERVENANT', 'FONCTION', 'EXPÉRIENCE', 'AFFECTATION'])
fill_table(blk[33], [
    ["nom — fonction", "expérience (reprendre le gabarit)", "affectation sur CETTE opération"],  # 5 lignes : l'équipe DCR du gabarit
])
# ======================= 3.2 =======================
_trs = blk[37].findall('w:tr', ns)
cell_paras(_trs[1].findall('w:tc', ns)[-1], [
    mini('YILDIRIM MENDERES — CONDUCTEUR DE TRAVAUX TCE', AD),
    body([('Diplôme — ', True), ('BTS Bâtiment. Certification amiante SS4.', False)]),
    body([('Expérience — ', True), ('…reprendre le CV du gabarit…', False)]),
    body([('Missions sur ce chantier — ', True), ('…adaptées à cette opération…', False)]),
    tags(['BTS Bâtiment', 'Certifié amiante SS4', '20 ans expérience'], A),
])
cell_paras(_trs[2].findall('w:tc', ns)[-1], [
    mini('SELCUK SELAMI — CHEF DE CHANTIER TCE', AD),
    body([('Expérience — ', True), ('…reprendre le CV du gabarit…', False)]),
    body([('Missions sur ce chantier — ', True), ('…adaptées à cette opération…', False)]),
    tags([…], A),
])
# ======================= 3.3 =======================
set_content(blk[39], [
    chip('PARTENAIRES TECHNIQUES MOBILISÉS', A),
    body([("…BET mobilisés selon les besoins réels du lot (géotechnique, structure, fluides…)…", False)]),
])
rewrite_header_row(blk[41], ["BUREAU D'ÉTUDES", 'SPÉCIALITÉ', 'MISSIONS'])
fill_table(blk[41], [
    ["BET du gabarit", "spécialité", "missions pour CETTE opération"],  # garder uniquement les BET utiles au lot
])`,
    anchors: [
      /set_content\(blk\[31\]/, /rewrite_header_row\(blk\[33\]/, /fill_table\(blk\[33\]/,
      /blk\[37\]\.findall/, /cell_paras\(_trs\[1\]/, /cell_paras\(_trs\[2\]/,
      /set_content\(blk\[39\]/, /rewrite_header_row\(blk\[41\]/, /fill_table\(blk\[41\]/,
    ],
  },
  {
    id: 'partie 3/7 — section 3 (3.4 sous-traitants, 3.5 qualité, 3.6 insertion)',
    tplRefs: [47, 49, 51, 53, 55, 57, 59, 61],
    consignes: `Écris EXACTEMENT ces appels, dans cet ordre. Process entreprise :
reprends le cadre du gabarit, adapte aux exigences du RC/CCAP (sous-traitance
imposée ou interdite, heures d'insertion chiffrées si clause sociale…).

# ======================= 3.4 =======================
set_content(blk[47], [
    chip('GESTION DES SOUS-TRAITANTS', A),
    body([('…sous-traitance prévue ou non selon l\u2019analyse ; cadre loi n°75-1334 si recours…', False)]),
    tags(['Loi n°75-1334', 'Aucune ST non agréée'], A),
])
rewrite_header_row(blk[49], ['ÉTAPE', 'ACTION', 'DOCUMENT PRODUIT', 'DÉLAI'])
fill_table(blk[49], [
    ["1 — Identification", "…", "…", "…"],  # 5 étapes : identification → contrôle (cadre du gabarit)
])
# ======================= 3.5 =======================
set_content(blk[51], [
    chip('DISPOSITIF DE CONTRÔLE QUALITÉ EN 3 NIVEAUX', A),
    body([('…contrôle documenté et traçable, adapté aux exigences qualité du CCTP…', False)]),
])
rewrite_header_row(blk[53], ['NIVEAU DE CONTRÔLE', 'FRÉQUENCE', 'RESPONSABLE', 'LIVRABLE'])
fill_table(blk[53], [
    ["…", "…", "…", "…"],  # 5 lignes : interne terrain → réception technique (gabarit)
])
set_content(blk[55], [
    body([("…gestion de la carence d'un intervenant — cadre du gabarit…", False)]),
])
rewrite_header_row(blk[57], ['NIVEAU', 'DÉCLENCHEUR', 'MESURES ACTIVÉES', "DÉLAI D'ACTIVATION"])
fill_table(blk[57], [
    ["N1 — Absence ponctuelle", "…", "…", "…"],  # N1 / N2 / N3 — cadre du gabarit
])
# ======================= 3.6 =======================
set_content(blk[59], [
    chip("ENGAGEMENT ET CALCUL DES HEURES D'INSERTION", A),
    body([("…heures d'insertion EXACTES du CCAP si la clause existe ; sinon engagement générique…", False)]),
    tags([…], A),
])
rewrite_header_row(blk[61], ['RÉFÉRENCE CHANTIER', 'MOA', 'HEURES'])
fill_table(blk[61], [
    ["référence du gabarit", "MOA", "heures"],  # 3 références d'insertion DCR réelles
])`,
    anchors: [
      /set_content\(blk\[47\]/, /rewrite_header_row\(blk\[49\]/, /fill_table\(blk\[49\]/,
      /set_content\(blk\[51\]/, /rewrite_header_row\(blk\[53\]/, /fill_table\(blk\[53\]/,
      /set_content\(blk\[55\]/, /rewrite_header_row\(blk\[57\]/, /fill_table\(blk\[57\]/,
      /set_content\(blk\[59\]/, /rewrite_header_row\(blk\[61\]/, /fill_table\(blk\[61\]/,
    ],
  },
  {
    id: 'partie 4/7 — section 4 (4.1, 4.2, 4.3 phasage et méthodologie)',
    tplRefs: [65, 67, 72, 74, 77, 81, 83],
    consignes: `Écris EXACTEMENT ces appels, dans cet ordre :

# ======================= 4.1 =======================
set_content(blk[65], [
    chip('PRÉPARATION DE CHANTIER ET INSTALLATION DU SITE', A),
    body([("…PIC adapté au site : accès réels, base vie, contraintes de la fiche…", False)]),
    mini("Clôture et signalisation", AD),
    body([…]),
    tags(['PIC validé CSPS', 'Base vie conforme', 'Réseaux provisoires'], A),
])
# ======================= 4.2 =======================
set_content(blk[67], [
    chip("ÉTUDES D'EXÉCUTION ET TRAVAUX PRÉPARATOIRES", A),
    body([('…activation dès notification : plans d\u2019exécution, constat huissier, géotechnique si la fiche en mentionne…', False)]),
    tags([…], A),
])
# ======================= 4.3 =======================
para_replace(blk[71], list(chip('SÉQUENÇAGE DES INTERVENTIONS', A)))
para_replace(blk[72], list(body([("…phasing inscrit dans le planning contractuel du DCE et le délai global…", False)])))
rewrite_header_row(blk[74], ['PHASE', 'OPÉRATIONS / PRESTATIONS DPGF', 'POINTS DE VIGILANCE'])
fill_table(blk[74], [
    ["Phase 0 — …", "postes DPGF + opérations", "vigilances"],  # 10-12 phases datées sur le planning réel
])
box_tc = blk[77].findall('.//w:tc', ns)[-1]
cell_paras(box_tc, [
    chip('MÉTHODOLOGIE D\u2019EXÉCUTION', A),
    body([("…cohérence CCTP/DPGF/CCAP/planning, bureau de contrôle s'il est nommé…", False)]),
])
# Les paragraphes blk[80]/blk[81] dupliquent l'encadré : ils sont vidés en
# fin de fichier via to_delete (comme dans le mémoire de référence).
rewrite_header_row(blk[83], ['OUVRAGE / PRESTATION DPGF', "MÉTHODOLOGIE D'EXÉCUTION"])
fill_table(blk[83], [
    ["Famille (repères DPGF)", "mode opératoire détaillé avec prescriptions CCTP (DTU, classes, tolérances, essais)"],  # 12-14 lignes, 1 par famille d'ouvrages
])`,
    anchors: [
      /set_content\(blk\[65\]/, /set_content\(blk\[67\]/,
      /para_replace\(blk\[71\]/, /para_replace\(blk\[72\]/,
      /rewrite_header_row\(blk\[74\]/, /fill_table\(blk\[74\]/,
      /blk\[77\]\.findall/, /cell_paras\(box_tc/,
      /rewrite_header_row\(blk\[83\]/, /fill_table\(blk\[83\]/,
    ],
  },
  {
    id: 'partie 5/7 — section 4 (4.4 matériaux, 4.5 moyens, 4.6 réception)',
    tplRefs: [86, 88, 90, 92, 94, 96],
    consignes: `Écris EXACTEMENT ces appels, dans cet ordre :

# ======================= 4.4 =======================
set_content(blk[86], [
    chip('MATÉRIAUX ET FOURNITURES — FICHES TECHNIQUES', A),
    body([('…marques prescrites par le CCTP ou « ou équivalent », fiches techniques en annexe…', False)]),
    tags(['Fiches techniques en annexe', 'Fournisseurs locaux IDF'], A),
])
rewrite_header_row(blk[88], ['FAMILLE DE MATÉRIAUX', 'FOURNISSEUR(S) RÉFÉRENCÉ(S)', 'CERTIFICATION / NORME'])
fill_table(blk[88], [
    ["famille", "marques prescrites par le CCTP ou 2-3 marques crédibles « ou équivalent »", "norme/certification"],  # 10-15 lignes issues des prescriptions du lot
])
# ======================= 4.5 =======================
set_content(blk[90], [
    chip('MOYENS MATÉRIELS ET ENGINS AFFECTÉS', A),
    body([('…parc propre DCR + matériel réellement nécessaire à ce chantier…', False)]),
    tags(['Entrepôt 1 000 m²', 'Atelier 400 m² Aulnay', 'Parc propre'], A),
])
rewrite_header_row(blk[92], ['MATÉRIEL / ENGIN', 'CARACTÉRISTIQUE', "USAGE SUR L'OPÉRATION"])
fill_table(blk[92], [
    ["…", "…", "…"],  # ~10 lignes adaptées au chantier
])
# ======================= 4.6 =======================
set_content(blk[94], [
    chip('RÉCEPTION, LEVÉE DES RÉSERVES ET GARANTIE DE PARFAIT ACHÈVEMENT', A),
    body([('…modalités exactes du CCAP : OPR, délais, GPA, DOE, SAV…', False)]),
    tags(['2 compagnons dédiés', 'PV EXE8', 'GPA 12 mois', 'SAV 24-48h'], A),
])
rewrite_header_row(blk[96], ['ÉTAPE', 'MODALITÉ', 'DÉLAI / ENGAGEMENT'])
fill_table(blk[96], [
    ["…", "…", "…"],  # ~6 lignes : OPR → GPA → SAV (gabarit + CCAP)
])`,
    anchors: [
      /set_content\(blk\[86\]/, /rewrite_header_row\(blk\[88\]/, /fill_table\(blk\[88\]/,
      /set_content\(blk\[90\]/, /rewrite_header_row\(blk\[92\]/, /fill_table\(blk\[92\]/,
      /set_content\(blk\[94\]/, /rewrite_header_row\(blk\[96\]/, /fill_table\(blk\[96\]/,
    ],
  },
  {
    id: 'partie 6/7 — section 5 (planning, jalons, rattrapage, appro)',
    tplRefs: [100, 102, 104, 106, 108, 110, 112],
    consignes: `Écris EXACTEMENT ces appels, dans cet ordre (couleur G = GREEN pour toute la section 5) :

# ======================= 5.1 =======================
set_content(blk[100], [
    chip("CALENDRIER D'EXÉCUTION ET JALONS CONTRACTUELS", G),
    body([("…durée TOTALE réelle du marché, périodes clés, planning annexé, disponibilité imposée par le calendrier…", False)]),
    tags(['Planning annexé', 'Jalons contractuels', 'Période de préparation'], G),
])
rewrite_header_row(blk[102], ['PHASE', 'CONTENU', 'LIVRABLE'])
fill_table(blk[102], [
    ["Préparation", "…", "…"],  # jalons réels du planning du DCE, livrable + date de chaque phase
])
# ======================= 5.2 =======================
set_content(blk[104], [
    chip('EFFECTIFS PRÉVISIONNELS SELON L\u2019AVANCEMENT', G),
    body([('…effectifs moyens par phase, fréquence de visite du conducteur si le RC l\u2019exige…', False)]),
])
# Le gabarit n'a pas de tableau d'effectifs séparé : on clone le tableau 3
# colonnes des jalons (blk[102]) — même charte — inséré après l'espacement
# blk[105], suivi d'un espacement cloné (ordre exact du mémoire type).
eff_tbl = copy.deepcopy(blk[102])
blk[105].addnext(eff_tbl)
eff_tbl.addnext(copy.deepcopy(blk[105]))
rewrite_header_row(eff_tbl, ['PHASE', 'EFFECTIF MOYEN', "COMPOSITION DE L'ÉQUIPE"])
fill_table(eff_tbl, [
    ["phase", "effectif moyen", "composition de l'équipe"],  # ~6 lignes calées sur le phasage réel
])
# ======================= 5.3 =======================
_trs = blk[106].findall('w:tr', ns)
cell_paras(_trs[1].findall('w:tc', ns)[-1], [chip('ANTICIPATION ET PILOTAGE CONTINU', G), body([…]), tags([…], G)])
cell_paras(_trs[2].findall('w:tc', ns)[-1], [chip('N1 — ALERTE', G), body([('Déclencheur — ', True), ('écart ≤ x jours…', False)]), body([('Mesures — ', True), ('…', False)]), tags(['Activation immédiate'], G)])
cell_paras(_trs[3].findall('w:tc', ns)[-1], [chip('N2 — CORRECTION', G), body([('Déclencheur — ', True), ('…', False)]), body([('Mesures — ', True), ('…', False)]), tags(['Activation sous 48 h'], G)])
cell_paras(_trs[4].findall('w:tc', ns)[-1], [chip('N3 — CRISE', G), body([('Déclencheur — ', True), ('…', False)]), body([('Mesures — ', True), ('…', False)]), tags(['Activation sous 24 h', 'Direction DCR mobilisée'], G)])
cell_paras(_trs[5].findall('w:tc', ns)[-1], [chip('INDICATEURS DE SUIVI TRANSMIS À LA MAÎTRISE D\u2019ŒUVRE', G), body([…])])
rewrite_header_row(blk[108], ['INDICATEUR', 'FRÉQUENCE', 'RESPONSABLE', 'DESTINATAIRE'])
fill_table(blk[108], [
    ["…", "…", "…", "…"],  # 5 indicateurs
])
# ======================= 5.4 =======================
set_content(blk[110], [
    chip('ANTICIPATION LOGISTIQUE DÈS LA NOTIFICATION DU MARCHÉ', G),
    body([('…logistique + prix ferme/révisable + matériaux critiques du lot…', False)]),
    tags(['Anticipation 15-30 j', 'Plan de secours activable', 'Contrôle réception'], G),
])
rewrite_header_row(blk[112], ['MATÉRIAU / FAMILLE', 'DÉLAI APPROVISIONNEMENT', 'MESURE DE SÉCURISATION'])
fill_table(blk[112], [
    ["…", "délai réel", "…"],  # ~6 lignes adaptées aux matériaux du lot
])`,
    anchors: [
      /set_content\(blk\[100\]/, /rewrite_header_row\(blk\[102\]/, /fill_table\(blk\[102\]/,
      /set_content\(blk\[104\]/,
      /copy\.deepcopy\(blk\[102\]\)/, /blk\[105\]\.addnext\(eff_tbl\)/,
      /rewrite_header_row\(eff_tbl/, /fill_table\(eff_tbl/,
      /blk\[106\]\.findall/, /cell_paras\(_trs\[1\]/, /cell_paras\(_trs\[2\]/,
      /cell_paras\(_trs\[3\]/, /cell_paras\(_trs\[4\]/, /cell_paras\(_trs\[5\]/,
      /rewrite_header_row\(blk\[108\]/, /fill_table\(blk\[108\]/,
      /set_content\(blk\[110\]/, /rewrite_header_row\(blk\[112\]/, /fill_table\(blk\[112\]/,
    ],
  },
  {
    id: 'partie 7/7 — sections 6 + 7, sélection des sections, couverture, pied de page',
    tplRefs: [119, 121, 123, 126, 129, 131, 133, 139, 141, 143, 145, 147],
    consignes: `Écris EXACTEMENT ces appels, dans cet ordre (G = GREEN section 6, A = NAVY section 7) :

# ======================= 6.1 =======================
_trs = blk[119].findall('w:tr', ns)
cell_paras(_trs[1].findall('w:tc', ns)[-1], [chip("PRÉSERVATION DE L'ENVIRONNEMENT D'USAGE", G), body([… protections adaptées au site réel — occupants, voisinage, voiries …]), tags([…], G)])
cell_paras(_trs[2].findall('w:tc', ns)[-1], [chip('MAÎTRISE DES NUISANCES SONORES ET ATMOSPHÉRIQUES', G), body([…]), tags([…], G)])
# ======================= 6.2 =======================
set_content(blk[121], [chip('PLAN DE TRI ET ORGANISATION (SOSED)', G), body([…]), tags(['SOSED', 'BSD', '> 80% valorisation'], G)])
rewrite_header_row(blk[123], ['FLUX DE DÉCHETS', 'CONDITIONNEMENT', 'FILIÈRE', 'TRAÇABILITÉ'])
fill_table(blk[123], [
    ["…", "…", "…", "…"],  # ~6 flux réels du chantier (gravats, métaux, bois, DIB, DDS…)
])
# ======================= 6.3 =======================
set_content(blk[126], [chip('DÉPOSE SÉLECTIVE ET VALORISATION DES MATÉRIAUX', G), body([('…réemploi : centre de tri Villeneuve-le-Roi, objectif > 80%, CYCLE UP ou BELLASTOCK…', False)]), tags([…], G)])
# ======================= 6.4 =======================
set_content(blk[129], [chip('CRITÈRES DE SÉLECTION DES MATÉRIAUX', G), body([… exigences env du CCTP : FDES, A+, FSC/PEFC …]), tags(['FSC/PEFC', 'FDES', 'Émission A+', 'REACH'], G)])
rewrite_header_row(blk[131], ['CRITÈRE', 'EXIGENCE', 'RÉFÉRENCE'])
fill_table(blk[131], [
    ["…", "…", "…"],  # ~6 critères (émissions, certification, COV, fin de vie, traçabilité, santé chantier)
])
# ======================= 6.5 =======================
set_content(blk[133], [chip('RESPONSABILITÉ SOCIALE ET ENVIRONNEMENTALE', G), body([… RSE chantier …]), mini('Carbone', AD), body([…]), mini('Territoire', AD), body([…]), mini('Équité', AD), body([…]), tags([…], G)])
# ======================= 7.1 =======================
_trs = blk[139].findall('w:tr', ns)
cell_paras(_trs[1].findall('w:tc', ns)[-1], [chip("PLAN D'INSTALLATION DE CHANTIER (PIC)", A), body([…]), tags(['PIC validé CSPS', 'Base vie conforme'], A)])
cell_paras(_trs[2].findall('w:tc', ns)[-1], [chip('CLÔTURE DE CHANTIER ET SIGNALISATION', A), body([… clôtures HERAS, portail, signalétique adaptés au site …]), tags([…], A)])
# ======================= 7.2 =======================
set_content(blk[141], [chip('POLITIQUE DE PRÉVENTION', A), body([… PPSPS, coactivité décret 92-158, plan de prévention commun …]), tags(['PPSPS', 'Décret 92-158', 'Plan de prévention'], A)])
rewrite_header_row(blk[143], ['EPI', 'NORME', 'RENOUVELLEMENT'])
fill_table(blk[143], [
    ["Chaussures de sécurité", "EN ISO 20345 S3", "Annuelle ou sur usure"],  # ~7 EPI du gabarit + EPI spécifiques au lot (amiante SS4 si concerné…)
])
# ======================= 7.3 =======================
set_content(blk[145], [chip('POLITIQUE DE CONTRÔLE DES ACCÈS', A), body([… carte BTP, registre de présence, référent travail dissimulé …]), tags(['Carte BTP', 'CNAPS', 'Référent travail dissimulé'], A)])
rewrite_header_row(blk[147], ['MESURE', 'MODALITÉ', 'RESPONSABLE'])
fill_table(blk[147], [
    ["…", "…", "…"],  # ~6 mesures du gabarit
])

# ============ SÉLECTION DES SECTIONS (critères du RC) ============
# blk[80] et blk[81] : paragraphes « MÉTHODOLOGIE D'EXÉCUTION » qui dupliquent
# l'encadré blk[77] — TOUJOURS supprimés (comme dans le mémoire de référence).
to_delete = [blk[80], blk[81]]
# Sections 2, 4, 5 : toujours conservées. Pour les autres, garde la section si
# un critère noté du RC la couvre ; sinon ajoute TOUS ses blocs :
#   section 1 (présentation entreprise/références) → blk[4] à blk[22]
#   section 3 (moyens humains)                      → blk[29] à blk[62]
#   section 6 (environnement)                       → blk[113] à blk[136]
#   section 7 (sécurité et organisation)            → blk[137] à blk[148]
# En cas de doute sur un critère → conserve la section. Exemple :
# to_delete += [blk[i] for i in range(4, 23)]    # si §1 non notée par le RC
for el in to_delete:
    body_el.remove(el)

# ======================= BLOC DE FIN (structure fixe) =======================
fix_red_headers(body_el)
tree.write(DIR + '/word/document.xml', xml_declaration=True, encoding='UTF-8', standalone=True)

s = open(DIR + '/word/document.xml', encoding='utf-8').read()
subs = [
    ("Mairie de Rambouillet — 2, place de la Libération, 78120 Rambouillet", "<moa de la fiche>"),
    ("Rénovation de l'école maternelle La Gommerie", "<opération courte ≤ 75 car.>"),
    ("Lot 3 — Sols / Revêtements muraux / Maçonnerie", "<lot>"),
    ("[ N° de consultation / AO ]", "<référence consultation + procédure>"),
    ("[ JJ / MM / AAAA ]", "<date limite remise + visite éventuelle>"),
    ("[ Adresse — Téléphone — Email — Site web ]", "<ligne coordonnées du PROFIL SOCIÉTÉ si fournie, sinon conserve une ligne sobre type « Adresse — Téléphone — Email — Site web » avec les vraies données DCR du gabarit>"),
]
for a, b in subs:
    assert a in s, a
    s = s.replace(a, b)
open(DIR + '/word/document.xml', 'w', encoding='utf-8').write(s)

f = open(DIR + '/word/footer1.xml', encoding='utf-8').read()
fsubs = [
    ("Rénovation de l'école maternelle La ", "<opération courte>"),
    ("<w:t>Gommerie</w:t>", "<w:t></w:t>"),
    ("<w:t>ot</w:t>", "<w:t>Lot</w:t>"),
    (" 3 : Sols / Revêtements Muraux / Maçonnerie", " <n° lot> : <intitulé lot>"),
]
for a, b in fsubs:
    assert a in f, a
    f = f.replace(a, b)
f = f.replace('w:val="EE0000"', 'w:val="1A4A7A"')  # pied de page : rouge placeholder → marine DCR
open(DIR + '/word/footer1.xml', 'w', encoding='utf-8').write(f)
print('OK')`,
    anchors: [
      /blk\[119\]\.findall/, /blk\[139\]\.findall/,
      /set_content\(blk\[121\]/, /rewrite_header_row\(blk\[123\]/, /fill_table\(blk\[123\]/,
      /set_content\(blk\[126\]/, /set_content\(blk\[129\]/,
      /rewrite_header_row\(blk\[131\]/, /fill_table\(blk\[131\]/, /set_content\(blk\[133\]/,
      /set_content\(blk\[141\]/, /rewrite_header_row\(blk\[143\]/, /fill_table\(blk\[143\]/,
      /set_content\(blk\[145\]/, /rewrite_header_row\(blk\[147\]/, /fill_table\(blk\[147\]/,
      /to_delete/, /fix_red_headers/, /subs = \[/, /fsubs = \[/, /footer1\.xml/, /print\(['"]OK['"]\)/,
    ],
  },
]

const PROLOGUE = (lotLabel: string) => `# -*- coding: utf-8 -*-
# ---- Contenu ${lotLabel} — généré par Nexus (étape 1 du pipeline mémoire DCR) ----
tree = etree.parse(DIR + '/word/document.xml')
body_el = tree.getroot().find('w:body', ns)
blk = {i: body_el[i] for i in range(len(body_el))}
A = NAVY; AD = NAVYD; G = GREEN
`

// ---------------------------------------------------------------------------
// Validation statique du fichier produit
// ---------------------------------------------------------------------------

/** Retire les littéraux '…'/"…" et commentaires pour un comptage fiable. */
function stripStringsAndComments(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const c = code[i]
    if (c === '#') {
      while (i < code.length && code[i] !== '\n') i++
    } else if (c === "'" || c === '"') {
      i++
      while (i < code.length && code[i] !== c) {
        if (code[i] === '\\') i++
        i++
      }
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

/** Résout les alias `x = blk[N]` utilisés par les exemples du pipeline
 *  (risk_tbl = blk[74]…) avant le test des ancres. */
function resolveBlkAliases(code: string): string {
  const aliases = new Map<string, string>()
  for (const m of code.matchAll(/^[ \t]*(\w+)\s*=\s*blk\[(\d+)\][ \t]*$/gm)) {
    aliases.set(m[1], `blk[${m[2]}]`)
  }
  if (!aliases.size) return code
  return code.replace(/\b\w+\b/g, (w) => aliases.get(w) ?? w)
}

export function validateContentPy(code: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const aliased = resolveBlkAliases(code)
  for (const src of [...COVER_SOURCES]) {
    if (!code.includes(`("${src}"`) && !code.includes(`('${src}'`)) {
      errors.push(`chaîne de couverture absente : « ${src.slice(0, 50)}… »`)
    }
  }
  for (const src of [...FOOTER_SOURCES]) {
    if (!code.includes(`("${src}"`) && !code.includes(`('${src}'`)) {
      errors.push(`chaîne de pied de page absente : « ${src.slice(0, 50)}… »`)
    }
  }
  for (const part of PARTS) {
    for (const re of part.anchors) {
      if (!re.test(aliased)) errors.push(`appel manquant : ${re.source.replace(/\\/g, '')}`)
    }
  }
  // « & » : toléré par les exemples du pipeline (lxml échappe le texte), mais
  // signalé pour relecture — la règle du process demande « et ».
  if (code.includes('&')) {
    warnings.push("caractère « & » présent — le pipeline recommande « et »")
  }
  const bare = stripStringsAndComments(code)
  for (const [open, close] of [['(', ')'], ['[', ']']] as const) {
    const no = bare.split(open).length - 1
    const nc = bare.split(close).length - 1
    if (no !== nc) errors.push(`déséquilibre ${open}${close} hors chaînes : ${no} vs ${nc}`)
  }
  if (/^```/m.test(code)) errors.push('fences markdown résiduelles')

  // Sécurité : le fichier est exécuté par Python à l'étape 2 (build .docx).
  // Le squelette du pipeline n'utilise que des appels helpers + la boucle
  // subs/fsubs/to_delete — toute autre primitive est refusée.
  for (const [re, name] of [
    [/\bimport\b/, 'import'],
    [/\bexec\b/, 'exec'], [/\beval\b/, 'eval'], [/\bcompile\b/, 'compile'],
    [/\binput\b/, 'input'], [/\bbreakpoint\b/, 'breakpoint'],
    [/\bglobals\b/, 'globals'], [/\blocals\b/, 'locals'], [/\bvars\b/, 'vars'],
    [/\bgetattr\b/, 'getattr'], [/\bsetattr\b/, 'setattr'],
    [/\bwhile\b/, 'while'], [/\bdef\b/, 'def'], [/\bclass\b/, 'class'],
    [/\blambda\b/, 'lambda'], [/\byield\b/, 'yield'], [/\bwith\b/, 'with'],
    [/\btry\b/, 'try'], [/\braise\b/, 'raise'],
  ] as const) {
    if (re.test(bare)) errors.push(`instruction hors squelette : ${name}`)
  }
  if (bare.includes('__')) errors.push('accès dunder (__) interdit')
  // open() n'est légitime que sur DIR (remplacements couverture / pied de page)
  for (const m of bare.matchAll(/open\s*\(/g)) {
    if (!/^open\s*\(\s*DIR/.test(bare.slice(m.index))) {
      errors.push('open() ne doit cibler que DIR + …')
    }
  }
  // Boucles : uniquement celles du squelette (subs, fsubs, to_delete, blk,
  // range borné pour les plages de blocs à supprimer)
  const FOR_OK = [
    /for a, b in subs/, /for a, b in fsubs/, /for el in to_delete/,
    /for i in range\(len\(body_el\)\)/, /for i in range\(\d+,?\s*\d*\)/,
  ]
  for (const m of bare.matchAll(/\bfor\s[^\n:]*/g)) {
    if (!FOR_OK.some((re) => re.test(m[0]))) {
      errors.push(`boucle for hors squelette : « ${m[0].trim().slice(0, 60)} »`)
    }
  }
  return { errors, warnings }
}

function stripFences(text: string): string {
  const cleaned = text.trim()
  const m = cleaned.match(/^```(?:python|py)?\s*\n([\s\S]*?)\n?```\s*$/i)
  return (m ? m[1] : cleaned.replace(/^```(?:python|py)?\s*/i, '').replace(/\s*```\s*$/i, '')).trim()
}

export interface MemoireGeneration {
  code: string
  filename: string
  warnings: string[]
  model: string
  usage: { inputTokens: number; outputTokens: number }
}

/** Injecte le texte actuel du gabarit pour les blocs à adapter. */
function tplContext(refs: number[]): string {
  const entries = refs
    .map((i) => `blk[${i}] : ${(TEMPLATE_TEXTS as Record<string, string>)[String(i)] ?? ''}`)
    .filter((l) => !l.endsWith(': '))
  return entries.length
    ? `\n\nCONTENU ACTUEL DU GABARIT (vrai contenu DCR — adapte au projet, ne recopie pas les données du chantier Rambouillet) :\n${entries.join('\n\n')}`
    : ''
}

/** Étapes : fiche d'analyse → fichier content_<AFFAIRE>.py complet et validé. */
export async function generateContentPy(opts: {
  analysis: MemoireAnalysis
  lotLabel: string
  filenameBase: string
  /** Profil société (page /societe) — source de vérité entreprise. */
  company?: { context: string; coverLine?: string }
}): Promise<MemoireGeneration> {
  const fiche = JSON.stringify(opts.analysis, null, 1)
  const usage = { inputTokens: 0, outputTokens: 0 }
  let model = 'deepseek'
  const chunks: string[] = []
  const warnings: string[] = []

  const companyBlock = opts.company?.context
    ? `\n\nPROFIL SOCIÉTÉ (données officielles de l'entreprise — source de vérité, prioritaire sur le gabarit pour tout ce qui concerne DCR : identité, équipe, références, présentation, coordonnées) :\n${opts.company.context}${opts.company.coverLine ? `\nLIGNE COORDONNÉES à utiliser pour le sub « [ Adresse — Téléphone — Email — Site web ] » : ${opts.company.coverLine}` : ''}`
    : ''

  for (const part of PARTS) {
    const basePrompt = `Affaire : ${opts.lotLabel}

FICHE D'ANALYSE DU DCE (données sourcées — ne rien inventer au-delà) :
${fiche}
${tplContext(part.tplRefs)}${companyBlock}

${part.consignes}`

    let code = ''
    let lastErr = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nTa réponse précédente était invalide : ${lastErr}. Corrige et renvoie la partie complète.`
      const r = await complete({ system: SYSTEM, prompt, maxTokens: 8_000 })
      model = r.model
      usage.inputTokens += r.usage.inputTokens
      usage.outputTokens += r.usage.outputTokens
      code = stripFences(r.text)
      const aliased = resolveBlkAliases(code)
      const missing = part.anchors.filter((re) => !re.test(aliased)).map((re) => re.source)
      if (!missing.length) break
      lastErr = `appels obligatoires absents : ${missing.join(', ')}`
      code = ''
    }
    if (!code) throw new Error(`${part.id} : génération invalide (${lastErr}).`)
    chunks.push(code)
  }

  const file = `${PROLOGUE(opts.lotLabel)}\n${chunks.join('\n\n')}\n`

  const { errors, warnings: vWarnings } = validateContentPy(file)
  warnings.push(...vWarnings)
  if (errors.length) {
    throw new Error(`Fichier généré invalide : ${errors.slice(0, 4).join(' ; ')}`)
  }

  const filename = `content_${opts.filenameBase}.py`
  return { code: file, filename, warnings, model, usage }
}
