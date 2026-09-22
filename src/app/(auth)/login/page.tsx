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
  const { next } = await searchParams

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Connexion</CardTitle>
        <CardDescription>Accédez à votre espace Nexus.</CardDescription>
      </CardHeader>
      <CardContent>
        <AuthForm mode="login" action={login} next={typeof next === 'string' ? next : undefined} />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Pas de compte ?{' '}
          <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
            Créer un compte
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
