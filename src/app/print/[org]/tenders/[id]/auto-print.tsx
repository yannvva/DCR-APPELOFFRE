'use client'

import { useEffect } from 'react'
import { Printer } from 'lucide-react'

/**
 * Bouton « Enregistrer en PDF » — ouvre la boîte d'impression du navigateur
 * (destination « Enregistrer au format PDF »). ?auto=1 la déclenche dès le
 * chargement.
 */
export function AutoPrint({ auto }: { auto: boolean }) {
  useEffect(() => {
    if (!auto) return
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [auto])

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="fixed bottom-6 right-6 inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-lg print:hidden"
    >
      <Printer className="size-4" />
      Imprimer / Enregistrer en PDF
    </button>
  )
}
