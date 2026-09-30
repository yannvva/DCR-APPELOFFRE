# -*- coding: utf-8 -*-
# Contenu de test — remplit toutes les sections du gabarit tpl.docx.
# Conforme à la carte des blocs (identique à ce que génère generateContentPy).
tree = etree.parse(DIR + '/word/document.xml')
body_el = tree.getroot().find('w:body', ns)
blk = {i: body_el[i] for i in range(len(body_el))}
A = NAVY; AD = NAVYD; G = GREEN

# ======================= 2.1 =======================
set_content(blk[25], [
    chip('ANALYSE DU SITE ET DES CONTRAINTES OPÉRATIONNELLES', A),
    body([("L'opération test porte sur la rénovation d'un site occupé. ", False),
          ("Délai global : 8 mois. ", True),
          ("Critère technique : 40 points.", True)]),
    mini('Contexte du projet et spécificités du site', AD),
    body([('Site occupé, accès contraint, voisinage résidentiel.', False)]),
    tags(['8 mois de travaux', 'Site occupé', 'Remise 12h00'], A),
    mini('Consistance technique du lot', AD),
    body([('Curage, maçonnerie, plâtrerie, faux plafonds, menuiseries intérieures.', False)]),
    mini('Interfaces avec les autres lots', AD),
    body([('Coordination avec le lot électricité pour les réservations.', False)]),
    tags(['DPGF 24 postes'], A),
])
# ======================= 2.2 =======================
set_content(blk[27], [
    chip('IDENTIFICATION DES RISQUES ET SOLUTIONS PROPOSÉES', A),
    body([("Notre analyse croisée des pièces du DCE identifie quatre axes de risques propres à l'opération.", False)]),
])
risk_tbl = copy.deepcopy(blk[74])
blk[28].addnext(risk_tbl)
risk_tbl.addnext(copy.deepcopy(blk[28]))
rewrite_header_row(risk_tbl, ['RISQUE IDENTIFIÉ', 'CONSÉQUENCE POTENTIELLE', 'SOLUTION PROPOSÉE'])
fill_table(risk_tbl, [
    ["Coactivité en site occupé", "Gêne des occupants, arrêts", "Phasage hors horaires, PPSPS"],
    ["Délai contractuel court", "Pénalités 500 EUR/jour", "Anticipation des commandes"],
    ["Réseaux non repérés", "Endommagement, arrêt", "Recouvrement et détection géoradar"],
    ["Interface lots voisins", "Attentes, reprises", "Réunions de coordination hebdomadaires"],
    ["Pénurie appro plâtrerie", "Dérive planning", "Commande anticipée dès notification"],
    ["Amiante éventuel", "Arrêt de chantier", "Repérage avant travaux, SS4"],
    ["Accès chantier unique", "Congestion, retards livraisons", "Créneaux livraisons réservés"],
    ["Météo hivernale", "Retard curage extérieur", "Marge planning phase 2"],
    ["Note technique éliminatoire", "Offre irrégulière", "Relecture croisée qualité"],
    ["Réception partielle exigée", "Désorganisation", "Séquencement par zones"],
])

