import { Card, CardContent } from '@/components/ui/card'
import type { LucideIcon } from 'lucide-react'

export function ModulePlaceholder({
  title,
  description,
  icon: Icon,
}: {
  title: string
  description: string
  icon: LucideIcon
}) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <Card className="mt-6">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Icon className="size-10 text-muted-foreground" />
          <p className="font-medium">{title}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </div>
  )
}
