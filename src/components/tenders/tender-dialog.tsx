'use client'

import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Link2, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { tenderSchema } from '@/lib/validation/domain'
import { createTender, fetchTenderFromUrl, updateTender } from '@/app/actions/tenders'
import type { Account, DepositMode, MarketType, Tender, TenderLot } from '@/lib/types'
import type { z } from 'zod'

type Values = z.output<typeof tenderSchema>
type FormValues = z.input<typeof tenderSchema>

const toDateTimeLocal = (iso: string | null | undefined) =>
  iso ? new Date(iso).toISOString().slice(0, 16) : ''
const toDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '')

export function TenderDialog({
  orgSlug,
  tender,
  lots,
  accounts,
  members,
  trigger,
}: {
  orgSlug: string
  tender?: Tender
  lots?: TenderLot[]
  accounts: Pick<Account, 'id' | 'name'>[]
  members: { user_id: string; full_name: string | null }[]
  trigger?: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [buyerAccountId, setBuyerAccountId] = useState(tender?.buyer_account_id ?? '')
  const [marketType, setMarketType] = useState<MarketType | ''>(tender?.market_type ?? '')
  const [depositMode, setDepositMode] = useState<DepositMode | ''>(tender?.deposit_mode ?? '')
  const [responsibleId, setResponsibleId] = useState(tender?.responsible_id ?? '')
  const [siteVisitMandatory, setSiteVisitMandatory] = useState(
    tender?.site_visit_mandatory ?? false,
  )
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, Values>({
    resolver: zodResolver(tenderSchema),
    defaultValues: {
      title: tender?.title ?? '',
      reference: tender?.reference ?? '',
      platform: tender?.platform ?? '',
      dceUrl: tender?.dce_url ?? '',
      publishedAt: toDate(tender?.published_at),
      responseDeadline: toDateTimeLocal(tender?.response_deadline),
      questionsDeadline: toDateTimeLocal(tender?.questions_deadline),
      siteVisitAt: toDateTimeLocal(tender?.site_visit_at),
      procedureType: tender?.procedure_type ?? '',
      durationMonths: tender?.duration_months ?? '',
      estimatedAmountEuros:
        tender?.estimated_amount_cents != null ? tender.estimated_amount_cents / 100 : '',
      region: tender?.region ?? '',
      priceWeight: tender?.award_criteria?.prix ?? '',
      technicalWeight: tender?.award_criteria?.technique ?? '',
      notes: tender?.notes ?? '',
      lots:
        lots?.map((l) => ({
          number: l.number,
          title: l.title,
          amountEuros: l.amount_cents != null ? l.amount_cents / 100 : undefined,
        })) ?? [],
    },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'lots' })

  async function importFromUrl() {
    const url = importUrl.trim()
    if (!url) return
    setImporting(true)
    const res = await fetchTenderFromUrl(orgSlug, url)
    setImporting(false)
    if (res.error || !res.data) {
      toast.error(res.error ?? 'Extraction impossible.')
      return
    }
    const d = res.data
    const found: string[] = []
    if (d.title) {
      setValue('title', d.title)
      found.push('intitulé')
    }
    if (d.reference) {
      setValue('reference', d.reference)
      found.push('référence')
    }
    if (d.responseDeadline) {
      setValue('responseDeadline', d.responseDeadline)
      found.push('date limite')
    }
    if (d.publishedAt) {
      setValue('publishedAt', d.publishedAt)
      found.push('publication')
    }
    if (d.platform) {
      setValue('platform', d.platform)
      found.push('plateforme')
    }
    if (d.region) {
      setValue('region', d.region)
      found.push('région')
    }
    if (d.procedureType) {
      setValue('procedureType', d.procedureType)
      found.push('procédure')
    }
    if (d.marketType) {
      setMarketType(d.marketType)
      found.push('type de marché')
    }
    setValue('dceUrl', d.url)

    // Acheteur : correspondance floue avec les comptes, sinon note
    if (d.buyer) {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const match = accounts.find(
        (a) => norm(a.name).includes(norm(d.buyer!)) || norm(d.buyer!).includes(norm(a.name)),
      )
      if (match) {
        setBuyerAccountId(match.id)
        found.push('acheteur')
      } else {
        const note = `Acheteur (extrait) : ${d.buyer}`
        setValue('notes', ((tender?.notes ?? '') + '\n' + note).trim())
        found.push('acheteur (en notes)')
      }
    }
    if (d.excerpt) {
      const note = ((tender?.notes ?? '') + '\n' + d.excerpt).trim()
      setValue('notes', note.slice(0, 10000))
    }
    toast.success(
      found.length
        ? `Importé : ${found.join(', ')}`
        : 'Page récupérée — complétez manuellement.',
    )
  }

  async function onSubmit(values: Values) {
    const input = {
      ...values,
      buyerAccountId,
      marketType,
      depositMode,
      responsibleId,
      siteVisitMandatory,
    }
    const res = tender
      ? await updateTender(orgSlug, tender.id, input)
      : await createTender(orgSlug, input)
    if (res?.fieldErrors) {
      for (const [k, msgs] of Object.entries(res.fieldErrors)) {
        setError(k as keyof FormValues, { message: msgs?.[0] })
      }
      return
    }
    if (res?.error) {
      toast.error(res.error)
      return
    }
    toast.success(tender ? 'Appel d’offres mis à jour' : 'Appel d’offres créé')
    setOpen(false)
  }

  const triggerEl =
    trigger ??
    (tender ? undefined : (
      <Button>
        <Plus className="size-4" /> Nouvel appel d’offres
      </Button>
    ))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerEl && <DialogTrigger render={triggerEl} />}
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {tender ? 'Modifier l’appel d’offres' : 'Nouvel appel d’offres'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {!tender && (
            <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
              <Label htmlFor="importUrl" className="flex items-center gap-1.5 text-sm font-medium">
                <Link2 className="size-4" /> Importer depuis une URL d’avis
              </Label>
              <div className="flex gap-2">
                <Input
                  id="importUrl"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://www.marchesonline.com/appels-offres/…"
                  inputMode="url"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={importFromUrl}
                  disabled={importing || !importUrl.trim()}
                >
                  {importing ? <Loader2 className="size-4 animate-spin" /> : 'Analyser'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Extraction automatique : intitulé, référence, acheteur, deadline, plateforme.
                Vérifiez toujours les champs avant d’enregistrer.
              </p>
            </div>
          )}

          {/* Identification */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">Identification</legend>
            <div className="space-y-1.5">
              <Label htmlFor="title">Intitulé du marché *</Label>
              <Input id="title" {...register('title')} autoFocus aria-required />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="reference">Référence de consultation</Label>
                <Input id="reference" {...register('reference')} />
              </div>
              <div className="space-y-1.5">
                <Label>Acheteur public</Label>
                <Select value={buyerAccountId} onValueChange={(v) => setBuyerAccountId(v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner…" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="platform">Plateforme de publication</Label>
                <Input
                  id="platform"
                  placeholder="PLACE, AWS, Marchés Online…"
                  {...register('platform')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dceUrl">URL du dossier de consultation</Label>
                <Input id="dceUrl" placeholder="https://…" {...register('dceUrl')} />
                {errors.dceUrl && (
                  <p className="text-xs text-destructive">{errors.dceUrl.message}</p>
                )}
              </div>
            </div>
          </fieldset>

          {/* Échéances & procédure */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">Échéances & procédure</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="responseDeadline">Date limite de réponse *</Label>
                <Input
                  id="responseDeadline"
                  type="datetime-local"
                  {...register('responseDeadline')}
                  aria-required
                />
                {errors.responseDeadline && (
                  <p className="text-xs text-destructive">{errors.responseDeadline.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="questionsDeadline">Date limite de questions</Label>
                <Input
                  id="questionsDeadline"
                  type="datetime-local"
                  {...register('questionsDeadline')}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="publishedAt">Date de publication</Label>
                <Input id="publishedAt" type="date" {...register('publishedAt')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="siteVisitAt">Visite de site</Label>
                <Input id="siteVisitAt" type="datetime-local" {...register('siteVisitAt')} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={siteVisitMandatory}
                onCheckedChange={(v) => setSiteVisitMandatory(v === true)}
              />
              Visite de site obligatoire
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="procedureType">Type de procédure</Label>
                <Input
                  id="procedureType"
                  placeholder="AO ouvert, adapté…"
                  {...register('procedureType')}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type de marché</Label>
                <Select
                  value={marketType}
                  onValueChange={(v) => setMarketType((v ?? '') as MarketType | '')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="travaux">Travaux</SelectItem>
                    <SelectItem value="fournitures">Fournitures</SelectItem>
                    <SelectItem value="services">Services</SelectItem>
                    <SelectItem value="mixte">Mixte</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Mode de dépôt</Label>
                <Select
                  value={depositMode}
                  onValueChange={(v) => setDepositMode((v ?? '') as DepositMode | '')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="electronique">Électronique</SelectItem>
                    <SelectItem value="papier">Papier</SelectItem>
                    <SelectItem value="hybride">Hybride</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </fieldset>

          {/* Organisation */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">Organisation</legend>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="estimatedAmountEuros">Montant estimé (€)</Label>
                <Input
                  id="estimatedAmountEuros"
                  type="number"
                  min={0}
                  step="0.01"
                  {...register('estimatedAmountEuros')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="durationMonths">Durée (mois)</Label>
                <Input
                  id="durationMonths"
                  type="number"
                  min={1}
                  {...register('durationMonths')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="region">Région / localisation</Label>
                <Input id="region" {...register('region')} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="priceWeight">Critère prix (%)</Label>
                <Input id="priceWeight" type="number" min={0} max={100} {...register('priceWeight')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="technicalWeight">Critère technique (%)</Label>
                <Input
                  id="technicalWeight"
                  type="number"
                  min={0}
                  max={100}
                  {...register('technicalWeight')}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Responsable du dossier</Label>
                <Select value={responsibleId} onValueChange={(v) => setResponsibleId(v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.full_name ?? m.user_id.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Lots */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Lots</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({ number: fields.length + 1, title: '', amountEuros: undefined })
                  }
                >
                  <Plus className="size-3.5" /> Ajouter un lot
                </Button>
              </div>
              {fields.map((f, i) => (
                <div key={f.id} className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    className="w-20"
                    placeholder="N°"
                    {...register(`lots.${i}.number`)}
                  />
                  <Input
                    className="flex-1"
                    placeholder="Intitulé du lot"
                    {...register(`lots.${i}.title`)}
                  />
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-32"
                    placeholder="Montant €"
                    {...register(`lots.${i}.amountEuros`)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => remove(i)}
                    aria-label="Supprimer le lot"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes internes</Label>
              <Textarea id="notes" rows={3} {...register('notes')} />
            </div>
          </fieldset>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