# ======================= 3.1 =======================
set_content(blk[31], [
    chip("ORGANISATION DE L'ÉQUIPE ET ENGAGEMENTS", A),
    body([('Une équipe dédiée est mobilisée pour cette opération, avec présence permanente du chef de chantier.', False)]),
    tags(['Chef de chantier permanent', 'Organigramme annexé'], A),
])
rewrite_header_row(blk[33], ['INTERVENANT', 'FONCTION', 'EXPÉRIENCE', 'AFFECTATION'])
fill_table(blk[33], [
    ["YILDIRIM Mathieu", "Directeur travaux", "DUT Génie Civil — 15 ans", "Pilotage hebdomadaire"],
    ["SELCUK Selami", "Chef de chantier TCE", "20 ans chantier", "Présence permanente"],
    ["Conducteur OPCT", "OPC interne", "10 ans", "Coordination lots"],
    ["Technicien études", "DAO / métrés", "8 ans", "Plans d'exécution"],
    ["Compagnons DCR", "Production", "Confirmés", "Effectif selon phasage"],
])
# ======================= 3.2 =======================
_trs = blk[37].findall('w:tr', ns)
cell_paras(_trs[1].findall('w:tc', ns)[-1], [
    mini('YILDIRIM MENDERES — CONDUCTEUR DE TRAVAUX TCE', AD),
    body([('Diplôme — ', True), ('BTS Bâtiment. Certification amiante SS4.', False)]),
    body([('Expérience — ', True), ('20 ans sur des opérations TCE en site occupé.', False)]),
    body([('Missions sur ce chantier — ', True), ('Pilotage technique, interfaces MOE.', False)]),
    tags(['BTS Bâtiment', 'Certifié amiante SS4', '20 ans expérience'], A),
])
cell_paras(_trs[2].findall('w:tc', ns)[-1], [
    mini('SELCUK SELAMI — CHEF DE CHANTIER TCE', AD),
    body([('Expérience — ', True), ('20 ans de conduite de chantiers tous corps.', False)]),
    body([('Missions sur ce chantier — ', True), ('Animation quotidienne, autocontrôles.', False)]),
    tags(['TCE', 'Site occupé', 'Autocontrôle'], A),
])
# ======================= 3.3 =======================
set_content(blk[39], [
    chip('PARTENAIRES TECHNIQUES MOBILISÉS', A),
    body([('Les bureaux d’études habituels de DCR sont mobilisés selon les besoins du lot.', False)]),
])
rewrite_header_row(blk[41], ["BUREAU D'ÉTUDES", 'SPÉCIALITÉ', 'MISSIONS'])
fill_table(blk[41], [
    ["ARTEC INGÉNIERIE", "Structure", "Notes de calcul, repérages"],
    ["BET Fluides", "CVC / plomberie", "Plans de réservations"],
])
# ======================= 3.4 =======================
set_content(blk[47], [
    chip('GESTION DES SOUS-TRAITANTS', A),
    body([('Aucune sous-traitance d’exécution n’est envisagée ; le cadre de la loi n°75-1334 s’appliquerait en cas de recours.', False)]),
    tags(['Loi n°75-1334', 'Aucune ST non agréée'], A),
])
rewrite_header_row(blk[49], ['ÉTAPE', 'ACTION', 'DOCUMENT PRODUIT', 'DÉLAI'])
fill_table(blk[49], [
    ["1 — Identification", "Sélection sur critères qualité", "Fiche d’évaluation", "J+15"],
    ["2 — Vérification", "Kbis, attestations, assurance", "Dossier de conformité", "Avant commande"],
    ["3 — Commande", "Bon de commande + CCTP", "BC signé", "Démarrage"],
    ["4 — Suivi", "Points hebdomadaires", "CR de coordination", "Hebdomadaire"],
    ["5 — Réception", "OPR poste par poste", "PV de réception", "Fin de poste"],
])
# ======================= 3.5 =======================
set_content(blk[51], [
    chip('DISPOSITIF DE CONTRÔLE QUALITÉ EN 3 NIVEAUX', A),
    body([('Un contrôle documenté et traçable est appliqué à chaque étape de production.', False)]),
])
rewrite_header_row(blk[53], ['NIVEAU DE CONTRÔLE', 'FRÉQUENCE', 'RESPONSABLE', 'LIVRABLE'])
fill_table(blk[53], [
    ["Contrôle interne terrain", "Quotidien", "Chef de chantier", "Check-list journalière"],
    ["Contrôle conducteur", "Hebdomadaire", "Conducteur de travaux", "Fiche de pointage qualité"],
    ["Audit direction", "Mensuel", "Direction technique", "Rapport d’audit"],
    ["Contrôle réception", "Fin de poste", "Conducteur + MOE", "PV de réception"],
    ["GPA", "Année de garantie", "Chef de chantier", "Registre SAV"],
])
set_content(blk[55], [
    body([("Dès qu'une carence est constatée, un plan de remplacement est activé sous 48 h.", False)]),
])
rewrite_header_row(blk[57], ['NIVEAU', 'DÉCLENCHEUR', 'MESURES ACTIVÉES', "DÉLAI D'ACTIVATION"])
fill_table(blk[57], [
    ["N1 — Absence ponctuelle", "Indisponibilité < 3 jours", "Compagnon de réserve", "Immédiat"],
    ["N2 — Carence confirmée", "Absence > 3 jours", "Recrutement intérim qualifié", "48 h"],
    ["N3 — Départ définitif", "Démission / rupture", "Mobilité inter-chantiers + direction", "24 h"],
])
# ======================= 3.6 =======================
set_content(blk[59], [
    chip("ENGAGEMENT ET CALCUL DES HEURES D'INSERTION", A),
    body([('Nous appliquons la clause sociale du marché avec un objectif de 10 % des heures.', False)]),
    tags(['10 % heures insertion', 'Bilan trimestriel MOA'], A),
])
rewrite_header_row(blk[61], ['RÉFÉRENCE CHANTIER', 'MOA', 'HEURES'])
fill_table(blk[61], [
    ["École maternelle Les Alliers", "Commune", "1 200 h"],
    ["Centre administratif", "Département", "800 h"],
    ["Gymnase municipal", "Ville", "650 h"],
])

