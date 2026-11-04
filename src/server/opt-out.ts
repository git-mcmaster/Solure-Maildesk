import { HttpError, stringField } from './http';
import type { DoNotContactEntry, DoNotContactPage, Env, OptOutLink } from './types';

export function normalizedRecipient(value: unknown): string {
  const recipient = stringField(value, 'Recipient', 254).toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(recipient)
    || recipient.startsWith('.') || recipient.includes('..') || recipient.includes('.@')) {
    throw new HttpError(400, 'INVALID_RECIPIENT', 'Enter one complete email address.');
  }
  // Do not remove plus tags or dots: different providers can treat them as
  // distinct addresses. Only trimming and case folding are shared with SQL.
  return recipient;
}

export async function isDoNotContact(env: Env, recipient: string): Promise<boolean> {
  if (!recipient.trim()) return false;
  return !!await env.DB.prepare('SELECT 1 FROM do_not_contact WHERE recipient=lower(trim(?))').bind(recipient).first();
}

function entry(row: { recipient: string; created_at: string; source: DoNotContactEntry['source'] }): DoNotContactEntry {
  return { recipient: row.recipient, createdAt: row.created_at, source: row.source };
}

export async function addDoNotContact(env: Env, value: unknown): Promise<DoNotContactEntry> {
  const recipient = normalizedRecipient(value);
  await env.DB.prepare("INSERT OR IGNORE INTO do_not_contact (recipient,created_at,source) VALUES (?,?,'owner')")
    .bind(recipient, new Date().toISOString()).run();
  const row = await env.DB.prepare('SELECT recipient,created_at,source FROM do_not_contact WHERE recipient=?')
    .bind(recipient).first<{ recipient: string; created_at: string; source: DoNotContactEntry['source'] }>();
  if (!row) throw new Error('Opt-out preference was not saved');
  return entry(row);
}

export async function listDoNotContact(env: Env, params: URLSearchParams): Promise<DoNotContactPage> {
  for (const key of params.keys()) if (!['q', 'offset', 'limit'].includes(key) || params.getAll(key).length !== 1) throw new HttpError(400, 'INVALID_QUERY', 'Choose a valid search and page.');
  const q = params.get('q') ?? '';
  const limitText = params.get('limit') ?? '100';
  const offsetText = params.get('offset') ?? '0';
  if (q.length > 254 || !/^[1-9][0-9]{0,2}$/u.test(limitText) || Number(limitText) > 200
    || !/^(?:0|[1-9][0-9]{0,6})$/u.test(offsetText)) throw new HttpError(400, 'INVALID_QUERY', 'Choose a valid search and page.');
  const limit = Number(limitText);
  const offset = Number(offsetText);
  const [rows, count] = await Promise.all([
    env.DB.prepare('SELECT recipient,created_at,source FROM do_not_contact WHERE instr(recipient,?)>0 ORDER BY created_at DESC,recipient LIMIT ? OFFSET ?')
      .bind(q.trim().toLowerCase(), limit, offset).all<{ recipient: string; created_at: string; source: DoNotContactEntry['source'] }>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM do_not_contact WHERE instr(recipient,?)>0').bind(q.trim().toLowerCase()).first<{ count: number }>(),
  ]);
  const total = count?.count ?? 0;
  return { items: rows.results.map(entry), total, offset, hasMore: offset + rows.results.length < total };
}

export async function getOrCreateOptOutLink(env: Env, pixelId: string, rawRecipient: string): Promise<OptOutLink> {
  const recipient = normalizedRecipient(rawRecipient);
  if (await isDoNotContact(env, recipient)) throw new HttpError(409, 'DO_NOT_CONTACT', 'This address has opted out. Do not send further sales emails.');
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  // The recipient in the INSERT is read from the current row, not a stale API
  // read. An edit/delete race cannot bind a fresh link to an unintended address.
  await env.DB.prepare(`INSERT OR IGNORE INTO opt_out_links (token,pixel_id,recipient,created_at)
    SELECT ?,p.id,lower(trim(p.recipient)),? FROM pixels p WHERE p.id=? AND lower(trim(p.recipient))=?
      AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=lower(trim(p.recipient)))`)
    .bind(token, new Date().toISOString(), pixelId, recipient).run();
  const row = await env.DB.prepare(`SELECT l.token,l.recipient FROM opt_out_links l JOIN pixels p ON p.id=l.pixel_id
    WHERE l.pixel_id=? AND l.recipient=? AND l.recipient=lower(trim(p.recipient))
      AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=l.recipient)`).bind(pixelId, recipient)
    .first<{ token: string; recipient: string }>();
  if (!row) throw new HttpError(409, 'RECIPIENT_CHANGED', 'The recipient changed or opted out. Refresh this message before creating a link.');
  return { url: `${env.PIXEL_ORIGIN.replace(/\/$/u, '')}/outreach/stop/${row.token}`, recipient: row.recipient };
}

