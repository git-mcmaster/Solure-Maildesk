import { HttpError, json } from './http';
import { mailboxGraphFetch, mailboxStatus } from './mailbox';
import type { Env } from './types';

interface Header { name: string; value: string }
interface Message {
  id: string; from?: { emailAddress?: { address?: string } }; isDraft?: boolean;
  internetMessageHeaders?: Header[];
}
interface SentReference { id: string; recipient: string; message_id: string; submitted_at: string }
interface SignalState {
  last_checked_at: string | null; scan_from: string | null; scan_until: string | null;
  next_link: string | null; lease_token: string | null; last_error: string | null;
}
export interface RecipientStop {
  recipient: string; kind: 'reply' | 'bounce' | 'review'; createdAt: string; message: string;
}
export interface MailboxSignalsStatus {
  lastCheckedAt: string | null; checking: boolean; lastError: string | null; holds: RecipientStop[];
  notices: { createdAt: string; message: string }[];
}

const note = {
  reply: 'A reply was received. Further automatic outreach is paused for this address; review the conversation.',
  bounce: 'A matching delivery-failure report was received. Further automatic outreach is paused for this address.',
  review: 'A response refers to outgoing outreach and needs review. Further automatic outreach is paused for this address.',
} as const;

function headers(message: Message): Map<string, string> {
  const result = new Map<string, string>();
  for (const field of message.internetMessageHeaders ?? []) {
    if (typeof field?.name !== 'string' || typeof field.value !== 'string') continue;
    const key = field.name.toLowerCase();
    result.set(key, `${result.get(key) ?? ''} ${field.value.replace(/\r?\n[ \t]+/gu, ' ')}`.trim());
  }
  return result;
}
function references(value: string): Set<string> { return new Set(value.match(/<[^<>\s]{1,500}>/gu) ?? []); }

/** A subject line or a sender name alone is never enough to classify a reply. */
export function matchedReply(message: Message, sent: SentReference[], owner: string): { delivery: SentReference; kind: 'reply' | 'review'; related?: SentReference[] } | null {
  const from = message.from?.emailAddress?.address?.trim().toLowerCase();
  if (!from || from === owner.toLowerCase() || message.isDraft || !Array.isArray(message.internetMessageHeaders)) return null;
  const fields = headers(message);
  const directIds = references(fields.get('in-reply-to') ?? '');
  const direct = sent.filter(row => directIds.has(row.message_id));
  const ids = references(fields.get('references') ?? '');
  // A direct reply target takes precedence over older forwarded history.
  const candidates = direct.length ? direct : sent.filter(row => ids.has(row.message_id));
  if (!candidates.length) return null;
  const unique = [...new Map(candidates.map(row => [row.recipient, row])).values()];
  if (unique.length > 1) return { delivery: unique[0]!, related: unique.slice(1), kind: 'review' };
  return { delivery: candidates[0]!, kind: from === candidates[0]!.recipient ? 'reply' : 'review' };
}

/** Parse only a bounded DSN status part, not quoted prose or its subject. */
export function matchedBounce(mime: string, sent: SentReference[]): SentReference | null {
  if (new TextEncoder().encode(mime).length > 262_144) return null;
  const top = mime.split(/\r?\n\r?\n/u, 1)[0]!.replace(/\r?\n[ \t]+/gu, ' ');
  if (!/^Content-Type:\s*multipart\/report\b[^\r\n]*\breport-type\s*=\s*"?delivery-status"?/imu.test(top)) return null;
  const match = /(?:^|\r?\n)Content-Type:\s*message\/delivery-status\b[^\r\n]*(?:\r?\n[^\r\n]+)*\r?\n\r?\n([\s\S]*?)(?=\r?\n--[^\r\n]+(?:\r?\n|$)|$)/iu.exec(mime);
  if (!match) return null;
  const status = match[1]!.replace(/\r?\n[ \t]+/gu, ' ');
  // Require a concrete failed recipient AND an exact outgoing message identity.
  const ids = new Set([...status.matchAll(/^Original-Message-ID:\s*(<[^<>\s]{1,500}>)/gimu)].map(value => value[1]!));
  // Original message identities may also be in a structured attached header
  // part. Never scan explanatory text or the attached message's quoted body.
  for (const original of mime.matchAll(/(?:^|\r?\n)Content-Type:\s*(?:message\/rfc822|text\/rfc822-headers)\b[^\r\n]*(?:\r?\n[^\r\n]+)*\r?\n\r?\n([\s\S]*?)(?=\r?\n\r?\n|\r?\n--[^\r\n]+|$)/giu)) {
    for (const field of original[1]!.replace(/\r?\n[ \t]+/gu, ' ').matchAll(/^Message-ID:\s*(<[^<>\s]{1,500}>)/gimu)) ids.add(field[1]!);
  }
  for (const block of status.split(/\r?\n\r?\n/u)) {
    if (!/^Action:\s*failed\s*$/imu.test(block) || !/^Status:\s*5\.\d{1,3}\.\d{1,3}\s*$/imu.test(block)) continue;
    const recipient = /^Final-Recipient:\s*rfc822;\s*([^\s<>;]+@[^\s<>;]+)\s*$/imu.exec(block)?.[1]?.toLowerCase();
    const candidates = sent.filter(row => row.recipient === recipient && ids.has(row.message_id));
    if (candidates.length === 1) return candidates[0]!;
  }
  return null;
}

