import { redirect } from 'next/navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { OnboardingForm } from '@/components/onboarding-form'
import { requireUser, getUserOrganizations } from '@/lib/dal/auth'

export default async function OnboardingPage() {
  await requireUser()
  const orgs = await getUserOrganizations()
  if (orgs.length > 0) redirect(`/${orgs[0].slug}/dashboard`)

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Bienvenue sur Nexus</CardTitle>
          <CardDescription>
            Créez votre première organisation pour commencer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm />
        </CardContent>
      </Card>
    </div>
  )
}
