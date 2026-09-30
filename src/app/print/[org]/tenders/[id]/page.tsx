import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requireMembership } from '@/lib/dal/auth'
import {
  getTender,
  getTenderResult,
  listChecklistItems,
  listDceAnalyses,
  listSubmissions,
  listTenderAlerts,
  listTenderLots,
} from '@/lib/dal/tenders'
import { listDatasheetRuns } from '@/lib/dal/datasheets'
import { listMemoireRuns } from '@/lib/dal/memoire'
import { getEntityDocuments } from '@/lib/dal/documents'
import { normalizeAnalysis } from '@/lib/dce/normalize'
import { formatDate } from '@/lib/format'
import { AutoPrint } from './auto-print'
import type { DceAnalysis } from '@/lib/dce/types'
import { CHECKLIST_STATUS_LABELS, CHECKLIST_CATEGORY_LABELS, TENDER_STATUS_LABELS } from '@/components/tenders/constants'

const SEV_LABELS: Record<string, string> = {
  bloquante: 'Bloquante',
  critique: 'Critique',
  importante: 'Importante',
  info: 'Info',
}
const REQ_LABELS: Record<string, string> = {
  obligatoire: 'Obligatoire',
  recommande: 'Recommandé',
  facultatif: 'Facultatif',
}
const DOC_CATEGORY_LABELS: Record<string, string> = {
  technique: 'Technique',
  administratif: 'Administratif',
  financier: 'Financier',
  dce: 'DCE',
  autre: 'Autre',
}

let logoCache: string | null | undefined
function logoBase64(): string | null {
  if (logoCache !== undefined) return logoCache
  try {
    logoCache = readFileSync(
      join(process.cwd(), 'src', 'lib', 'datasheets', 'logo-dcr.png'),
    ).toString('base64')
  } catch {
    logoCache = null
  }
  return logoCache
}

export async function generateMetadata({
  params,
}: PageProps<'/print/[org]/tenders/[id]'>): Promise<Metadata> {
  const { org: orgSlug, id } = await params
  const ctx = await requireMembership(orgSlug)
  const tender = ctx ? await getTender(ctx, id) : null
  // Le titre du document devient le nom de fichier proposé par « Enregistrer
  // en PDF ».
  return { title: tender ? `Dossier AO — ${tender.title}` : 'Dossier AO' }
}

