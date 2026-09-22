import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function OrgNotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Page introuvable</h1>
      <p className="text-muted-foreground">
        Cette organisation ou cette page n’existe pas — ou vous n’y avez pas accès.
      </p>
      <Button variant="outline" render={<Link href="/" />}>
        Retour à l’accueil
      </Button>
    </div>
  )
}
