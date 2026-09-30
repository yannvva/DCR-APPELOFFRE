'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  CalendarClock,
  Copy,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  TriangleAlert,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { draftSiteVisitEmail } from '@/app/actions/tenders'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DceAnalysis } from '@/lib/dce/types'

type Visit = NonNullable<DceAnalysis['deadlines']['site_visit']>

/**
 * « Important » — éléments critiques extraits du RC par l'analyse DCE :
 * visite de site (statut + modale contact/rédaction IA), échéances,
 * personnes à contacter. La modale de visite permet de générer par IA
 * l'e-mail de demande de rendez-vous (nom AO, lot, date, heure).
 */
export function ImportantCard({
  orgSlug,
  tenderId,
  tenderTitle,
  lots,
  analysis,
  siteVisitJustified,
  canEdit,
}: {
  orgSlug: string
  tenderId: string
  tenderTitle: string
  lots: { number: number; title: string }[]
  analysis: DceAnalysis | null
  siteVisitJustified: boolean
  canEdit: boolean
}) {
  const visit: Visit | undefined = analysis?.deadlines.site_visit
  const contacts = analysis?.contacts ?? []
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // Pré-remplissage : première date de visite connue, premier contact e-mail.
  const firstDate = visit?.dates?.[0] ?? visit?.date ?? ''
  const defaultDate = firstDate ? firstDate.slice(0, 10) : ''
  const defaultTime = firstDate?.includes('T') ? firstDate.slice(11, 16) : '10:00'
  const [visitDate, setVisitDate] = useState(defaultDate)
  const [visitTime, setVisitTime] = useState(defaultTime)
  const [lotNumber, setLotNumber] = useState('')
  const firstEmail = contacts.find((c) => c.email)
  const [contactEmail, setContactEmail] = useState(firstEmail?.email ?? '')
  const [contactName, setContactName] = useState(firstEmail?.name ?? '')
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null)

  const mailto = draft
    ? `mailto:${contactEmail}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`
    : null

  return (
    <>
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TriangleAlert className="size-4 text-amber-600 dark:text-amber-300" /> Important
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {/* Visite de site — cliquable → modale contact + rédaction IA */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/50"
          >
            <span className="flex items-center gap-2">
              <MapPin className="size-4 shrink-0" />
              <span>
                <span className="font-medium">Visite de site</span>
                <span className="block text-xs text-muted-foreground">
                  {(visit?.dates?.length ? visit.dates : visit?.date ? [visit.date] : [])
                    .map(formatDate)
                    .join(' · ') || 'Date à confirmer'}
                </span>
              </span>
            </span>
            <Badge
              variant="secondary"
              className={cn(
                'text-[10px]',
                !visit || visit.mandatory
                  ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                  : 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
              )}
            >
              {!visit
                ? 'À vérifier'
                : visit.mandatory
                  ? siteVisitJustified
                    ? 'Obligatoire — justifiée'
                    : 'Obligatoire'
                  : 'Recommandée'}
            </Badge>
          </button>

          {/* Échéances clés */}
          <ul className="space-y-1.5 px-1 text-sm">
            {analysis?.deadlines.response_deadline && (
              <li className="flex items-center gap-2">
                <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">Remise des offres :</span>
                <span className="font-medium">
                  {formatDate(analysis.deadlines.response_deadline)}
                </span>
              </li>
            )}
            {analysis?.deadlines.questions_deadline && (
              <li className="flex items-center gap-2">
                <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">Questions au MOA :</span>
                <span>{formatDate(analysis.deadlines.questions_deadline)}</span>
              </li>
            )}
            {/* Les échéances annexes (PGC, rapports MOE…) restent dans
                « À retenir » — ici seules les actions du soumissionnaire. */}
          </ul>

          {/* Contacts RC */}
          {contacts.length > 0 && (
            <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
              <Users className="size-3.5 shrink-0" />
              {contacts.length} contact{contacts.length > 1 ? 's' : ''} identifié
              {contacts.length > 1 ? 's' : ''} dans le RC — détail via « Visite de site »
            </p>
          )}
          {!analysis && (
            <p className="px-1 text-xs text-muted-foreground">
              Lancez l’analyse DCE pour extraire visite, contacts et échéances.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="size-4" /> Visite de site
            </DialogTitle>
            <DialogDescription>
              {!visit
                ? 'Aucune visite n’a été détectée dans le RC — vérifiez les pièces.'
                : visit.mandatory
                  ? 'Visite obligatoire — sans visite, l’offre peut être déclarée irrégulière.'
                  : 'Visite recommandée ou facultative selon le RC.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            {/* Dates et modalités */}
            {visit && (
              <div className="space-y-1">
                {(visit.dates?.length ?? 0) > 0 || visit.date ? (
                  <p>
                    <span className="text-muted-foreground">Date(s) : </span>
                    <span className="font-medium">
                      {(visit.dates?.length ? visit.dates : [visit.date!])
                        .map(formatDate)
                        .join(' · ')}
                    </span>
                  </p>
                ) : null}
                {visit.access && (
                  <p className="whitespace-pre-wrap">
                    <span className="text-muted-foreground">Accès / inscription : </span>
                    {visit.access}
                  </p>
                )}
                {visit.details && (
                  <p className="whitespace-pre-wrap text-muted-foreground">{visit.details}</p>
                )}
              </div>
            )}

            {/* Personnes à contacter */}
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 font-medium">
                <Users className="size-3.5" /> Personne(s) à contacter
              </p>
              {contacts.length === 0 ? (
                <p className="text-muted-foreground">
                  Aucun contact extrait — consultez le RC ou le profil acheteur.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {contacts.slice(0, 5).map((c, i) => (
                    <li key={i}>
                      <p>
                        {c.name ?? 'Contact'}
                        {c.role && <span className="text-muted-foreground"> — {c.role}</span>}
                      </p>
                      <p className="flex flex-wrap gap-x-3 text-xs">
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
              )}
            </div>

            {/* Formulaire de demande de visite — agent IA */}
            {canEdit && (
              <div className="space-y-3 rounded-md border border-border p-3">
                <p className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="size-3.5 text-primary" /> Demande de visite (IA)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="visit-date">Date de visite</Label>
                    <Input
                      id="visit-date"
                      type="date"
                      className="mt-1"
                      value={visitDate}
                      onChange={(e) => setVisitDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="visit-time">Heure</Label>
                    <Input
                      id="visit-time"
                      type="time"
                      className="mt-1"
                      value={visitTime}
                      onChange={(e) => setVisitTime(e.target.value)}
                    />
                  </div>
                </div>
                {lots.length > 0 && (
                  <div>
                    <Label>Lot concerné</Label>
                    <Select value={lotNumber} onValueChange={(v) => setLotNumber(v ?? '')}>
                      <SelectTrigger className="mt-1 w-full">
                        <SelectValue placeholder="Tous les lots" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Tous les lots</SelectItem>
                        {lots.map((l) => (
                          <SelectItem
                            key={l.number}
                            value={String(l.number)}
                            label={`Lot ${l.number} — ${l.title}`}
                          >
                            Lot {l.number} — {l.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="visit-name">Destinataire</Label>
                    <Input
                      id="visit-name"
                      className="mt-1"
                      placeholder="Nom du contact"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="visit-email">E-mail</Label>
                    <Input
                      id="visit-email"
                      type="email"
                      className="mt-1"
                      placeholder="contact@…"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={pending || !visitDate || !visitTime}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await draftSiteVisitEmail(orgSlug, tenderId, {
                        visitDate,
                        visitTime,
                        lotNumber,
                        contactEmail,
                        contactName,
                      })
                      if (res.error) toast.error(res.error)
                      else if (res.data) setDraft(res.data)
                    })
                  }
                >
                  {pending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  Rédiger la demande
                </Button>

                {draft && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <div>
                      <Label>Objet</Label>
                      <p className="mt-1 rounded-md bg-muted px-2 py-1.5 text-sm">{draft.subject}</p>
                    </div>
                    <div>
                      <Label>Message — {tenderTitle}</Label>
                      <Textarea readOnly className="mt-1 min-h-44 text-sm" value={draft.body} />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard.writeText(
                            `Objet : ${draft.subject}\n\n${draft.body}`,
                          )
                          toast.success('E-mail copié')
                        }}
                      >
                        <Copy className="size-3.5" /> Copier
                      </Button>
                      {mailto && (
                        <Button
                          size="sm"
                          nativeButton={false}
                          render={<a href={mailto} />}
                        >
                          <Mail className="size-3.5" /> Ouvrir dans ma messagerie
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