# ======================= 4.1 =======================
set_content(blk[65], [
    chip('PRÉPARATION DE CHANTIER ET INSTALLATION DU SITE', A),
    body([("Le PIC est adapté au site occupé : accès unique, base vie en zone neutre.", False)]),
    mini('Clôture et signalisation', AD),
    body([('Clôtures HERAS, portail sécurisé, panneaux réglementaires.', False)]),
    tags(['PIC validé CSPS', 'Base vie conforme', 'Réseaux provisoires'], A),
])
# ======================= 4.2 =======================
set_content(blk[67], [
    chip("ÉTUDES D'EXÉCUTION ET TRAVAUX PRÉPARATOIRES", A),
    body([("Dès la notification : plans d'exécution, constat d'huissier, levées de réserves.", False)]),
    tags(['Constat huissier', 'Plans EXE validés', 'Consultations anticipées'], A),
])
# ======================= 4.3 =======================
para_replace(blk[71], list(chip('SÉQUENÇAGE DES INTERVENTIONS', A)))
para_replace(blk[72], list(body([("Le phasage ci-dessous s'inscrit dans le planning contractuel et le délai global de 8 mois.", False)])))
rewrite_header_row(blk[74], ['PHASE', 'OPÉRATIONS / PRESTATIONS DPGF', 'POINTS DE VIGILANCE'])
fill_table(blk[74], [
    ["Phase 0 — Préparation", "PIC, constat, plans EXE", "Validation CSPS"],
    ["Phase 1 — Curage", "Démolition, dépose plafonds", "Site occupé, tri sélectif"],
    ["Phase 2 — Maçonnerie", "Reprises, ouvertures", "Étais, fissurations"],
    ["Phase 3 — Plâtrerie", "Cloisons, doublages", "Alignements, planéité"],
    ["Phase 4 — Faux plafonds", "Ossatures, dalles", "Hauteurs libres"],
    ["Phase 5 — Menuiseries", "Blocs-portes, agencement", "Cotes finies"],
    ["Phase 6 — Finitions", "Peinture, retouches", "Pré-réception"],
    ["Phase 7 — Réception", "OPR, levées de réserves", "PV, DOE"],
    ["Phase 8 — Parfait achèvement", "SAV, garanties", "Registre SAV"],
    ["Phase 9 — Livraison", "Remise des clés", "Dossier des ouvrages"],
])
box_tc = blk[77].findall('.//w:tc', ns)[-1]
cell_paras(box_tc, [
    chip("MÉTHODOLOGIE D'EXÉCUTION", A),
    body([("Notre méthodologie est en cohérence complète avec le CCTP, le DPGF et le planning contractuel.", False)]),
])
# blk[80]/blk[81] : paragraphes dupliqués du gabarit → to_delete en fin de fichier
rewrite_header_row(blk[83], ['OUVRAGE / PRESTATION DPGF', "MÉTHODOLOGIE D'EXÉCUTION"])
fill_table(blk[83], [
    ["Curage intérieur", "Dépose méthodique par zones confinées, tri en bennes dédiées"],
    ["Maçonnerie de reprise", "Chaînages, linteaux, étais préalables, sondages"],
    ["Plâtrerie cloisons", "Ossatures métalliques, parements doubles, planéité contrôlée"],
    ["Faux plafonds", "Suspentes réglées, dalles démontables, trappes"],
    ["Menuiseries intérieures", "Pose en applique, réglage, joints périphériques"],
    ["Peinture", "Sous-couche + 2 couches, gamme A+"],
    ["Sols souples", "Ragréage, collage, soudure à chaud"],
    ["Sanitaires", "Remplacement appareils, raccordement existant"],
    ["Électricité interface", "Repères trajets, coordination lot dédié"],
    ["VRD empiétement", "Reprise bordures, passage piéton"],
    ["Nettoyage fin de chantier", "Bionettoyage, remise en état zones occupées"],
    ["Réception préparatoire", "Autocontrôle, pré-OPR interne"],
])
# ======================= 4.4 =======================
set_content(blk[86], [
    chip('MATÉRIAUX ET FOURNITURES — FICHES TECHNIQUES', A),
    body([('Matériaux conformes au CCTP ; marques prescrites ou équivalent, fiches techniques en annexe.', False)]),
    tags(['Fiches techniques en annexe', 'Fournisseurs locaux IDF'], A),
])
rewrite_header_row(blk[88], ['FAMILLE DE MATÉRIAUX', 'FOURNISSEUR(S) RÉFÉRENCÉ(S)', 'CERTIFICATION / NORME'])
fill_table(blk[88], [
    ["Plaques de plâtre", "Placo, Siniat ou équivalent", "NF EN 520 — émissions A+"],
    ["Ossatures métalliques", "Placo, Rondo ou équivalent", "NF EN 13964"],
    ["Dalles de plafond", "Armstrong, AMF ou équivalent", "EN 13964 — classe A+"],
    ["Laine minérale", "Isover, Rockwool ou équivalent", "ACERMI, émissions A+"],
    ["Blocs-portes", "Dorma, Jeld-Wen ou équivalent", "NF EN 14351"],
    ["Peintures", "Tollens, Zolpan ou équivalent", "Émissions A+"],
    ["Sols souples PVC", "Gerflor, Tarkett ou équivalent", "Émissions A+, FDES"],
    ["Colles et ragréages", "Mapei, Bostik ou équivalent", "EMICODE EC1"],
    ["Menuiseries bois", "Fabrication atelier DCR", "PEFC"],
    ["Enduits et mortiers", "PRB, Weber ou équivalent", "NF EN 998"],
    ["Carrelage", "Pavé, Novoceram ou équivalent", "PEI IV, UPEC"],
    ["Quincaillerie", "Häfele ou équivalent", "NF EN 1906"],
])
# ======================= 4.5 =======================
set_content(blk[90], [
    chip('MOYENS MATÉRIELS ET ENGINS AFFECTÉS', A),
    body([('Parc propre DCR mobilisé ; matériel adapté aux contraintes du site occupé.', False)]),
    tags(['Entrepôt 1 000 m²', 'Atelier 400 m² Aulnay', 'Parc propre'], A),
])
rewrite_header_row(blk[92], ['MATÉRIEL / ENGIN', 'CARACTÉRISTIQUE', "USAGE SUR L'OPÉRATION"])
fill_table(blk[92], [
    ["Entrepôt principal", "1 000 m² — Île-de-France", "Stockage et préparation"],
    ["Échafaudages roulants", "Hauteur 8 m", "Travaux en hauteur"],
    ["Bennes à déchets", "7 et 15 m³", "Tri sélectif sur site"],
    ["Outillage électroportatif", "Hilti, Festool", "Production"],
    ["Nacelle", "Électrique 10 m", "Faux plafonds, réseaux"],
    ["Camion benne", "3,5 t", "Évacuation déblais"],
    ["Groupe électrogène", "Secours", "Continuité de service"],
    ["Aspirateurs industriels", "Classe M", "Captage des poussières"],
    ["Ponts de chantier", "Modulaires", "Accès niveaux"],
])
# ======================= 4.6 =======================
set_content(blk[94], [
    chip('RÉCEPTION, LEVÉE DES RÉSERVES ET GARANTIE DE PARFAIT ACHÈVEMENT', A),
    body([('Modalités du CCAP appliquées : OPR contradictoire, levée des réserves sous 15 jours, GPA 12 mois.', False)]),
    tags(['2 compagnons dédiés', 'PV EXE8', 'GPA 12 mois', 'SAV 24-48h'], A),
])
rewrite_header_row(blk[96], ['ÉTAPE', 'MODALITÉ', 'DÉLAI / ENGAGEMENT'])
fill_table(blk[96], [
    ["OPR", "En présence MOA, MOE — vérification conformité", "Sur convocation"],
    ["Réserves", "Levée par poste avec contre-visite", "Sous 15 jours"],
    ["DOE", "Dossier des ouvrages exécutés", "Remise à la réception"],
    ["GPA", "Garantie de parfait achèvement", "12 mois"],
    ["SAV", "Intervention sur appel", "24-48 h"],
    ["Clôture", "PV de parfait achèvement", "Fin GPA"],
])

