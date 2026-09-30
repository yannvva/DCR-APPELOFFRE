'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Send, Trophy, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { recordTenderResult, submitTender } from '@/app/actions/tenders'
import { formatDate, formatEuros } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { TenderReadiness, TenderResult, TenderSubmission } from '@/lib/types'

export function DepotPanel({
  orgSlug,
  tenderId,
  readiness,
  submissions,
  result,
  canEdit,
}: {
  orgSlug: string
  tenderId: string
  readiness: TenderReadiness
  submissions: TenderSubmission[]
  result: TenderResult | null
  canEdit: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [platform, setPlatform] = useState('')
  const [submissionRef, setSubmissionRef] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [outcome, setOutcome] = useState<string>(result?.outcome ?? '')
  const [awardedTo, setAwardedTo] = useState(result?.awarded_to ?? '')
  const [amount, setAmount] = useState(
    result?.awarded_amount_cents != null ? String(result.awarded_amount_cents / 100) : '',
  )
  const [lossReason, setLossReason] = useState(result?.loss_reason ?? '')

  function submit() {
    startTransition(async () => {
      const res = await submitTender(orgSlug, tenderId, {
        platform,
        submissionRef,
        confirmComplete: confirm,
        notes: '',
      })
      if (res?.fieldErrors || res?.error) {
        toast.error(res.error ?? 'Formulaire invalide — certification requise.')
        return
      }
      toast.success('Dépôt enregistré')
      setPlatform('')
      setSubmissionRef('')
      setConfirm(false)
    })
  }

  function recordResult() {
    if (!outcome) {
      toast.error('Sélectionnez un résultat.')
      return
    }
    startTransition(async () => {
      const res = await recordTenderResult(orgSlug, tenderId, {
        outcome,
        awardedAmountEuros: amount === '' ? '' : Number(amount),
        awardedTo,
        lossReason,
        decidedAt: new Date().toISOString().slice(0, 10),
      })
      if (res?.fieldErrors || res?.error) {
        toast.error(res.error ?? 'Résultat invalide.')
        return
      }
      toast.success('Résultat enregistré')
    })
  }

  return (
    <div className="space-y-6">
      {/* État de conformité */}
      <section
        className={cn(
          'rounded-lg border px-4 py-3',
          readiness.ready
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-red-500/30 bg-red-500/5',
        )}
      >
        <div className="flex items-center gap-2">
          {readiness.ready ? (
            <CheckCircle2 className="size-5 text-emerald-600" />
          ) : (
            <XCircle className="size-5 text-red-600" />
          )}
          <p className="text-sm font-semibold">
            {readiness.ready
              ? 'Dossier conforme — prêt à déposer'
              : `Dossier incomplet — ${readiness.pct} % des pièces obligatoires validées`}
          </p>
        </div>
        {!readiness.ready && readiness.blockers.length > 0 && (
          <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-red-600 dark:text-red-300">
            {readiness.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
      </section>

      {/* Enregistrer un dépôt */}
      {canEdit && (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">Enregistrer un dépôt</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dep-platform">Plateforme de dépôt</Label>
              <Input
                id="dep-platform"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                placeholder="PLACE, AWS…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dep-ref">Référence / numéro de dépôt</Label>
              <Input
                id="dep-ref"
                value={submissionRef}
                onChange={(e) => setSubmissionRef(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={confirm}
              onCheckedChange={(v) => setConfirm(v === true)}
              aria-required
            />
            <span>
              Je certifie que le dossier est complet et conforme au règlement de
              consultation. *
            </span>
          </label>
          <Button
            onClick={submit}
            disabled={pending || !confirm || !readiness.ready}
            title={
              !readiness.ready
                ? 'Des pièces obligatoires sont incomplètes'
                : undefined
            }
          >
            <Send className="size-4" /> Enregistrer le dépôt
          </Button>
          {!readiness.ready && (
            <p className="text-xs text-muted-foreground">
              Le dépôt est bloqué tant que des pièces obligatoires sont manquantes,
              non signées ou expirées.
            </p>
          )}
        </section>
      )}

      {/* Historique des dépôts */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">Historique des dépôts</h3>
        {submissions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
            Aucun dépôt enregistré.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {submissions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Badge variant="secondary" className="text-[10px]">
                  v{s.version}
                </Badge>
                <span className="min-w-0 flex-1">
                  {formatDate(s.submitted_at)}
                  {s.platform ? ` — ${s.platform}` : ''}
                  {s.submission_ref ? ` — réf. ${s.submission_ref}` : ''}
                </span>
                <span className="text-xs text-muted-foreground">
                  {s.validator?.full_name ?? ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Résultat */}
      <section className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Trophy className="size-4" /> Résultat de la consultation
        </h3>
        {result && (
          <p className="text-sm">
            Résultat actuel :{' '}
            <Badge variant="secondary">
              {result.outcome === 'gagne'
                ? 'Gagné'
                : result.outcome === 'perdu'
                  ? 'Perdu'
                  : result.outcome === 'sans_suite'
                    ? 'Sans suite'
                    : 'Annulé'}
            </Badge>
            {result.awarded_to && (
              <span className="ml-2 text-muted-foreground">attribué à {result.awarded_to}</span>
            )}
            {result.awarded_amount_cents != null && (
              <span className="ml-2 tabular-nums text-muted-foreground">
                {formatEuros(result.awarded_amount_cents)}
              </span>
            )}
          </p>
        )}
        {canEdit && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Select value={outcome} onValueChange={(v) => setOutcome(v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Résultat…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gagne">Gagné</SelectItem>
                  <SelectItem value="perdu">Perdu</SelectItem>
                  <SelectItem value="sans_suite">Sans suite</SelectItem>
                  <SelectItem value="annule">Annulé</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={awardedTo}
                onChange={(e) => setAwardedTo(e.target.value)}
                placeholder="Attribué à…"
                aria-label="Attribué à"
              />
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                min={0}
                placeholder="Montant €"
                aria-label="Montant attribué"
              />
            </div>
            <Input
              value={lossReason}
              onChange={(e) => setLossReason(e.target.value)}
              placeholder="Motif de perte / commentaire"
              aria-label="Motif"
            />
            <Button variant="outline" size="sm" onClick={recordResult} disabled={pending}>
              Enregistrer le résultat
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
