'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  BookOpenCheck,
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Package,
  Plus,
  Search,
  Table2,
  Trash2,
  Upload,
  X,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  attachDatasheetDocument,
  createDatasheetRun,
  deleteDatasheetRun,
  downloadRunPdfs,
  exportRunDeliverables,
  extractRunBrief,
  findMissingDocUrls,
  importDatasheetDeliverable,
  researchRunChapter,
} from '@/app/actions/datasheets'
import { getDocumentUrl } from '@/app/actions/documents'
import {
  EMPTY_CHAPTER_RESULT,
  folderForDocType,
  isProductDocument,
} from '@/lib/datasheets/types'
import type { ChapterResult } from '@/lib/datasheets/types'
import type { DatasheetRunRow } from '@/lib/dal/datasheets'
import type { TenderLot } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { AObtenirPanel, EcartsPanel } from '@/components/tenders/ecarts-panel'
import { PaginationBar, usePager } from '@/components/pagination-bar'

const STATUT_STYLE: Record<string, string> = {
  OK: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  'À VALIDER': 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  'NON CONFORME': 'bg-red-500/15 text-red-600 dark:text-red-400',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  brief_ready: 'DCE dépouillé',
  researched: 'Recherche terminée',
  downloaded: 'PDF téléchargés',
  error: 'Erreur',
}

function statutBadge(statut: string) {
  const base = statut.split('|')[0].trim()
  return (
    <Badge
      variant="secondary"
      className={cn('text-[10px]', STATUT_STYLE[base])}
      title={statut !== base ? statut : undefined}
    >
      {base}
    </Badge>
  )
}

