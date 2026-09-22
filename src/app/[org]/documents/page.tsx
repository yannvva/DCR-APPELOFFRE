import { FileText } from 'lucide-react'
import { ModulePlaceholder } from '@/components/module-placeholder'

export default function DocumentsPage() {
  return (
    <ModulePlaceholder
      title="Documents"
      description="Fichiers privés liés à vos clients, projets et opportunités — livré à l'epic 4 du plan."
      icon={FileText}
    />
  )
}
