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
                <blockquote className="whitespace-pre-wrap border-l-2 border-primary/30 pl-2 text-xs italic text-muted-foreground">
                  {visit.details}
                </blockquote>
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
            <ul className="space-y-1.5">
              {a.contacts.slice(0, 5).map((c, i) => (
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
              {a.contacts.length > 5 && (
                <li className="text-xs text-muted-foreground">
                  +{a.contacts.length - 5} autre(s) contact(s)
                </li>
              )}
            </ul>
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
            <ul className="space-y-1">
              {deadlineEntries.map((d, i) => {
                const past = isOverdue(d.date)
                const days = daysUntil(d.date)
                return (
                  <li
                    key={i}
                    className={cn(
                      'flex items-baseline justify-between gap-2',
                      past && 'opacity-50',
                    )}
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
                        past && 'text-muted-foreground',
                        !past && d.primary && days <= 7 && 'font-medium text-red-600 dark:text-red-400',
                        !past && d.primary && days > 7 && 'text-amber-600 dark:text-amber-400',
                        !past && !d.primary && 'text-muted-foreground',
                      )}
                    >
                      {past ? 'passée' : days === 0 ? 'aujourd’hui' : `J-${days}`}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {a.deadlines.offer_validity && (
            <p className="text-muted-foreground">
              Validité de l’offre : {a.deadlines.offer_validity}
            </p>
          )}
          {nbObligatoires > 0 && (
            <p className="text-muted-foreground">
              {nbObligatoires} pièce(s) obligatoire(s) dans la réponse — voir l’onglet
              Checklist.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
