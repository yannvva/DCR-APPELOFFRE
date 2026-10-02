import { notFound } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { requireMembership } from '@/lib/dal/auth'
import { parseCompanyProfile, REQUIRED_COMPANY_DOCS } from '@/lib/company'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CompanyProfileForm } from '@/components/company/profile-form'
import { CompanyDocumentsPanel } from '@/components/company/documents-panel'
import type { Document } from '@/lib/types'

/**
 * Référentiel société : profil juridique/financier + pièces officielles
 * (KBIS, RIB, URSSAF, assurances, DC1/DC2…). Les agents (mémoire
 * technique, fiches, futur dépôt DC1/DC2) lisent ces informations pour
 * produire les documents sans ressaisie.
 */
export default async function SocietePage({
  params,
}: PageProps<'/[org]/societe'>) {
  const { org: orgSlug } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()
  const { org } = ctx
  const canEdit = ctx.role !== 'viewer'

  const profile = parseCompanyProfile(org.settings)
  const { data: docs } = await ctx.supabase
    .from('documents')
    .select('*')
    .eq('organization_id', org.id)
    .eq('category', 'societe')
    .order('created_at', { ascending: false })

  const today = new Date().toISOString().slice(0, 10)
  // Kit candidature standard : chaque pièce attendue est contrôlée par type
  // (+ motif sur le nom quand un type couvre plusieurs attestations).
  const docStatus = REQUIRED_COMPANY_DOCS.map(({ type, label, match }) => {
    const doc = (docs ?? [])
      .filter(
        (d) =>
          d.document_type === type && (!match || match.test(d.name)),
      )
      .sort((a, b) =>
        (b.valid_until ?? '').localeCompare(a.valid_until ?? ''),
      )[0]
    const expired = !!doc?.valid_until && doc.valid_until < today
    return { type, label, present: !!doc, expired, until: doc?.valid_until ?? null }
  })
  // Expirées puis manquantes d'abord — c'est ce qui demande une action.
  docStatus.sort(
    (a, b) =>
      Number(b.expired) - Number(a.expired) ||
      Number(!b.present) - Number(!a.present) ||
      (a.until ?? '9999').localeCompare(b.until ?? '9999'),
  )

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Building2 className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Société — {org.name}</h1>
          <p className="text-sm text-muted-foreground">
            Informations officielles et pièces de l’entreprise — les agents les
            utilisent pour produire les mémoires, fiches techniques et pièces de
            réponse (DC1, DC2…).
          </p>
        </div>
      </div>

      <CompanyProfileForm orgSlug={orgSlug} initial={profile} canEdit={canEdit} />

      <Card id="pieces">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Kit candidature — pièces de la société
            {docStatus.some((d) => !d.present || d.expired) && (
              <Badge variant="outline" className="font-normal">
                {docStatus.filter((d) => !d.present || d.expired).length}{' '}
                à mettre à jour
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <CompanyDocumentsPanel
            orgSlug={orgSlug}
            documents={(docs ?? []) as Document[]}
            coverage={docStatus}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
    </div>
  )
}
