'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ListTodo,
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
  FileSignature,
  BookMarked,
  Building2,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { logout } from '@/app/actions/auth'
import type { MembershipRole, Organization } from '@/lib/types'

type OrgWithRole = Organization & { memberRole: MembershipRole }

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'todo', label: 'À faire', icon: ListTodo },
  { key: 'tenders', label: 'Appels d’offres', icon: FileSignature },
  { key: 'crm', label: 'CRM', icon: Users },
  { key: 'projects', label: 'Projets', icon: FolderKanban },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'fiches', label: 'Fiches techniques', icon: BookMarked },
  { key: 'societe', label: 'Société', icon: Building2 },
  { key: 'members', label: 'Membres', icon: UserCog },
  { key: 'settings', label: 'Paramètres', icon: Settings },
] as const

const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
  viewer: 'Observateur',
}

const SIDEBAR_KEY = 'nexus-sidebar-collapsed'
const SIDEBAR_EVENT = 'nexus-sidebar-collapsed-change'

function subscribeSidebar(cb: () => void) {
  window.addEventListener(SIDEBAR_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(SIDEBAR_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

type SidebarContentProps = {
  org: Organization
  orgs: OrgWithRole[]
  role: MembershipRole
  user: { email: string; fullName: string }
  collapsed: boolean
  onToggleCollapsed?: () => void
  /** Appelé après clic sur un lien — ferme le drawer mobile. */
  onNavigate?: () => void
}

function SidebarContent({
  org,
  orgs,
  role,
  user,
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: SidebarContentProps) {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const initials = (user.fullName || user.email).slice(0, 2).toUpperCase()

  return (
    <>
      <div className={cn('flex items-center p-3', collapsed && 'flex-col gap-2')}>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent',
              collapsed ? 'justify-center' : 'w-full',
            )}
            title={collapsed ? org.name : undefined}
          >
            <Avatar className="size-6 shrink-0">
              <AvatarFallback className="text-xs">
                {org.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <>
                <span className="flex-1 truncate text-sm font-medium">{org.name}</span>
                <ChevronsUpDown className="size-4 text-muted-foreground" />
              </>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Organisations</DropdownMenuLabel>
            </DropdownMenuGroup>
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
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Ouvrir le menu' : 'Réduire le menu'}
            aria-label={collapsed ? 'Ouvrir le menu' : 'Réduire le menu'}
            className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        )}
      </div>

      <div className="px-3 pb-2">
        <button
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-sidebar-border px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent',
            collapsed && 'justify-center',
          )}
          title={collapsed ? 'Rechercher…' : undefined}
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
          }
        >
          <Search className="size-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Rechercher…</span>
              <kbd className="text-[10px] text-muted-foreground">⌘K</kbd>
            </>
          )}
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
              title={collapsed ? label : undefined}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                collapsed && 'justify-center',
                active
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && label}
            </Link>
          )
        })}
      </nav>

      <div className="p-3">
        <Separator className="mb-3" />
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent',
              collapsed ? 'justify-center' : 'w-full',
            )}
            title={collapsed ? (user.fullName || user.email) : undefined}
          >
            <Avatar className="size-6 shrink-0">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {user.fullName || user.email}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {ROLE_LABELS[role] ?? role}
                </p>
              </div>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
            </DropdownMenuGroup>
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
    </>
  )
}

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
  // Préférence persistée dans localStorage — useSyncExternalStore évite le
  // mismatch SSR (snapshot serveur = étendu) et synchronise entre onglets.
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    () => localStorage.getItem(SIDEBAR_KEY) === '1',
    () => false,
  )
  const [mobileOpen, setMobileOpen] = useState(false)

  function toggleCollapsed() {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '0' : '1')
    window.dispatchEvent(new Event(SIDEBAR_EVENT))
  }

  return (
    <>
      {/* Mobile : barre supérieure + navigation en drawer. Sans ça, la
          sidebar w-64 occupait ~70 % du viewport téléphone. */}
      <div className="sticky top-0 z-40 flex items-center gap-1 border-b border-border bg-background px-2 py-1.5 lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Ouvrir le menu"
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-72 gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex h-full flex-col overflow-y-auto">
              <SidebarContent
                org={org}
                orgs={orgs}
                role={role}
                user={user}
                collapsed={false}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
        <Link
          href={`/${org.slug}/dashboard`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5"
        >
          <Avatar className="size-6 shrink-0">
            <AvatarFallback className="text-xs">
              {org.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-sm font-medium">{org.name}</span>
        </Link>
        <button
          type="button"
          aria-label="Rechercher"
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
          }
        >
          <Search className="size-5" />
        </button>
      </div>

      {/* Desktop */}
      <aside
        className={cn(
          'hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <SidebarContent
          org={org}
          orgs={orgs}
          role={role}
          user={user}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      </aside>
    </>
  )
}