async function boundedText(response: Response): Promise<string> {
  if (!response.ok) throw new Error('Mailbox check did not complete');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Mailbox response unavailable');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 262_144) { await reader.cancel(); throw new Error('Mailbox response exceeds the check limit'); }
    chunks.push(value);
  }
  const all = new Uint8Array(size); let offset = 0;
  for (const value of chunks) { all.set(value, offset); offset += value.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(all);
}

async function reportPrefix(response: Response): Promise<string> {
  if (!response.ok || !response.body) throw new Error('Delivery report unavailable');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  while (size < 262_144) {
    const { value, done } = await reader.read(); if (done) break;
    const part = value.subarray(0, 262_144 - size);
    chunks.push(part); size += part.length;
    if (part.length !== value.length || size === 262_144) { await reader.cancel(); break; }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  // A large unrelated attachment must not poison the cursor forever. Only a
  // bounded structured prefix is inspected; unmatched reports get a notice.
  return new TextDecoder().decode(bytes);
}

async function saveStops(env: Env, deliveries: SentReference[], kind: RecipientStop['kind'], sourceId: string, now: string) {
  await env.DB.prepare(`INSERT OR IGNORE INTO outreach_recipient_stops
    (recipient,kind,created_at,source_message_id,delivery_id,message)
    SELECT json_extract(value,'$.recipient'),?,?,?,json_extract(value,'$.id'),? FROM json_each(?)`)
    .bind(kind, now, sourceId, note[kind], JSON.stringify(deliveries.map(({ recipient, id }) => ({ recipient, id })))).run();
}

/** All-folder bounded polling handles mail moved by Outlook's server-side rules. */
export async function runMailboxSignals(env: Env, time = new Date()): Promise<boolean> {
  const started = Date.now();
  const leaseTime = () => new Date(time.getTime() + Math.max(0, Date.now() - started)).toISOString();
  if (env.OUTREACH_SENDING_ENABLED !== 'true') return true;
  const mailbox = await mailboxStatus(env);
  if (!mailbox.connected) return false;
  const paused = await env.DB.prepare('SELECT paused FROM outreach_automation_settings WHERE id=1').first<number>('paused');
  if (paused === 1) return false;
  const now = time.toISOString(), lease = crypto.randomUUID();
  const claim = await env.DB.prepare(`UPDATE outreach_signal_state SET lease_token=?,lease_until=?
    WHERE id=1 AND (lease_until IS NULL OR lease_until<?)`)
    .bind(lease, new Date(time.getTime() + 120_000).toISOString(), now).run();
  if (claim.meta.changes !== 1) return false;
  try {
    const state = await env.DB.prepare('SELECT * FROM outreach_signal_state WHERE id=1 AND lease_token=?').bind(lease).first<SignalState>();
    if (!state) return false;
    const sent = (await env.DB.prepare(`SELECT id,recipient,message_id,submitted_at FROM outreach_deliveries
      WHERE submitted_at IS NOT NULL AND state IN ('submitting','accepted','sent','needs_attention')
      ORDER BY submitted_at DESC LIMIT 500`).all<SentReference>()).results;
    if (!sent.length) {
      const finished = await env.DB.prepare('UPDATE outreach_signal_state SET last_checked_at=?,last_error=NULL,lease_token=NULL,lease_until=NULL WHERE id=1 AND lease_token=? AND lease_until>?').bind(now, lease, leaseTime()).run();
      return finished.meta.changes === 1;
    }
    const earliest = Math.min(...sent.map(row => Date.parse(row.submitted_at)));
    const from = state.scan_from ?? new Date(Math.max(time.getTime() - 30 * 86400_000, Date.parse(state.last_checked_at ?? new Date(earliest).toISOString()) - 120_000)).toISOString();
    const until = state.scan_until ?? now;
    const query = new URLSearchParams({ '$filter': `receivedDateTime ge ${from} and receivedDateTime le ${until}`, '$orderby': 'receivedDateTime asc', '$top': '2', '$select': 'id,from,isDraft,internetMessageHeaders' });
    const response = await mailboxGraphFetch(env, state.next_link ?? `/me/messages?${query}`);
    const page = JSON.parse(await boundedText(response)) as { value?: Message[]; '@odata.nextLink'?: string };
    if (!Array.isArray(page.value) || page.value.length > 2) throw new Error('Mailbox check did not return a bounded message page');
    for (const message of page.value) {
      if (typeof message?.id !== 'string' || message.id.length > 1500) throw new Error('Mailbox message identity unavailable');
      const fields = headers(message);
      if (/\bmultipart\/report\b.*\breport-type\s*=\s*"?delivery-status/iu.test(fields.get('content-type') ?? '')) {
        const mime = await reportPrefix(await mailboxGraphFetch(env, `/me/messages/${encodeURIComponent(message.id)}/$value`));
        const delivery = matchedBounce(mime, sent);
        if (delivery) await saveStops(env, [delivery], 'bounce', message.id, now);
        else await env.DB.prepare(`INSERT OR IGNORE INTO outreach_signal_notices(source_message_id,created_at,message) VALUES(?,?,?)`)
          .bind(message.id, now, 'A delivery report could not be linked to a Maildesk message. Review it in Outlook; no recipient was marked as a confirmed failure.').run();
      } else {
        const match = matchedReply(message, sent, env.OWNER_EMAIL);
        if (match) await saveStops(env, [match.delivery, ...match.related ?? []], match.kind, message.id, now);
      }
    }
    const next = page['@odata.nextLink'] ?? null;
    if (next && (typeof next !== 'string' || !next.startsWith('https://graph.microsoft.com/v1.0/me/messages?') || next.length > 16_384)) throw new Error('Mailbox continuation unavailable');
    const finished = await env.DB.prepare(`UPDATE outreach_signal_state SET last_checked_at=?,scan_from=?,scan_until=?,next_link=?,
      last_error=NULL,lease_token=NULL,lease_until=NULL WHERE id=1 AND lease_token=? AND lease_until>?`)
      .bind(next ? state.last_checked_at : until, next ? from : null, next ? until : null, next, lease, leaseTime()).run();
    return finished.meta.changes === 1 && !next;
  } catch {
    // A failed inbound check must not silently permit further automatic outreach.
    await env.DB.prepare(`UPDATE outreach_signal_state SET last_error='Mailbox checks are unavailable. Scheduled sending is held until a check succeeds; reconnect if requested.',lease_token=NULL,lease_until=NULL WHERE id=1 AND lease_token=?`).bind(lease).run();
    return false;
  }
}

export async function mailboxSignalsStatus(env: Env): Promise<MailboxSignalsStatus> {
  const state = await env.DB.prepare('SELECT * FROM outreach_signal_state WHERE id=1').first<SignalState>();
  const rows = await env.DB.prepare('SELECT recipient,kind,created_at,message FROM outreach_recipient_stops ORDER BY created_at DESC LIMIT 100').all<{ recipient: string; kind: RecipientStop['kind']; created_at: string; message: string }>();
  const notices = await env.DB.prepare('SELECT created_at,message FROM outreach_signal_notices ORDER BY created_at DESC LIMIT 20').all<{ created_at: string; message: string }>();
  return { lastCheckedAt: state?.last_checked_at ?? null, checking: !!state?.next_link, lastError: state?.last_error ?? null,
    holds: rows.results.map(row => ({ recipient: row.recipient, kind: row.kind, createdAt: row.created_at, message: row.message })),
    notices: notices.results.map(row => ({ createdAt: row.created_at, message: row.message })) };
}

export async function mailboxSignalsApi(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/automation/signals') return null;
  if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'These mailbox checks are read-only.');
  return json(await mailboxSignalsStatus(env));
}
