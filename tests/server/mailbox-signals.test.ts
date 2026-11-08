import { readFile, readdir } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import type { Env } from '../../src/server/types';

const mailbox = vi.hoisted(() => ({ graph: vi.fn(), status: vi.fn() }));
vi.mock('../../src/server/mailbox', () => ({ mailboxGraphFetch: mailbox.graph, mailboxStatus: mailbox.status }));
import { matchedBounce, matchedReply, mailboxSignalsStatus, runMailboxSignals } from '../../src/server/mailbox-signals';

const now = new Date('2026-11-08T17:00:00.000Z');
const submitted = '2026-11-08T16:50:00.000Z';
const originalId = '<original-message@example.test>';
const reference = { id: 'original-delivery', recipient: 'recipient@example.test', message_id: originalId, submitted_at: submitted };
const reply = { id: 'incoming-reply', from: { emailAddress: { address: reference.recipient } }, internetMessageHeaders: [{ name: 'In-Reply-To', value: originalId }] };
const bounce = `From: postmaster@example.test\r\nContent-Type: multipart/report; report-type=delivery-status; boundary="report"\r\nMessage-ID: <report@example.test>\r\n\r\n--report\r\nContent-Type: text/plain\r\n\r\nDelivery failed.\r\n--report\r\nContent-Type: message/delivery-status\r\n\r\nOriginal-Message-ID: ${originalId}\r\nReporting-MTA: dns; example.test\r\n\r\nFinal-Recipient: rfc822; ${reference.recipient}\r\nAction: failed\r\nStatus: 5.1.1\r\n\r\n--report--\r\n`;
let mf: Miniflare, env: Env;

beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("fixture"); } };', compatibilityDate: '2026-07-30', d1Databases: { DB: 'mailbox-signal-tests' } });
  const DB = await mf.getD1Database('DB') as unknown as D1Database;
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(new URL(name, migrations), 'utf8')).replace(/--[^\n]*/gu, '');
    const tail = sql.indexOf('CREATE TRIGGER');
    await DB.batch((tail < 0 ? sql : sql.slice(0, tail)).split(';').map(value => value.trim()).filter(Boolean).map(value => DB.prepare(value)));
    if (tail >= 0) await DB.prepare(sql.slice(tail)).run();
  }
  env = { DB, OWNER_EMAIL: 'owner@example.test', DASHBOARD_ORIGIN: 'http://127.0.0.1:8787', PIXEL_ORIGIN: 'https://pixel.example.test', DEV_AUTH: 'true', EMAIL_MODE: 'dry-run', OUTREACH_SENDING_ENABLED: 'true' };
}, 30_000);
beforeEach(async () => {
  mailbox.graph.mockReset(); mailbox.status.mockReset();
  mailbox.status.mockResolvedValue({ configured: true, connected: true, sendingEnabled: true, ownerEmail: env.OWNER_EMAIL, connectedEmail: env.OWNER_EMAIL, permissions: [], nativeUnsubscribeVerified: false, lastError: null });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM outreach_recipient_stops'), env.DB.prepare('DELETE FROM outreach_jobs'),
    env.DB.prepare('DELETE FROM outreach_signal_notices'),
    env.DB.prepare('UPDATE outreach_automation_settings SET paused=0 WHERE id=1'),
    env.DB.prepare('UPDATE outreach_signal_state SET last_checked_at=NULL,scan_from=NULL,scan_until=NULL,next_link=NULL,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=1'),
  ]);
});
afterAll(async () => { await mf?.dispose(); });

