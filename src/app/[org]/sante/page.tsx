import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookMarked,
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  FileSignature,
  FileWarning,
  FolderInput,
  History,
  Loader,
  PenLine,
  ScanSearch,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireMembership } from '@/lib/dal/auth'
import { listOpenTenderAlerts, listExpiringDocuments, listTenders } from '@/lib/dal/tenders'
import { listFolders } from '@/lib/dal/documents'
import { listAuditLogs } from '@/lib/dal/audit'
import { buildFolderTree, SOCIETE_FOLDER } from '@/lib/folder-tree'
import { tenderFolderName } from '@/lib/doc-folders'
import { tenderPath } from '@/lib/slug'
import { formatDate, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AutoRefresh, RefreshButton } from '@/components/sante/auto-refresh'

/**
 * Page Santé — vue globale des workflows de réponse aux AO :
 * analyse DCE, fiches techniques, mémoire technique et formulaires DC1/DC2.
 * Lecture seule : chaque ligne renvoie vers le dossier concerné. La page se
 * rafraîchit automatiquement tant qu'un workflow est en activité.
 */

// Étapes métier des deux pipelines — même ordre que les panneaux de lancement.
const DS_STEPS = ['Dépouillage', 'Recherche web', 'PDF téléchargés', 'Livrables'] as const
const DS_STATUS_STEP: Record<string, number> = {
  draft: 0,
  brief_ready: 1,
  researched: 2,
  downloaded: 3,
  error: -1,
}
const MEMO_STEPS = ['Analyse DCE', 'Contenu généré', 'Mémoire étape 1', 'Mémoire complet'] as const
const MEMO_STATUS_STEP: Record<string, number> = {
  draft: 0,
  analyzed: 1,
  generated: 2,
  built: 3,
  built_full: 4,
  error: -1,
}
const DCE_STATUS_LABEL: Record<string, string> = {
  pending: 'En file',
  running: 'En cours',
  done: 'Terminée',
  error: 'Échec',
}
const SEVERITY_STYLE: Record<string, string> = {
  bloquante: 'bg-red-500/15 text-red-600 dark:text-red-400',
  critique: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  importante: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  info: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
}

/** Actions d'audit des workflows — affichées dans le journal avec leur
 *  libellé métier plutôt que la clé technique. */
const WORKFLOW_ACTIONS: Record<string, string> = {
  'datasheet_run.created': 'Dossier fiches créé',
  'datasheet_run.doc_search': 'Recherche des URL de fiches',
  'datasheet_run.downloaded': 'PDF de fiches téléchargés',
  'datasheet_run.exported': 'Livrables fiches exportés',
  'datasheet_run.deliverable_imported': 'Livrable fiches importé',
  'datasheet_run.document_attached': 'Fiche rattachée manuellement',
  'datasheet_run.deleted': 'Dossier fiches supprimé',
  'memoire_run.created': 'Run mémoire créé',
  'memoire_run.generated': 'Contenu mémoire généré',
  'memoire_run.built': 'Mémoire .docx construit (étape 1)',
  'memoire_run.built_full': 'Mémoire complet construit',
  'memoire_run.docx_imported': 'Mémoire .docx importé',
  'memoire_run.deleted': 'Run mémoire supprimé',
  'tender.dce_imported': 'DCE importé et classé',
  'tender.dce_analyzed': 'DCE analysé',
  'tender.dce_applied': 'Analyse appliquée au dossier',
  'dc.generated': 'Formulaire DC généré',
  'dc.unfilled_placeholders': 'Champs DC laissés vides',
  'tender.submitted': 'Offre déposée',
  'tender.result_recorded': 'Résultat enregistré',
}

/** Non terminale et pas d'activité récente → probablement interrompu. */
const STALE_MS = 6 * 3600 * 1000

type TenderRef = { id: string; title: string } | { id: string; title: string }[] | null

const oneTender = (t: TenderRef) => (Array.isArray(t) ? (t[0] ?? null) : t)

const fmtTokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)} M`
    : n >= 1_000
      ? `${Math.round(n / 1000)} k`
      : `${n}`

const fmtDuration = (from: string, to: string) => {
  const ms = Date.parse(to) - Date.parse(from)
  if (!Number.isFinite(ms) || ms < 0) return null
  const min = Math.round(ms / 60000)
  return min < 1 ? '<1 min' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60}`
}

