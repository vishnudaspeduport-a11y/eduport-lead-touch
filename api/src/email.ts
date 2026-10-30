import { WorkerMailer } from 'worker-mailer';
import type { Env } from './env';

/**
 * Outgoing e-mail (account created / password set). Two transports, picked from the Worker's configuration:
 *   1. SMTP (Gmail / Google Workspace mailbox, no DNS work):  secrets SMTP_USER (the mailbox, e.g. bi_team@eduport.ai) and SMTP_PASS
 *      (a Google App Password - needs 2-Step Verification on that account); vars SMTP_HOST (smtp.gmail.com) and SMTP_PORT (465).
 *      Mail is sent from that mailbox; MAIL_FROM_NAME is the display name. Workers reach the SMTP server over a TCP socket (worker-mailer).
 *   2. Resend HTTP API:  secret RESEND_API_KEY + MAIL_FROM ("Name <addr@verified-domain>"), the domain verified in Resend.
 * With neither configured nothing is sent: mailConfigured() is false, the Access page says so and the admin shares the password by hand.
 */
export interface Mail { to: string; subject: string; text: string; html?: string }
export type Transport = 'smtp' | 'resend' | null;

export function mailTransport(env: Env): Transport {
  if (env.SMTP_USER && env.SMTP_PASS) return 'smtp';
  if (env.RESEND_API_KEY && env.MAIL_FROM) return 'resend';
  return null;
}
export function mailConfigured(env: Env): boolean { return mailTransport(env) !== null; }
/** the sender as shown to the recipient */
export function mailFrom(env: Env): string | null {
  const t = mailTransport(env);
  if (t === 'smtp') return `${env.MAIL_FROM_NAME || 'Eduport Lead Touch'} <${env.SMTP_USER}>`;
  if (t === 'resend') return env.MAIL_FROM ?? null;
  return null;
}

export async function sendMail(env: Env, m: Mail): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = mailTransport(env);
  if (!t) return { ok: false, error: 'E-mail is not configured (SMTP_USER / SMTP_PASS, or RESEND_API_KEY / MAIL_FROM)' };
  try {
    if (t === 'smtp') {
      const port = Number(env.SMTP_PORT ?? 465) || 465;
      await WorkerMailer.send(
        { host: env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465, startTls: port !== 465,
          credentials: { username: env.SMTP_USER!, password: env.SMTP_PASS! }, authType: ['plain', 'login'], socketTimeoutMs: 20000, responseTimeoutMs: 20000 },
        { from: { name: env.MAIL_FROM_NAME || 'Eduport Lead Touch', email: env.SMTP_USER! }, to: m.to, subject: m.subject, text: m.text, html: m.html },
      );
      return { ok: true };
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { message?: string; name?: string };
    return { ok: false, error: `${res.status} ${body.message ?? body.name ?? res.statusText}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** The account e-mail: login link, e-mail address and password, for a new account or a password set by an admin */
export function accountMail(o: { to: string; name: string; password: string; origin: string; kind: 'new' | 'reset'; by: string }): Mail {
  const hello = o.name ? `Hi ${o.name},` : 'Hi,';
  const intro = o.kind === 'new'
    ? `An account has been created for you on the Eduport Lead Touch dashboard by ${o.by}.`
    : `Your password for the Eduport Lead Touch dashboard has been reset by ${o.by}.`;
  const text = [
    hello, '', intro, '',
    `Dashboard: ${o.origin}`, `Login e-mail: ${o.to}`, `Password: ${o.password}`, '',
    'Please sign in and change the password from the menu at the top right (your name -> Change password).',
    'If you did not expect this e-mail, reply to let us know.',
  ].join('\n');
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.5">
  <p>${esc(hello)}</p><p>${esc(intro)}</p>
  <table style="border-collapse:collapse;margin:12px 0">
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Dashboard</td><td style="padding:4px 0"><a href="${esc(o.origin)}">${esc(o.origin)}</a></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Login e-mail</td><td style="padding:4px 0">${esc(o.to)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Password</td><td style="padding:4px 0"><code style="font-size:15px;background:#f3f4f6;padding:2px 6px;border-radius:4px">${esc(o.password)}</code></td></tr>
  </table>
  <p>Please sign in and change the password from the menu at the top right (your name &rarr; Change password).</p>
  <p style="color:#6b7280">If you did not expect this e-mail, reply to let us know.</p>
</div>`;
  return { to: o.to, subject: o.kind === 'new' ? 'Your Eduport Lead Touch dashboard account' : 'Your Eduport Lead Touch dashboard password was reset', text, html };
}