# ======================= 5.1 =======================
set_content(blk[100], [
    chip("CALENDRIER D'EXÉCUTION ET JALONS CONTRACTUELS", G),
    body([("Durée totale : 8 mois. Calendrier détaillé annexé, jalons contractuels respectés.", False)]),
    tags(['Planning annexé', 'Jalons contractuels', 'Période de préparation'], G),
])
rewrite_header_row(blk[102], ['PHASE', 'CONTENU', 'LIVRABLE'])
fill_table(blk[102], [
    ["J1 — Préparation", "Plans EXE, consultations, commandes", "Dossier de lancement"],
    ["J2 — Curage", "Démolition contrôlée", "PV d’avancement"],
    ["J3 — Corps d’état", "Maçonnerie, plâtrerie, plafonds", "Compte rendu hebdo"],
    ["J4 — Finitions", "Menuiseries, peinture, sols", "PV d’avancement"],
    ["J5 — Pré-réception", "Autocontrôle complet", "Check-list OPR"],
    ["J6 — Réception", "OPR, levée réserves, DOE", "PV de réception"],
])
# ======================= 5.2 =======================
set_content(blk[104], [
    chip('EFFECTIFS PRÉVISIONNELS SELON L’AVANCEMENT', G),
    body([('Effectifs ajustés selon le phasage ; visite hebdomadaire du conducteur de travaux.', False)]),
])
eff_tbl = copy.deepcopy(blk[102])
blk[105].addnext(eff_tbl)
eff_tbl.addnext(copy.deepcopy(blk[105]))
rewrite_header_row(eff_tbl, ['PHASE', 'EFFECTIF MOYEN', "COMPOSITION DE L'ÉQUIPE"])
fill_table(eff_tbl, [
    ["Préparation", "2", "Conducteur + technicien"],
    ["Curage", "5", "Chef de chantier + 4 compagnons"],
    ["Maçonnerie", "6", "Chef de chantier + 5 compagnons"],
    ["Plâtrerie / plafonds", "7", "Chef de chantier + 6 compagnons"],
    ["Finitions", "5", "Chef de chantier + 4 compagnons"],
    ["Réception", "3", "Chef de chantier + 2 compagnons"],
])
# ======================= 5.3 =======================
_trs = blk[106].findall('w:tr', ns)
cell_paras(_trs[1].findall('w:tc', ns)[-1], [
    chip('ANTICIPATION ET PILOTAGE CONTINU', G),
    body([('Le respect des délais repose sur un pilotage hebdomadaire et des marges planifiées.', False)]),
    tags(['Point hebdo', 'Marge tampon'], G),
])
cell_paras(_trs[2].findall('w:tc', ns)[-1], [
    chip('N1 — ALERTE', G),
    body([('Déclencheur — ', True), ('écart ≤ 5 jours sur un jalon.', False)]),
    body([('Mesures — ', True), ('réaffectation interne, horaires aménagés.', False)]),
    tags(['Activation immédiate'], G),
])
cell_paras(_trs[3].findall('w:tc', ns)[-1], [
    chip('N2 — CORRECTION', G),
    body([('Déclencheur — ', True), ('écart de 5 à 15 jours ou risque avéré.', False)]),
    body([('Mesures — ', True), ('double équipe, renforts matériels, astreintes.', False)]),
    tags(['Activation sous 48 h'], G),
])
cell_paras(_trs[4].findall('w:tc', ns)[-1], [
    chip('N3 — CRISE', G),
    body([('Déclencheur — ', True), ('écart > 15 jours ou jalon contractuel menacé.', False)]),
    body([('Mesures — ', True), ('cellule de crise direction, réorganisation du phasage.', False)]),
    tags(['Activation sous 24 h', 'Direction DCR mobilisée'], G),
])
cell_paras(_trs[5].findall('w:tc', ns)[-1], [
    chip('INDICATEURS DE SUIVI TRANSMIS À LA MAÎTRISE D’ŒUVRE', G),
    body([('Les indicateurs ci-dessous sont transmis chaque semaine au MOE et au MOA.', False)]),
])
rewrite_header_row(blk[108], ['INDICATEUR', 'FRÉQUENCE', 'RESPONSABLE', 'DESTINATAIRE'])
fill_table(blk[108], [
    ["Avancement physique par tâche (%)", "Hebdomadaire", "Chef de chantier", "MOE"],
    ["Courbe en S réelle / prévisionnelle", "Hebdomadaire", "Conducteur de travaux", "MOA / MOE"],
    ["Délais d’approvisionnement critiques", "Hebdomadaire", "Conducteur de travaux", "MOE"],
    ["Incidents qualité et réserves", "Hebdomadaire", "Chef de chantier", "MOE"],
    ["Taux de présence / effectifs", "Hebdomadaire", "Conducteur de travaux", "MOE"],
    ["Consommation des heures d’insertion", "Mensuelle", "Direction", "MOA"],
])
# ======================= 5.4 =======================
set_content(blk[110], [
    chip('ANTICIPATION LOGISTIQUE DÈS LA NOTIFICATION DU MARCHÉ', G),
    body([('Prix fermes du marché sécurisés ; matériaux critiques commandés dès notification.', False)]),
    tags(['Anticipation 15-30 j', 'Plan de secours activable', 'Contrôle réception'], G),
])
rewrite_header_row(blk[112], ['MATÉRIAU / FAMILLE', 'DÉLAI APPROVISIONNEMENT', 'MESURE DE SÉCURISATION'])
fill_table(blk[112], [
    ["Menuiseries intérieures", "6 à 10 semaines", "Commande dès validation EXE"],
    ["Dalles de plafond", "3 à 5 semaines", "Stock tampon entrepôt"],
    ["Blocs-portes techniques", "8 à 12 semaines", "Réserve usine"],
    ["Sols souples", "3 à 4 semaines", "Bain de teinte unique"],
    ["Plaques et ossatures", "1 à 2 semaines", "Stock permanent"],
    ["Peintures et enduits", "1 semaine", "Teintes validées en amont"],
])

