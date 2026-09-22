import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserOrganizations } from '@/lib/dal/auth'

export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('default_organization_id')
    .eq('id', user.id)
    .single()

  const orgs = await getUserOrganizations()

  if (orgs.length === 0) redirect('/onboarding')

  const preferred =
    orgs.find((o) => o.id === profile?.default_organization_id) ?? orgs[0]
  redirect(`/${preferred.slug}/dashboard`)
}
