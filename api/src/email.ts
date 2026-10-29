import type { Env } from './env';

/**
 * Outgoing e-mail (account created / password set) through the Resend HTTP API - the only thing a Worker needs is an API key.
 *   RESEND_API_KEY  Worker secret:  npx wrangler secret put RESEND_API_KEY     (Resend -> API Keys; the sending domain must be verified there)
 *   MAIL_FROM       wrangler.toml [vars], e.g. "Eduport Lead Touch <noreply@eduport.ai>"
 * Without the key nothing is sent: mailConfigured() is false and the Access page says so; the admin still sees the password on screen.
 */
export interface Mail { to: string; subject: string; text: string; html?: string }

export function mailConfigured(env: Env): boolean { return !!env.RESEND_API_KEY && !!env.MAIL_FROM; }

export async function sendMail(env: Env, m: Mail): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!mailConfigured(env)) return { ok: false, error: 'E-mail is not configured (RESEND_API_KEY / MAIL_FROM)' };
  try {
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