# ======================= 6.1 =======================
_trs = blk[119].findall('w:tr', ns)
cell_paras(_trs[1].findall('w:tc', ns)[-1], [
    chip("PRÉSERVATION DE L'ENVIRONNEMENT D'USAGE", G),
    body([('État des lieux photographié, protections des zones adjacentes, passage balisé.', False)]),
    tags(['Constat d’entrée', 'Protections zones occupées'], G),
])
cell_paras(_trs[2].findall('w:tc', ns)[-1], [
    chip('MAÎTRISE DES NUISANCES SONORES ET ATMOSPHÉRIQUES', G),
    body([('Équipements silencieux, travaux bruyants sur créneaux convenus, captage poussières.', False)]),
    tags(['Créneaux bruit', 'Aspiration classe M'], G),
])
# ======================= 6.2 =======================
set_content(blk[121], [
    chip('PLAN DE TRI ET ORGANISATION (SOSED)', G),
    body([('SOSED établi dès la préparation ; bennes dédiées par flux.', False)]),
    tags(['SOSED', 'BSD', '> 80% valorisation'], G),
])
rewrite_header_row(blk[123], ['FLUX DE DÉCHETS', 'CONDITIONNEMENT', 'FILIÈRE', 'TRAÇABILITÉ'])
fill_table(blk[123], [
    ["Gravats inertes", "Benne dédiée", "Plateforme IDF agréée", "BSD"],
    ["Métaux", "Casier séparé", "Filière recyclage", "BSD"],
    ["Bois", "Benne dédiée", "Valorisation énergie", "BSD"],
    ["DIB", "Big-bags", "Centre de tri", "BSD"],
    ["DDS éventuels", "Fûts étanches", "Filière certifiée", "BSD"],
    ["Plâtre", "Sac dédié", "Filière plâtre agréée", "BSD"],
])
# ======================= 6.3 =======================
set_content(blk[126], [
    chip('DÉPOSE SÉLECTIVE ET VALORISATION DES MATÉRIAUX', G),
    body([('Réemploi via centre de tri partenaire ; objectif de valorisation supérieur à 80 %.', False)]),
    tags(['> 80 % valorisation', 'Diagnostic PEMD'], G),
])
# ======================= 6.4 =======================
set_content(blk[129], [
    chip('CRITÈRES DE SÉLECTION DES MATÉRIAUX', G),
    body([('Matériaux à faibles émissions : classe A ou A+, FDES, labels FSC/PEFC pour les bois.', False)]),
    tags(['FSC/PEFC', 'FDES', 'Émission A+', 'REACH'], G),
])
rewrite_header_row(blk[131], ['CRITÈRE', 'EXIGENCE', 'RÉFÉRENCE'])
fill_table(blk[131], [
    ["Émissions", "Classe A ou A+ obligatoire", "Arrêté du 19/04/2011"],
    ["Certification", "FDES pour produits du lot", "NF EN 15804"],
    ["Bois", "FSC ou PEFC", "Chaîne de traçabilité"],
    ["COV", "EMICODE EC1 colles", "REACH"],
    ["Fin de vie", "Recyclabilité documentée", "Fiches produit"],
    ["Santé chantier", "Sans CMR connus", "FDS"],
])
# ======================= 6.5 =======================
set_content(blk[133], [
    chip('RESPONSABILITÉ SOCIALE ET ENVIRONNEMENTALE', G),
    body([('Notre politique RSE se traduit par des engagements mesurables sur le chantier.', False)]),
    mini('Carbone', AD),
    body([('Trajets optimisés, motorisation Euro 6, éclairage basse consommation.', False)]),
    mini('Territoire', AD),
    body([('Insertion professionnelle selon la clause du marché (cf. §3.6).', False)]),
    mini('Équité', AD),
    body([('Conditions de travail dignes, accès sanitaires, pointage transparent.', False)]),
    tags(['ISO 14001', 'E+C-', 'Euro 6', 'Insertion §3.6'], G),
])

