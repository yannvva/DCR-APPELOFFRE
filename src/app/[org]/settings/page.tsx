import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  Building2,
  BookMarked,
  ChevronRight,
  FolderOpen,
  ScrollText,
  Settings,
  UserCog,
} from 'lucide-react'
import { getUserOrganizations, requireMembership } from '@/lib/dal/auth'
import { listAuditLogs } from '@/lib/dal/audit'
import { formatDate, formatRelative } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { OrgNameForm, ProfileForm } from '@/components/settings/settings-forms'
import { DangerZone, SecurityForm } from '@/components/settings/security-forms'
import type { AuditLog, JobRole } from '@/lib/types'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
  viewer: 'Observateur',
}

const AUDIT_LABELS: Record<string, string> = {
  'profile.updated': 'Profil mis à jour',
  'organization.renamed': 'Organisation renommée',
  'company.profile_updated': 'Profil société mis à jour',
  'invitation.created': 'Invitation créée',
  'invitation.accepted': 'Invitation acceptée',
  'invitation.revoked': 'Invitation révoquée',
  'member.role_updated': 'Rôle de membre modifié',
  'member.removed': 'Membre retiré',
  'document.uploaded': 'Document déposé',
  'document.deleted': 'Document supprimé',
  'document.validity_updated': 'Validité de document modifiée',
  'document.folder_exported': 'Dossier exporté en ZIP',
  'document.marked_signed': 'Pièce marquée signée',
  'document.marked_unsigned': 'Signature de pièce annulée',
  'checklist.validated': 'Ligne de checklist validée',
  'checklist.force_validated': 'Validation forcée (checklist)',
  'checklist.company_docs_attached': 'Pièces société rattachées',
  'task.deleted': 'Tâche supprimée',
  'tender.created': 'Appel d’offres créé',
  'tender.status_changed': 'Statut d’AO modifié',
  'tender.deleted': 'Appel d’offres supprimé',
  'tender.submitted': 'Offre déposée',
  'tender.result_recorded': 'Résultat d’AO enregistré',
  'tender.dce_imported': 'DCE importé',
  'tender.dce_analyzed': 'DCE analysé',
  'tender.dce_applied': 'Analyse DCE appliquée',
  'datasheet_run.created': 'Recherche de fiches lancée',
  'datasheet_run.doc_search': 'Recherche documentaire lancée',
  'datasheet_run.downloaded': 'Fiches téléchargées',
  'datasheet_run.exported': 'Dossier de fiches exporté',
  'datasheet_run.deliverable_imported': 'Livrable de fiches importé',
  'datasheet_run.document_attached': 'Document rattaché à une fiche',
  'datasheet_run.deleted': 'Recherche de fiches supprimée',
  'memoire_run.created': 'Mémoire technique lancé',
  'memoire_run.generated': 'Mémoire technique généré',
  'memoire_run.built': 'DOCX de mémoire construit',
  'memoire_run.built_full': 'Mémoire complet construit',
  'memoire_run.docx_imported': 'DOCX de mémoire importé',
  'memoire_run.deleted': 'Mémoire technique supprimé',
  'dc.generated': 'DC1/DC2 généré',
  'dc.unfilled_placeholders': 'DC généré avec champs vides',
  'account.created': 'Compte CRM créé',
  'account.deleted': 'Compte CRM supprimé',
  'contact.created': 'Contact créé',
  'contact.deleted': 'Contact supprimé',
  'opportunity.created': 'Opportunité créée',
  'opportunity.lost': 'Opportunité perdue',
  'project.created': 'Projet créé',
  'project.deleted': 'Projet supprimé',
  'opportunity.converted_to_project': 'Opportunité convertie en projet',
}

/** Lien vers l'objet concerné par l'action. Pour un AO, l'id nu suffit : la
    page cible redirige vers l'URL canonique « slug-id ». */
function auditEntityHref(orgSlug: string, log: AuditLog): string | null {
  const m = log.metadata ?? {}
  const tenderId =
    log.entity_type === 'tender' || log.entity_type === 'tender_checklist_item'
      ? (typeof m.tender_id === 'string' ? m.tender_id : log.entity_id)
      : typeof m.tender_id === 'string'
        ? m.tender_id
        : null
  if (tenderId)
    return `/${orgSlug}/tenders/${tenderId}${log.entity_type === 'tender_checklist_item' ? '?tab=checklist' : ''}`
  switch (log.entity_type) {
    case 'project':
      return `/${orgSlug}/projects/${log.entity_id}`
    case 'account':
      return `/${orgSlug}/crm/accounts/${log.entity_id}`
    case 'contact':
      return `/${orgSlug}/crm/contacts/${log.entity_id}`
    case 'document':
      return `/${orgSlug}/documents`
    default:
      return null
  }
}

/** Détail lisible extrait des métadonnées : nom de pièce, lot, compteurs. */
function auditDetail(log: AuditLog): string | null {
  const m = log.metadata ?? {}
  const parts: string[] = []
  const name = m.name ?? m.title
  if (typeof name === 'string' && name) parts.push(name)
  if (typeof m.lot_label === 'string' && m.lot_label) parts.push(m.lot_label)
  if (typeof m.ok === 'number' && typeof m.failed === 'number')
    parts.push(m.failed ? `${m.ok} ok · ${m.failed} échec(s)` : `${m.ok} fichier(s)`)
  else if (typeof m.files === 'number') parts.push(`${m.files} fichier(s)`)
  if (Array.isArray(m.placeholders) && m.placeholders.length)
    parts.push(`${m.placeholders.length} champ(s) vide(s)`)
  if (typeof m.force_reason === 'string' && m.force_reason)
    parts.push(`« ${m.force_reason} »`)
  else if (typeof m.reason === 'string' && m.reason) parts.push(`« ${m.reason} »`)
  return parts.length ? parts.join(' — ') : null
}

