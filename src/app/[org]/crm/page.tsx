import { Users } from 'lucide-react'
import { ModulePlaceholder } from '@/components/module-placeholder'

export default function CrmPage() {
  return (
    <ModulePlaceholder
      title="CRM"
      description="Entreprises, contacts, leads et opportunités — livré à l'epic 2 du plan."
      icon={Users}
    />
  )
}