async function delivery(id = reference.id, state = 'accepted', messageId = originalId) {
  const job = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO outreach_jobs(id,label,recipient,subject,body,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(job, 'Synthetic signal test', reference.recipient, 'Subject', 'Owner copy', state === 'pending' ? 'scheduled' : 'tracking', submitted, submitted).run();
  await env.DB.prepare(`INSERT INTO outreach_deliveries(id,job_id,approved_version,recipient,label,subject,body_html,body_text,opt_out_url,message_id,state,send_at,time_zone,tracking_starts_at,queued_at,updated_at,submitted_at)
    VALUES(?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, job, reference.recipient, 'Synthetic signal test', 'Subject', '<p>Owner copy</p>', 'Owner copy', 'https://pixel.example.test/outreach/stop/' + 'a'.repeat(64), messageId, state, submitted, 'UTC', submitted, submitted, submitted, state === 'pending' ? null : submitted).run();
}
function page(value: unknown[], next?: string) { return new Response(JSON.stringify({ value, ...(next ? { '@odata.nextLink': next } : {}) }), { headers: { 'Content-Type': 'application/json' } }); }

describe('precise inbound correlation', () => {
  it('uses reply reference identity and sender address instead of a matching subject', () => {
    expect(matchedReply(reply, [reference], env.OWNER_EMAIL)).toEqual({ delivery: reference, kind: 'reply' });
    expect(matchedReply({ ...reply, internetMessageHeaders: [] }, [reference], env.OWNER_EMAIL)).toBeNull();
    expect(matchedReply({ ...reply, internetMessageHeaders: [{ name: 'Subject', value: 'Re: Subject' }] }, [reference], env.OWNER_EMAIL)).toBeNull();
    expect(matchedReply({ ...reply, from: { emailAddress: { address: env.OWNER_EMAIL } } }, [reference], env.OWNER_EMAIL)).toBeNull();
    expect(matchedReply({ ...reply, isDraft: true }, [reference], env.OWNER_EMAIL)).toBeNull();
  });
  it('prefers a direct reply target and holds all known recipients in an ambiguous reference chain', () => {
    expect(matchedReply({ ...reply, from: { emailAddress: { address: 'colleague@example.test' } } }, [reference], env.OWNER_EMAIL)?.kind).toBe('review');
    const other = { ...reference, id: 'other', recipient: 'other@example.test', message_id: '<other@example.test>' };
    expect(matchedReply({ ...reply, internetMessageHeaders: [...reply.internetMessageHeaders, { name: 'References', value: originalId + '\r\n <other@example.test>' }] }, [reference, other], env.OWNER_EMAIL)?.kind).toBe('reply');
    const ambiguous = matchedReply({ ...reply, internetMessageHeaders: [{ name: 'References', value: originalId + '\r\n <other@example.test>' }] }, [reference, other], env.OWNER_EMAIL);
    expect(ambiguous?.kind).toBe('review');
    expect([ambiguous?.delivery.recipient, ...ambiguous?.related?.map(row => row.recipient) ?? []].sort()).toEqual([reference.recipient, other.recipient].sort());
  });
  it('requires structured failed-recipient DSN status and exact original identity', () => {
    expect(matchedBounce(bounce, [reference])).toEqual(reference);
    expect(matchedBounce(bounce.replace('5.1.1', '4.1.1'), [reference])).toBeNull();
    expect(matchedBounce(bounce.replace('Action: failed', 'Action: delayed'), [reference])).toBeNull();
    expect(matchedBounce(bounce.replace(reference.recipient, 'other@example.test'), [reference])).toBeNull();
    expect(matchedBounce(bounce.replace(originalId, '<unknown@example.test>'), [reference])).toBeNull();
    const quoted = bounce.replace(originalId, '<unknown@example.test>').replace('Delivery failed.', `Delivery failed.\r\nMessage-ID: ${originalId}`);
    expect(matchedBounce(quoted, [reference])).toBeNull();
    const attached = bounce.replace(originalId, '<unknown@example.test>').replace('--report--', `--report\r\nContent-Type: message/rfc822\r\n\r\nMessage-ID: ${originalId}\r\nSubject: Original message\r\n\r\nBody\r\n--report--`);
    expect(matchedBounce(attached, [reference])).toEqual(reference);
    expect(matchedBounce('Subject: Delivery failed\r\n\r\nAction: failed\r\nStatus: 5.1.1', [reference])).toBeNull();
    expect(matchedBounce(bounce + 'x'.repeat(262_144), [reference])).toBeNull();
  });
});

describe('bounded automatic mailbox checks', () => {
  it('does nothing when sending is disabled and does not scan mail before any submission', async () => {
    expect(await runMailboxSignals({ ...env, OUTREACH_SENDING_ENABLED: 'false' }, now)).toBe(true);
    expect(mailbox.status).not.toHaveBeenCalled();
    expect(await runMailboxSignals(env, now)).toBe(true);
    expect(mailbox.graph).not.toHaveBeenCalled();
    expect((await mailboxSignalsStatus(env)).lastCheckedAt).toBe(now.toISOString());
  });
  it('scans across folders with metadata only, then pauses pending outreach after a precise reply', async () => {
    await delivery(); await delivery('follow-up', 'pending', '<follow-up@example.test>');
    mailbox.graph.mockResolvedValueOnce(page([reply]));
    expect(await runMailboxSignals(env, now)).toBe(true);
    const path = mailbox.graph.mock.calls[0]![1] as string;
    expect(path.startsWith('/me/messages?')).toBe(true);
    expect(path).not.toContain('/inbox/');
    const selected = new URL(path, 'https://graph.microsoft.com').searchParams.get('$select');
    expect(selected).toBe('id,from,isDraft,internetMessageHeaders');
    expect(await env.DB.prepare("SELECT state FROM outreach_deliveries WHERE id='follow-up'").first('state')).toBe('blocked');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM do_not_contact').first<number>('n')).toBe(0);
    expect((await mailboxSignalsStatus(env)).holds).toMatchObject([{ recipient: reference.recipient, kind: 'reply' }]);
  });
  it('reads MIME only for report candidates and holds a precisely matched failed recipient', async () => {
    await delivery();
    mailbox.graph.mockResolvedValueOnce(page([{ id: 'report', from: { emailAddress: { address: 'postmaster@example.test' } }, internetMessageHeaders: [{ name: 'Content-Type', value: 'multipart/report; report-type=delivery-status' }] }]))
      .mockResolvedValueOnce(new Response(bounce));
    expect(await runMailboxSignals(env, now)).toBe(true);
    expect(mailbox.graph.mock.calls[1]![1]).toBe('/me/messages/report/$value');
    expect((await mailboxSignalsStatus(env)).holds[0]?.kind).toBe('bounce');
  });
  it('bounds a two-report page and rejects an overfull provider page', async () => {
    await delivery();
    const report = (id: string) => ({ id, internetMessageHeaders: [{ name: 'Content-Type', value: 'multipart/report; report-type=delivery-status' }] });
    mailbox.graph.mockResolvedValueOnce(page([report('one'), report('two')]))
      .mockResolvedValueOnce(new Response(bounce)).mockResolvedValueOnce(new Response(bounce));
    expect(await runMailboxSignals(env, now)).toBe(true);
    expect(new URL(mailbox.graph.mock.calls[0]![1], 'https://graph.microsoft.com').searchParams.get('$top')).toBe('2');
    expect(mailbox.graph).toHaveBeenCalledTimes(3);
    mailbox.graph.mockResolvedValueOnce(page([reply, reply, reply]));
    expect(await runMailboxSignals(env, now)).toBe(false);
  });
  it('saves a large ambiguous reference chain atomically instead of one database call per recipient', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `chain-${i}`, job: `chain-job-${i}`, recipient: `chain-${i}@example.test`, message: `<chain-${i}@example.test>` }));
    const encoded = JSON.stringify(rows);
    await env.DB.prepare(`INSERT INTO outreach_jobs(id,label,recipient,subject,body,state,created_at,updated_at)
      SELECT json_extract(value,'$.job'),'Synthetic chain',json_extract(value,'$.recipient'),'Subject','Body','tracking',?,? FROM json_each(?)`).bind(submitted, submitted, encoded).run();
    await env.DB.prepare(`INSERT INTO outreach_deliveries(id,job_id,approved_version,recipient,label,subject,body_html,body_text,opt_out_url,message_id,state,send_at,time_zone,tracking_starts_at,queued_at,updated_at,submitted_at)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.job'),1,json_extract(value,'$.recipient'),'Synthetic chain','Subject','<p>Body</p>','Body',?,json_extract(value,'$.message'),'accepted',?,'UTC',?,?,?,? FROM json_each(?)`)
      .bind('https://pixel.example.test/outreach/stop/' + 'b'.repeat(64), submitted, submitted, submitted, submitted, submitted, encoded).run();
    mailbox.graph.mockResolvedValueOnce(page([{ ...reply, internetMessageHeaders: [{ name: 'References', value: rows.map(row => row.message).join(' ') }] }]));
    let calls = 0;
    const DB = { prepare(sql: string) {
      const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(target, key) {
        if (key === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
        const method = Reflect.get(target, key);
        if (['all', 'first', 'run', 'raw'].includes(String(key))) return (...args: unknown[]) => { calls++; return Reflect.apply(method, target, args); };
        return typeof method === 'function' ? method.bind(target) : method;
      } });
      return wrap(env.DB.prepare(sql));
    } } as unknown as D1Database;
    expect(await runMailboxSignals({ ...env, DB }, now)).toBe(true);
    expect(calls).toBe(6); // Microsoft wrapper overhead is covered in connected resource tests.
    expect(await env.DB.prepare('SELECT count(*) AS n FROM outreach_recipient_stops').first('n')).toBe(100);
  });
  it('preserves a continuation without sending past an unchecked backlog', async () => {
    await delivery();
    const next = 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=opaque';
    mailbox.graph.mockResolvedValueOnce(page([], next)).mockResolvedValueOnce(page([]));
    expect(await runMailboxSignals(env, now)).toBe(false);
    expect((await mailboxSignalsStatus(env)).checking).toBe(true);
    expect(await runMailboxSignals(env, new Date(now.getTime() + 60_000))).toBe(true);
    expect(mailbox.graph.mock.calls[1]![1]).toBe(next);
    expect((await mailboxSignalsStatus(env)).lastCheckedAt).toBe(now.toISOString());
  });
  it('fails closed on provider errors, unsafe continuation, malformed or oversized responses', async () => {
    await delivery();
    for (const response of [page([], 'https://other.example.test/steal'), new Response('{bad json'), new Response('x'.repeat(262_145)), new Response('private provider error', { status: 503 })]) {
      await env.DB.prepare('UPDATE outreach_automation_settings SET paused=0 WHERE id=1').run();
      mailbox.graph.mockResolvedValueOnce(response);
      expect(await runMailboxSignals(env, now)).toBe(false);
      expect(await env.DB.prepare('SELECT paused FROM outreach_automation_settings WHERE id=1').first('paused')).toBe(0);
      expect((await mailboxSignalsStatus(env)).lastError).not.toContain('private provider error');
    }
  });
  it('uses one lease so overlapping checks cannot race the mailbox cursor', async () => {
    await delivery();
    let release!: (value: Response) => void, arrived!: () => void;
    const atProvider = new Promise<void>(resolve => { arrived = resolve; });
    mailbox.graph.mockImplementationOnce(() => { arrived(); return new Promise<Response>(resolve => { release = resolve; }); });
    const first = runMailboxSignals(env, now);
    await atProvider;
    expect(await runMailboxSignals(env, now)).toBe(false);
    release(page([]));
    expect(await first).toBe(true);
    expect(mailbox.graph).toHaveBeenCalledTimes(1);
  });
  it('automatically retries a failed read without clearing an owner pause or resubmitting mail', async () => {
    await delivery();
    mailbox.graph.mockResolvedValueOnce(new Response('temporary failure', { status: 503 })).mockResolvedValueOnce(page([]));
    expect(await runMailboxSignals(env, now)).toBe(false);
    expect((await mailboxSignalsStatus(env)).lastError).toBeTruthy();
    expect(await runMailboxSignals(env, new Date(now.getTime() + 60_000))).toBe(true);
    expect((await mailboxSignalsStatus(env)).lastError).toBeNull();
    await env.DB.prepare('UPDATE outreach_automation_settings SET paused=1 WHERE id=1').run();
    expect(await runMailboxSignals(env, new Date(now.getTime() + 120_000))).toBe(false);
    expect(mailbox.graph).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare('SELECT paused FROM outreach_automation_settings WHERE id=1').first('paused')).toBe(1);
  });
  it('does not allow dispatch after losing the mailbox-check lease', async () => {
    await delivery();
    mailbox.graph.mockImplementationOnce(async () => {
      await env.DB.prepare('UPDATE outreach_signal_state SET lease_token=?,lease_until=? WHERE id=1').bind('new-worker-lease', new Date(now.getTime() + 120_000).toISOString()).run();
      return page([]);
    });
    expect(await runMailboxSignals(env, now)).toBe(false);
    expect(await env.DB.prepare('SELECT lease_token FROM outreach_signal_state WHERE id=1').first('lease_token')).toBe('new-worker-lease');
    expect((await mailboxSignalsStatus(env)).lastCheckedAt).toBeNull();
  });
  it('advances past a large unmatched report without storing its body or poisoning all later checks', async () => {
    await delivery();
    mailbox.graph.mockResolvedValueOnce(page([{ id: 'large-unmatched-report', internetMessageHeaders: [{ name: 'Content-Type', value: 'multipart/report; report-type=delivery-status' }] }]))
      .mockResolvedValueOnce(new Response(bounce.replace(originalId, '<unrelated@example.test>') + 'attachment'.repeat(100_000)));
    expect(await runMailboxSignals(env, now)).toBe(true);
    const status = await mailboxSignalsStatus(env);
    expect(status.holds).toEqual([]);
    expect(status.notices).toHaveLength(1);
    expect(status.notices[0]?.message).toContain('could not be linked');
    expect(status.lastCheckedAt).toBe(now.toISOString());
    const saved = await env.DB.prepare('SELECT * FROM outreach_signal_notices').first();
    expect(JSON.stringify(saved)).not.toContain('attachment');
  });
});
