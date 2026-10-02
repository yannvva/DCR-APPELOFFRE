import 'server-only'

import { getEnv } from '@/env'

/**
 * Envoi d'emails transactionnels via l'API REST Resend (aucune dépendance).
 * Optionnel : si RESEND_API_KEY / EMAIL_FROM ne sont pas configurés,
 * `sendEmail` renvoie false et l'appelant garde son repli manuel
 * (ex. lien d'invitation affiché à copier).
 */
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}): Promise<boolean> {
  const { RESEND_API_KEY, EMAIL_FROM } = getEnv()
  if (!RESEND_API_KEY || !EMAIL_FROM) return false

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function inviteEmailHtml({
  orgName,
  inviteUrl,
  role,
}: {
  orgName: string
  inviteUrl: string
  role: string
}) {
  return `<div style="font-family:sans-serif;max-width:480px;margin:auto">
  <h2>Invitation à rejoindre ${esc(orgName)}</h2>
  <p>Vous avez été invité(e) à rejoindre l'organisation <strong>${esc(orgName)}</strong> sur Nexus (rôle : ${esc(role)}).</p>
  <p style="margin:24px 0"><a href="${esc(inviteUrl)}" style="background:#111;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Accepter l'invitation</a></p>
  <p style="color:#666;font-size:12px">Ce lien expire dans 7 jours. Si vous n'attendiez pas cette invitation, ignorez cet email.</p>
</div>`
}

export function deadlineEmailHtml({
  tenderTitle,
  deadline,
  tenderUrl,
}: {
  tenderTitle: string
  deadline: string
  tenderUrl: string
}) {
  return `<div style="font-family:sans-serif;max-width:480px;margin:auto">
  <h2>Échéance proche — ${esc(tenderTitle)}</h2>
  <p>La date limite de remise de l'offre <strong>${esc(tenderTitle)}</strong> est le <strong>${esc(deadline)}</strong>.</p>
  <p style="margin:24px 0"><a href="${esc(tenderUrl)}" style="background:#111;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Ouvrir le dossier</a></p>
</div>`
}
