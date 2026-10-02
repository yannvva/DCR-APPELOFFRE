import { Skeleton } from '@/components/ui/skeleton'

export default function OrgLoading() {
  return (
    <div className="space-y-4 p-4 sm:p-6" aria-busy="true" aria-label="Chargement de la page">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-4 w-96" />
      <div className="space-y-3 pt-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  )
}
