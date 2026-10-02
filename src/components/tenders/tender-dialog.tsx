'use client'

import { useState } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  CheckCircle2,
  ClipboardPaste,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { tenderSchema } from '@/lib/validation/domain'
import { createTender, fetchTenderFromUrl, updateTender } from '@/app/actions/tenders'
import type { TenderImport } from '@/lib/tender-import'
import type { Account, Tender, TenderLot } from '@/lib/types'
import type { z } from 'zod'

type Values = z.output<typeof tenderSchema>
type FormValues = z.input<typeof tenderSchema>

const NONE = '__none__'

type Tab = 'identification' | 'echeances' | 'organisation'
const ERROR_TAB: Record<string, Tab> = {
  title: 'identification',
  reference: 'identification',
  buyerAccountId: 'identification',
  platform: 'identification',
  dceUrl: 'identification',
  publishedAt: 'echeances',
  responseDeadline: 'echeances',
  questionsDeadline: 'echeances',
  siteVisitAt: 'echeances',
  procedureType: 'echeances',
  marketType: 'echeances',
  depositMode: 'echeances',
}

const toDateTimeLocal = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const toDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '')
const emptyToNumber = (v: unknown) => (v === '' || v == null ? '' : Number(v))

function importPreviewRows(d: TenderImport): [string, string][] {
  const rows: [string, string][] = []
  if (d.title) rows.push(['Intitulé', d.title])
  if (d.reference) rows.push(['Référence', d.reference])
  if (d.buyer) rows.push(['Acheteur', d.buyer])
  if (d.responseDeadline) rows.push(['Date limite de réponse', d.responseDeadline.replace('T', ' à ')])
  if (d.questionsDeadline)
    rows.push(['Date limite de questions', d.questionsDeadline.replace('T', ' à ')])
  if (d.publishedAt) rows.push(['Publication', d.publishedAt])
  if (d.siteVisitAt)
    rows.push([
      'Visite de site',
      `${d.siteVisitAt.replace('T', ' à ')}${d.siteVisitMandatory ? ' — obligatoire' : ''}`,
    ])
  else if (d.siteVisitMandatory) rows.push(['Visite de site', 'obligatoire'])
  if (d.estimatedAmountEuros)
    rows.push(['Montant estimé', `${d.estimatedAmountEuros.toLocaleString('fr-FR')} €`])
  if (d.durationMonths) rows.push(['Durée', `${d.durationMonths} mois`])
  if (d.platform) rows.push(['Plateforme', d.platform])
  if (d.region) rows.push(['Région / département', d.region])
  if (d.procedureType) rows.push(['Procédure', d.procedureType])
  if (d.marketType) rows.push(['Type de marché', d.marketType])
  return rows
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-destructive">{message}</p>
}

