'use client'

import { useEffect, useState } from 'react'
import { Tabs } from '@/components/ui/tabs'

/**
 * Onglets du dossier synchronisés avec l'URL (`?tab=…`).
 *
 * Sans cela, l'URL ne suivait pas l'onglet réellement affiché : on pouvait
 * être sur « Fiches techniques » avec `?tab=documents` dans la barre
 * d'adresse, et un lien profond ne rouvrait pas le bon onglet.
 * `window.history.replaceState` évite un aller-retour serveur à chaque clic.
 */
export function TenderTabs({
  initial,
  tabs,
  children,
}: {
  initial: string
  tabs: readonly string[]
  children: React.ReactNode
}) {
  const [value, setValue] = useState(initial)
  // Clé stable : évite de relancer l'effet quand la page repasse un tableau.
  const tabsKey = tabs.join(',')

  useEffect(() => {
    const list = tabsKey.split(',')
    const sync = () => {
      const t = new URLSearchParams(window.location.search).get('tab')
      if (t && list.includes(t)) setValue(t)
    }
    sync()
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [tabsKey])

  return (
    <Tabs
      value={value}
      onValueChange={(v) => {
        setValue(String(v))
        const params = new URLSearchParams(window.location.search)
        params.set('tab', String(v))
        window.history.replaceState(null, '', `?${params.toString()}`)
      }}
    >
      {children}
    </Tabs>
  )
}
