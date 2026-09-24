'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const TABS = [
  { key: 'opportunities', label: 'Opportunités' },
  { key: 'accounts', label: 'Entreprises' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'leads', label: 'Leads' },
] as const

export function CrmNav({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname()
  return (
    <div className="flex items-center gap-1 border-b border-border px-6 py-2">
      {TABS.map(({ key, label }) => {
        const href = `/${orgSlug}/crm/${key}`
        const active = pathname.startsWith(href)
        return (
          <Link
            key={key}
            href={href}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm',
              active
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}
