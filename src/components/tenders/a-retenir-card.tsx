import Link from 'next/link'
import {
  BookmarkCheck,
  CalendarClock,
  FileDown,
  Mail,
  MapPin,
  Phone,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { daysUntil, formatDate, isOverdue } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DceAnalysis } from '@/lib/dce/types'

/**
 * « À retenir » — les éléments indispensables extraits du DCE :
 * visite de site (obligatoire, dates, modalités d'accès), personnes en
 * charge et échéances critiques. Affiché dans l'onglet Analyse DCE et,
 * une fois l'analyse appliquée, sur la vue d'ensemble du dossier.
 */
export function ARetenirCard({
  analysis,
  exportHref,
}: {
  analysis: DceAnalysis
  /** Lien vers la version imprimable (export PDF via le navigateur). */
  exportHref?: string
}) {
  const a = analysis
  const visit = a.deadlines.site_visit
  const nbObligatoires = a.required_documents.filter(
    (d) => d.requirement === 'obligatoire',
  ).length

  // Échéances : la remise des offres en tête (critique), puis les autres par
  // ordre chronologique. Les dates passées sont estompées plutôt que mises au
  // même niveau que les échéances à venir.
  const deadlineEntries = [
    a.deadlines.response_deadline && {
      label: 'Remise des offres',
      date: a.deadlines.response_deadline,
      primary: true,
    },
    a.deadlines.questions_deadline && {
      label: 'Questions au MOA',
      date: a.deadlines.questions_deadline,
    },
    ...(a.deadlines.other ?? []).map((o) => ({ label: o.label, date: o.date })),
  ]
    .filter((d): d is { label: string; date: string; primary?: boolean } => Boolean(d))
    .sort(
      (x, y) =>
        Number(y.primary ?? false) - Number(x.primary ?? false) ||
        x.date.localeCompare(y.date),
    )
  // Échéances déjà passées (PGC, rapports intermédiaires d'un DCE ancien…) :
  // elles documentent le calendrier mais ne sont plus « à ne pas manquer » —
  // repliées sous un dépliant plutôt qu'affichées au même niveau.
  const upcomingDeadlines = deadlineEntries.filter((d) => !isOverdue(d.date))
  const pastDeadlines = deadlineEntries.filter((d) => isOverdue(d.date))

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookmarkCheck className="size-4 text-primary" /> À retenir
          {exportHref && (
            <Button
              variant="outline"
              size="xs"
              className="ml-auto"
              nativeButton={false}
              render={<Link href={exportHref} target="_blank" />}
            >
              <FileDown className="size-3.5" />
              Export dossier (PDF)
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm md:grid-cols-3">
        {/* Visite de site */}
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 font-medium">
            <MapPin className="size-3.5 shrink-0" /> Visite de site
          </p>
          {visit ? (
            <div className="space-y-1.5">
              <Badge
                variant="secondary"
                className={cn(
                  'text-[10px]',
                  visit.mandatory
                    ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                    : 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
                )}
              >
                {visit.mandatory ? 'Obligatoire' : 'Recommandée / facultative'}
              </Badge>
              {(visit.dates?.length ?? 0) > 0 || visit.date ? (
                <ul className="space-y-0.5">
                  {(visit.dates?.length ? visit.dates : [visit.date!]).map((d, i) => (
                    <li key={i} className="font-medium tabular-nums">
                      {formatDate(d)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">Date non précisée dans les pièces.</p>
              )}
              {visit.access && (
                <p className="whitespace-pre-wrap text-muted-foreground">
                  <span className="font-medium text-foreground">Accès / inscription : </span>
                  {visit.access}
                </p>
              )}
              {visit.details && (
                // Justificatif (citation RC/CCTP) : preuve utile mais longue —
                // repliée pour ne pas allonger la carte.
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">
                    Extrait des pièces
                  </summary>
                  <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-primary/30 pl-2 italic">
                    {visit.details}
                  </blockquote>
                </details>
              )}
              {visit.mandatory && (
                <p className="font-medium text-red-600 dark:text-red-400">
                  Sans visite, l’offre peut être déclarée irrégulière.
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              Aucune visite détectée dans les pièces analysées.
            </p>
          )}
        </div>

        {/* Contacts clés */}
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 font-medium">
            <Users className="size-3.5 shrink-0" /> Personnes en charge
          </p>
          {a.contacts.length === 0 ? (
            <p className="text-muted-foreground">Aucun contact extrait des pièces.</p>
          ) : (
            // 3 contacts visibles, le reste sous un dépliant — un DCE peut
            // citer MOA, MOE, CSPS, contrôleur, copie… qui noyaient la carte.
            <>
              <ul className="space-y-1.5">
                {a.contacts.slice(0, 3).map((c, i) => (
                  <li key={i} className="space-y-0.5">
                    <p>
                      {c.name ?? 'Contact'}
                      {c.role && <span className="text-muted-foreground"> — {c.role}</span>}
                    </p>
                    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      {c.email && (
                        <a
                          href={`mailto:${c.email}`}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <Mail className="size-3" /> {c.email}
                        </a>
                      )}
                      {c.phone && (
                        <a
                          href={`tel:${c.phone.replace(/\s/g, '')}`}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <Phone className="size-3" /> {c.phone}
                        </a>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
              {a.contacts.length > 3 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">
                    +{a.contacts.length - 3} autre(s) contact(s)
                  </summary>
                  <ul className="mt-1.5 space-y-1.5">
                    {a.contacts.slice(3).map((c, i) => (
                      <li key={i} className="space-y-0.5">
                        <p>
                          {c.name ?? 'Contact'}
                          {c.role && (
                            <span className="text-muted-foreground"> — {c.role}</span>
                          )}
                        </p>
                        <p className="flex flex-wrap gap-x-3 gap-y-0.5">
                          {c.email && (
                            <a
                              href={`mailto:${c.email}`}
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              <Mail className="size-3" /> {c.email}
                            </a>
                          )}
                          {c.phone && (
                            <a
                              href={`tel:${c.phone.replace(/\s/g, '')}`}
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              <Phone className="size-3" /> {c.phone}
                            </a>
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        {/* Échéances critiques */}
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 font-medium">
            <CalendarClock className="size-3.5 shrink-0" /> Échéances à ne pas manquer
          </p>
          {deadlineEntries.length === 0 ? (
            <p className="text-muted-foreground">Aucune échéance extraite des pièces.</p>
          ) : (
            <>
              {upcomingDeadlines.length === 0 ? (
                <p className="text-muted-foreground">
                  Toutes les échéances extraites sont passées.
                </p>
              ) : (
                <ul className="space-y-1">
                  {upcomingDeadlines.map((d, i) => {
                    const days = daysUntil(d.date)
                    return (
                      <li
                        key={i}
                        className="flex items-baseline justify-between gap-2"
                      >
                        <span className="min-w-0">
                          <span className="text-muted-foreground">{d.label} : </span>
                          <span className={cn(d.primary && 'font-medium')}>
                            {formatDate(d.date)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-xs tabular-nums',
                            d.primary && days <= 7 && 'font-medium text-red-600 dark:text-red-400',
                            d.primary && days > 7 && 'text-amber-600 dark:text-amber-400',
                            !d.primary && 'text-muted-foreground',
                          )}
                        >
                          {days === 0 ? 'aujourd’hui' : `J-${days}`}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              {pastDeadlines.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">
                    {pastDeadlines.length} échéance{pastDeadlines.length > 1 ? 's' : ''} passée
                    {pastDeadlines.length > 1 ? 's' : ''} (calendrier du DCE)
                  </summary>
                  <ul className="mt-1 space-y-0.5 opacity-70">
                    {pastDeadlines.map((d, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0">
                          <span>{d.label} : </span>
                          {formatDate(d.date)}
                        </span>
                        <span className="shrink-0 tabular-nums">passée</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
          {a.deadlines.offer_validity && (
            <p className="text-muted-foreground">
              Validité de l’offre : {a.deadlines.offer_validity}
            </p>
          )}
          {nbObligatoires > 0 && (
            <p className="text-muted-foreground">
              Le DCE exige {nbObligatoires} pièce
              {nbObligatoires > 1 ? 's' : ''} dans la réponse — détail dans l’onglet
              Checklist.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