# ======================= 7.1 =======================
_trs = blk[139].findall('w:tr', ns)
cell_paras(_trs[1].findall('w:tc', ns)[-1], [
    chip("PLAN D'INSTALLATION DE CHANTIER (PIC)", A),
    body([('Dès la prise de possession : base vie, stockage sécurisé, plan de circulation.', False)]),
    tags(['PIC validé CSPS', 'Base vie conforme'], A),
])
cell_paras(_trs[2].findall('w:tc', ns)[-1], [
    chip('CLÔTURE DE CHANTIER ET SIGNALISATION', A),
    body([('Clôtures HERAS, portail à accès contrôlé, signalétique adaptée au site occupé.', False)]),
    tags(['Clôture HERAS', 'Accès filtré'], A),
])
# ======================= 7.2 =======================
set_content(blk[141], [
    chip('POLITIQUE DE PRÉVENTION', A),
    body([('PPSPS validé, plan de prévention commun avec les autres entreprises (décret 92-158).', False)]),
    tags(['PPSPS', 'Décret 92-158', 'Plan de prévention'], A),
])
rewrite_header_row(blk[143], ['EPI', 'NORME', 'RENOUVELLEMENT'])
fill_table(blk[143], [
    ["Chaussures de sécurité", "EN ISO 20345 S3", "Annuelle ou sur usure"],
    ["Casque de chantier", "EN 397", "3 ans ou choc"],
    ["Gants de manutention", "EN 388", "Sur usure"],
    ["Gilet haute visibilité", "EN ISO 20471", "Sur usure"],
    ["Protection auditive", "EN 352", "Selon exposition"],
    ["Lunettes / visière", "EN 166", "Sur usure"],
    ["Masque anti-poussière", "FFP2 / FFP3", "Par poste exposé"],
])
# ======================= 7.3 =======================
set_content(blk[145], [
    chip('POLITIQUE DE CONTRÔLE DES ACCÈS', A),
    body([('Vérification carte BTP à chaque entrée, registre de présence, référent travail dissimulé.', False)]),
    tags(['Carte BTP', 'CNAPS', 'Référent travail dissimulé'], A),
])
rewrite_header_row(blk[147], ['MESURE', 'MODALITÉ', 'RESPONSABLE'])
fill_table(blk[147], [
    ["Contrôle d’identité", "Carte BTP + lecture QR", "Chef de chantier"],
    ["Registre de présence", "Pointage quotidien", "Chef de chantier"],
    ["Visiteurs", "Autorisation + accompagnement", "Conducteur de travaux"],
    ["Livraisons", "Créneaux réservés, guidage", "Chef de chantier"],
    ["Surveillance hors horaires", "Verrouillage, alarme", "Chef de chantier"],
    ["Travail dissimulé", "Référent dédié, contrôles inopinés", "Direction DCR"],
])

