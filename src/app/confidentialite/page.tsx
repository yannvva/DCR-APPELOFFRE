import Link from 'next/link'

export const metadata = { title: 'Politique de confidentialité — Nexus' }

/**
 * Page publique — décrit les traitements réellement effectués par la
 * plateforme (données d'organisation, documents, appels IA). Les
 * coordonnées du DPO et les durées de conservation sont à compléter.
 */
export default function ConfidentialitePage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Politique de confidentialité</h1>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Données traitées</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Compte : nom, adresse email, mot de passe (haché), organisation.</li>
          <li>
            Données métier saisies : entreprises, contacts, projets, tâches,
            appels d’offres et documents que vous importez.
          </li>
          <li>Journaux d’activité et d’audit (traçabilité des actions sensibles).</li>
          <li>Journaux techniques de connexion (sécurité).</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Finalités et base légale</h2>
        <p className="text-muted-foreground">
          Les données sont traitées pour fournir le service (exécution du
          contrat), assurer sa sécurité (intérêt légitime) et respecter nos
          obligations légales (conservation comptable).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Sous-traitants</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Supabase — hébergement de la base de données et des fichiers.</li>
          <li>
            Fournisseur d’IA — analyse des dossiers de consultation. Les
            documents transmis servent uniquement à produire l’analyse demandée.
          </li>
          <li>Fournisseur d’emails transactionnels (invitations, alertes).</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Conservation</h2>
        <p className="text-muted-foreground">
          Les données sont conservées pendant la durée d’utilisation du service,
          puis [durée] après la résiliation. Elles sont supprimées sur demande
          via la suppression d’organisation (Paramètres → Données &amp; conformité).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Vos droits</h2>
        <p className="text-muted-foreground">
          Vous disposez d’un droit d’accès, de rectification, d’effacement, de
          portabilité et d’opposition. L’export complet de vos données est
          disponible dans Paramètres → Données &amp; conformité (JSON).
          Pour toute demande : [email du DPO].
        </p>
      </section>

      <p className="border-t border-border pt-4">
        <Link href="/mentions-legales" className="text-primary hover:underline">
          Mentions légales
        </Link>
        {' · '}
        <Link href="/login" className="text-primary hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </main>
  )
}
