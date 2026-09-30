import Link from 'next/link'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthForm } from '@/components/auth/auth-form'
import { signup } from '@/app/actions/auth'

export default async function SignupPage({
  searchParams,
}: PageProps<'/signup'>) {
  const { next } = await searchParams

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Créer un compte</CardTitle>
        <CardDescription>Quelques secondes suffisent.</CardDescription>
      </CardHeader>
      <CardContent>
        <AuthForm mode="signup" action={signup} next={typeof next === 'string' ? next : undefined} />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Déjà un compte ?{' '}
          <Link
            href={typeof next === 'string' ? `/login?next=${encodeURIComponent(next)}` : '/login'}
            className="text-primary underline-offset-4 hover:underline"
          >
            Se connecter
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
