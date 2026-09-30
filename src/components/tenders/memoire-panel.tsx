'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  CircleAlert,
  FileCode2,
  FileText,
  Loader2,
  PenLine,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { ActionProgress } from '@/components/ui/action-progress'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  analyzeMemoireDce,
  buildMemoireComplet,
  buildMemoireDocx,
  createMemoireRun,
  deleteMemoireRun,
  generateMemoireContent,
  importMemoireDocx,
} from '@/app/actions/memoire'
import { getDocumentUrl } from '@/app/actions/documents'
import type { MemoireRunRow } from '@/lib/dal/memoire'
import { EMPTY_ANALYSIS } from '@/lib/memoire/types'
import type { TenderLot } from '@/lib/types'
import { formatDate } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  analyzed: 'DCE analysé',
  generated: 'Fichier généré',
  built: 'Mémoire étape 1 prêt',
  built_full: 'Mémoire complet prêt',
  error: 'Erreur',
}

function FicheRow({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-44 shrink-0 pt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <ul className="min-w-0 flex-1 list-disc space-y-0.5 pl-4">
        {values.map((v, i) => (
          <li key={i} className="text-sm">
            {v}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function MemoirePanel({
  orgSlug,
  tenderId,
  runs,
  lots,
  analysisLots = [],
  canEdit,
}: {
  orgSlug: string
  tenderId: string
  runs: MemoireRunRow[]
  lots: TenderLot[]
  /** Lots détectés par l'analyse DCE mais pas encore créés dans le dossier. */
  analysisLots?: { number: number; title: string }[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [runId, setRunId] = useState(runs[0]?.id ?? '')
  const run = useMemo(() => runs.find((r) => r.id === runId) ?? runs[0], [runs, runId])
  const [createOpen, setCreateOpen] = useState(false)
  const [lotPick, setLotPick] = useState('')
  const [lotLabel, setLotLabel] = useState('')
  const [pending, startTransition] = useTransition()
  const [pendingStep, setPendingStep] = useState<{
    title: string
    steps: string[]
  } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [building, setBuilding] = useState(false)
  const [buildingFull, setBuildingFull] = useState(false)
  // Pipeline enchaîné : 0 analyse DCE, 1 génération contenu, 2 mémoire complet.
  const [pipelineStep, setPipelineStep] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // La fiche jsonb peut être vide ({}) avant l'analyse — merge avec les défauts.
  const analysis = run?.analysis ? { ...EMPTY_ANALYSIS, ...run.analysis } : null
  const hasFiche = !!analysis?.couverture?.operation
  const warnings = Array.isArray(run?.warnings) ? run.warnings : []

  // Options du sélecteur : les lots du dossier, sinon ceux détectés par
  // l'analyse DCE (préfixe « a: » = pas encore de ligne tender_lots).
  const lotOptions = useMemo(
    () =>
      lots.length
        ? lots.map((l) => ({
            value: l.id,
            number: l.number,
            title: l.title,
            real: true,
          }))
        : analysisLots.map((l) => ({
            value: `a:${l.number}`,
            number: l.number,
            title: l.title,
            real: false,
          })),
    [lots, analysisLots],
  )

  // Choix dérivé de lotPick — un choix périmé (analyse appliquée entre-temps,
  // option « a: » disparue) retombe sur « rien » au lieu d'être renvoyé.
  const pickedLot = lotOptions.find((o) => o.value === lotPick) ?? null
  const lotId = pickedLot?.real ? pickedLot.value : ''
  const pickedAnalysisLot =
    pickedLot && !pickedLot.real
      ? { number: pickedLot.number, title: pickedLot.title }
      : null

  function pickLot(value: string) {
    setLotPick(value)
    const opt = lotOptions.find((o) => o.value === value)
    if (opt) {
      setLotLabel(`LOT ${String(opt.number).padStart(2, '0')} - ${opt.title.toUpperCase()}`)
    }
  }

  function create() {
    if (!lotLabel.trim()) return
    startTransition(async () => {
      const res = await createMemoireRun(orgSlug, tenderId, {
        lotId,
        lotNumber: pickedAnalysisLot?.number,
        lotTitle: pickedAnalysisLot?.title,
        lotLabel: lotLabel.trim(),
      })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success('Run créé — lancez l’analyse du DCE')
      setCreateOpen(false)
      if (res?.id) setRunId(res.id)
      router.refresh()
    })
  }

  function analyze() {
    if (!run) return
    setPendingStep({
      title: `Analyse du DCE — ${run.lot_label}`,
      steps: [
        'Chargement des pièces du lot',
        'Extraction du texte',
        'Analyse IA ciblée sur le lot (critères, périmètre, échéances)',
        'Remplissage de la fiche d’analyse',
      ],
    })
    startTransition(async () => {
      try {
        const res = await analyzeMemoireDce(orgSlug, tenderId, run.id)
        if (res.error) {
          toast.error(res.error)
          return
        }
        toast.success(
          `Fiche remplie : ${res.data?.criteres ?? 0} critère(s), ${res.data?.manquants ?? 0} donnée(s) manquante(s)` +
            (res.data?.skipped ? ` — ${res.data.skipped} pièce(s) illisible(s)` : ''),
        )
        router.refresh()
      } finally {
        setPendingStep(null)
      }
    })
  }

  function generate() {
    if (!run) return
    setGenerating(true)
    startTransition(async () => {
      try {
        const res = await generateMemoireContent(orgSlug, tenderId, run.id)
        if (res.error) {
          toast.error(res.error)
          return
        }
        toast.success(`Fichier ${res.data?.filename} généré et rangé dans Documents`)
        router.refresh()
      } finally {
        setGenerating(false)
      }
    })
  }

  async function openContent(id?: string | null) {
    const docId = id ?? run?.content_document_id
    if (!docId) return
    // docx/py : pas d'aperçu navigateur — on sert le vrai nom de fichier.
    const res = await getDocumentUrl(orgSlug, docId, { download: true })
    if (res.error || !res.url) {
      toast.error(res.error ?? 'Lien impossible')
      return
    }
    window.open(res.url, '_blank', 'noopener')
  }

  function build() {
    if (!run) return
    setBuilding(true)
    startTransition(async () => {
      try {
        const res = await buildMemoireDocx(orgSlug, tenderId, run.id)
        if (res.error) {
          toast.error(res.error)
          return
        }
        toast.success(`${res.data?.filename} construit et rangé dans Documents`)
        router.refresh()
      } finally {
        setBuilding(false)
      }
    })
  }

  function buildFull() {
    if (!run) return
    setBuildingFull(true)
    startTransition(async () => {
      try {
        const res = await buildMemoireComplet(orgSlug, tenderId, run.id)
        if (res.error) {
          toast.error(res.error)
          return
        }
        toast.success(`${res.data?.filename} construit et rangé dans Documents`)
        router.refresh()
      } finally {
        setBuildingFull(false)
      }
    })
  }

  /**
   * Pipeline complet en un clic : analyse du DCE → génération du fichier de
   * contenu → construction du mémoire complet (.docx). Un échec stoppe la
   * chaîne en indiquant l'étape fautive.
   */
  async function runPipeline() {
    if (!run || pipelineStep != null) return
    const stepTitles = [
      'Analyse du DCE',
      'Génération du contenu',
      'Mémoire complet (.docx)',
    ]
    // Compteur local : `pipelineStep` (state) resterait figé dans le catch.
    let step = 0
    try {
      setPipelineStep(step)
      const a = await analyzeMemoireDce(orgSlug, tenderId, run.id)
      if (a.error) throw new Error(a.error)

      step = 1
      setPipelineStep(step)
      const g = await generateMemoireContent(orgSlug, tenderId, run.id)
      if (g.error) throw new Error(g.error)

      step = 2
      setPipelineStep(step)
      const b = await buildMemoireComplet(orgSlug, tenderId, run.id)
      if (b.error) throw new Error(b.error)

      toast.success(`${b.data?.filename} — pipeline terminé`)
    } catch (e) {
      toast.error(
        `Pipeline interrompu à l’étape ${step + 1} (${stepTitles[step]}) : ${e instanceof Error ? e.message : 'erreur'}`,
      )
    } finally {
      setPipelineStep(null)
      router.refresh()
    }
  }

  /** Importe un mémoire .docx déjà produit hors pipeline et le rattache
   *  au run courant (ou à un nouveau run créé sur le lot choisi). */
  function importDocx() {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.set('file', file)
    startTransition(async () => {
      const res = await importMemoireDocx(
        orgSlug,
        tenderId,
        {
          runId: run?.id ?? '',
          lotId,
          lotNumber: pickedAnalysisLot?.number,
          lotTitle: pickedAnalysisLot?.title,
          lotLabel,
        },
        fd,
      )
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`${res.data?.filename} importé — rattaché au run`)
      setImportOpen(false)
      if (res.data?.runId) setRunId(res.data.runId)
      router.refresh()
    })
  }

  function removeRun() {
    if (!run) return
    startTransition(async () => {
      const res = await deleteMemoireRun(orgSlug, tenderId, run.id)
      if (res?.error) toast.error(res.error)
      else {
        toast.success('Run supprimé')
        setRunId('')
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {runs.length > 0 && (
          <Select value={run?.id ?? ''} onValueChange={(v) => setRunId(v ?? '')}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Run mémoire…" />
            </SelectTrigger>
            <SelectContent>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.lot_label} — {formatDate(r.created_at)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {run && <Badge variant="secondary">{STATUS_LABELS[run.status] ?? run.status}</Badge>}
        {canEdit && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger
              render={
                <Button size="sm" variant={runs.length ? 'outline' : 'default'}>
                  <Plus className="size-4" /> Nouveau mémoire
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Mémoire technique — nouveau run</DialogTitle>
                <DialogDescription>
                  Étape 1 du pipeline : analyse du DCE puis génération du fichier
                  de contenu (content_*.py) qui servira à construire le .docx.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Lot concerné</Label>
                  <Select value={lotPick} onValueChange={(v) => pickLot(v ?? '')}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Sélectionner un lot…" />
                    </SelectTrigger>
                    <SelectContent>
                      {lotOptions.map((l) => (
                        <SelectItem key={l.value} value={l.value}>
                          Lot {l.number} — {l.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!lots.length && analysisLots.length > 0 && (
                    <p className="text-muted-foreground text-xs">
                      Lots détectés par l’analyse DCE — la fiche lot sera créée
                      automatiquement.
                    </p>
                  )}
                  {!lotOptions.length && (
                    <p className="text-muted-foreground text-xs">
                      Aucun lot détecté — appliquez l’analyse DCE ou saisissez le
                      libellé ci-dessous.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="memoireLotLabel">Libellé du lot *</Label>
                  <Input
                    id="memoireLotLabel"
                    value={lotLabel}
                    onChange={(e) => setLotLabel(e.target.value)}
                    placeholder="LOT 01 - GROS OEUVRE"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Annuler
                </Button>
                <Button onClick={create} disabled={pending || !lotLabel.trim()}>
                  {pending && <Loader2 className="size-4 animate-spin" />} Créer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {canEdit && (
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger
              render={
                <Button size="sm" variant="outline">
                  <Upload className="size-4" /> Importer un .docx
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Importer un mémoire existant</DialogTitle>
                <DialogDescription>
                  Vous avez déjà produit le mémoire ? Importez le .docx — il sera
                  rattaché au run{run ? ` « ${run.lot_label} »` : ''} comme
                  livrable final (mémoire complet), sans relancer le pipeline.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {!run && (
                  <div className="space-y-1.5">
                    <Label>Lot concerné</Label>
                    <Select value={lotPick} onValueChange={(v) => pickLot(v ?? '')}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Sélectionner un lot…" />
                      </SelectTrigger>
                      <SelectContent>
                        {lotOptions.map((l) => (
                          <SelectItem key={l.value} value={l.value}>
                            Lot {l.number} — {l.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!lotOptions.length && (
                      <p className="text-muted-foreground text-xs">
                        Aucun lot détecté — appliquez l’analyse DCE ou saisissez
                        le libellé ci-dessous.
                      </p>
                    )}
                  </div>
                )}
                {!run && !lotOptions.length && (
                  <div className="space-y-1.5">
                    <Label htmlFor="memoireImportLotLabel">Libellé du lot *</Label>
                    <Input
                      id="memoireImportLotLabel"
                      value={lotLabel}
                      onChange={(e) => setLotLabel(e.target.value)}
                      placeholder="LOT 01 - GROS OEUVRE"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="memoireImportFile">Fichier .docx *</Label>
                  <Input id="memoireImportFile" ref={fileRef} type="file" accept=".docx" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportOpen(false)}>
                  Annuler
                </Button>
                <Button
                  onClick={importDocx}
                  disabled={pending || (!run && !lotLabel.trim())}
                >
                  {pending && <Loader2 className="size-4 animate-spin" />} Importer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {run && canEdit && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Supprimer le run"
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer ce run ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Le contenu généré et les fichiers produits pour ce run
                  seront définitivement supprimés.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={removeRun} disabled={pending}>
                  Supprimer
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {!run && (
        <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          Aucun run de mémoire technique — créez-en un pour analyser le DCE et
          produire le fichier de contenu qui alimentera le .docx (étape 2).
        </div>
      )}

      {run && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 py-3">
              {canEdit && (
                <Button
                  size="sm"
                  onClick={runPipeline}
                  disabled={
                    pipelineStep != null ||
                    pending ||
                    generating ||
                    building ||
                    buildingFull
                  }
                >
                  {pipelineStep != null ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <BookOpenCheck className="size-4" />
                  )}
                  Tout lancer
                </Button>
              )}
              <Button
                size="sm"
                variant={run.status === 'draft' ? 'default' : 'outline'}
                onClick={analyze}
                disabled={!canEdit || pending || generating || pipelineStep != null}
              >
                {pending && !generating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <BookOpenCheck className="size-4" />
                )}
                1. Analyser le DCE
              </Button>
              <Button
                size="sm"
                variant={hasFiche ? 'default' : 'outline'}
                onClick={generate}
                disabled={
                  !canEdit || !hasFiche || pending || generating || pipelineStep != null
                }
              >
                {generating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <PenLine className="size-4" />
                )}
                2. Générer le fichier de contenu
              </Button>
              <Button
                size="sm"
                variant={run.docx_document_id ? 'outline' : 'default'}
                onClick={build}
                disabled={
                  !canEdit ||
                  !run.content_document_id ||
                  pending ||
                  generating ||
                  building ||
                  buildingFull ||
                  pipelineStep != null
                }
              >
                {building ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4" />
                )}
                3. Mémoire .docx — étape 1
              </Button>
              <Button
                size="sm"
                variant={run.docx_full_document_id ? 'outline' : 'default'}
                onClick={buildFull}
                disabled={
                  !canEdit ||
                  !run.content_document_id ||
                  pending ||
                  generating ||
                  building ||
                  buildingFull ||
                  pipelineStep != null
                }
              >
                {buildingFull ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4" />
                )}
                4. Mémoire complet — étape 2
              </Button>
              {pipelineStep != null && (
                <ActionProgress
                  title={`Pipeline mémoire en cours — ${run.lot_label}`}
                  steps={[
                    'Analyse du DCE (fiche)',
                    'Génération du contenu',
                    'Mémoire complet (.docx)',
                  ]}
                  activeStep={pipelineStep}
                  className="w-full"
                />
              )}
              {pipelineStep == null && (building || buildingFull) && (
                <ActionProgress
                  title={
                    buildingFull
                      ? 'Construction du mémoire complet (.docx)'
                      : 'Construction du mémoire .docx — étape 1'
                  }
                  steps={[
                    'Injection du contenu dans le gabarit DCR',
                    'Validation XML du document',
                    'Rangement et liaison au dossier',
                  ]}
                  className="w-full"
                />
              )}
              {generating && (
                <ActionProgress
                  title="Rédaction du fichier de contenu (7 parties, sections 1 à 7 selon critères du RC)"
                  steps={[
                    'Génération IA section par section',
                    'Assemblage du fichier Python',
                    'Rangement dans Documents',
                  ]}
                  className="w-full"
                />
              )}
              {pending && !generating && pendingStep && (
                <ActionProgress
                  title={pendingStep.title}
                  steps={pendingStep.steps}
                  className="w-full"
                />
              )}
            </CardContent>
          </Card>

          {run.error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <CircleAlert className="size-4" /> {run.error}
            </div>
          )}

          {/* Fiche d'analyse */}
          {hasFiche && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <BookOpenCheck className="size-4" /> Fiche d’analyse du DCE
                  {analysis.criteres.length > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {analysis.criteres.length} critère(s)
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Couverture
                    </p>
                    <p className="mt-1 font-medium">{analysis.couverture.operation || '—'}</p>
                    <p className="text-muted-foreground">{analysis.couverture.moa}</p>
                    <p className="text-muted-foreground">{analysis.couverture.lot}</p>
                    <p className="text-muted-foreground">{analysis.couverture.reference}</p>
                    <p className="text-muted-foreground">{analysis.couverture.remise}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Délai / contrainte
                    </p>
                    <p className="mt-1">{analysis.delai_global || '—'}</p>
                    <p className="text-muted-foreground">{analysis.contrainte_site || '—'}</p>
                    {analysis.visite ? (
                      <p className="mt-1 text-muted-foreground">Visite : {analysis.visite}</p>
                    ) : null}
                  </div>
                </div>
                <FicheRow label="Critères de jugement" values={analysis.criteres} />
                <FicheRow label="Exigences du RC" values={analysis.exigences_rc} />
                <FicheRow label="Pénalités" values={analysis.penalites.slice(0, 8)} />
                <FicheRow label="Conditions marché" values={analysis.conditions_marche.slice(0, 6)} />
                <FicheRow label="Phases planning" values={analysis.planning_phases.slice(0, 8)} />
                <FicheRow label="Jalons" values={analysis.jalons} />
                <FicheRow label="Interfaces" values={analysis.interfaces.slice(0, 6)} />
                <FicheRow label="Options / PSE" values={analysis.options} />
                <FicheRow label="Clauses sociales / env." values={analysis.clauses ?? []} />
                <FicheRow label="Pièces à remettre" values={analysis.pieces_a_remettre ?? []} />
                {(analysis.prix || analysis.reception) && (
                  <div className="flex gap-3 text-sm">
                    <span className="w-44 shrink-0 pt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Prix / réception
                    </span>
                    <p className="min-w-0 flex-1 text-sm">
                      {[analysis.prix, analysis.reception].filter(Boolean).join(' — ')}
                    </p>
                  </div>
                )}
                {analysis.manquants.length > 0 && (
                  <div className="flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <div>
                      <span className="font-medium">Données absentes du DCE :</span>{' '}
                      {analysis.manquants.join(' — ')}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Fichier généré */}
          {run.content_document_id && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileCode2 className="size-4" /> Fichier de contenu — étape 1
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openContent()}>
                    <FileCode2 className="size-3.5" /> {run.content_filename ?? 'content.py'}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    rangé dans Documents → /Mémoire technique
                  </span>
                </div>
                {warnings.length > 0 && (
                  <ul className="space-y-1 text-xs text-amber-600">
                    {warnings.map((w, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <AlertTriangle className="size-3" /> {w}
                      </li>
                    ))}
                  </ul>
                )}
                {run.docx_document_id && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openContent(run.docx_document_id)}
                    >
                      <FileText className="size-3.5" /> {run.docx_filename ?? 'mémoire.docx'}
                    </Button>
                    <span className="text-xs text-emerald-600">
                      Étape 1 — sections 2/4/5 + couverture
                    </span>
                  </div>
                )}
                {run.docx_full_document_id && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openContent(run.docx_full_document_id)}
                    >
                      <FileText className="size-3.5" />
                      {run.docx_full_filename ?? 'mémoire_complet.docx'}
                    </Button>
                    <span className="text-xs text-emerald-600">
                      Étape 2 — mémoire complet 7 parties — relecture dans Word
                      (Ctrl+A puis F9 pour la TDM)
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {!hasFiche && run.status !== 'error' && (
            <p className="text-sm text-muted-foreground">
              Étape 1 : analysez le DCE pour remplir la fiche (critères, pénalités,
              planning, consistence), puis générez le fichier de contenu.
            </p>
          )}
          {run.status === 'generated' && (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="size-4" /> Fichier de contenu prêt — lancez
              la construction du .docx (étape 2).
            </p>
          )}
          {run.status === 'built' && (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="size-4" /> Mémoire étape 1 construit et
              validé — lancez l’étape 2 pour le mémoire complet.
            </p>
          )}
          {run.status === 'built_full' && (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="size-4" /> Mémoire complet (avec
              couverture) construit et validé — relecture dans Word avant dépôt.
            </p>
          )}
        </>
      )}
    </div>
  )
}