/** Compte à rebours sur une échéance : « J-12 », «Aujourd’hui», «Dépassée de 3 j ». */
function DeadlineHint({ value }: { value?: string }) {
  if (!value) return null
  const t = new Date(value)
  if (Number.isNaN(t.getTime())) return null
  const days = Math.ceil((t.getTime() - Date.now()) / 86_400_000)
  const label =
    days > 1 ? `J-${days}` : days === 1 ? 'Demain' : days === 0 ? 'Aujourd’hui' : `Dépassée de ${-days} j`
  return (
    <p className={days < 0 ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'}>
      {label}
    </p>
  )
}

/** Prévisualisation des informations extraites d'un avis avant application. */
function ImportPreview({
  preview,
  onApply,
  onIgnore,
}: {
  preview: TenderImport
  onApply: () => void
  onIgnore: () => void
}) {
  return (
    <div className="rounded-md border border-border bg-background p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
        <CheckCircle2 className="size-3.5 text-emerald-500" />
        {importPreviewRows(preview).length} information(s) détectée(s)
      </p>
      <dl className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
        {importPreviewRows(preview).map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate font-medium" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onIgnore}>
          Ignorer
        </Button>
        <Button type="button" size="sm" onClick={onApply}>
          Appliquer au formulaire
        </Button>
      </div>
    </div>
  )
}

export function TenderDialog({
  orgSlug,
  tender,
  lots,
  accounts,
  members,
  defaultOpen,
  trigger,
}: {
  orgSlug: string
  tender?: Tender
  lots?: TenderLot[]
  accounts: Pick<Account, 'id' | 'name'>[]
  members: { user_id: string; full_name: string | null }[]
  defaultOpen?: boolean
  trigger?: React.ReactElement
}) {
  // Remonté via `key` par la page quand « ?new=1 » bascule (navigation SPA
  // depuis la palette ⌘K) — useState(defaultOpen) se réinitialise alors.
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [tab, setTab] = useState<Tab>('identification')
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<TenderImport | null>(null)

  const defaults = (): FormValues => ({
    title: tender?.title ?? '',
    reference: tender?.reference ?? '',
    buyerAccountId: tender?.buyer_account_id ?? '',
    buyerName: '',
    platform: tender?.platform ?? '',
    dceUrl: tender?.dce_url ?? '',
    publishedAt: toDate(tender?.published_at),
    responseDeadline: toDateTimeLocal(tender?.response_deadline),
    questionsDeadline: toDateTimeLocal(tender?.questions_deadline),
    siteVisitAt: toDateTimeLocal(tender?.site_visit_at),
    siteVisitMandatory: tender?.site_visit_mandatory ?? false,
    procedureType: tender?.procedure_type ?? '',
    marketType: tender?.market_type ?? '',
    durationMonths: tender?.duration_months ?? '',
    estimatedAmountEuros:
      tender?.estimated_amount_cents != null ? tender.estimated_amount_cents / 100 : '',
    region: tender?.region ?? '',
    priceWeight: tender?.award_criteria?.prix ?? '',
    technicalWeight: tender?.award_criteria?.technique ?? '',
    depositMode: tender?.deposit_mode ?? '',
    responsibleId: tender?.responsible_id ?? '',
    notes: tender?.notes ?? '',
    lots:
      lots?.map((l) => ({
        number: l.number,
        title: l.title,
        amountEuros: l.amount_cents != null ? l.amount_cents / 100 : undefined,
      })) ?? [],
  })

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, Values>({
    resolver: zodResolver(tenderSchema),
    defaultValues: defaults(),
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'lots' })
  const dceUrlValue = String(useWatch({ control, name: 'dceUrl' }) ?? '')
  const deadlineValue = useWatch({ control, name: 'responseDeadline' })
  const questionsValue = useWatch({ control, name: 'questionsDeadline' })
  const siteVisitValue = useWatch({ control, name: 'siteVisitAt' })
  const priceWeightValue = useWatch({ control, name: 'priceWeight' })
  const technicalWeightValue = useWatch({ control, name: 'technicalWeight' })
  const criteriaTotal =
    (Number(priceWeightValue) || 0) + (Number(technicalWeightValue) || 0)

  // Réinitialisation complète à chaque ouverture (annulation propre + données fraîches)
  function handleOpenChange(v: boolean) {
    if (v) {
      reset(defaults())
      setTab('identification')
      setImportUrl('')
      setPreview(null)
    }
    setOpen(v)
  }

  // Lien profond « ?new=1 » : la page remonte le dialogue via `key` quand le
  // paramètre bascule — handleOpenChange(true) rejoue alors la réinitialisation.

  async function analyzeUrl(url = importUrl) {
    const trimmed = url.trim()
    if (!trimmed) return
    setImporting(true)
    const res = await fetchTenderFromUrl(orgSlug, trimmed)
    setImporting(false)
    if (res.error || !res.data) {
      toast.error(res.error ?? 'Extraction impossible.')
      setPreview(null)
      return
    }
    setPreview(res.data)
  }

  function applyImport() {
    const d = preview
    if (!d) return
    const found: string[] = []
    const fill = (name: keyof FormValues, v: string | undefined, label: string) => {
      if (v) {
        setValue(name, v)
        found.push(label)
      }
    }
    fill('title', d.title, 'intitulé')
    fill('reference', d.reference, 'référence')
    fill('responseDeadline', d.responseDeadline, 'date limite')
    fill('questionsDeadline', d.questionsDeadline, 'questions')
    fill('publishedAt', d.publishedAt, 'publication')
    fill('siteVisitAt', d.siteVisitAt, 'visite de site')
    fill('platform', d.platform, 'plateforme')
    fill('region', d.region, 'région')
    fill('procedureType', d.procedureType, 'procédure')
    if (d.estimatedAmountEuros) {
      setValue('estimatedAmountEuros', d.estimatedAmountEuros)
      found.push('montant')
    }
    if (d.durationMonths) {
      setValue('durationMonths', d.durationMonths)
      found.push('durée')
    }
    if (d.siteVisitMandatory) {
      setValue('siteVisitMandatory', true)
      found.push('visite obligatoire')
    }
    if (d.marketType) {
      setValue('marketType', d.marketType)
      found.push('type de marché')
    }
    // URL de l'avis : proposée comme URL de consultation (c'est là que le DCE
    // se télécharge sur la plupart des plateformes) mais sans écraser une URL
    // de dossier déjà saisie — annonce et dossier de consultation sont deux
    // choses distinctes.
    if (d.url && !getValues('dceUrl')) {
      setValue('dceUrl', d.url)
      found.push('URL de consultation')
    }

    if (d.buyer) {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const match = accounts.find(
        (a) => norm(a.name).includes(norm(d.buyer!)) || norm(d.buyer!).includes(norm(a.name)),
      )
      if (match) {
        setValue('buyerAccountId', match.id)
        found.push('acheteur')
      } else {
        // Pas de compte correspondant : le nom est transmis tel quel —
        // l'action créera le compte acheteur et le rattachera au dossier.
        setValue('buyerName', d.buyer)
        found.push('acheteur (compte à créer)')
      }
    }
    if (d.excerpt) {
      const note = `${getValues('notes') ?? ''}\n${d.excerpt}`.trim()
      setValue('notes', note.slice(0, 10000))
    }
    toast.success(
      found.length ? `Importé : ${found.join(', ')}` : 'Page récupérée — complétez manuellement.',
    )
    setPreview(null)
  }

  function onInvalid(formErrors: Record<string, unknown>) {
    const first = Object.keys(formErrors)[0]
    if (first) {
      setTab(ERROR_TAB[first] ?? 'organisation')
      toast.error('Certains champs sont incomplets — vérifiez les onglets.')
    }
  }

  async function onSubmit(values: Values) {
    const res = tender
      ? await updateTender(orgSlug, tender.id, values)
      : await createTender(orgSlug, values)
    if (res?.fieldErrors) {
      let firstTab: Tab | undefined
      for (const [k, msgs] of Object.entries(res.fieldErrors)) {
        setError(k as keyof FormValues, { message: msgs?.[0] })
        firstTab ??= ERROR_TAB[k] ?? 'organisation'
      }
      if (firstTab) setTab(firstTab)
      return
    }
    if (res?.error) {
      toast.error(res.error)
      return
    }
    toast.success(tender ? 'Appel d’offres mis à jour' : 'Appel d’offres créé')
    setOpen(false)
  }

  const errCount = (t: Tab) =>
    Object.keys(errors).filter((k) => (ERROR_TAB[k] ?? 'organisation') === t).length

  const triggerEl =
    trigger ??
    (tender ? undefined : (
      <Button>
        <Plus className="size-4" /> Nouvel appel d’offres
      </Button>
    ))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {triggerEl && <DialogTrigger render={triggerEl} />}
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {tender ? 'Modifier l’appel d’offres' : 'Nouvel appel d’offres'}
          </DialogTitle>
          <DialogDescription>
            {tender
              ? 'Mettez à jour les informations du dossier de réponse.'
              : 'Importez un avis depuis son URL ou renseignez le dossier manuellement.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit, onInvalid)}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          {!tender && (
            <div className="space-y-2.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="importUrl" className="flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="size-4 text-primary" /> Import automatique depuis un avis
                </Label>
                <p className="hidden text-[11px] text-muted-foreground sm:block">
                  PLACE · AWS · France Marchés · Marchés Online…
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  id="importUrl"
                  value={importUrl}
                  onChange={(e) => {
                    setImportUrl(e.target.value)
                    setPreview(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      analyzeUrl()
                    }
                  }}
                  placeholder="Collez l’URL de l’avis — francemarches.com/appel-offre/…"
                  inputMode="url"
                  autoFocus
                  className="bg-background"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Coller l’URL depuis le presse-papiers puis analyser"
                  disabled={importing}
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText()
                      const url = text.trim()
                      if (!url) {
                        toast.error('Presse-papiers vide.')
                        return
                      }
                      setImportUrl(url)
                      setPreview(null)
                      if (/^https?:\/\//.test(url)) analyzeUrl(url)
                    } catch {
                      toast.error('Accès au presse-papiers refusé — collez avec Ctrl+V.')
                    }
                  }}
                >
                  <ClipboardPaste className="size-4" />
                </Button>
                <Button
                  type="button"
                  onClick={() => analyzeUrl()}
                  disabled={importing || !importUrl.trim()}
                >
                  {importing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Analyse…
                    </>
                  ) : (
                    'Analyser'
                  )}
                </Button>
              </div>
              {preview ? (
                <ImportPreview
                  preview={preview}
                  onApply={applyImport}
                  onIgnore={() => setPreview(null)}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Pré-remplit intitulé, référence, acheteur, deadlines, visite, montant et
                  plateforme — vous validez avant application.
                </p>
              )}
            </div>
          )}

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="grid h-auto w-full grid-cols-3 gap-1 p-1">
              {(
                [
                  ['identification', 'Identification'],
                  ['echeances', 'Échéances & procédure'],
                  ['organisation', 'Organisation'],
                ] as const
              ).map(([value, label]) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="min-w-0 gap-1.5 px-2 py-1.5"
                >
                  {/* truncate : sans ça le libellé nowrap déborde sur l'onglet
                      voisin quand la modale rétrécit. */}
                  <span className="truncate">{label}</span>
                  {errCount(value) > 0 && (
                    <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1 pt-4">
              {/* Identification */}
              <TabsContent value="identification" className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="title">
                    Intitulé du marché <span className="text-destructive">*</span>
                  </Label>
                  <Input id="title" {...register('title')} autoFocus={!!tender} aria-required />
                  <FieldError message={errors.title?.message} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input type="hidden" {...register('buyerName')} />
                  <div className="space-y-1.5">
                    <Label htmlFor="reference">Référence de consultation</Label>
                    <Input id="reference" {...register('reference')} />
                    <FieldError message={errors.reference?.message} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Acheteur public</Label>
                    <Controller
                      control={control}
                      name="buyerAccountId"
                      render={({ field }) => (
                        <Select
                          value={field.value || NONE}
                          onValueChange={(v) => field.onChange(v === NONE ? '' : (v ?? ''))}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Sélectionner…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>— Non renseigné</SelectItem>
                            {accounts.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
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
                    <FieldError message={errors.dceUrl?.message} />
                  </div>
                </div>
                {tender && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => analyzeUrl(dceUrlValue)}
                        disabled={importing || !dceUrlValue.trim()}
                      >
                        {importing ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                        Mettre à jour depuis l’avis
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Recharge l’avis et propose les nouveautés (rectificatif,
                        deadline repoussée…).
                      </p>
                    </div>
                    {preview && (
                      <ImportPreview
                        preview={preview}
                        onApply={applyImport}
                        onIgnore={() => setPreview(null)}
                      />
                    )}
                  </div>
                )}
              </TabsContent>

              {/* Échéances & procédure */}
              <TabsContent value="echeances" className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="responseDeadline">
                      Date limite de réponse <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="responseDeadline"
                      type="datetime-local"
                      {...register('responseDeadline')}
                      aria-required
                    />
                    <DeadlineHint value={deadlineValue} />
                    <FieldError message={errors.responseDeadline?.message} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="questionsDeadline">Date limite de questions</Label>
                    <Input
                      id="questionsDeadline"
                      type="datetime-local"
                      {...register('questionsDeadline')}
                    />
                    <DeadlineHint value={questionsValue} />
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
                    <DeadlineHint value={siteVisitValue} />
                  </div>
                </div>
                <Controller
                  control={control}
                  name="siteVisitMandatory"
                  render={({ field }) => (
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={field.value === true}
                        onCheckedChange={(v) => field.onChange(v === true)}
                      />
                      Visite de site obligatoire
                    </label>
                  )}
                />
                <div className="grid gap-3 sm:grid-cols-3">
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
                    <Controller
                      control={control}
                      name="marketType"
                      render={({ field }) => (
                        <Select
                          value={field.value || NONE}
                          onValueChange={(v) => field.onChange(v === NONE ? '' : (v ?? ''))}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>— Non renseigné</SelectItem>
                            <SelectItem value="travaux">Travaux</SelectItem>
                            <SelectItem value="fournitures">Fournitures</SelectItem>
                            <SelectItem value="services">Services</SelectItem>
                            <SelectItem value="mixte">Mixte</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mode de dépôt</Label>
                    <Controller
                      control={control}
                      name="depositMode"
                      render={({ field }) => (
                        <Select
                          value={field.value || NONE}
                          onValueChange={(v) => field.onChange(v === NONE ? '' : (v ?? ''))}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>— Non renseigné</SelectItem>
                            <SelectItem value="electronique">Électronique</SelectItem>
                            <SelectItem value="papier">Papier</SelectItem>
                            <SelectItem value="hybride">Hybride</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                </div>
              </TabsContent>

              {/* Organisation */}
              <TabsContent value="organisation" className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="estimatedAmountEuros">Montant estimé (€)</Label>
                    <Input
                      id="estimatedAmountEuros"
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Ex. 150000"
                      {...register('estimatedAmountEuros', { setValueAs: emptyToNumber })}
                    />
                    <FieldError message={errors.estimatedAmountEuros?.message} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="durationMonths">Durée (mois)</Label>
                    <Input
                      id="durationMonths"
                      type="number"
                      min={1}
                      {...register('durationMonths', { setValueAs: emptyToNumber })}
                    />
                    <FieldError message={errors.durationMonths?.message} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="region">Région / localisation</Label>
                    <Input id="region" {...register('region')} />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="priceWeight">Critère prix (%)</Label>
                    <Input
                      id="priceWeight"
                      type="number"
                      min={0}
                      max={100}
                      {...register('priceWeight', { setValueAs: emptyToNumber })}
                    />
                    <FieldError message={errors.priceWeight?.message} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="technicalWeight">Critère technique (%)</Label>
                    <Input
                      id="technicalWeight"
                      type="number"
                      min={0}
                      max={100}
                      {...register('technicalWeight', { setValueAs: emptyToNumber })}
                    />
                    {criteriaTotal > 0 && criteriaTotal !== 100 ? (
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                        Total critères : {criteriaTotal} % (attendu 100 %)
                      </p>
                    ) : (
                      <FieldError message={errors.technicalWeight?.message} />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Responsable du dossier</Label>
                    <Controller
                      control={control}
                      name="responsibleId"
                      render={({ field }) => (
                        <Select
                          value={field.value || NONE}
                          onValueChange={(v) => field.onChange(v === NONE ? '' : (v ?? ''))}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>— Non assigné</SelectItem>
                            {members.map((m) => (
                              <SelectItem key={m.user_id} value={m.user_id}>
                                {m.full_name ?? m.user_id.slice(0, 8)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
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
                      onClick={() => {
                        const next =
                          fields.reduce((m, f) => Math.max(m, Number(f.number) || 0), 0) + 1
                        append({ number: next, title: '', amountEuros: undefined })
                      }}
                    >
                      <Plus className="size-3.5" /> Ajouter un lot
                    </Button>
                  </div>
                  {fields.length > 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="w-20">N°</span>
                      <span className="flex-1">Intitulé</span>
                      <span className="w-32">Montant €</span>
                      <span className="w-7" />
                    </div>
                  )}
                  {fields.map((f, i) => (
                    <div key={f.id}>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          className="w-20"
                          placeholder="N°"
                          {...register(`lots.${i}.number`, { setValueAs: emptyToNumber })}
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
                          {...register(`lots.${i}.amountEuros`, { setValueAs: emptyToNumber })}
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
                      <FieldError message={errors.lots?.[i]?.title?.message} />
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notes internes</Label>
                  <Textarea id="notes" rows={3} {...register('notes')} />
                </div>
              </TabsContent>
            </div>
          </Tabs>

          <DialogFooter>
            <span className="mr-auto self-center text-xs text-muted-foreground">
              <span className="text-destructive">*</span> Champs requis
              {tender?.updated_at &&
                ` — modifié le ${new Date(tender.updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`}
            </span>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Enregistrement…
                </>
              ) : tender ? (
                'Mettre à jour'
              ) : (
                'Créer le dossier'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
