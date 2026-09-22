import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AcceptInvite } from '@/components/invite/accept-invite'

export default async function InvitePage({
  params,
}: PageProps<'/invite/[token]'>) {
  const { token } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/signup?next=/invite/${token}`)
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <AcceptInvite token={token} />
    </div>
  )
}