const publicHeaders = {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store',
  // Native form navigation needs its real Origin. "no-referrer" makes that
  // header null in browsers; same-origin still omits referrers to other sites.
  'Cloudflare-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function page(title: string, body: string, status = 200, head = false): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Solure Digital Works</title><style>body{margin:0;background:#f5f6f8;color:#17212b;font-family:system-ui,-apple-system,sans-serif;line-height:1.6}main{max-width:32rem;margin:12vh auto;padding:2rem;background:white;border:1px solid #e0e4e9;border-radius:16px}h1{font-size:1.7rem;line-height:1.25}p{overflow-wrap:anywhere}.brand{font-weight:750;color:#526171}button{font:inherit;font-weight:650;color:white;background:#17212b;border:0;border-radius:8px;padding:.8rem 1.2rem;cursor:pointer;min-height:48px}button:focus-visible{outline:3px solid #ff6b20;outline-offset:4px}.note{color:#526171;font-size:.9rem}@media(max-width:600px){main{margin:2rem 1rem;padding:1.5rem}}</style></head><body><main><p class="brand">Solure Digital Works</p><h1>${title}</h1>${body}</main></body></html>`;
  return new Response(head ? null : html, { status, headers: publicHeaders });
}

async function readConfirmation(request: Request): Promise<boolean> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded') return false;
  const reader = request.body?.getReader();
  if (!reader) return false;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > 256) { await reader.cancel(); return false; }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  return [...form.keys()].length === 1 && form.getAll('confirm').length === 1 && form.get('confirm') === 'stop';
}

/** Public recipient page only. Reading a link never creates an event or opt-out. */
export async function fetchOptOut(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/outreach\/stop\/([a-f0-9]{64})$/u.exec(url.pathname);
  if (!match) return page('Link unavailable', '<p>This preference link is unavailable. You can reply to the original email to request no further sales emails.</p>', 404, request.method === 'HEAD');
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
    const response = page('Action unavailable', '<p>Open the link from your email to manage your preference.</p>', 405);
    response.headers.set('Allow', 'GET, HEAD, POST');
    return response;
  }
  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site' || !await readConfirmation(request)) {
      return page('Preference not changed', '<p>No preference was changed. Open the link in your browser and press the confirmation button.</p>', 403);
    }
  }
  try {
    const link = await env.DB.prepare('SELECT 1 FROM opt_out_links WHERE token=?').bind(match[1]).first();
    if (!link) return page('Link unavailable', '<p>This preference link is unavailable. You can reply to the original email to request no further sales emails.</p>', 404, request.method === 'HEAD');
    if (request.method === 'POST') {
      await env.DB.prepare(`INSERT OR IGNORE INTO do_not_contact (recipient,created_at,source)
        SELECT recipient,?,'recipient' FROM opt_out_links WHERE token=?`).bind(new Date().toISOString(), match[1]).run();
      return page('Your preference has been saved', '<p>The address associated with this link is on Solure’s do-not-contact list for sales emails.</p><p class="note">You can close this page. No confirmation email will be sent.</p>');
    }
    return page('Stop outreach emails', '<p>To stop future sales emails from Solure for the address associated with this link, press the button below.</p><p class="note">Simply visiting this page does not change your preference.</p><form method="post"><button type="submit" name="confirm" value="stop">Stop outreach emails</button></form>', 200, request.method === 'HEAD');
  } catch {
    console.error('Opt-out request failed');
    return page('Preference not changed', '<p>We could not save your preference. Please try again, or reply to the original email to request no further sales emails.</p>', 503, request.method === 'HEAD');
  }
}