export function DatasheetPanel({
  orgSlug,
  tenderId,
  runs,
  lots,
  analysisLots = [],
  canEdit,
}: {
  orgSlug: string
  tenderId: string
  runs: DatasheetRunRow[]
  lots: TenderLot[]
  /** Lots détectés par l'analyse DCE mais pas encore créés dans le dossier. */
  analysisLots?: { number: number; title: string }[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [runId, setRunId] = useState(runs[0]?.id ?? '')
  const run = useMemo(
    () => runs.find((r) => r.id === runId) ?? runs[0],
    [runs, runId],
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [lotPick, setLotPick] = useState('')
  const [lotLabel, setLotLabel] = useState('')
  const [operationShort, setOperationShort] = useState('')
  const [variantes, setVariantes] = useState('')
  const [pending, startTransition] = useTransition()
  const [pendingStep, setPendingStep] = useState<{
    title: string
    steps: string[]
  } | null>(null)
  const [researchProgress, setResearchProgress] = useState<string | null>(null)
  // Pipeline enchaîné : 0 dépouillage, 1 recherche, 2 PDF, 3 livrables.
  const [pipelineStep, setPipelineStep] = useState<number | null>(null)
  const [pdfFilter, setPdfFilter] = useState('')
  // Onglet courant conservé au router.refresh() (le key={doneChapters}
  // renvoyait au 1er onglet après chaque recherche).
  const [tabPick, setTabPick] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const chapterCodes = Object.keys(run?.chapters ?? {})
  const doneChapters = chapterCodes.filter((c) => run?.result?.[c])
  const allDocs = Object.values(run?.result ?? {}).flatMap(
    (r) => r.documents ?? [],
  )
  // Les prescriptions CCTP / références normatives (DTU, NF EN, PV d'essais…)
  // n'ont pas de fiche fabricant téléchargeable — elles ne comptent pas dans
  // le ratio de couverture PDF, sinon il paraît toujours catastrophique.
  const productDocs = allDocs.filter((d) => isProductDocument(d))
  const prescriptiveDocs = allDocs.filter((d) => !isProductDocument(d))
  const withUrl = allDocs.filter((d) => d.url && d.filename !== '—')
  // Livrés = flag posé par le téléchargement OU document rattaché (réutilisé
  // de la bibliothèque / même URL partagée / PDF conservé à la re-recherche).
  const delivered = allDocs.filter((d) => d.downloaded || d.document_id)
  const allEcarts = Object.values(run?.result ?? {}).flatMap(
    (r) => r.ecarts ?? [],
  )
  const allProduits = Object.values(run?.result ?? {}).flatMap(
    (r) => r.produits ?? [],
  )
  const allAObtenir = Object.values(run?.result ?? {}).flatMap(
    (r) => r.a_obtenir ?? [],
  )

  // PDF récupérés : filtre instantané (marque, référence, désignation, type,
  // code chapitre) puis pagination — la grille 2 colonnes reste compacte.
  const pdfNeedle = pdfFilter.trim().toLowerCase()
  const deliveredVisible = pdfNeedle
    ? delivered.filter((d) =>
        `${d.code} ${d.marque} ${d.reference} ${d.designation} ${d.type_document.replace(/_/g, ' ')}`
          .toLowerCase()
          .includes(pdfNeedle),
      )
    : delivered
  const deliveredPager = usePager(deliveredVisible, 12)

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
      setLotLabel(
        `LOT ${String(opt.number).padStart(2, '0')} - ${opt.title.toUpperCase()}`,
      )
    }
  }

  function create() {
    if (!lotLabel.trim()) return
    startTransition(async () => {
      const res = await createDatasheetRun(orgSlug, tenderId, {
        lotId,
        lotNumber: pickedAnalysisLot?.number,
        lotTitle: pickedAnalysisLot?.title,
        lotLabel: lotLabel.trim(),
        operationShort: operationShort.trim(),
        variantes: variantes
          .split(',')
          .map((v) => v.trim().toUpperCase())
          .filter(Boolean),
      })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success('Dossier créé — lancez le dépouillage du DCE')
      setCreateOpen(false)
      if (res?.id) setRunId(res.id)
      router.refresh()
    })
  }

  function extract() {
    if (!run) return
    setPendingStep({
      title: `Dépouillage du DCE — ${run.lot_label}`,
      steps: [
        'Chargement des pièces du lot',
        'Extraction du texte (PDF, DOCX, XLSX)',
        'Détection des exigences produits et chapitres',
      ],
    })
    startTransition(async () => {
      try {
        const res = await extractRunBrief(orgSlug, tenderId, run.id)
        if (res.error) {
          toast.error(res.error)
          return
        }
        toast.success(
          `DCE dépouillé : ${res.data?.chapters.length ?? 0} chapitre(s) détecté(s)`,
        )
        router.refresh()
      } finally {
        setPendingStep(null)
      }
    })
  }

  async function researchAll() {
    if (!run) return
    setResearchProgress('démarrage…')
    for (const code of chapterCodes.filter((c) => !run.result?.[c])) {
      setResearchProgress(`chapitre ${code}…`)
      const res = await researchRunChapter(orgSlug, tenderId, run.id, code)
      if (res.error) {
        toast.error(`${code} : ${res.error}`)
        break
      }
      router.refresh()
    }
    setResearchProgress(null)
  }

  function researchOne(code: string) {
    setPendingStep({
      title: `Recherche documentaire — chapitre ${code}`,
      steps: [
        'Agent web DeepSeek — recherche fabricants officiels',
        'Récupération des documents techniques',
        'Analyse de conformité vs exigences CCTP',
      ],
    })
    startTransition(async () => {
      try {
        const res = await researchRunChapter(orgSlug, tenderId, run!.id, code)
        if (res.error) {
          toast.error(res.error)
          return
        }
        toast.success(
          `${code} : ${res.data?.produits ?? 0} produits, ${res.data?.documents ?? 0} documents`,
        )
        router.refresh()
      } finally {
        setPendingStep(null)
      }
    })
  }

  /** Téléchargement des PDF : un agent cherche d'abord les URL officielles
   *  des documents restés sans lien (seconde passe), puis tous les PDF sont
   *  récupérés — couverture maximale en un clic. */
  function downloadAll() {
    if (!run) return
    // Seules les fiches fabricants peuvent être trouvées en ligne : les
    // prescriptions CCTP / normes (DTU, NF EN…) n'ont pas de PDF public.
    const missingCount = productDocs.filter((d) => !d.url).length
    const missing = missingCount > 0
    const stepLabel = (toFetch: number) =>
      `Téléchargement de ${toFetch} PDF (6 en parallèle)`
    setPendingStep({
      title: 'Téléchargement des PDF fabricants',
      steps: [
        ...(missing
          ? [
              `Recherche ciblée des URL officielles manquantes — ${missingCount} fiche${missingCount > 1 ? 's' : ''} fabricant sans URL (agent web)`,
            ]
          : []),
        stepLabel(withUrl.length),
        'Stockage et liaison au dossier',
        'Vérification des téléchargements',
      ],
    })
    startTransition(async () => {
      try {
        let found = 0
        let stillMissing = 0
        let prescriptive = 0
        if (missing) {
          const s = await findMissingDocUrls(orgSlug, tenderId, run.id)
          if (s.error) {
            toast.error(`Recherche complémentaire : ${s.error}`)
          } else {
            found = s.data?.found ?? 0
            stillMissing = s.data?.missing ?? 0
            prescriptive = s.data?.prescriptive ?? 0
          }
          // Le compte réel à télécharger inclut les URL retrouvées.
          setPendingStep({
            title: 'Téléchargement des PDF fabricants',
            steps: [
              `Recherche ciblée des URL manquantes terminée — ${found} retrouvée${found > 1 ? 's' : ''}, ${stillMissing} restante${stillMissing > 1 ? 's' : ''} sans URL`,
              stepLabel(withUrl.length + found),
              'Stockage et liaison au dossier',
              'Vérification des téléchargements',
            ],
          })
        }
        const res = await downloadRunPdfs(orgSlug, tenderId, run.id)
        if (res.error) {
          toast.error(res.error)
          return
        }
        toast.success(
          `${res.data?.ok ?? 0} PDF téléchargé(s)` +
            (found ? ` — ${found} fiche(s) retrouvée(s) par l'agent` : '') +
            (res.data?.failed ? `, ${res.data.failed} en échec` : '') +
            (stillMissing ? `, ${stillMissing} fiche(s) fabricant introuvable(s)` : '') +
            (prescriptive
              ? `, ${prescriptive} prescription(s) CCTP/norme à joindre`
              : ''),
        )
        router.refresh()
      } finally {
        setPendingStep(null)
      }
    })
  }

  function exportDeliverables() {
    if (!run) return
    setPendingStep({
      title: 'Génération du classeur et de l’arborescence',
      steps: [
        'Classeur Excel de conformité',
        'Arborescence et README de livraison',
        'Assemblage du ZIP et rangement',
      ],
    })
    startTransition(async () => {
      try {
        const res = await exportRunDeliverables(orgSlug, tenderId, run.id)
        if (res.error) {
          toast.error(res.error)
          return
        }
        toast.success(`Livrables générés : ${res.data?.files.join(', ')}`)
        if (res.data?.failed.length) {
          toast.warning(
            `Livrable(s) en échec : ${res.data.failed.join(', ')}`,
          )
        }
        router.refresh()
      } finally {
        setPendingStep(null)
      }
    })
  }

  /**
   * Pipeline complet en un clic : dépouillage → recherche web (chaque
   * chapitre, séquentiel) → téléchargement des PDF → classeur + arborescence.
   * Les étapes s'enchaînent sans intervention ; chaque étape affiche sa
   * progression et un échec stoppe la chaîne en indiquant où.
   */
  async function runPipeline() {
    if (!run || pipelineStep != null) return
    const stepTitles = [
      'Dépouillage du DCE',
      'Recherche web par chapitre',
      'Recherche des PDF manquants + téléchargement',
      'Classeur + arborescence',
    ]
    // Compteur local : `pipelineStep` (state) resterait figé dans le catch.
    let step = 0
    try {
      setPipelineStep(step)
      const brief = await extractRunBrief(orgSlug, tenderId, run.id)
      if (brief.error) throw new Error(brief.error)
      const chapters = brief.data?.chapters ?? []
      if (!chapters.length)
        throw new Error('Aucun chapitre détecté dans le DCE.')

      step = 1
      setPipelineStep(step)
      // Chapitres déjà recherchés conservés par le dépouillage → on ne les
      // refait pas (relancer un chapitre à la main reste possible).
      const alreadyDone = new Set(Object.keys(run.result ?? {}))
      const toResearch = chapters.filter((c) => !alreadyDone.has(c))
      let i = 0
      for (const code of toResearch) {
        i += 1
        setResearchProgress(`chapitre ${code} — ${i}/${toResearch.length}`)
        const r = await researchRunChapter(orgSlug, tenderId, run.id, code)
        if (r.error) throw new Error(`Chapitre ${code} : ${r.error}`)
        router.refresh()
      }
      setResearchProgress(null)

      step = 2
      setPipelineStep(step)
      // Seconde passe : l'agent cherche les URL officielles des documents
      // restés sans lien avant le téléchargement (no-op si rien à chercher).
      const extra = await findMissingDocUrls(orgSlug, tenderId, run.id)
      if (extra.error) toast.error(`Recherche complémentaire : ${extra.error}`)
      router.refresh()
      const dl = await downloadRunPdfs(orgSlug, tenderId, run.id)
      if (dl.error) throw new Error(dl.error)

      step = 3
      setPipelineStep(step)
      const ex = await exportRunDeliverables(orgSlug, tenderId, run.id)
      if (ex.error) throw new Error(ex.error)

      toast.success(
        `Pipeline terminé — ${dl.data?.ok ?? 0} PDF, livrables : ${ex.data?.files.join(', ')}`,
      )
      if (ex.data?.failed.length) {
        toast.warning(`Livrable(s) en échec : ${ex.data.failed.join(', ')}`)
      }
    } catch (e) {
      toast.error(
        `Pipeline interrompu à l’étape ${step + 1} (${stepTitles[step]}) : ${e instanceof Error ? e.message : 'erreur'}`,
      )
    } finally {
      setPipelineStep(null)
      setResearchProgress(null)
      router.refresh()
    }
  }

  // download: force le nom « propre » en Content-Disposition — les livrables
  // (xlsx/zip) ne s'affichent pas en navigateur, autant servir le bon nom.
  async function openDocument(documentId: string, download = false) {
    const res = await getDocumentUrl(orgSlug, documentId, { download })
    if (res.error || !res.url) {
      toast.error(res.error ?? 'Lien impossible')
      return
    }
    window.open(res.url, '_blank', 'noopener')
  }

  /** Rattache un livrable déjà produit (ZIP, classeur, PDF) au dossier —
   *  sans relancer le pipeline. */
  function importDeliverable(file: File) {
    if (!run) return
    const fd = new FormData()
    fd.set('file', file)
    startTransition(async () => {
      const res = await importDatasheetDeliverable(orgSlug, tenderId, run.id, fd)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`${res.data?.filename} ajouté aux livrables`)
      router.refresh()
    })
  }

  function removeRun() {
    if (!run) return
    startTransition(async () => {
      const res = await deleteDatasheetRun(orgSlug, tenderId, run.id)
      if (res?.error) toast.error(res.error)
      else {
        toast.success('Dossier supprimé')
        setRunId('')
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Sélecteur de dossier + création */}
      <div className="flex flex-wrap items-center gap-3">
        {runs.length > 0 && (
          <Select
            value={run?.id ?? ''}
            onValueChange={(v) => setRunId(v ?? '')}
          >
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Dossier de fiches…" />
            </SelectTrigger>
            <SelectContent>
              {runs.map((r) => (
                <SelectItem
                  key={r.id}
                  value={r.id}
                  label={`${r.lot_label} — ${formatDate(r.created_at)}`}
                >
                  {r.lot_label} — {formatDate(r.created_at)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {run && (
          <Badge variant="secondary">
            {STATUS_LABELS[run.status] ?? run.status}
          </Badge>
        )}
        {canEdit && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger
              render={
                <Button size="sm" variant={runs.length ? 'outline' : 'default'}>
                  <Plus className="size-4" /> Nouveau dossier de fiches
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouveau dossier de fiches techniques</DialogTitle>
                <DialogDescription>
                  Un dossier « Liste des marques / fiches techniques » pour un
                  lot du marché. Les pièces du DCE jointes au dossier serviront
                  de base.
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
                        <SelectItem
                          key={l.value}
                          value={l.value}
                          label={`Lot ${l.number} — ${l.title}`}
                        >
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
                  <Label htmlFor="lotLabel">Libellé du lot *</Label>
                  <Input
                    id="lotLabel"
                    value={lotLabel}
                    onChange={(e) => setLotLabel(e.target.value)}
                    placeholder="LOT 01 - DESAMIANTAGE DEMOLITION"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="operationShort">
                    Nom court de l’opération (optionnel)
                  </Label>
                  <Input
                    id="operationShort"
                    value={operationShort}
                    onChange={(e) => setOperationShort(e.target.value)}
                    placeholder="ABEILLE CAMUS"
                  />
                  <p className="text-muted-foreground text-xs">
                    Utilisé dans le nom du classeur : ABEILLE CAMUS - ECOLE NORD
                    - Lot 01 - …
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="variantes">
                    Variantes (optionnel, séparées par des virgules)
                  </Label>
                  <Input
                    id="variantes"
                    value={variantes}
                    onChange={(e) => setVariantes(e.target.value)}
                    placeholder="ECOLE NORD, ECOLE SUD"
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
        {run && canEdit && (
          <>
            <input
              ref={importRef}
              type="file"
              accept=".zip,.xlsx,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importDeliverable(f)
                e.target.value = ''
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => importRef.current?.click()}
            >
              <Upload className="size-4" /> Importer un livrable
            </Button>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Supprimer le dossier"
                  >
                    <Trash2 className="text-destructive size-4" />
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer ce dossier ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Les fichiers générés et importés pour ce dossier (PDF,
                    classeurs, ZIP, livrables) seront définitivement supprimés.
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
          </>
        )}
      </div>

      {!run && (
        <div className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-12 text-center text-sm">
          Aucun dossier de fiches techniques — créez-en un pour générer la liste
          des marques, télécharger les PDF officiels et produire le classeur
          DCR, ou importez directement les livrables déjà produits depuis
          l’onglet Documents.
        </div>
      )}

      {run && (
        <>
          {/* Pipeline */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 py-3">
              {canEdit && (
                <Button
                  size="sm"
                  onClick={runPipeline}
                  disabled={pipelineStep != null || pending || !!researchProgress}
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
                onClick={extract}
                disabled={!canEdit || pending || pipelineStep != null}
              >
                {pending && run.status === 'draft' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <BookOpenCheck className="size-4" />
                )}
                1. Dépouiller le DCE
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={researchAll}
                disabled={
                  !canEdit ||
                  !chapterCodes.length ||
                  pending ||
                  !!researchProgress ||
                  pipelineStep != null
                }
              >
                {researchProgress ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Globe className="size-4" />
                )}
                2. Recherche web
                {chapterCodes.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {doneChapters.length}/{chapterCodes.length}
                  </Badge>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={downloadAll}
                disabled={
                  !canEdit ||
                  !allDocs.length ||
                  pending ||
                  !!researchProgress ||
                  pipelineStep != null
                }
                title={
                  allDocs.length - withUrl.length > 0
                    ? "Un agent recherche d'abord les URL officielles des documents sans lien, puis télécharge tout"
                    : undefined
                }
              >
                <Download className="size-4" />
                3. Télécharger les PDF
                <Badge variant="secondary" className="text-[10px]">
                  {delivered.length}/{allDocs.length}
                </Badge>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={exportDeliverables}
                disabled={
                  !canEdit ||
                  !Object.keys(run.result).length ||
                  pending ||
                  !!researchProgress ||
                  pipelineStep != null
                }
              >
                <Table2 className="size-4" />
                4. Classeur + arborescence
              </Button>
              {pipelineStep != null ? (
                <ActionProgress
                  title={`Pipeline en cours — ${run.lot_label}`}
                  steps={[
                    'Dépouillage du DCE',
                    'Recherche web par chapitre',
                    'Recherche des PDF manquants + téléchargement',
                    'Classeur + arborescence',
                  ]}
                  activeStep={pipelineStep}
                  stepDetail={
                    pipelineStep === 1
                      ? (researchProgress ?? 'démarrage…')
                      : undefined
                  }
                  className="w-full"
                />
              ) : (
                <>
                  {researchProgress && (
                    <span className="text-muted-foreground text-xs">
                      Agent en cours : {researchProgress} (1 à 3 min par chapitre)
                    </span>
                  )}
                  {pending && !researchProgress && pendingStep && (
                    <ActionProgress
                      title={pendingStep.title}
                      steps={pendingStep.steps}
                      className="w-full"
                    />
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {run.error && (
            <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
              <CircleAlert className="size-4" /> {run.error}
            </div>
          )}

          {/* PDF récupérés — vue consolidée tous chapitres : chaque PDF est
              aussi rangé dans l'onglet Documents du dossier et dans la
              bibliothèque /fiches (réutilisable par les autres AO). */}
          {Object.keys(run.result ?? {}).length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                  <FileText className="size-4" /> PDF récupérés
                  <Badge variant="secondary" className="text-[10px]">
                    {delivered.length}/{allDocs.length}
                  </Badge>
                  <span className="text-muted-foreground text-xs font-normal">
                    · {delivered.filter((d) => isProductDocument(d)).length}/
                    {productDocs.length} fiches fabricants
                    {prescriptiveDocs.length > 0 && (
                      <>
                        {' '}
                        · {delivered.filter((d) => !isProductDocument(d)).length}/
                        {prescriptiveDocs.length} documents normatifs
                      </>
                    )}
                  </span>
                  {allDocs.length - withUrl.length > 0 && (
                    <span className="text-muted-foreground text-xs font-normal">
                      ·{' '}
                      {allDocs.filter((d) => !d.url).length} document
                      {allDocs.filter((d) => !d.url).length > 1 ? 's' : ''} sans
                      URL — recherché
                      {allDocs.filter((d) => !d.url).length > 1 ? 's' : ''} au clic
                      sur « Télécharger les PDF »
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2 text-xs font-normal">
                    <Link
                      href={`/${orgSlug}/fiches`}
                      className="text-primary hover:underline"
                    >
                      Bibliothèque fiches
                    </Link>
                    <Link href="?tab=documents" className="text-primary hover:underline">
                      Onglet Documents
                    </Link>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {delivered.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Aucun PDF récupéré pour l’instant — lancez « 3. Télécharger
                    les PDF » après la recherche web.
                  </p>
                ) : (
                  <>
                    {delivered.length > 12 && (
                      <div className="relative mb-2 w-full sm:w-64">
                        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={pdfFilter}
                          onChange={(e) => {
                            setPdfFilter(e.target.value)
                            deliveredPager.setPage(0)
                          }}
                          placeholder="Filtrer (marque, référence…)…"
                          className="h-8 w-full rounded-lg border border-input bg-transparent pl-8 pr-7 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          aria-label="Filtrer les PDF récupérés"
                        />
                        {pdfFilter && (
                          <button
                            type="button"
                            onClick={() => {
                              setPdfFilter('')
                              deliveredPager.setPage(0)
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            aria-label="Effacer le filtre"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                    {deliveredVisible.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Aucun PDF ne correspond au filtre.
                      </p>
                    ) : (
                      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {deliveredPager.slice.map((d) => (
                          // Plusieurs documents peuvent partager le même PDF
                          // officiel (même document_id) — filename est la clé
                          // unique (dedupeFilenames la garantit).
                          <li key={d.filename}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-auto w-full justify-start gap-2 px-3 py-2 text-left"
                              onClick={() =>
                                d.document_id && openDocument(d.document_id)
                              }
                            >
                              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">
                                  {d.marque} — {d.reference}
                                </span>
                                <span className="block truncate text-[10px] text-muted-foreground">
                                  {d.type_document.replace(/_/g, ' ')} ·{' '}
                                  {d.designation}
                                </span>
                              </span>
                              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {d.code}
                              </span>
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <PaginationBar
                      className="mt-3"
                      page={deliveredPager.page}
                      pageCount={deliveredPager.pageCount}
                      onPage={deliveredPager.setPage}
                      total={deliveredVisible.length}
                      pageSize={deliveredPager.pageSize}
                    />
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Chapitres proposés par le dépouillage */}
          {chapterCodes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chapterCodes.map((code) => {
                const done = !!run.result?.[code]
                return (
                  <Button
                    key={code}
                    size="sm"
                    variant={done ? 'secondary' : 'outline'}
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => researchOne(code)}
                    disabled={!canEdit || pending || !!researchProgress || pipelineStep != null}
                    title={run.chapters[code].libelle}
                  >
                    {done && (
                      <CheckCircle2 className="size-3 text-emerald-500" />
                    )}
                    {code}
                  </Button>
                )
              })}
              <span className="text-muted-foreground text-xs">
                — relancer un chapitre le régénère
              </span>
            </div>
          )}

          {/* Livrables */}
          {run.deliverable_document_ids.length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Package className="size-4" /> Livrables
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                {(run.config.deliverables?.length
                  ? run.config.deliverables
                  : run.deliverable_document_ids.map((id) => ({
                      id,
                      name: 'Livrable',
                    }))
                ).map((d) => (
                  <Button
                    key={d.id}
                    size="sm"
                    variant="outline"
                    className="max-w-80"
                    title={d.name}
                    onClick={() => openDocument(d.id, true)}
                  >
                    <FileText className="size-3.5 shrink-0" />
                    <span className="truncate">{d.name}</span>
                  </Button>
                ))}
                <span className="text-muted-foreground self-center text-xs">
                  aussi visibles dans l’onglet Documents du dossier
                </span>
                {run.config.deliverable_stats && (
                  <p className="text-muted-foreground w-full text-xs">
                    Couverture à l’export :{' '}
                    {run.config.deliverable_stats.produits} produits ·{' '}
                    {run.config.deliverable_stats.documents} documents
                    recherchés ·{' '}
                    {run.config.deliverable_stats.avecUrl} URL officielles ·{' '}
                    {run.config.deliverable_stats.pdfsEmbarques}
                    {run.config.deliverable_stats.pdfsAttendus
                      ? `/${run.config.deliverable_stats.pdfsAttendus}`
                      : ''}{' '}
                    PDF embarqués dans le ZIP
                    {run.config.deliverable_stats.sansUrl > 0 &&
                      ` · ${run.config.deliverable_stats.sansUrl} à obtenir`}
                    {run.config.deliverable_stats.pdfsAttendus != null &&
                      run.config.deliverable_stats.pdfsEmbarques <
                        run.config.deliverable_stats.pdfsAttendus && (
                        <span className="text-amber-600 dark:text-amber-400">
                          {' '}
                          — écart d’intégrité, relancez l’export
                        </span>
                      )}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Résultats par chapitre — onglet contrôlé : un router.refresh()
              (recherche d'un autre chapitre) ne renvoie plus au 1er onglet. */}
          {doneChapters.length > 0 && (
            <Tabs
              value={
                tabPick && doneChapters.includes(tabPick)
                  ? tabPick
                  : doneChapters[0]
              }
              onValueChange={(v) => setTabPick(String(v))}
            >
              <TabsList className="h-auto max-w-full flex-wrap justify-start">
                {doneChapters.map((code) => (
                  <TabsTrigger key={code} value={code}>
                    {run.chapters[code]?.onglet ?? code}
                  </TabsTrigger>
                ))}
              </TabsList>
              {doneChapters.map((code) => (
                <TabsContent key={code} value={code} className="mt-4">
                  <ChapterView
                    result={run.result[code] ?? EMPTY_CHAPTER_RESULT}
                    code={code}
                    orgSlug={orgSlug}
                    tenderId={tenderId}
                    runId={run.id}
                    onOpen={openDocument}
                    canEdit={canEdit}
                    onAttached={() => router.refresh()}
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}

          {/* Synthèse transverse — écarts regroupés par thème */}
          {(allEcarts.length > 0 || allAObtenir.length > 0) && (
            <div className="space-y-4">
              {allEcarts.length > 0 && <EcartsPanel ecarts={allEcarts} />}
              {allAObtenir.length > 0 && <AObtenirPanel items={allAObtenir} />}
            </div>
          )}

          {allProduits.length === 0 && run.status === 'brief_ready' && (
            <p className="text-muted-foreground text-sm">
              Dépouillage terminé — lancez la recherche web par chapitre
              (boutons ci-dessus) ou en une fois via « 2. Recherche web ».
            </p>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Dernier recours, garanti : rattache une fiche à cette ligne précise —
 * import d'un PDF téléchargé à la main, ou collage de l'URL de la fiche.
 * Sans ça, une fiche que les agents n'ont pas trouvée restait absente du
 * classeur et de l'arborescence de livraison.
 */
function AttachDocButton({
  orgSlug,
  tenderId,
  runId,
  code,
  docIndex,
  label,
  onAttached,
}: {
  orgSlug: string
  tenderId: string
  runId: string
  code: string
  docIndex: number
  label: string
  onAttached: () => void
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  function submit(withFile: boolean) {
    const fd = new FormData()
    fd.set('code', code)
    fd.set('docIndex', String(docIndex))
    fd.set('url', withFile ? '' : url.trim())
    const file = fileRef.current?.files?.[0]
    if (withFile && file) fd.set('file', file)
    startTransition(async () => {
      const res = await attachDatasheetDocument(orgSlug, tenderId, runId, fd)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`Fiche rattachée : ${res.data?.filename}`)
      setOpen(false)
      setUrl('')
      if (fileRef.current) fileRef.current.value = ''
      onAttached()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px]"
            title="Rattacher la fiche manuellement (fichier ou URL)"
          >
            <Upload className="size-3" /> Rattacher la fiche
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Rattacher une fiche technique</DialogTitle>
          <DialogDescription>
            {label} — importez le PDF téléchargé depuis le site du fabricant, ou
            collez l’URL de la fiche. Le document est vérifié (PDF), rangé dans
            le dossier, ajouté à la bibliothèque et inclus au classeur et au ZIP.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`file-${code}-${docIndex}`}>Fichier PDF</Label>
            <Input
              id={`file-${code}-${docIndex}`}
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
            />
            <Button
              size="sm"
              onClick={() => submit(true)}
              disabled={pending}
              className="w-full"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Importer le fichier
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`url-${code}-${docIndex}`}>
              … ou URL de la fiche
            </Label>
            <Input
              id={`url-${code}-${docIndex}`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.fabricant.fr/…/fiche-technique.pdf"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => submit(false)}
              disabled={pending || !url.trim()}
              className="w-full"
            >
              <Download className="size-4" />
              Télécharger depuis l’URL
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChapterView({
  result,
  code,
  orgSlug,
  tenderId,
  runId,
  onOpen,
  canEdit,
  onAttached,
}: {
  result: ChapterResult
  code: string
  orgSlug: string
  tenderId: string
  runId: string
  onOpen: (id: string) => void
  canEdit: boolean
  onAttached: () => void
}) {
  const produitsPager = usePager(result.produits, 15)
  const docsPager = usePager(result.documents, 15)
  const confPager = usePager(result.conformite, 15)
  return (
    <div className="space-y-4">
      {/* Produits */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">
            Liste des marques
            <Badge variant="secondary" className="ml-2 text-[10px]">
              {result.produits.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Désignation</TableHead>
                <TableHead>Marque</TableHead>
                <TableHead>Référence</TableHead>
                <TableHead className="w-28">Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {produitsPager.slice.map((p, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell className="text-sm">{p.designation}</TableCell>
                  <TableCell className="text-sm font-medium">
                    {p.marque}
                  </TableCell>
                  <TableCell className="text-sm">{p.reference}</TableCell>
                  <TableCell>{statutBadge(p.statut)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationBar
            className="border-t border-border px-3 py-2"
            page={produitsPager.page}
            pageCount={produitsPager.pageCount}
            onPage={produitsPager.setPage}
            total={result.produits.length}
            pageSize={produitsPager.pageSize}
          />
        </CardContent>
      </Card>

      {/* Index documents */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">
            Documents officiels
            <Badge variant="secondary" className="ml-2 text-[10px]">
              {result.documents.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Code</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Dossier</TableHead>
                <TableHead className="w-40">Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docsPager.slice.map((d, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{d.code}</TableCell>
                  <TableCell className="text-sm">
                    <span className="font-medium">{d.marque}</span>{' '}
                    {d.reference}
                    <span className="text-muted-foreground block text-xs">
                      {d.designation} · {d.source}
                    </span>
                    {d.url && (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary mt-0.5 inline-flex items-center gap-1 text-[10px] hover:underline"
                        title={d.url}
                      >
                        <ExternalLink className="size-3" />
                        Source officielle
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {d.type_document.replace(/_/g, ' ')}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {folderForDocType(d.type_document)}
                  </TableCell>
                  <TableCell>
                    {d.downloaded && d.document_id ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-1 text-xs"
                        onClick={() => onOpen(d.document_id!)}
                      >
                        <CheckCircle2 className="size-3.5 text-emerald-500" />{' '}
                        PDF livré
                      </Button>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        {d.download_error ? (
                          <span
                            className="text-destructive text-xs"
                            title={d.download_error}
                          >
                            Échec : {d.download_error.slice(0, 32)}
                          </span>
                        ) : (
                          statutBadge(d.statut)
                        )}
                        {canEdit && (
                          <AttachDocButton
                            orgSlug={orgSlug}
                            tenderId={tenderId}
                            runId={runId}
                            code={code}
                            docIndex={
                              docsPager.page * docsPager.pageSize + i
                            }
                            label={`${d.marque} ${d.reference}`}
                            onAttached={onAttached}
                          />
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationBar
            className="border-t border-border px-3 py-2"
            page={docsPager.page}
            pageCount={docsPager.pageCount}
            onPage={docsPager.setPage}
            total={result.documents.length}
            pageSize={docsPager.pageSize}
          />
        </CardContent>
      </Card>

      {/* Conformité */}
      {result.conformite.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              Contrôle de conformité
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {result.conformite.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Exigence CCTP</TableHead>
                  <TableHead>Donnée fabricant</TableHead>
                  <TableHead className="w-28">Conforme</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {confPager.slice.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">
                      {c.code}
                    </TableCell>
                    <TableCell className="text-sm">{c.exigence}</TableCell>
                    <TableCell className="text-sm">
                      {c.donnee_fabricant}
                      {c.commentaire && (
                        <span className="text-muted-foreground block text-xs">
                          {c.commentaire}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={cn(
                          'text-[10px]',
                          c.conforme === 'Oui' && STATUT_STYLE.OK,
                          c.conforme === 'Non' && STATUT_STYLE['NON CONFORME'],
                          c.conforme === 'À vérifier' &&
                            STATUT_STYLE['À VALIDER'],
                        )}
                      >
                        {c.conforme}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationBar
              className="border-t border-border px-3 py-2"
              page={confPager.page}
              pageCount={confPager.pageCount}
              onPage={confPager.setPage}
              total={result.conformite.length}
              pageSize={confPager.pageSize}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
