#!/usr/bin/env python3
# Validation minimale du .docx produit : archive lisible, XML bien formés,
# charte DCR préservée (logo), aucune chaîne du gabarit tpl.docx résiduelle.
import sys, zipfile
from lxml import etree

path = sys.argv[1]
z = zipfile.ZipFile(path)
bad = z.testzip()
assert bad is None, f"Archive corrompue: {bad}"

for name in ("word/document.xml", "word/footer1.xml", "[Content_Types].xml"):
    data = z.read(name)
    etree.fromstring(data)  # lève une exception si XML invalide

doc = z.read("word/document.xml").decode("utf-8")

# Logo DCR de la couverture : indispensable à la charte
if "word/media/dcr_logo_cover.png" not in z.namelist():
    raise SystemExit("ERREUR : logo DCR de couverture absent (charte non respectée)")

# Placeholders rouges : le gabarit contient ~992 occurrences latentes (styles,
# TDM, calques) qui n'apparaissent pas au rendu — normal. Au-delà, du contenu
# rouge visible n'a probablement pas été remplacé.
n_red = doc.count("EE0000")
if n_red > 1030:
    print(f"ATTENTION : {n_red} occurrences EE0000 (> 1030) — un placeholder rouge "
          f"visible n'a probablement pas été remplacé. Contrôler le rendu PDF.")

# Chaînes de la couverture du gabarit = subs non appliqués
for s in ("La Gommerie", "Mairie de Rambouillet", "[ N° de consultation",
          "[ JJ / MM"):
    if s in doc:
        raise SystemExit(f"ERREUR : chaîne de couverture non remplacée : « {s} »")

# Pied de page : texte du gabarit + placeholder rouge EE0000
foot = z.read("word/footer1.xml").decode("utf-8")
for s in ("Gommerie", "Sols / Revêtements Muraux", "<w:t>ot</w:t>"):
    if s in foot:
        raise SystemExit(f"ERREUR : pied de page non remplacé (« {s} »)")
if "EE0000" in foot:
    print("ATTENTION : pied de page encore rouge (EE0000) — la correction "
          "marine n'a pas été appliquée.")

print("Validation OK :", path)
