import Link from 'next/link'

export const metadata = { title: 'Mentions légales — Nexus' }

/**
 * Page publique. Les champs entre crochets doivent être complétés avec les
 * informations réelles de l'éditeur avant mise en production commerciale.
 */
export default function MentionsLegalesPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Mentions légales</h1>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Éditeur du site</h2>
        <p className="text-muted-foreground">
          [Raison sociale] — [Forme juridique] au capital de [montant] €<br />
          Siège social : [adresse complète]<br />
          RCS [ville] [numéro SIREN] — TVA intracommunautaire : [numéro]<br />
          Contact : [email de contact] — Téléphone : [téléphone]
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Directeur de la publication</h2>
        <p className="text-muted-foreground">[Nom du responsable légal]</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Hébergement</h2>
        <p className="text-muted-foreground">
          [Nom de l’hébergeur] — [adresse] — [site web]
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Propriété intellectuelle</h2>
        <p className="text-muted-foreground">
          L’ensemble des contenus de la plateforme Nexus (interface, code,
          marques, documents générés) est protégé. Toute reproduction sans
          autorisation écrite est interdite. Les documents importés par
          l’utilisateur restent sa propriété.
        </p>
      </section>

      <p className="border-t border-border pt-4">
        <Link href="/confidentialite" className="text-primary hover:underline">
          Politique de confidentialité
        </Link>
        {' · '}
        <Link href="/login" className="text-primary hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </main>
  )
}
