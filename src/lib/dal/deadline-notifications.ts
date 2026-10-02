import 'server-only'

import { notifyUsers } from '@/lib/dal/notifications'
import { sendEmail, deadlineEmailHtml } from '@/lib/email'
import { getEnv } from '@/env'
import { daysUntil, formatDate } from '@/lib/format'
import { tenderPath } from '@/lib/slug'
import type { requireMembership } from '@/lib/dal/auth'

type DalContext = NonNullable<Awaited<ReturnType<typeof requireMembership>>>

/**
 * Rappels d'échéance pour l'utilisateur courant (J-7 / J-3 / J-0 / dépassée)
 * sur les AO ouverts dont il est responsable. Idempotent : `notifyUsers`
 * déduplique — y compris sur une notification déjà lue créée dans les
 * dernières 20 h, sinon un rappel marqué lu reviendrait à chaque chargement.
 * L'email (si provider configuré) n'est envoyé que lorsqu'une notification
 * vient d'être créée — jamais à chaque chargement de page. Appelé au
 * chargement du tableau de bord : les AO sont traités en parallèle pour ne
 * pas empiler les allers-retours réseau avant le rendu.
 */
export async function syncDeadlineNotifications(ctx: DalContext): Promise<void> {
  const { data: tenders } = await ctx.supabase
    .from('tenders')
    .select('id, title, response_deadline')
    .eq('organization_id', ctx.org.id)
    .eq('responsible_id', ctx.user.id)
    .not('response_deadline', 'is', null)
    .not('status', 'in', '(depose,gagne,perdu,abandonne,annule)')

  if (!tenders?.length) return

  const email = ctx.user.email
  const appUrl = getEnv().APP_URL.replace(/\/$/, '')

  await Promise.all(
    tenders.map(async (t) => {
      const deadline = t.response_deadline as string
      const days = daysUntil(deadline)
      let label: string | null = null
      if (days < 0) label = 'dépassée'
      else if (days === 0) label = "aujourd'hui"
      else if (days <= 3) label = `dans ${days} jour${days > 1 ? 's' : ''}`
      else if (days <= 7) label = `dans ${days} jours`
      if (!label) return

      const created = await notifyUsers({
        organizationId: ctx.org.id,
        userIds: [ctx.user.id],
        type: 'tender_deadline',
        title: `Échéance ${label} — ${t.title}`,
        body: `Date limite de remise : ${formatDate(deadline)}`,
        entityType: 'tender',
        entityId: t.id as string,
        // Un rappel relu ne doit pas être recréé au prochain chargement.
        dedupeWindowHours: 20,
      })

      if (created > 0 && email) {
        // Chemin canonique du dossier (`/<org>/tenders/<slug-uuid>`) : un
        // lien sans slug d'organisation renvoie une 404.
        const tenderUrl = `${appUrl}${tenderPath(ctx.org.slug, {
          id: t.id as string,
          title: (t.title as string) ?? '',
        })}`
        await sendEmail({
          to: email,
          subject: `Échéance proche — ${t.title}`,
          html: deadlineEmailHtml({
            tenderTitle: t.title as string,
            deadline: formatDate(deadline),
            tenderUrl,
          }),
        })
      }
    }),
  )
}
