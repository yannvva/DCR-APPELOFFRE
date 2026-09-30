/**
 * Règles méthodologiques DCR — recopiées telles quelles dans chaque brief
 * (source : "02 - Prompts/01 - Regles methodologiques DCR.txt").
 */
export const DCR_RULES = `MÉTHODOLOGIE ABSOLUE (DCR) :
1. Ne JAMAIS inventer une marque, une référence, une caractéristique, une certification,
   un avis technique, un classement feu, une performance acoustique ni un lien PDF.
2. Uniquement des PDF officiels du fabricant (ou d'un organisme officiel : CSTB, AFNOR,
   Legifrance…). Un miroir distributeur n'est accepté que s'il héberge le document
   éditeur du fabricant, et il est alors signalé dans le champ "source".
3. Chaque URL citée doit avoir été réellement ouverte (web_fetch) et renvoyer un PDF.
4. Une FDS n'est JAMAIS une fiche technique. Les FDS portent le type "FDS".
5. Ne jamais utiliser une fiche générique quand une fiche précise existe.
6. Ne jamais déclarer une conformité sans comparer chiffre par chiffre la donnée du
   document fabricant et l'exigence du CCTP.
7. Si aucun PDF officiel n'existe : url "" et statut exactement
   "À VALIDER | Fiche technique PDF officielle non trouvée à ce stade — validation fournisseur/fabricant nécessaire".
8. Ne jamais contourner une protection anti-robot (Cloudflare, captcha). Chercher un
   autre hébergement officiel (DAM fabricant, batipedia…) ou déclarer "à obtenir".
9. Quand le CCTP n'impose aucune marque, les marques proposées sont des PROPOSITIONS
   DCR à soumettre à l'agrément de la maîtrise d'œuvre.
10. Signaler tout écart contractuel (contradiction CCTP/DPGF, norme périmée, pièce
    manquante, exigence impossible) avec une criticité BLOQUANT / MAJEUR / MINEUR,
    un constat et une action proposée.`
