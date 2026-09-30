/** Nom d'objet compatible avec Supabase Storage : les clés rejettent les
 *  caractères non-ASCII (erreur `InvalidKey`) — le tiret cadratin « — »
 *  des noms de livrables DCR faisait échouer tous les uploads de fiches
 *  techniques (« upload impossible »). */
export function storageSafeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.()\- ]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200)
}
