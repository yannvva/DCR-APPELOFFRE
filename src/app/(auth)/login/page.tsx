import Link from 'next/link'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthForm } from '@/components/auth/auth-form'
import { login } from '@/app/actions/auth'

export default async function LoginPage({
  searchParams,
}: PageProps<'/login'>) {
  const { next, reset } = await searchParams

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Connexion</CardTitle>
        <CardDescription>Accédez à votre espace Nexus.</CardDescription>
      </CardHeader>
      <CardContent>
        {reset === 'ok' && (
          <p className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            Mot de passe mis à jour — connectez-vous.
          </p>
        )}
        <AuthForm mode="login" action={login} next={typeof next === 'string' ? next : undefined} />
        <p className="mt-3 text-center text-sm">
          <Link
            href="/mot-de-passe-oublie"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Mot de passe oublié ?
          </Link>
        </p>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Pas de compte ?{' '}
          <Link
            href={typeof next === 'string' ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}
            className="text-primary underline-offset-4 hover:underline"
          >
            Créer un compte
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
