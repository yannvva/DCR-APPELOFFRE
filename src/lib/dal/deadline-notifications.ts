import 'server-only'

import { notifyUsers } from '@/lib/dal/notifications'
import { sendEmail, deadlineEmailHtml } from '@/lib/email'
import { getEnv } from '@/env'
import { daysUntil, formatDate } from '@/lib/format'
import type { requireMembership } from '@/lib/dal/auth'

type DalContext = NonNullable<Awaited<ReturnType<typeof requireMembership>>>

/**
 * Rappels d'échéance pour l'utilisateur courant (J-7 / J-3 / J-0 / dépassée)
 * sur les AO ouverts dont il est responsable. Idempotent : `notifyUsers`
 * déduplique les notifications non lues identiques. L'email (si provider
 * configuré) n'est envoyé que lorsqu'une notification vient d'être créée —
 * jamais à chaque chargement de page. Appelé au chargement du tableau de bord.
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
  for (const t of tenders) {
    const deadline = t.response_deadline as string
    const days = daysUntil(deadline)
    let label: string | null = null
    if (days < 0) label = 'dépassée'
    else if (days === 0) label = "aujourd'hui"
    else if (days <= 3) label = `dans ${days} jour${days > 1 ? 's' : ''}`
    else if (days <= 7) label = `dans ${days} jours`
    if (!label) continue

    const created = await notifyUsers({
      organizationId: ctx.org.id,
      userIds: [ctx.user.id],
      type: 'tender_deadline',
      title: `Échéance ${label} — ${t.title}`,
      body: `Date limite de remise : ${formatDate(deadline)}`,
      entityType: 'tender',
      entityId: t.id as string,
    })

    if (created > 0 && email) {
      await sendEmail({
        to: email,
        subject: `Échéance proche — ${t.title}`,
        html: deadlineEmailHtml({
          tenderTitle: t.title as string,
          deadline: formatDate(deadline),
          tenderUrl: `${getEnv().APP_URL}/tenders/${t.id}`,
        }),
      })
    }
  }
}
