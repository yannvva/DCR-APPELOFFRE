import { FolderKanban } from 'lucide-react'
import { ModulePlaceholder } from '@/components/module-placeholder'

export default function ProjectsPage() {
  return (
    <ModulePlaceholder
      title="Projets"
      description="Projets, tâches, kanban et échéances — livré à l'epic 3 du plan."
      icon={FolderKanban}
    />
  )
}
