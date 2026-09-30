'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Folder, FolderOpen, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ancestorFolders, type FolderNode } from '@/lib/folder-tree'

/**
 * Arborescence des dossiers : deux racines seulement — « Société » (kit
 * candidature) et un dossier par appel d'offres, chacun avec ses
 * sous-dossiers (DCE/…, Fiches techniques/…, DC1-DC2, Mémoire technique).
 * Repliable ; les ancêtres du dossier courant sont dépliés d'office.
 */
export function FolderTree({
  orgSlug,
  nodes,
  current,
  rootCount = 0,
  query = '',
  unfiled = [],
}: {
  orgSlug: string
  nodes: FolderNode[]
  current: string
  /** Documents sans dossier (racine). */
  rootCount?: number
  query?: string
  /** Dossiers racine hors convention (ni « Société » ni dossier d'AO). */
  unfiled?: string[]
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(ancestorFolders(current)),
  )

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function href(path: string) {
    return `/${orgSlug}/documents?folder=${encodeURIComponent(path)}`
  }

  function Row({
    node,
    depth,
  }: {
    node: FolderNode
    depth: number
  }) {
    const open = expanded.has(node.path)
    const active = node.path === current && !query
    const hasChildren = node.children.length > 0
    return (
      <li>
        <div className="flex items-center">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(node.path)}
              aria-label={open ? 'Replier' : 'Déplier'}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent/60"
            >
              <ChevronRight
                className={cn('size-3.5 transition-transform', open && 'rotate-90')}
              />
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}
          <Link
            href={href(node.path)}
            style={{ paddingLeft: depth * 10 }}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1.5 pr-2 text-sm',
              active
                ? 'bg-accent font-medium'
                : 'text-muted-foreground hover:bg-accent/60',
            )}
            title={node.path}
          >
            {open && hasChildren ? (
              <FolderOpen className="size-3.5 shrink-0" />
            ) : (
              <Folder className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
            {unfiled.includes(node.path) && (
              <TriangleAlert
                className="size-3 shrink-0 text-amber-500"
                aria-label="Dossier non rattaché à un appel d’offres"
              />
            )}
            {node.total > 0 && (
              <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {node.total}
              </span>
            )}
          </Link>
        </div>
        {hasChildren && open && (
          <ul className="space-y-0.5">
            {node.children.map((c) => (
              <Row key={c.path} node={c} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <nav className="space-y-0.5">
      <Link
        href={href('/')}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
          current === '/' && !query
            ? 'bg-accent font-medium'
            : 'text-muted-foreground hover:bg-accent/60',
        )}
      >
        <Folder className="size-3.5" />
        <span className="truncate">Racine</span>
        {rootCount > 0 && (
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
            {rootCount}
          </span>
        )}
      </Link>
      <ul className="space-y-0.5">
        {nodes.map((n) => (
          <Row key={n.path} node={n} depth={0} />
        ))}
      </ul>
    </nav>
  )
}