# ============ SÉLECTION DES SECTIONS ============
# Paras dupliqués du gabarit toujours supprimés ; toutes les sections notées
# sont conservées ici (le RC test couvre l'ensemble des parties).
to_delete = [blk[80], blk[81]]
for el in to_delete:
    body_el.remove(el)

# ======================= BLOC DE FIN =======================
fix_red_headers(body_el)
tree.write(DIR + '/word/document.xml', xml_declaration=True, encoding='UTF-8', standalone=True)

s = open(DIR + '/word/document.xml', encoding='utf-8').read()
subs = [
    ("Mairie de Rambouillet — 2, place de la Libération, 78120 Rambouillet", "ESAT Marsoulan — 64-68 rue Robespierre, 93100 Montreuil"),
    ("Rénovation de l'école maternelle La Gommerie", "Mise aux normes et restructuration des ateliers du Pôle Compans — Montreuil (93)"),
    ("Lot 3 — Sols / Revêtements muraux / Maçonnerie", "Lot n°01 — Curage / Maçonnerie / Plâtrerie / Faux plafonds / Menuiseries intérieures"),
    ("[ N° de consultation / AO ]", "Consultation n°202608102352 — Procédure adaptée"),
    ("[ JJ / MM / AAAA ]", "Lundi 2 novembre 2026 à 12h00 — visite obligatoire (25/09 ou 09/10/2026)"),
]
for a, b in subs:
    assert a in s, a
    s = s.replace(a, b)
open(DIR + '/word/document.xml', 'w', encoding='utf-8').write(s)

f = open(DIR + '/word/footer1.xml', encoding='utf-8').read()
fsubs = [
    ("Rénovation de l'école maternelle La ", "Ateliers du Pôle Compans — ESAT Marsoulan, Montreuil (93)"),
    ("<w:t>Gommerie</w:t>", "<w:t></w:t>"),
    ("<w:t>ot</w:t>", "<w:t>Lot</w:t>"),
    (" 3 : Sols / Revêtements Muraux / Maçonnerie", " n°01 : Curage — Maçonnerie — Plâtrerie — Faux plafonds — Menuiseries int."),
]
for a, b in fsubs:
    assert a in f, a
    f = f.replace(a, b)
f = f.replace('w:val="EE0000"', 'w:val="1A4A7A"')
open(DIR + '/word/footer1.xml', 'w', encoding='utf-8').write(f)
print('OK')
