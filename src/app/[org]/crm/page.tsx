import { redirect } from 'next/navigation'

export default async function CrmPage({ params }: PageProps<'/[org]/crm'>) {
  const { org } = await params
  redirect(`/${org}/crm/opportunities`)
}
