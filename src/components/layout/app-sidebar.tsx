'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  FileText,
  UserCog,
  Settings,
  ChevronsUpDown,
  Check,
  Plus,
  LogOut,
  Sun,
  Moon,
  Search,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { logout } from '@/app/actions/auth'
import type { MembershipRole, Organization } from '@/lib/types'

type OrgWithRole = Organization & { memberRole: MembershipRole }

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'crm', label: 'CRM', icon: Users },
  { key: 'projects', label: 'Projets', icon: FolderKanban },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'members', label: 'Membres', icon: UserCog },
  { key: 'settings', label: 'Paramètres', icon: Settings },
] as const

export function AppSidebar({
  org,
  orgs,
  role,
  user,
}: {
  org: Organization
  orgs: OrgWithRole[]
  role: MembershipRole
  user: { email: string; fullName: string }
}) {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()

  const initials = (user.fullName || user.email).slice(0, 2).toUpperCase()

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent">
            <Avatar className="size-6">
              <AvatarFallback className="text-xs">
                {org.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="flex-1 truncate text-sm font-medium">{org.name}</span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start">
            <DropdownMenuLabel>Organisations</DropdownMenuLabel>
            {orgs.map((o) => (
              <DropdownMenuItem key={o.id} render={<Link href={`/${o.slug}/dashboard`} />}>
                <span className="flex w-full items-center justify-between">
                  <span className="truncate">{o.name}</span>
                  {o.id === org.id && <Check className="size-4" />}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/onboarding" />}>
              <Plus className="size-4" /> Nouvelle organisation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="px-3 pb-2">
        <button
          className="flex w-full items-center gap-2 rounded-md border border-sidebar-border px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent"
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
          }
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">Rechercher…</span>
          <kbd className="text-[10px] text-muted-foreground">⌘K</kbd>
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const href = `/${org.slug}/${key}`
          const active = pathname.startsWith(href)
          return (
            <Link
              key={key}
              href={href}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                active
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="p-3">
        <Separator className="mb-3" />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent">
            <Avatar className="size-6">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {user.fullName || user.email}
              </p>
              <p className="truncate text-xs text-muted-foreground capitalize">{role}</p>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start">
            <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
              {theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void logout()}
            >
              <LogOut className="size-4" /> Déconnexion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}