const QUICK_LINKS = [
  {
    key: 'societe',
    label: 'Société',
    icon: Building2,
    desc: 'Identité, RIB, assurances, kit candidature (KBIS, DC1/DC2…)',
  },
  {
    key: 'members',
    label: 'Membres',
    icon: UserCog,
    desc: 'Rôles d’accès, invitations et retrait de membres',
  },
  {
    key: 'fiches',
    label: 'Fiches techniques',
    icon: BookMarked,
    desc: 'Bibliothèque de fiches réutilisables par les agents',
  },
  {
    key: 'documents',
    label: 'Documents',
    icon: FolderOpen,
    desc: 'Fichiers de l’organisation — société et dossiers AO',
  },
] as const

export default async function SettingsPage({
  params,
}: PageProps<'/[org]/settings'>) {
  const { org: orgSlug } = await params
  const ctx = await requireMembership(orgSlug)
  if (!ctx) notFound()
  const { supabase, org, role, user, profile } = ctx
  const isAdmin = role === 'owner' || role === 'admin'

  const [orgs, auditLogs, myMemberRes, memberCountRes] = await Promise.all([
    getUserOrganizations(),
    listAuditLogs(ctx, 30),
    supabase
      .from('organization_members')
      .select('job_role, joined_at')
      .eq('organization_id', org.id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('organization_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('organization_id', org.id),
  ])

  const myMember = myMemberRes.data
  const memberCount = memberCountRes.count ?? 0
  const initials = (profile?.full_name || user.email || '?').slice(0, 2).toUpperCase()

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Settings className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Paramètres</h1>
          <p className="text-sm text-muted-foreground">
            Compte, organisation et traçabilité — {org.name}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---- Mon compte ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mon compte</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-10">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {profile?.full_name || user.email}
                </p>
                {profile?.full_name && (
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                )}
              </div>
              <Badge variant="secondary" className="ml-auto shrink-0">
                {ROLE_LABELS[role]}
              </Badge>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Membre depuis</span>
              <span>{formatDate(myMember?.joined_at)}</span>
            </div>
            <Separator />
            <ProfileForm
              orgSlug={orgSlug}
              initialFullName={profile?.full_name ?? ''}
              initialJobRole={(myMember?.job_role as JobRole | null) ?? null}
              initialDefaultOrgId={profile?.default_organization_id ?? null}
              orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
            />
            <Separator />
            <SecurityForm orgSlug={orgSlug} currentEmail={user.email ?? ''} />
          </CardContent>
        </Card>

        {/* ---- Données & conformité ---- */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Données & conformité</CardTitle>
            </CardHeader>
            <CardContent>
              <DangerZone orgSlug={orgSlug} orgName={org.name} isOwner={role === 'owner'} />
            </CardContent>
          </Card>
        )}

        {/* ---- Organisation ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Organisation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isAdmin ? (
              <OrgNameForm orgSlug={orgSlug} initialName={org.name} />
            ) : (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Nom</span>
                <span className="font-medium">{org.name}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Identifiant (URL)</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{org.slug}</code>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Créée le</span>
              <span>{formatDate(org.created_at)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Membres</span>
              <Link
                href={`/${orgSlug}/members`}
                className="font-medium text-primary hover:underline"
              >
                {memberCount} membre{memberCount > 1 ? 's' : ''}
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">
              L’identifiant sert dans les URL et ne peut pas être modifié.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ---- Accès rapides ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accès rapides</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map(({ key, label, icon: Icon, desc }) => (
            <Link
              key={key}
              href={`/${orgSlug}/${key}`}
              className="group flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
            >
              <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground group-hover:text-foreground" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center justify-between text-sm font-medium">
                  {label}
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* ---- Journal d'audit (owner/admin) ---- */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="size-4 text-muted-foreground" />
              Journal d’audit
              <span className="text-xs font-normal text-muted-foreground">
                — 30 dernières actions sensibles
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {auditLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune action tracée pour l’instant.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Par</TableHead>
                    <TableHead>Élément</TableHead>
                    <TableHead className="text-right">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.map((log) => {
                    const href = auditEntityHref(orgSlug, log)
                    const detail = auditDetail(log)
                    return (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm">
                          {AUDIT_LABELS[log.action] ?? (
                            <code className="text-xs">{log.action}</code>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {log.actor?.full_name ?? 'Système'}
                        </TableCell>
                        <TableCell className="min-w-0 text-sm text-muted-foreground">
                          {href ? (
                            <Link
                              href={href}
                              className="hover:text-foreground hover:underline"
                            >
                              {detail ?? (log.entity_type ?? '—')}
                            </Link>
                          ) : (
                            <span className="truncate">{detail ?? (log.entity_type ?? '—')}</span>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-right text-sm text-muted-foreground"
                          title={formatDate(log.created_at)}
                        >
                          {formatRelative(log.created_at)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
