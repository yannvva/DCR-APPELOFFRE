'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2,
  Contact,
  FileText,
  FolderKanban,
  CheckSquare,
  CircleDot,
  FileSignature,
  LayoutDashboard,
  Users,
  Settings,
  UserCog,
  Plus,
} from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'

interface SearchResult {
  type: 'account' | 'contact' | 'opportunity' | 'project' | 'task' | 'document' | 'tender'
  id: string
  label: string
  sub?: string
}

const TYPE_META: Record<SearchResult['type'], { icon: typeof FileText; path: (org: string, id: string) => string }> = {
  account: { icon: Building2, path: (o, id) => `/${o}/crm/accounts/${id}` },
  contact: { icon: Contact, path: (o, id) => `/${o}/crm/contacts/${id}` },
  opportunity: { icon: CircleDot, path: (o) => `/${o}/crm/opportunities` },
  project: { icon: FolderKanban, path: (o, id) => `/${o}/projects/${id}` },
  task: { icon: CheckSquare, path: (o) => `/${o}/projects` },
  document: { icon: FileText, path: (o) => `/${o}/documents` },
  tender: { icon: FileSignature, path: (o, id) => `/${o}/tenders/${id}` },
}

const NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, path: 'dashboard' },
  { label: 'Appels d’offres', icon: FileSignature, path: 'tenders' },
  { label: 'Opportunités', icon: CircleDot, path: 'crm/opportunities' },
  { label: 'Entreprises', icon: Building2, path: 'crm/accounts' },
  { label: 'Contacts', icon: Contact, path: 'crm/contacts' },
  { label: 'Leads', icon: Users, path: 'crm/leads' },
  { label: 'Projets', icon: FolderKanban, path: 'projects' },
  { label: 'Documents', icon: FileText, path: 'documents' },
  { label: 'Membres', icon: UserCog, path: 'members' },
  { label: 'Paramètres', icon: Settings, path: 'settings' },
] as const

const ACTIONS = [
  { label: 'Nouvel appel d’offres', icon: FileSignature, path: 'tenders?new=1' },
  { label: 'Nouvelle entreprise', icon: Plus, path: 'crm/accounts?new=1' },
  { label: 'Nouveau contact', icon: Plus, path: 'crm/contacts?new=1' },
  { label: 'Nouvelle opportunité', icon: Plus, path: 'crm/opportunities?new=1' },
  { label: 'Nouveau projet', icon: Plus, path: 'projects?new=1' },
] as const

export function CommandPalette({ orgSlug }: { orgSlug: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onQueryChange(v: string) {
    setQuery(v)
    if (v.trim().length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
  }

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (query.trim().length < 2) return
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/${orgSlug}/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data.results ?? [])
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, orgSlug])

  const go = useCallback(
    (path: string) => {
      setOpen(false)
      setQuery('')
      router.push(path)
    },
    [router],
  )

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Palette de commandes" description="Recherchez ou naviguez">
      <CommandInput
        placeholder="Rechercher ou naviguer…"
        value={query}
        onValueChange={onQueryChange}
      />
      <CommandList>
        <CommandEmpty>{loading ? 'Recherche…' : 'Aucun résultat.'}</CommandEmpty>

        {results.length > 0 && (
          <CommandGroup heading="Résultats">
            {results.map((r) => {
              const meta = TYPE_META[r.type]
              const Icon = meta.icon
              return (
                <CommandItem
                  key={`${r.type}-${r.id}`}
                  value={`${r.type}-${r.id}-${r.label}`}
                  onSelect={() => go(meta.path(orgSlug, r.id))}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="truncate">{r.label}</span>
                  {r.sub && (
                    <span className="ml-auto truncate text-xs text-muted-foreground">{r.sub}</span>
                  )}
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}

        {query.trim().length < 2 && (
          <>
            <CommandGroup heading="Navigation">
              {NAV.map(({ label, icon: Icon, path }) => (
                <CommandItem key={path} value={label} onSelect={() => go(`/${orgSlug}/${path}`)}>
                  <Icon className="size-4 text-muted-foreground" />
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Créer">
              {ACTIONS.map(({ label, icon: Icon, path }) => (
                <CommandItem key={path} value={label} onSelect={() => go(`/${orgSlug}/${path}`)}>
                  <Icon className="size-4 text-muted-foreground" />
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
