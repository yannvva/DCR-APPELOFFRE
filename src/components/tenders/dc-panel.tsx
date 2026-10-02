'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Loader2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ActionProgress } from '@/components/ui/action-progress'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { generateDcForms } from '@/app/actions/dc'
import { getDocumentUrl } from '@/app/actions/documents'
import {
  DocumentViewer,
  useDocumentViewer,
} from '@/components/documents/document-viewer'
import { formatDate } from '@/lib/format'
import type { Document, TenderLot } from '@/lib/types'

/**
 * Génération des formulaires officiels DC1 (lettre de candidature, commune à
 * tous les lots) et DC2 (déclaration du candidat, un par lot) à partir des
 * gabarits DCR + profil société (page /societe).
 */
export function DcPanel({
  orgSlug,
  tenderId,
  lots,
  analysisLots = [],
  documents,
  missingFields,
  canEdit,
}: {
  orgSlug: string
  tenderId: string
  lots: TenderLot[]
  /** Lots détectés par l'analyse DCE mais pas encore créés dans le dossier. */
  analysisLots?: { number: number; title: string }[]
  documents: Document[]
  missingFields: string[]
  canEdit: boolean
}) {
  const router = useRouter()
  // null = « défaut » (lots marqués selected, ou tous) : recalculé à chaque
  // rendu → les lots créés à la volée après une génération restent cochés.
  const [override, setOverride] = useState<string[] | null>(null)
  const defaults = lots.filter((l) => l.selected).map((l) => l.id)
  // Ids présents en base uniquement : un lot supprimé entre deux rendus
  // laisserait une case fantôme cochée et un compte de DC2 erroné.
  const selected = (
    override ?? (defaults.length ? defaults : lots.map((l) => l.id))
  ).filter((id) => lots.some((l) => l.id === id))
  const [pending, startTransition] = useTransition()
  const [downloading, setDownloading] = useState<string | null>(null)

  const viewer = useDocumentViewer(orgSlug)

  // Uniquement les DC1/DC2 produits ici : marqueur pipeline « /dc/ » dans le
  // chemin storage. Les gabarits « DC1 - TEMPLATE.doc » téléversés à la main
  // restent dans Documents mais ne sont pas listés comme livrables.
  const dcDocs = documents.filter(
    (d) =>
      (d.document_type === 'dc1' || d.document_type === 'dc2') &&
      d.storage_path.includes('/dc/'),
  )

  function toggle(id: string) {
    setOverride(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    )
  }

  function generate() {
    // Aucun lot coché alors que le dossier en a : le serveur retomberait sur
    // lots.selected en base — incohérent avec les cases décochées affichées.
    if (lots.length > 0 && selected.length === 0) {
      toast.error('Sélectionnez au moins un lot — un DC2 est généré par lot.')
      return
    }
    startTransition(async () => {
      const res = await generateDcForms(orgSlug, tenderId, { lotIds: selected })
      if (res?.error) {
        toast.error(res.error)
        return
      }
      // Compte réel renvoyé par le serveur (les lots périmés y sont écartés).
      toast.success(
        `${res?.generated ?? 0} document(s) généré(s) — DC1 + DC2 rangés dans Documents`,
      )
      if (res?.warnings?.length) {
        toast.warning(
          `Champ(s) resté(s) vide(s) dans les gabarits : ${res.warnings.join(', ')} — complétez le profil Société.`,
        )
      }
      router.refresh()
    })
  }

  async function download(doc: Document) {
    setDownloading(doc.id)
    const res = await getDocumentUrl(orgSlug, doc.id, { download: true })
    setDownloading(null)
    if ('error' in res) {
      toast.error(res.error)
      return
    }
    window.open(res.url, '_blank', 'noopener')
  }

  return (
    <div className="space-y-4">
      {missingFields.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">
              Profil société incomplet — {missingFields.length} élément(s)
              manquant(s)
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {missingFields.join(', ')} — complétez-les sur{' '}
              <Link href={`/${orgSlug}/societe`} className="text-primary underline">
                la page Société
              </Link>{' '}
              pour des formulaires complets.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileCheck2 className="size-4" /> Générer les formulaires
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            DC1 = lettre de candidature (commune à tous les lots). DC2 =
            déclaration du candidat (un exemplaire par lot). Identité, finances
            et coordonnées proviennent du profil de la page Société.
          </p>

          {lots.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Lots de la candidature
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {lots.map((l) => (
                  <label
                    key={l.id}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={selected.includes(l.id)}
                      onCheckedChange={() => toggle(l.id)}
                      disabled={!canEdit || pending}
                    />
                    <span className="min-w-0 truncate">
                      Lot {l.number} — {l.title}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {!lots.length && analysisLots.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Lots détectés par l’analyse DCE
              </p>
              <ul className="space-y-1 text-sm">
                {analysisLots.map((l) => (
                  <li key={l.number}>
                    Lot {l.number} — {l.title}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Les fiches lots seront créées automatiquement à la génération —
                un DC2 sera produit pour chacun.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={generate} disabled={!canEdit || pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileCheck2 className="size-4" />
              )}
              Générer DC1
              {lots.length > 0 && selected.length > 0
                ? ` + DC2 ×${selected.length}`
                : !lots.length && analysisLots.length > 0
                  ? ` + DC2 ×${analysisLots.length}`
                  : ' + DC2'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Les fichiers .docx sont rangés dans l’onglet Documents (dossier DC).
            </p>
          </div>
          {pending && (
            <ActionProgress
              title="Génération des formulaires DC1/DC2"
              steps={[
                'Chargement des gabarits DCR et du profil société',
                'Remplissage DC1 + un DC2 par lot',
                'Rangement dans Documents et mise à jour de la checklist',
              ]}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Formulaires générés</CardTitle>
        </CardHeader>
        <CardContent>
          {dcDocs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Aucun DC1/DC2 généré pour ce dossier.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {dcDocs.map((doc, i) => (
                <li key={doc.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                    onClick={() => viewer.open(dcDocs, i)}
                  >
                    {doc.name}
                  </button>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {doc.document_type?.toUpperCase()}
                  </Badge>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(doc.created_at)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => viewer.open(dcDocs, i)}
                    aria-label={`Voir ${doc.name}`}
                  >
                    <Eye className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={downloading === doc.id}
                    onClick={() => download(doc)}
                    aria-label={`Télécharger ${doc.name}`}
                  >
                    {downloading === doc.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DocumentViewer {...viewer.viewerProps()} />
    </div>
  )
}
