'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  FileText,
  Gavel,
  Layers,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ActionProgress } from '@/components/ui/action-progress'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { analyzeTenderDce, applyDceAnalysis, type DceAnalysisMeta } from '@/app/actions/dce'
import { ARetenirCard } from '@/components/tenders/a-retenir-card'
import { normalizeAnalysis } from '@/lib/dce/normalize'
import type { DceAnalysisRow } from '@/lib/dal/tenders'
import type { DceAnalysis } from '@/lib/dce/types'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

const SEVERITY_STYLE: Record<string, string> = {
  bloquante: 'bg-red-500/15 text-red-600 dark:text-red-400',
  critique: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  importante: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  info: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
}

const REQUIREMENT_LABELS: Record<string, string> = {
  obligatoire: 'Obligatoire',
  recommande: 'Recommandé',
  facultatif: 'Facultatif',
}

const DOC_TYPE_LABELS: Record<string, string> = {
  rc: 'RC',
  cctp: 'CCTP',
  ccap: 'CCAP',
  ccag: 'CCAG',
  ae: 'AE',
  bpu: 'BPU',
  dpgf: 'DPGF',
  annexe: 'Annexe',
  autre: 'Autre',
}

export function DceAnalysisPanel({
  orgSlug,
  tenderId,
  analyses,
  canEdit,
}: {
  orgSlug: string
  tenderId: string
  analyses: DceAnalysisRow[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [applying, startApply] = useTransition()
  const [current, setCurrent] = useState<{
    analysis: DceAnalysis
    meta: DceAnalysisMeta
  } | null>(() => {
    const done = analyses.find((x) => x.status === 'done' && x.result)
    return done
      ? {
          analysis: normalizeAnalysis(done.result),
          meta: {
            id: done.id,
            model: done.model,
            files: done.files,
            skipped: done.skipped,
            created_at: done.created_at,
          },
        }
      : null
  })
  const appliedId = analyses.find((x) => x.applied_at)?.id ?? null

  function run() {
    startTransition(async () => {
      const res = await analyzeTenderDce(orgSlug, tenderId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.data) {
        setCurrent(res.data)
        toast.success('Analyse du DCE terminée')
      }
      // Rafraîchit la liste `analyses` (props) — historique et applied_at.
      router.refresh()
    })
  }

  function apply() {
    if (!current) return
    startApply(async () => {
      const res = await applyDceAnalysis(orgSlug, tenderId, current.meta.id)
      if (res?.error) toast.error(res.error)
      else
        toast.success(
          `Analyse appliquée au dossier (champs, lots, checklist)` +
            (res?.attached
              ? ` — ${res.attached} pièce${res.attached > 1 ? 's' : ''} société rattachée${res.attached > 1 ? 's' : ''} (${res.validated ?? 0} validée${res.validated === 1 ? '' : 's'})`
              : ''),
        )
      // L'application réécrit champs, lots et checklist — la page doit
      // se recharger pour refléter le dossier à jour (et marquer l'analyse
      // comme appliquée via `applied_at`).
      router.refresh()
    })
  }

  const a = current?.analysis

  return (
    <div className="space-y-4">
      {/* Barre d'action */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={pending || !canEdit} size="sm">
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {pending ? 'Analyse en cours…' : 'Analyser le DCE'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Lit les pièces jointes au dossier (PDF, ZIP, DOCX) : RC, CCTP, CCAP, AE, BPU…
        </p>
        {current && canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={apply}
            disabled={applying || appliedId === current.meta.id}
          >
            {applying && <Loader2 className="size-4 animate-spin" />}
            <CheckCircle2 className="size-4" />
            {appliedId === current.meta.id
              ? 'Appliquée au dossier'
              : 'Appliquer au dossier'}
          </Button>
        )}
      </div>

      {pending && (
        <ActionProgress
          title="Analyse du DCE en cours — l'agent lit toutes les pièces rangées"
          steps={[
            'Chargement des pièces liées au dossier',
            'Extraction du texte (PDF, DOCX, XLSX, ZIP)',
            'Analyse IA — identification acheteur, lots, pièces exigées, risques',
            'Enregistrement du résultat',
          ]}
        />
      )}
      {applying && (
        <ActionProgress
          title="Application de l'analyse au dossier"
          steps={[
            'Mise à jour des champs et des lots',
            'Création des pièces exigées dans la checklist',
            'Rattachement des pièces société',
            'Contrôles de conformité et alertes',
          ]}
        />
      )}

      {/* Pièces analysées / ignorées */}
      {current && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {current.meta.files.map((f) => (
            <Badge key={f.name} variant="secondary" className="gap-1 font-normal">
              <FileText className="size-3" />
              {f.name}
              <span className="text-muted-foreground">
                {DOC_TYPE_LABELS[f.type] ?? f.type}
                {f.lots?.length ? ` · lot ${f.lots.join('/')}` : ''}
              </span>
            </Badge>
          ))}
          {current.meta.skipped.map((s) => (
            <Badge
              key={s.name}
              variant="secondary"
              className="gap-1 font-normal text-amber-600 dark:text-amber-400"
              title={s.reason}
            >
              <AlertTriangle className="size-3" />
              {s.name} ignoré
            </Badge>
          ))}
          {current.meta.model && (
            <span className="ml-auto text-muted-foreground">
              {current.meta.model} · {formatDate(current.meta.created_at)}
            </span>
          )}
        </div>
      )}

      {!current && analyses.some((x) => x.status === 'error') && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="size-4" />
          Dernière analyse en échec : {analyses.find((x) => x.status === 'error')?.error}
        </div>
      )}

      {!current && !pending && (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Aucune analyse — déposez le DCE dans la zone ci-dessus
          (les pièces seront classées et rangées automatiquement),
          puis lancez l’analyse pour pré-remplir le dossier.
        </div>
      )}

      {a && (
        <>
          {/* À retenir — les éléments indispensables à ne pas louper */}
          <ARetenirCard
            analysis={a}
            exportHref={`/print/${orgSlug}/tenders/${tenderId}?auto=1`}
          />

          {/* Synthèse */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-primary" /> Synthèse
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="whitespace-pre-wrap">{a.summary}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                {a.identification.buyer && (
                  <>
                    <dt className="text-muted-foreground">Acheteur</dt>
                    <dd className="col-span-1 sm:col-span-2">{a.identification.buyer}</dd>
                  </>
                )}
                {a.identification.reference && (
                  <>
                    <dt className="text-muted-foreground">Référence</dt>
                    <dd className="col-span-1 sm:col-span-2">{a.identification.reference}</dd>
                  </>
                )}
                {a.identification.procedure_type && (
                  <>
                    <dt className="text-muted-foreground">Procédure</dt>
                    <dd className="col-span-1 sm:col-span-2">{a.identification.procedure_type}</dd>
                  </>
                )}
                {a.deadlines.response_deadline && (
                  <>
                    <dt className="text-muted-foreground">Remise des offres</dt>
                    <dd className="col-span-1 font-medium sm:col-span-2">
                      {formatDate(a.deadlines.response_deadline)}
                    </dd>
                  </>
                )}
                {a.deadlines.questions_deadline && (
                  <>
                    <dt className="text-muted-foreground">Questions avant</dt>
                    <dd className="col-span-1 sm:col-span-2">
                      {formatDate(a.deadlines.questions_deadline)}
                    </dd>
                  </>
                )}
                {a.deadlines.offer_validity && (
                  <>
                    <dt className="text-muted-foreground">Validité offres</dt>
                    <dd className="col-span-1 sm:col-span-2">{a.deadlines.offer_validity}</dd>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Critères */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gavel className="size-4" /> Critères d’attribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                {a.award_criteria.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Non détectés.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {a.award_criteria.map((c, i) => (
                      <li key={i} className="flex items-center justify-between gap-2">
                        <span>{c.label}</span>
                        {c.weight_pct != null && (
                          <Badge variant="secondary">{c.weight_pct} %</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Lots */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers className="size-4" /> Lots
                </CardTitle>
              </CardHeader>
              <CardContent>
                {a.lots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Marché non alloti (ou non détecté).</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {a.lots.map((l) => (
                      <li key={l.number} className="flex items-baseline gap-2">
                        <Badge variant="outline" className="shrink-0">
                          Lot {l.number}
                        </Badge>
                        <span className="min-w-0 flex-1">
                          {l.title}
                          {(l.duree || l.variantes || l.amount_euros != null) && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {[
                                l.amount_euros != null
                                  ? `${new Intl.NumberFormat('fr-FR').format(l.amount_euros)} €`
                                  : null,
                                l.duree,
                                l.variantes,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Pièces exigées */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="size-4" /> Pièces exigées dans la réponse
                <Badge variant="secondary" className="text-[10px]">
                  {a.required_documents.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {a.required_documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune pièce exigée détectée.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {a.required_documents.map((d, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="min-w-0 flex-1">
                        {d.lot != null && (
                          <Badge variant="outline" className="mr-1.5 text-[10px]">
                            Lot {d.lot}
                          </Badge>
                        )}
                        {d.label}
                      </span>
                      {d.requires_signature && (
                        <Badge variant="outline" className="text-[10px]">
                          À signer
                        </Badge>
                      )}
                      {d.requires_chiffrage && (
                        <Badge variant="outline" className="text-[10px]">
                          À chiffrer
                        </Badge>
                      )}
                      <Badge
                        variant="secondary"
                        className={cn(
                          'text-[10px]',
                          d.requirement === 'obligatoire' && 'bg-primary/10 text-primary',
                        )}
                      >
                        {REQUIREMENT_LABELS[d.requirement] ?? d.requirement}
                      </Badge>
                      {d.source && (
                        <p
                          className="w-full truncate text-xs text-muted-foreground"
                          title={d.source}
                        >
                          {d.source}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Risques + Go/No-Go */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="size-4" /> Points de vigilance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {a.risks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun risque signalé.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {a.risks.map((r, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Badge
                          variant="secondary"
                          className={cn('mt-0.5 shrink-0 text-[10px]', SEVERITY_STYLE[r.severity])}
                        >
                          {r.severity}
                        </Badge>
                        <span>{r.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Signaux Go / No-Go</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {a.go_nogo.favorable_signals.length > 0 && (
                  <ul className="space-y-1">
                    {a.go_nogo.favorable_signals.map((s, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {a.go_nogo.blocking_signals.length > 0 && (
                  <ul className="space-y-1">
                    {a.go_nogo.blocking_signals.map((s, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {a.go_nogo.recommendation && (
                  <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
                    {a.go_nogo.recommendation}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