function StepBar({ step, steps }: { step: number; steps: readonly string[] }) {
  if (step < 0) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive">
        <CircleAlert className="size-3.5" /> Erreur
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1" title={steps.join(' → ')}>
      {steps.map((s, i) => (
        <span
          key={s}
          title={s}
          className={cn(
            'h-1.5 w-6 rounded-full',
            i < step ? 'bg-emerald-500' : 'bg-muted',
          )}
        />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">
        {step}/{steps.length}
      </span>
    </span>
  )
}

function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'err' | 'idle' }) {
  return (
    <span
      className={cn(
        'inline-block size-2 rounded-full',
        tone === 'ok' && 'bg-emerald-500',
        tone === 'warn' && 'bg-amber-500',
        tone === 'err' && 'bg-destructive',
        tone === 'idle' && 'bg-muted-foreground/40',
      )}
    />
  )
}

export default async function SantePage({
  params,
}: PageProps<'/[org]/sante'>) {
  const { org: orgSlug } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()
  const { supabase, org } = ctx
  const now = new Date().getTime()

  const [dsRuns, memoRuns, analyses, dcDocs, openTenders, allTenders, alerts, expiring, folderRows, auditLogs] =
    await Promise.all([
      // Colonnes légères : result/chapters (JSONB volumineux) exclus — la
      // progression vient du statut et des stats d'export.
      supabase
        .from('tender_datasheet_runs')
        .select(
          'id, tender_id, lot_label, status, error, created_at, updated_at, model, input_tokens, output_tokens, deliverable_document_ids, config, tender:tenders(id,title)',
        )
        .eq('organization_id', org.id)
        .order('updated_at', { ascending: false })
        .limit(40),
      supabase
        .from('tender_memoire_runs')
        .select(
          'id, tender_id, lot_label, status, error, created_at, updated_at, model, input_tokens, output_tokens, content_document_id, docx_document_id, docx_full_document_id, tender:tenders(id,title)',
        )
        .eq('organization_id', org.id)
        .order('updated_at', { ascending: false })
        .limit(40),
      supabase
        .from('tender_dce_analyses')
        .select(
          'id, tender_id, status, error, applied_at, created_at, model, tender:tenders(id,title)',
        )
        .eq('organization_id', org.id)
        .order('created_at', { ascending: false })
        .limit(60),
      supabase
        .from('documents')
        .select('created_at', { count: 'exact' })
        .eq('organization_id', org.id)
        .in('document_type', ['dc1', 'dc2'])
        .like('storage_path', '%/dc/%')
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('tenders')
        .select('id, title, status')
        .eq('organization_id', org.id)
        .not('status', 'in', '("depose","gagne","perdu","abandonne","annule")'),
      // Tous les AO (clos compris) : leurs dossiers racine restent valides
      // dans l'arborescence documentaire.
      listTenders(ctx, { pageSize: 500 }),
      listOpenTenderAlerts(ctx, 10),
      listExpiringDocuments(ctx, 15, 50),
      listFolders(ctx),
      // Journal des workflows — la DAL limite la lecture à owner/admin.
      listAuditLogs(ctx, 60),
    ])

  type DsRow = {
    id: string
    tender_id: string
    lot_label: string
    status: string
    error: string | null
    created_at: string
    updated_at: string
    model: string | null
    input_tokens: number | null
    output_tokens: number | null
    deliverable_document_ids: string[] | null
    config: { deliverable_stats?: { pdfsEmbarques?: number; pdfsAttendus?: number } } | null
    tender: TenderRef
  }
  type MemoRow = {
    id: string
    tender_id: string
    lot_label: string
    status: string
    error: string | null
    created_at: string
    updated_at: string
    model: string | null
    input_tokens: number | null
    output_tokens: number | null
    content_document_id: string | null
    docx_document_id: string | null
    docx_full_document_id: string | null
    tender: TenderRef
  }
  type AnaRow = {
    id: string
    tender_id: string
    status: string
    error: string | null
    applied_at: string | null
    created_at: string
    tender: TenderRef
  }

  const ds = (dsRuns.data ?? []) as DsRow[]
  const memo = (memoRuns.data ?? []) as MemoRow[]
  const ana = (analyses.data ?? []) as AnaRow[]
  const tenders = (openTenders.data ?? []) as { id: string; title: string }[]

  const isStale = (status: string, terminal: boolean, updatedAt: string) =>
    status !== 'error' && !terminal && now - Date.parse(updatedAt) > STALE_MS
  const dsTerminal = (r: DsRow) => !!r.deliverable_document_ids?.length
  const memoTerminal = (r: MemoRow) => r.status === 'built_full'

  // Problèmes remontés en tête : erreurs, puis interrompus, puis le reste.
  const rank = (status: string, terminal: boolean, updatedAt: string) =>
    status === 'error' ? 0 : isStale(status, terminal, updatedAt) ? 1 : 2
  ds.sort(
    (a, b) =>
      rank(a.status, dsTerminal(a), a.updated_at) - rank(b.status, dsTerminal(b), b.updated_at),
  )
  memo.sort(
    (a, b) =>
      rank(a.status, memoTerminal(a), a.updated_at) - rank(b.status, memoTerminal(b), b.updated_at),
  )

  // Un AO peut avoir plusieurs runs (un par lot) — dernier état par AO pour
  // la carte « Analyse DCE ».
  const latestByTender = new Map<string, AnaRow>()
  for (const a of ana) if (!latestByTender.has(a.tender_id)) latestByTender.set(a.tender_id, a)

  const dsStale = ds.filter((r) => isStale(r.status, dsTerminal(r), r.updated_at))
  const memoStale = memo.filter((r) => isStale(r.status, memoTerminal(r), r.updated_at))

  // Échecs comptés sur le dernier état connu : une vieille analyse en erreur
  // suivie d'un succès ne doit plus peser dans le compteur.
  const errorCount =
    ds.filter((r) => r.status === 'error').length +
    memo.filter((r) => r.status === 'error').length +
    [...latestByTender.values()].filter((a) => a.status === 'error').length

  const tokens = [...ds, ...memo].reduce(
    (s, r) => s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
    0,
  )
  const dsDelivered = ds.filter((r) => r.deliverable_document_ids?.length).length
  const memoDone = memo.filter((r) => r.status === 'built_full').length
  const dcCount = dcDocs.count ?? 0
  const lastDc = dcDocs.data?.[0]?.created_at ?? null

  // Santé documentaire : dossiers racine hors convention (ni « Société » ni
  // le dossier d'un AO) + fichiers posés directement à la racine.
  const tenderRoots = new Set(allTenders.rows.map((t) => tenderFolderName(t)))
  const tree = buildFolderTree(folderRows)
  const unfiledRoots = tree.filter(
    (n) => n.name !== SOCIETE_FOLDER && !tenderRoots.has(n.name),
  )
  const rootFiles = folderRows.find((r) => r.path === '/')?.count ?? 0

  // Journal des workflows : actions d'audit de production uniquement.
  const tenderTitles = new Map<string, string>(
    [
      ...tenders.map((t) => [t.id, t.title] as const),
      ...allTenders.rows.map((t) => [t.id, t.title] as const),
    ],
  )
  const journal = auditLogs.filter((l) => l.action in WORKFLOW_ACTIONS).slice(0, 20)

  // Un workflow est « en activité » s'il a bougé récemment sans être terminé
  // — tant que c'est vrai la page se rafraîchit toute seule.
  const hasActive =
    ds.some((r) => !dsTerminal(r) && r.status !== 'error' && now - Date.parse(r.updated_at) <= STALE_MS) ||
    memo.some((r) => !memoTerminal(r) && r.status !== 'error' && now - Date.parse(r.updated_at) <= STALE_MS) ||
    ana.some((a) => a.status === 'running' || a.status === 'pending')

  const kpis = [
    {
      label: 'Workflows en échec',
      value: errorCount,
      icon: CircleAlert,
      tone: errorCount > 0 ? ('danger' as const) : undefined,
      hint: 'fiches, mémoire et analyses DCE',
    },
    {
      label: 'Runs interrompus',
      value: dsStale.length + memoStale.length,
      icon: Loader,
      tone: dsStale.length + memoStale.length > 0 ? ('warn' as const) : undefined,
      hint: 'sans activité depuis 6 h',
    },
    {
      label: 'Alertes conformité',
      value: alerts.length,
      icon: ShieldAlert,
      tone: alerts.length > 0 ? ('warn' as const) : undefined,
      hint: 'ouverte(s) sur les AO',
    },
    {
      label: 'Livrables produits',
      value: dsDelivered + memoDone + dcCount,
      icon: FileCheck2,
      hint: `${dsDelivered} fiches · ${memoDone} mémoires · ${dcCount} DC`,
    },
    {
      label: 'Dossiers non rattachés',
      value: unfiledRoots.length + (rootFiles > 0 ? 1 : 0),
      icon: FolderInput,
      tone: unfiledRoots.length + (rootFiles > 0 ? 1 : 0) > 0 ? ('warn' as const) : undefined,
      hint: `hors « Société »/AO${rootFiles ? ` · ${rootFiles} fichier(s) à la racine` : ''}`,
    },
    {
      label: 'Jetons IA consommés',
      value: fmtTokens(tokens),
      icon: Sparkles,
      hint: 'fiches + mémoire, tous runs',
    },
  ]

  const runMeta = (r: { model: string | null; input_tokens: number | null; output_tokens: number | null; created_at: string; updated_at: string }) => {
    const t = (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
    const dur = fmtDuration(r.created_at, r.updated_at)
    return [
      dur && `${dur}`,
      t ? `${fmtTokens(t)} jetons` : null,
      r.model,
    ].filter(Boolean).join(' · ')
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <AutoRefresh active={hasActive} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Activity className="size-6" /> Santé
          </h1>
          <p className="text-sm text-muted-foreground">
            {org.name} — état des workflows de réponse aux appels d’offres :
            analyse DCE, fiches techniques, mémoire technique, formulaires DC.
          </p>
        </div>
        <RefreshButton />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpis.map(({ label, value, icon: Icon, tone, hint }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
              <Icon
                className={cn(
                  'size-4',
                  tone === 'danger'
                    ? 'text-destructive'
                    : tone === 'warn'
                      ? 'text-amber-500'
                      : 'text-muted-foreground',
                )}
              />
            </CardHeader>
            <CardContent>
              <p
                className={cn(
                  'text-2xl font-semibold tabular-nums',
                  tone === 'danger' && 'text-destructive',
                  tone === 'warn' && 'text-amber-600 dark:text-amber-400',
                )}
              >
                {value}
              </p>
              {hint && <p className="mt-1 truncate text-xs text-muted-foreground" title={hint}>{hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Vue par AO : un point de la pipeline de réponse pour chaque dossier
          ouvert — c'est ici que se lit « où en est chaque AO ». */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="size-4" /> Chaîne de production par AO ouvert
          </CardTitle>
          <Link
            href={`/${orgSlug}/tenders`}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Tout voir <ArrowRight className="size-3" />
          </Link>
        </CardHeader>
        <CardContent>
          {tenders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun appel d’offres ouvert.</p>
          ) : (
            <ul className="divide-y divide-border">
              {tenders.map((t) => {
                const a = latestByTender.get(t.id)
                const tDs = ds.filter((r) => r.tender_id === t.id)
                const tMemo = memo.filter((r) => r.tender_id === t.id)
                const tAlerts = alerts.filter((x) => x.tender_id === t.id)
                const dot = (v: 'ok' | 'warn' | 'err' | 'idle') => (
                  <StatusDot tone={v} />
                )
                return (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5 text-sm"
                  >
                    <Link
                      href={tenderPath(orgSlug, t)}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {t.title}
                    </Link>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {dot(
                        !a ? 'idle' : a.status === 'error' ? 'err' : a.status === 'done' ? 'ok' : 'warn',
                      )}
                      DCE
                      {a?.applied_at ? ' appliquée' : a ? ` ${DCE_STATUS_LABEL[a.status] ?? a.status}` : ' —'}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {dot(
                        tDs.some((r) => r.status === 'error')
                          ? 'err'
                          : !tDs.length
                            ? 'idle'
                            : tDs.every((r) => r.deliverable_document_ids?.length)
                              ? 'ok'
                              : 'warn',
                      )}
                      Fiches {tDs.length ? `${tDs.filter((r) => r.deliverable_document_ids?.length).length}/${tDs.length}` : '—'}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {dot(
                        tMemo.some((r) => r.status === 'error')
                          ? 'err'
                          : !tMemo.length
                            ? 'idle'
                            : tMemo.every((r) => r.status === 'built_full')
                              ? 'ok'
                              : 'warn',
                      )}
                      Mémoire {tMemo.length ? `${tMemo.filter((r) => r.status === 'built_full').length}/${tMemo.length}` : '—'}
                    </span>
                    {tAlerts.length > 0 && (
                      <span className="flex items-center gap-1.5 text-xs text-destructive">
                        <ShieldAlert className="size-3.5" />
                        {tAlerts.length} alerte{tAlerts.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Runs fiches techniques */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookMarked className="size-4" /> Fiches techniques — runs récents
            </CardTitle>
            <Link
              href={`/${orgSlug}/fiches`}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Bibliothèque <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {ds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun run — ouvrez un AO, onglet Fiches, pour démarrer.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {ds.map((r) => {
                  const tender = oneTender(r.tender)
                  const step = r.deliverable_document_ids?.length
                    ? DS_STEPS.length
                    : (DS_STATUS_STEP[r.status] ?? 0)
                  const stale = isStale(r.status, dsTerminal(r), r.updated_at)
                  return (
                    <li key={r.id} className="space-y-1 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {tender ? (
                          <Link
                            href={`${tenderPath(orgSlug, tender)}?tab=fiches`}
                            className="min-w-0 flex-1 truncate font-medium hover:underline"
                          >
                            {tender.title}
                          </Link>
                        ) : (
                          <span className="min-w-0 flex-1 truncate font-medium">
                            AO supprimé
                          </span>
                        )}
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {r.lot_label}
                        </Badge>
                        <span className="shrink-0 text-xs text-muted-foreground" title={formatDate(r.updated_at)}>
                          {formatRelative(r.updated_at)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <StepBar step={step} steps={DS_STEPS} />
                        {stale && (
                          <Badge
                            variant="secondary"
                            className="bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400"
                          >
                            <AlertTriangle className="size-3" /> interrompu
                          </Badge>
                        )}
                        {r.config?.deliverable_stats?.pdfsAttendus != null && (
                          <span className="text-xs text-muted-foreground">
                            {r.config.deliverable_stats.pdfsEmbarques}/
                            {r.config.deliverable_stats.pdfsAttendus} PDF
                          </span>
                        )}
                        {runMeta(r) && (
                          <span className="text-xs text-muted-foreground">{runMeta(r)}</span>
                        )}
                      </div>
                      {r.error && (
                        <p className="flex items-start gap-1.5 text-xs text-destructive">
                          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                          {r.error}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Runs mémoire technique */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <PenLine className="size-4" /> Mémoire technique — runs récents
            </CardTitle>
          </CardHeader>
          <CardContent>
            {memo.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun run — ouvrez un AO, onglet Mémoire, pour démarrer.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {memo.map((r) => {
                  const tender = oneTender(r.tender)
                  const step = MEMO_STATUS_STEP[r.status] ?? 0
                  const stale = isStale(r.status, memoTerminal(r), r.updated_at)
                  return (
                    <li key={r.id} className="space-y-1 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {tender ? (
                          <Link
                            href={`${tenderPath(orgSlug, tender)}?tab=memoire`}
                            className="min-w-0 flex-1 truncate font-medium hover:underline"
                          >
                            {tender.title}
                          </Link>
                        ) : (
                          <span className="min-w-0 flex-1 truncate font-medium">
                            AO supprimé
                          </span>
                        )}
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {r.lot_label}
                        </Badge>
                        <span className="shrink-0 text-xs text-muted-foreground" title={formatDate(r.updated_at)}>
                          {formatRelative(r.updated_at)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <StepBar step={step} steps={MEMO_STEPS} />
                        {stale && (
                          <Badge
                            variant="secondary"
                            className="bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400"
                          >
                            <AlertTriangle className="size-3" /> interrompu
                          </Badge>
                        )}
                        {runMeta(r) && (
                          <span className="text-xs text-muted-foreground">{runMeta(r)}</span>
                        )}
                      </div>
                      {r.error && (
                        <p className="flex items-start gap-1.5 text-xs text-destructive">
                          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                          {r.error}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Analyses DCE + formulaires DC */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScanSearch className="size-4" /> Analyse DCE par dossier
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latestByTender.size === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune analyse — déposez un DCE dans un dossier puis lancez
                « Analyser le DCE ».
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {[...latestByTender.values()].map((a) => {
                  const tender = oneTender(a.tender)
                  return (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                      {tender ? (
                        <Link
                          href={`${tenderPath(orgSlug, tender)}?tab=dce`}
                          className="min-w-0 flex-1 truncate font-medium hover:underline"
                        >
                          {tender.title}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 truncate font-medium">
                          AO supprimé
                        </span>
                      )}
                      <Badge
                        variant="secondary"
                        className={cn(
                          'shrink-0 text-[10px]',
                          a.status === 'error' &&
                            'bg-destructive/15 text-destructive',
                          a.status === 'done' &&
                            'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                        )}
                      >
                        {DCE_STATUS_LABEL[a.status] ?? a.status}
                        {a.applied_at ? ' · appliquée' : ''}
                      </Badge>
                      <span className="shrink-0 text-xs text-muted-foreground" title={formatDate(a.created_at)}>
                        {formatRelative(a.created_at)}
                      </span>
                      {a.error && (
                        <p className="flex w-full items-start gap-1.5 text-xs text-destructive">
                          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                          {a.error}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCheck2 className="size-4" /> Formulaires DC1/DC2
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {dcCount === 0 ? (
              <p className="text-muted-foreground">
                Aucun formulaire généré — la génération se fait dans l’onglet DC
                d’un dossier (gabarits DCR + profil Société).
              </p>
            ) : (
              <>
                <p>
                  <span className="text-2xl font-semibold tabular-nums">{dcCount}</span>{' '}
                  <span className="text-muted-foreground">
                    document(s) généré(s) par le pipeline DC
                  </span>
                </p>
                {lastDc && (
                  <p className="text-xs text-muted-foreground">
                    Dernière génération : {formatRelative(lastDc)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Les DC signés téléversés à la main ne sont pas comptés ici.
                  Une régénération remplace les formulaires précédents du même
                  utilisateur.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Alertes conformité + journal des workflows */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4" /> Alertes conformité ouvertes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-emerald-500" />
                Aucune alerte ouverte sur les dossiers.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {alerts.map((al) => (
                  <li key={al.id} className="flex items-start gap-2 py-2 text-sm">
                    <Badge
                      variant="secondary"
                      className={cn('mt-0.5 shrink-0 text-[10px]', SEVERITY_STYLE[al.severity])}
                    >
                      {al.severity}
                    </Badge>
                    <span className="min-w-0 flex-1">
                      {al.message}
                      {al.tender && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {al.tender.title}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {(unfiledRoots.length > 0 || expiring.length > 0 || rootFiles > 0) && (
              <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                {unfiledRoots.length > 0 && (
                  <p className="flex items-center gap-1.5">
                    <FileWarning className="size-3.5 text-amber-500" />
                    Dossier(s) racine hors convention : {unfiledRoots.map((n) => n.name).join(', ')} —{' '}
                    <Link href={`/${orgSlug}/documents`} className="text-primary underline">
                      onglet Documents
                    </Link>
                  </p>
                )}
                {rootFiles > 0 && (
                  <p className="flex items-center gap-1.5">
                    <FileWarning className="size-3.5 text-amber-500" />
                    {rootFiles} fichier(s) posé(s) à la racine — convention : « Société »
                    ou le dossier d’un AO.
                  </p>
                )}
                {expiring.length > 0 && (
                  <p className="flex items-center gap-1.5">
                    <FileWarning className="size-3.5 text-amber-500" />
                    {expiring.length} pièce(s) expirent sous 15 j —{' '}
                    <Link href={`/${orgSlug}/documents`} className="text-primary underline">
                      à renouveler
                    </Link>
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {journal.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="size-4" /> Journal des workflows
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {journal.map((l) => {
                  const tenderId =
                    l.entity_type === 'tender'
                      ? l.entity_id
                      : (l.metadata?.tenderId as string | undefined) ??
                        (l.metadata?.tender_id as string | undefined)
                  const title = tenderId ? tenderTitles.get(tenderId) : undefined
                  const detail =
                    (l.metadata?.filename as string | undefined) ??
                    (l.metadata?.name as string | undefined)
                  return (
                    <li key={l.id} className="flex items-baseline gap-2 py-1.5 text-sm">
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelative(l.created_at)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {WORKFLOW_ACTIONS[l.action] ?? l.action}
                        {detail && (
                          <span className="text-muted-foreground"> — {detail}</span>
                        )}
                        {title && (
                          <span className="text-muted-foreground"> · {title}</span>
                        )}
                      </span>
                      {l.actor?.full_name && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {l.actor.full_name}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