/** Barre de progression — imprimée en couleur grâce à print-color-adjust. */
function Bar({ done, total, tone = 'bg-slate-800' }: { done: number; total: number; tone?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Titre de section numéroté — la numérotation se fait dans l'ordre de rendu. */
function H2({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2.5 break-after-avoid">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-900 text-[11px] font-bold text-white">
        {String(index).padStart(2, '0')}
      </span>
      <span className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-800">
        {children}
      </span>
      <span className="h-px flex-1 bg-slate-300" />
    </h2>
  )
}

// Pas de break-inside-avoid ici : une checklist/pièces exigées qui dépasserait
// une page serait tronquée à l'impression. On évite juste les coupures au
// milieu d'une ligne (break-inside-avoid sur les <li>) et les titres orphelins
// (break-after-avoid sur H2).
function Section({ children }: { children: React.ReactNode }) {
  return <section className="mt-7">{children}</section>
}

/** Carte KPI du bandeau de synthèse. */
function Kpi({
  label,
  value,
  sub,
  tone = 'default',
  progress,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'default' | 'danger' | 'warn' | 'ok'
  progress?: { done: number; total: number }
}) {
  const ring =
    tone === 'danger'
      ? 'border-red-300 bg-red-50'
      : tone === 'warn'
        ? 'border-amber-300 bg-amber-50'
        : tone === 'ok'
          ? 'border-emerald-300 bg-emerald-50'
          : 'border-slate-200 bg-white'
  const text =
    tone === 'danger'
      ? 'text-red-800'
      : tone === 'warn'
        ? 'text-amber-800'
        : tone === 'ok'
          ? 'text-emerald-800'
          : 'text-slate-900'
  return (
    <div className={`rounded-xl border px-4 py-3 ${ring}`}>
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-[15px] font-bold leading-tight ${text}`}>{value}</p>
      {progress ? (
        <div className="mt-2">
          <Bar
            done={progress.done}
            total={progress.total}
            tone={tone === 'danger' ? 'bg-red-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-emerald-500'}
          />
        </div>
      ) : null}
      {sub ? <p className="mt-1 text-[10px] leading-snug text-slate-500">{sub}</p> : null}
    </div>
  )
}

/** Carte à bord supérieur coloré — blocs « L'essentiel ». */
function Card({
  title,
  tone = 'slate',
  children,
}: {
  title: string
  tone?: 'slate' | 'red' | 'emerald'
  children: React.ReactNode
}) {
  const top =
    tone === 'red' ? 'border-t-red-500' : tone === 'emerald' ? 'border-t-emerald-500' : 'border-t-slate-700'
  return (
    <div className={`rounded-lg border border-slate-200 border-t-[3px] bg-white p-4 ${top}`}>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {title}
      </p>
      {children}
    </div>
  )
}

const PILL: Record<string, string> = {
  valide: 'bg-emerald-100 text-emerald-800',
  bloque: 'bg-red-100 text-red-800',
  a_verifier: 'bg-amber-100 text-amber-800',
  en_cours: 'bg-blue-100 text-blue-800',
  non_requis: 'bg-slate-100 text-slate-500',
  non_commence: 'bg-slate-100 text-slate-500',
}

export default async function ARetenirPrintPage({
  params,
  searchParams,
}: PageProps<'/print/[org]/tenders/[id]'>) {
  const { org: orgSlug, id } = await params
  const sp = await searchParams
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()

  const tender = await getTender(ctx, id)
  if (!tender) notFound()

  const [analyses, lots, checklist, alerts, submissions, result, documents, datasheetRuns, memoireRuns] =
    await Promise.all([
      listDceAnalyses(ctx, tender.id, 5),
      listTenderLots(ctx, tender.id),
      listChecklistItems(ctx, tender.id),
      listTenderAlerts(ctx, tender.id),
      listSubmissions(ctx, tender.id),
      getTenderResult(ctx, tender.id),
      getEntityDocuments(ctx, 'tender', tender.id),
      listDatasheetRuns(ctx, tender.id),
      listMemoireRuns(ctx, tender.id),
    ])
  const done = analyses.find((x) => x.status === 'done' && x.result)

  const a: DceAnalysis | null = done ? normalizeAnalysis(done.result) : null
  const visit = a?.deadlines.site_visit
  const fmtEuros = (n: number) =>
    `${new Intl.NumberFormat('fr-FR').format(n)} €`
  // Les alertes checklist_* doublonnent la section « État de la checklist » —
  // on ne garde ici que les alertes transverses (deadline, visite, lots…).
  const otherAlerts = alerts.filter((al) => !al.check_key.startsWith('checklist_'))
  const requiredItems = checklist.filter((c) => c.requirement === 'obligatoire')
  const validatedItems = requiredItems.filter(
    (c) => c.status === 'valide' || c.status === 'non_requis',
  )

  // --- Bandeau synthèse : les chiffres qui comptent en un coup d'œil ---
  const logo = logoBase64()
  const deadlineIso = tender.response_deadline ?? a?.deadlines.response_deadline
  const daysUntil = deadlineIso
    ? Math.ceil(
        (new Date(deadlineIso).getTime() - new Date().getTime()) / 86_400_000,
      )
    : null
  const blockingCount = otherAlerts.filter(
    (al) => al.severity === 'bloquante' || al.severity === 'critique',
  ).length
  const dsStats = datasheetRuns
    .map((r) => r.config?.deliverable_stats)
    .filter((s): s is NonNullable<typeof s> => !!s)
  const fichesLivrees = dsStats.reduce(
    (n, s) => n + (s.fichesFabricantsLivrees ?? s.pdfsEmbarques),
    0,
  )
  const fichesAttendues = dsStats.reduce(
    (n, s) => n + (s.fichesFabricants ?? s.documents),
    0,
  )
  const prescriptions = dsStats.reduce((n, s) => n + (s.prescriptions ?? 0), 0)
  const fichesRestantes = dsStats.reduce((n, s) => n + (s.sansUrl ?? 0), 0)
  const dcDocs = documents.filter(
    (d) => d.document_type === 'dc1' || d.document_type === 'dc2',
  )
  const hasLivrables =
    datasheetRuns.length > 0 || memoireRuns.length > 0 || dcDocs.length > 0

  // Annexe : documents regroupés par dossier (2 derniers segments du chemin).
  const docGroups = new Map<string, typeof documents>()
  for (const d of documents) {
    const segs = (d.folder_path ?? '').split('/').filter(Boolean)
    const label = segs.length ? segs.slice(-2).join(' · ') : 'Divers'
    const arr = docGroups.get(label) ?? []
    arr.push(d)
    docGroups.set(label, arr)
  }

  const deadlineTone =
    daysUntil == null ? 'default' : daysUntil < 0 ? 'danger' : daysUntil <= 7 ? 'danger' : daysUntil <= 30 ? 'warn' : 'default'
  const kpis: {
    label: string
    value: React.ReactNode
    sub?: React.ReactNode
    tone?: 'default' | 'danger' | 'warn' | 'ok'
    progress?: { done: number; total: number }
  }[] = [
    {
      label: 'Échéance de remise',
      value:
        daysUntil != null
          ? daysUntil >= 0
            ? `J-${daysUntil}`
            : `Dépassée de ${-daysUntil} j`
          : deadlineIso
            ? formatDate(deadlineIso)
            : '—',
      sub: deadlineIso ? formatDate(deadlineIso) : 'Non renseignée',
      tone: deadlineTone as 'default' | 'danger' | 'warn',
    },
    {
      label: 'Montant estimé',
      value:
        a?.identification.estimated_amount_euros != null
          ? fmtEuros(a.identification.estimated_amount_euros)
          : tender.estimated_amount_cents
            ? fmtEuros(tender.estimated_amount_cents / 100)
            : '—',
      sub: a?.deadlines.offer_validity ? `Validité : ${a.deadlines.offer_validity}` : undefined,
    },
    {
      label: 'Pièces obligatoires',
      value: requiredItems.length ? `${validatedItems.length}/${requiredItems.length}` : '—',
      tone: (requiredItems.length && validatedItems.length < requiredItems.length ? 'warn' : 'ok') as 'warn' | 'ok',
      progress: { done: validatedItems.length, total: requiredItems.length },
      sub: requiredItems.length ? 'validées ou non requises' : 'checklist vide',
    },
    {
      label: 'Lots',
      value: lots.length ? `${lots.length}` : '—',
      sub: lots.length ? `${lots.filter((l) => l.selected).length} retenu(s)` : undefined,
    },
    {
      label: 'Fiches fabricants',
      value: fichesAttendues ? `${fichesLivrees}/${fichesAttendues}` : '—',
      tone: (fichesAttendues && fichesLivrees < fichesAttendues ? 'warn' : 'ok') as 'warn' | 'ok',
      progress: { done: fichesLivrees, total: fichesAttendues },
      sub: fichesAttendues
        ? `${fichesRestantes ? `${fichesRestantes} à obtenir` : 'PDF embarqués'}${prescriptions ? ` · +${prescriptions} normes` : ''}`
        : undefined,
    },
    {
      label: 'Alertes',
      value: blockingCount
        ? `${blockingCount} bloquante${blockingCount > 1 ? 's' : ''}`
        : otherAlerts.length
          ? `${otherAlerts.length} ouverte${otherAlerts.length > 1 ? 's' : ''}`
          : 'Aucune',
      tone: (blockingCount ? 'danger' : otherAlerts.length ? 'warn' : 'ok') as 'danger' | 'warn' | 'ok',
      sub: visit?.mandatory ? 'Visite de site obligatoire' : undefined,
    },
  ]

  // Sommaire — sections réellement présentes.
  const toc: string[] = [
    a && 'L’essentiel',
    a?.summary && 'Synthèse',
    'Identification',
    a?.award_criteria.length && 'Critères d’attribution',
    (lots.length > 0 || (a?.lots.length ?? 0) > 0) && `Lots (${lots.length || a?.lots.length})`,
    a?.required_documents.length && `Pièces exigées (${a.required_documents.length})`,
    a?.risks.length && 'Points de vigilance',
    a && (a.go_nogo.favorable_signals.length > 0 || a.go_nogo.blocking_signals.length > 0 || a.go_nogo.recommendation) && 'Go / No-Go',
    checklist.length && `Checklist (${checklist.filter((c) => c.status === 'valide').length}/${checklist.length})`,
    'Livrables produits',
    submissions.length && `Dépôts (${submissions.length})`,
    result && 'Résultat',
    otherAlerts.length && `Alertes (${otherAlerts.length})`,
    documents.length && `Annexe — documents (${documents.length})`,
  ].filter(Boolean) as string[]

  let sectionIndex = 0
  const nextIndex = () => ++sectionIndex

  return (
    <div className="pdf-doc min-h-screen bg-white font-sans text-[13px] leading-relaxed text-slate-900 antialiased">
      {/* print-color-adjust : les fonds/badges couleur passent dans le PDF. */}
      <style>{`
        .pdf-doc, .pdf-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { size: A4; margin: 11mm 12mm 14mm; }
      `}</style>
      <div className="mx-auto max-w-[190mm] px-9 py-8">
        {/* ================= HÉRO — identification ================= */}
        <header className="overflow-hidden rounded-2xl bg-slate-900 text-white print:rounded-lg">
          <div className="flex items-start justify-between gap-6 px-7 pt-6">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">
                Dossier d’appel d’offres — export complet
              </p>
              <h1 className="mt-2 text-[22px] font-bold leading-tight">
                {a?.identification.title || tender.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(a?.identification.reference ?? tender.reference) && (
                  <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold tracking-wide">
                    Réf. {a?.identification.reference ?? tender.reference}
                  </span>
                )}
                <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold">
                  {TENDER_STATUS_LABELS[tender.status]}
                </span>
                {lots.length > 0 && (
                  <span className="rounded-md bg-white/10 px-2 py-1 text-[11px]">
                    {lots.length} lot{lots.length > 1 ? 's' : ''} — {lots.filter((l) => l.selected).length} retenu(s)
                  </span>
                )}
                {visit?.mandatory && (
                  <span className="rounded-md bg-red-500/90 px-2 py-1 text-[11px] font-semibold">
                    Visite obligatoire
                  </span>
                )}
              </div>
            </div>
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/png;base64,${logo}`}
                alt="DCR"
                className="h-14 w-auto shrink-0 rounded-lg bg-white object-contain p-1.5"
              />
            )}
          </div>
          <dl className="mt-5 grid grid-cols-4 gap-4 border-t border-white/15 px-7 py-4 text-[11px]">
            <div>
              <dt className="text-slate-400">Acheteur</dt>
              <dd className="mt-0.5 font-medium leading-snug">
                {a?.identification.buyer ?? tender.buyer?.name ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Procédure</dt>
              <dd className="mt-0.5 font-medium">
                {a?.identification.procedure_type ?? tender.procedure_type ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Type de marché</dt>
              <dd className="mt-0.5 font-medium">
                {a?.identification.market_type ?? tender.market_type ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Export du dossier</dt>
              <dd className="mt-0.5 font-medium">{formatDate(new Date().toISOString())}</dd>
            </div>
          </dl>
        </header>

        {/* ================= KPI — les chiffres qui décident ================= */}
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {kpis.map((k) => (
            <Kpi key={k.label} label={k.label} value={k.value} sub={k.sub} tone={k.tone} progress={k.progress} />
          ))}
        </div>

        {/* ================= Sommaire ================= */}
        <nav className="mt-4 flex flex-wrap gap-1.5">
          {toc.map((t, i) => (
            <span
              key={t}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-600"
            >
              {String(i + 1).padStart(2, '0')} · {t}
            </span>
          ))}
        </nav>

        {/* ================= L'essentiel ================= */}
        {a && (
          <Section>
            <H2 index={nextIndex()}>L’essentiel — à ne pas manquer</H2>
            <div className="grid grid-cols-3 gap-3">
              <Card title="Visite de site" tone={visit?.mandatory ? 'red' : 'slate'}>
                {visit ? (
                  <>
                    <p className={visit.mandatory ? 'font-bold text-red-700' : 'font-medium text-slate-700'}>
                      {visit.mandatory ? 'Obligatoire' : 'Recommandée / facultative'}
                    </p>
                    {(visit.dates?.length || visit.date) && (
                      <ul className="mt-1 space-y-0.5">
                        {(visit.dates?.length ? visit.dates : [visit.date!]).map((d, i) => (
                          <li key={i} className="font-semibold">{formatDate(d)}</li>
                        ))}
                      </ul>
                    )}
                    {visit.access && <p className="mt-1 text-[12px] text-slate-600">Accès : {visit.access}</p>}
                    {visit.details && <p className="mt-1 text-[12px] text-slate-600">{visit.details}</p>}
                    {visit.mandatory && (
                      <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">
                        Sans visite, l’offre peut être déclarée irrégulière.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-slate-500">Aucune visite détectée.</p>
                )}
              </Card>
              <Card title="Personnes en charge">
                {a.contacts.length ? (
                  <ul className="space-y-1.5">
                    {a.contacts.map((c, i) => (
                      <li key={i} className="break-inside-avoid">
                        <p className="font-medium">
                          {c.name ?? 'Contact'}
                          {c.role && <span className="font-normal text-slate-500"> — {c.role}</span>}
                        </p>
                        <p className="text-[11px] text-slate-600">
                          {[c.email, c.phone].filter(Boolean).join(' · ')}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500">Aucun contact extrait.</p>
                )}
              </Card>
              <Card title="Échéances à ne pas manquer" tone={deadlineTone === 'danger' ? 'red' : 'slate'}>
                <ul className="space-y-1">
                  {a.deadlines.response_deadline && (
                    <li className="flex items-baseline justify-between gap-2">
                      <span className="text-slate-500">Remise des offres</span>
                      <span className={`font-bold ${deadlineTone === 'danger' ? 'text-red-700' : ''}`}>
                        {formatDate(a.deadlines.response_deadline)}
                      </span>
                    </li>
                  )}
                  {a.deadlines.questions_deadline && (
                    <li className="flex items-baseline justify-between gap-2">
                      <span className="text-slate-500">Questions au MOA</span>
                      <span className="font-semibold">{formatDate(a.deadlines.questions_deadline)}</span>
                    </li>
                  )}
                  {a.deadlines.other?.map((o, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2">
                      <span className="text-slate-500">{o.label}</span>
                      <span className="font-semibold">{formatDate(o.date)}</span>
                    </li>
                  ))}
                  {!a.deadlines.response_deadline &&
                    !a.deadlines.questions_deadline &&
                    !(a.deadlines.other?.length) && (
                      <li className="text-slate-500">Aucune échéance extraite.</li>
                    )}
                </ul>
                {a.required_documents.filter((d) => d.requirement === 'obligatoire').length > 0 && (
                  <p className="mt-2 rounded-md bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700">
                    {a.required_documents.filter((d) => d.requirement === 'obligatoire').length} pièce(s)
                    obligatoire(s) dans la réponse.
                  </p>
                )}
              </Card>
            </div>
          </Section>
        )}

        {/* ================= Synthèse ================= */}
        {a?.summary && (
          <Section>
            <H2 index={nextIndex()}>Synthèse</H2>
            <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4">
              {a.summary}
            </p>
          </Section>
        )}

        {/* ================= Identification ================= */}
        <Section>
          <H2 index={nextIndex()}>Identification</H2>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5">
            {(a?.identification.buyer || tender.buyer?.name) && (
              <>
                <dt className="text-slate-500">Acheteur</dt>
                <dd className="font-medium">{a?.identification.buyer ?? tender.buyer?.name}</dd>
              </>
            )}
            {(a?.identification.procedure_type || tender.procedure_type) && (
              <>
                <dt className="text-slate-500">Procédure</dt>
                <dd>{a?.identification.procedure_type ?? tender.procedure_type}</dd>
              </>
            )}
            {(a?.identification.market_type || tender.market_type) && (
              <>
                <dt className="text-slate-500">Type de marché</dt>
                <dd>{a?.identification.market_type ?? tender.market_type}</dd>
              </>
            )}
            {(a?.identification.estimated_amount_euros != null || tender.estimated_amount_cents) && (
              <>
                <dt className="text-slate-500">Montant estimé</dt>
                <dd className="font-semibold">
                  {a?.identification.estimated_amount_euros != null
                    ? fmtEuros(a.identification.estimated_amount_euros)
                    : fmtEuros((tender.estimated_amount_cents ?? 0) / 100)}
                </dd>
              </>
            )}
            {(a?.identification.duration_months != null || tender.duration_months != null) && (
              <>
                <dt className="text-slate-500">Durée</dt>
                <dd>{a?.identification.duration_months ?? tender.duration_months} mois</dd>
              </>
            )}
            {a?.deadlines.offer_validity && (
              <>
                <dt className="text-slate-500">Validité des offres</dt>
                <dd>{a.deadlines.offer_validity}</dd>
              </>
            )}
            {tender.response_deadline && (
              <>
                <dt className="text-slate-500">Date limite de remise</dt>
                <dd className="font-bold">{formatDate(tender.response_deadline)}</dd>
              </>
            )}
            {tender.platform && (
              <>
                <dt className="text-slate-500">Plateforme</dt>
                <dd>{tender.platform}</dd>
              </>
            )}
          </dl>
        </Section>

        {/* ================= Critères ================= */}
        {a && a.award_criteria.length > 0 && (
          <Section>
            <H2 index={nextIndex()}>Critères d’attribution</H2>
            <ul className="space-y-1.5">
              {a.award_criteria.map((c, i) => (
                <li key={i} className="flex items-center gap-3 break-inside-avoid">
                  <span className="flex-1">{c.label}</span>
                  {c.weight_pct != null && (
                    <>
                      <span className="w-28">
                        <Bar done={c.weight_pct} total={100} />
                      </span>
                      <span className="w-10 text-right font-bold">{c.weight_pct} %</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ================= Lots ================= */}
        {lots.length > 0 ? (
          <Section>
            <H2 index={nextIndex()}>Lots ({lots.length})</H2>
            <ul className="space-y-1">
              {lots.map((l) => (
                <li key={l.id} className="flex items-baseline gap-2 break-inside-avoid">
                  <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {l.number}
                  </span>
                  <span className="font-medium">{l.title}</span>
                  {l.amount_cents != null && (
                    <span className="text-xs text-slate-600">{fmtEuros(l.amount_cents / 100)}</span>
                  )}
                  {l.selected && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      retenu
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        ) : a && a.lots.length > 0 ? (
          <Section>
            <H2 index={nextIndex()}>Lots détectés par l’analyse ({a.lots.length})</H2>
            <ul className="space-y-1">
              {a.lots.map((l) => (
                <li key={l.number}>
                  <span className="font-semibold">Lot {l.number} — {l.title}</span>
                  {(l.amount_euros != null || l.duree || l.variantes) && (
                    <span className="block pl-4 text-xs text-slate-600">
                      {[
                        l.amount_euros != null ? fmtEuros(l.amount_euros) : null,
                        l.duree,
                        l.variantes,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {/* ================= Pièces exigées ================= */}
        {a && a.required_documents.length > 0 && (
          <Section>
            <H2 index={nextIndex()}>Pièces exigées dans la réponse ({a.required_documents.length})</H2>
            <ul className="divide-y divide-slate-200">
              {a.required_documents.map((d, i) => (
                <li key={i} className="flex items-baseline justify-between gap-4 break-inside-avoid py-1.5">
                  <span>
                    {d.lot != null && <span className="font-medium">[Lot {d.lot}] </span>}
                    {d.label}
                    {d.source && (
                      <span className="block pl-4 text-xs italic text-slate-500">{d.source}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        d.requirement === 'obligatoire'
                          ? 'bg-red-100 text-red-800'
                          : d.requirement === 'recommande'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {REQ_LABELS[d.requirement] ?? d.requirement}
                    </span>
                    {d.requires_signature && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">à signer</span>
                    )}
                    {d.requires_chiffrage && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">à chiffrer</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ================= Risques ================= */}
        {a && a.risks.length > 0 && (
          <Section>
            <H2 index={nextIndex()}>Points de vigilance</H2>
            <ul className="space-y-1.5">
              {a.risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2 break-inside-avoid">
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      r.severity === 'bloquante' || r.severity === 'critique'
                        ? 'bg-red-100 text-red-800'
                        : r.severity === 'importante'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {SEV_LABELS[r.severity] ?? r.severity}
                  </span>
                  <span>{r.message}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ================= Go / No-Go ================= */}
        {a && (a.go_nogo.favorable_signals.length > 0 ||
          a.go_nogo.blocking_signals.length > 0 ||
          a.go_nogo.recommendation) && (
          <Section>
            <H2 index={nextIndex()}>Signaux Go / No-Go</H2>
            <div className="grid grid-cols-2 gap-3">
              <Card title="Signaux favorables" tone="emerald">
                {a.go_nogo.favorable_signals.length ? (
                  <ul className="space-y-1">
                    {a.go_nogo.favorable_signals.map((s, i) => (
                      <li key={i} className="break-inside-avoid">✓ {s}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500">Aucun signal favorable relevé.</p>
                )}
              </Card>
              <Card title="Points bloquants" tone="red">
                {a.go_nogo.blocking_signals.length ? (
                  <ul className="space-y-1">
                    {a.go_nogo.blocking_signals.map((s, i) => (
                      <li key={i} className="break-inside-avoid text-red-700">✗ {s}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500">Aucun point bloquant relevé.</p>
                )}
              </Card>
            </div>
            {a.go_nogo.recommendation && (
              <p className="mt-3 rounded-lg border-l-4 border-slate-800 bg-slate-50 p-3">
                {a.go_nogo.recommendation}
              </p>
            )}
          </Section>
        )}

        {/* ================= Checklist ================= */}
        {checklist.length > 0 && (
          <Section>
            <H2 index={nextIndex()}>
              État de la checklist — {checklist.filter((c) => c.status === 'valide').length}/
              {checklist.length} validées
            </H2>
            <ul className="divide-y divide-slate-200">
              {checklist.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-4 break-inside-avoid py-1.5">
                  <span>
                    {c.label}
                    <span className="ml-2 text-xs text-slate-500">
                      {[
                        CHECKLIST_CATEGORY_LABELS[c.category] ?? c.category,
                        REQ_LABELS[c.requirement] ?? c.requirement,
                        c.requires_signature && 'à signer',
                        c.requires_chiffrage && 'à chiffrer',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {c.document && (
                      <span className="text-[10px] text-slate-500">{c.document.name}</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PILL[c.status] ?? PILL.non_commence}`}>
                      {CHECKLIST_STATUS_LABELS[c.status] ?? c.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ================= Livrables produits ================= */}
        <Section>
          <H2 index={nextIndex()}>Livrables produits</H2>
          {!hasLivrables ? (
            <p className="text-slate-500">Aucun livrable généré à ce stade.</p>
          ) : (
            <ul className="space-y-1.5">
              {datasheetRuns.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-4 break-inside-avoid">
                  <span className="font-semibold">Fiches techniques — {r.lot_label}</span>
                  <span className="text-xs text-slate-600">
                    {formatDate(r.created_at)}
                    {r.config?.deliverable_stats
                      ? ` · ${r.config.deliverable_stats.produits} produits · ${r.config.deliverable_stats.documents} fiches · ${r.config.deliverable_stats.pdfsEmbarques} PDF embarqués${r.config.deliverable_stats.sansUrl ? ` · ${r.config.deliverable_stats.sansUrl} à obtenir` : ''}`
                      : r.config?.deliverables?.length
                        ? ` · ${r.config.deliverables.length} livrable(s)`
                        : ''}
                    {r.error ? ` · erreur : ${r.error}` : ''}
                  </span>
                </li>
              ))}
              {memoireRuns.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-4 break-inside-avoid">
                  <span className="font-semibold">Mémoire technique — {r.lot_label}</span>
                  <span className="text-xs text-slate-600">
                    {formatDate(r.created_at)}
                    {r.docx_full_filename
                      ? ` · ${r.docx_full_filename}`
                      : r.docx_filename
                        ? ` · ${r.docx_filename}`
                        : ''}
                    {r.error ? ` · erreur : ${r.error}` : ''}
                  </span>
                </li>
              ))}
              {dcDocs.map((d) => (
                <li key={d.id} className="flex items-baseline justify-between gap-4 break-inside-avoid">
                  <span className="font-semibold">
                    {d.document_type === 'dc1' ? 'DC1 — Lettre de candidature' : 'DC2 — Déclaration du candidat'}
                  </span>
                  <span className="text-xs text-slate-600">
                    {formatDate(d.created_at)}
                    {d.is_signed ? ' · signé' : ' · non signé'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ================= Dépôts ================= */}
        {submissions.length > 0 && (
          <Section>
            <H2 index={nextIndex()}>Dépôts ({submissions.length})</H2>
            <ul className="space-y-1">
              {submissions.map((s) => (
                <li key={s.id}>
                  <span className="font-semibold">
                    Version {s.version} — {formatDate(s.submitted_at)}
                  </span>
                  <span className="ml-2 text-xs text-slate-600">
                    {[s.platform, s.submission_ref, s.receipt?.name && `récépissé : ${s.receipt.name}`, s.validator?.full_name && `validé par ${s.validator.full_name}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ================= Résultat ================= */}
        {result && (
          <Section>
            <H2 index={nextIndex()}>Résultat</H2>
            <p className={`rounded-lg border-l-4 p-3 ${result.outcome === 'gagne' ? 'border-emerald-500 bg-emerald-50' : 'border-red-500 bg-red-50'}`}>
              <span className="font-bold">
                {result.outcome === 'gagne'
                  ? 'Marché remporté'
                  : result.outcome === 'perdu'
                    ? 'Marché perdu'
                    : result.outcome === 'sans_suite'
                      ? 'Sans suite'
                      : 'Annulé'}
              </span>
              {' — '}
              {[
                result.decided_at && `décision du ${formatDate(result.decided_at)}`,
                result.awarded_to && `attributaire : ${result.awarded_to}`,
                result.awarded_amount_cents != null &&
                  `montant : ${fmtEuros(result.awarded_amount_cents / 100)}`,
                result.loss_reason && `motif : ${result.loss_reason}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </Section>
        )}

        {/* ================= Alertes ================= */}
        {otherAlerts.length > 0 && (
          <Section>
            <H2 index={nextIndex()}>Alertes non résolues ({otherAlerts.length})</H2>
            <ul className="space-y-1.5">
              {otherAlerts.map((al) => (
                <li key={al.id} className="flex items-start gap-2 break-inside-avoid">
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      al.severity === 'bloquante' || al.severity === 'critique'
                        ? 'bg-red-100 text-red-800'
                        : al.severity === 'importante'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {SEV_LABELS[al.severity] ?? al.severity}
                  </span>
                  <span>{al.message}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ================= Annexe : documents groupés ================= */}
        {documents.length > 0 && (
          <Section>
            <H2 index={nextIndex()}>Documents du dossier ({documents.length})</H2>
            <div className="space-y-3 break-before-page">
              {[...docGroups.entries()].map(([group, docs]) => (
                <div key={group}>
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    {group} <span className="font-normal">({docs.length})</span>
                  </p>
                  <ul className="columns-2 gap-8 text-[11.5px]">
                    {docs.map((d) => (
                      <li key={d.id} className="break-inside-avoid truncate py-0.5" title={d.name}>
                        <span className="font-medium">{d.name}</span>
                        <span className="ml-1.5 text-[10px] text-slate-500">
                          {DOC_CATEGORY_LABELS[d.category] ?? d.category}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ================= Pied : traçabilité ================= */}
        <footer className="mt-10 border-t-2 border-slate-900 pt-3 text-[11px] text-slate-500">
          <div className="flex items-start justify-between gap-6">
            <div>
              {done ? (
                <>
                  <p>
                    Pièces analysées : {done.files.map((f) => f.name).join(' · ') || '—'}
                    {done.skipped.length > 0 &&
                      ` — ignorées : ${done.skipped.map((s) => s.name).join(', ')}`}
                  </p>
                  {done.model && <p className="mt-0.5">Modèle : {done.model} — analyse du {formatDate(done.created_at)}</p>}
                </>
              ) : (
                <p>Aucune analyse DCE réalisée à ce jour.</p>
              )}
            </div>
            <p className="shrink-0 font-medium text-slate-700">
              Dossier généré par Nexus — {formatDate(new Date().toISOString())}
            </p>
          </div>
          <p className="mt-0.5">Documents liés au dossier : {documents.length}</p>
        </footer>
      </div>
      <AutoPrint auto={sp.auto === '1'} />
    </div>
  )
}
