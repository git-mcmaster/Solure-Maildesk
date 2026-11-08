import { readFile, readdir } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { automationApi, getDeliveryForJob, hasManagedDelivery, listDeliveriesForJobs, runAutomation } from '../../src/server/automation';
import { fetchPixel } from '../../src/server/pixel';
import type { Env } from '../../src/server/types';
import type { AutomationPage, AutomaticDelivery } from '../../src/shared/automation';
import { HttpError } from '../../src/server/http';

const mocks = vi.hoisted(() => ({ status: vi.fn(), graph: vi.fn(), posts: vi.fn() }));
vi.mock('../../src/server/mailbox', () => ({ mailboxStatus: mocks.status, mailboxGraphFetch: mocks.graph }));
const base = new Date('2026-11-08T15:00:00Z'), origin = 'http://127.0.0.1:8787';
const at = (seconds: number) => new Date(base.getTime() + seconds * 1000);
const migrations = new URL('../../migrations/', import.meta.url);
let mf: Miniflare, env: Env;
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}', compatibilityDate: '2026-07-30', d1Databases: { DB: 'maildesk-automation-tests' } });
  const DB = await mf.getD1Database('DB') as unknown as D1Database;
  for (const name of (await readdir(migrations)).filter(value => value.endsWith('.sql')).sort()) {
    const sql = (await readFile(new URL(name, migrations), 'utf8')).replace(/--[^\n]*/gu, '');
    const trigger = sql.indexOf('CREATE TRIGGER');
    await DB.batch((trigger < 0 ? sql : sql.slice(0, trigger)).split(';').map(value => value.trim()).filter(Boolean).map(value => DB.prepare(value)));
    if (trigger >= 0) await DB.prepare(sql.slice(trigger)).run();
  }
  env = { DB, OWNER_EMAIL: 'owner@example.com', DASHBOARD_ORIGIN: origin, PIXEL_ORIGIN: 'https://pixel.example.com', OUTREACH_SENDING_ENABLED: 'true', DEV_AUTH: 'true', EMAIL_MODE: 'dry-run' };
}, 30_000);
beforeEach(async () => {
  await env.DB.batch(['DELETE FROM outreach_recipient_stops', 'DELETE FROM outreach_jobs', 'DELETE FROM opt_out_links', 'DELETE FROM do_not_contact', 'DELETE FROM notifications', 'DELETE FROM pixel_reports', 'DELETE FROM events', 'DELETE FROM pixels',
    'UPDATE outreach_automation_settings SET paused=0,resume_after=NULL WHERE id=1', 'UPDATE settings SET email_enabled=0,event_day=NULL,event_count=0 WHERE id=1'].map(sql => env.DB.prepare(sql)));
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(base);
  env.OUTREACH_SENDING_ENABLED = 'true';
  delete env.OUTREACH_TEST_RECIPIENT;
  mocks.status.mockReset().mockResolvedValue({ configured: true, connected: true, sendingEnabled: true, ownerEmail: env.OWNER_EMAIL, connectedEmail: env.OWNER_EMAIL, permissions: [], lastError: null, nativeUnsubscribeVerified: false });
  mocks.posts.mockReset(); mocks.graph.mockReset().mockImplementation(async (_env: Env, path: string, init?: RequestInit, before?: () => Promise<void>) => {
    if (init?.method === 'POST') { await before?.(); mocks.posts(path, init); return new Response(null, { status: 202 }); }
    return Response.json({ value: [] });
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await mf?.dispose(); });

async function api<T = AutomationPage>(path = '/api/automation', body?: unknown) {
  const response = await automationApi(new Request(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
  if (!response) throw new Error('Unrouted fixture');
  return { response, ...(await response.json() as { data: T }) };
}
async function failure(path: string, body: unknown, code: string) {
  await expect(api(path, body)).rejects.toMatchObject({ code });
}
async function fixture(recipient = 'alice@example.net') {
  const jobId = crypto.randomUUID(), pixelId = crypto.randomUUID(), imageToken = crypto.randomUUID().replaceAll('-', ''), token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const optOutUrl = env.PIXEL_ORIGIN + '/outreach/stop/' + token;
  const subject = 'A useful heads-up — café ☕', text = 'Hello, Alice — useful test copy.\nElijah\n' + optOutUrl;
  const html = `<p>Hello, Alice — useful test copy.</p><img src="${env.PIXEL_ORIGIN}/p/${imageToken}/logo.png"><a href="${optOutUrl}">Stop outreach emails</a>`;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO pixels(id,token,label,recipient,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(pixelId, imageToken, 'Synthetic approved automation fixture', recipient, '', base.toISOString(), base.toISOString()),
    env.DB.prepare('INSERT INTO opt_out_links(token,pixel_id,recipient,created_at) VALUES(?,?,?,?)').bind(token, pixelId, recipient, base.toISOString()),
    env.DB.prepare(`INSERT INTO outreach_jobs(id,version,state,label,recipient,subject,body,prepared_html,prepared_text,pixel_id,opt_out_url,created_at,updated_at,approved_at,approved_version)
      VALUES(?,1,'approved','Synthetic approved automation fixture',?,?,?,?,?,?,?,?,?,?,1)`).bind(jobId, recipient, subject, 'Hello, Alice — useful test copy.', html, text, pixelId, optOutUrl, base.toISOString(), base.toISOString(), base.toISOString()),
  ]);
  return { id: jobId, version: 1, pixelId, recipient, imageUrl: env.PIXEL_ORIGIN + '/p/' + imageToken + '.gif', subject, text, html };
}
async function queue(items: { id: string; version: number }[], seconds = 300, extra = {}) {
  return (await api('/api/automation/schedule', { items: items.map(({ id, version }) => ({ id, version })), sendAt: at(seconds).toISOString(), timeZone: 'America/New_York', spacingMinutes: 2, confirmSending: true, ...extra })).data;
}
async function current(id: string): Promise<AutomaticDelivery> { return (await api()).data.deliveries.find(row => row.jobId === id)!; }
async function dnc(recipient: string) { await env.DB.prepare("INSERT INTO do_not_contact(recipient,created_at,source) VALUES(?,?,'recipient')").bind(recipient, at(300).toISOString()).run(); }
async function loads() { return env.DB.prepare('SELECT COUNT(*) AS n FROM events').first<number>('n'); }

describe('connected exact-approved delivery automation', () => {
  it('stores the whole approved batch and its recipient-bound snapshots without sending or arming tracking', async () => {
    const a = await fixture(), b = await fixture('bob@example.net');
    const page = await queue([a, b]);
    expect(page.deliveries.map(row => row.sendAt).sort()).toEqual([at(300).toISOString(), at(420).toISOString()]);
    expect(page.deliveries.every(row => row.state === 'pending' && row.nativeUnsubscribeVerified === false)).toBe(true);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM pixels WHERE status='armed'").first<number>('n')).toBe(0);
    expect(mocks.posts).not.toHaveBeenCalled();
    expect(await hasManagedDelivery(env, a.id)).toBe(true);
    expect((await listDeliveriesForJobs(env, [a.id])).map(row => row.jobId)).toEqual([a.id]);
    expect((await getDeliveryForJob(env, a.id))?.approvedVersion).toBe(1);
    expect(await getDeliveryForJob(env, crypto.randomUUID())).toBeNull();
  });
  it('sends once as exact MIME and treats 202 as acceptance, with no recording before the saved 45-second gate', async () => {
    const a = await fixture(); await queue([a]);
    await runAutomation(env, at(299)); expect(mocks.posts).not.toHaveBeenCalled();
    await runAutomation(env, at(300));
    const row = await current(a.id);
    expect(row).toMatchObject({ state: 'accepted', attempts: 1, acceptedAt: at(300).toISOString(), sentAt: null, trackingStartsAt: at(345).toISOString() });
    expect(mocks.posts).toHaveBeenCalledTimes(1);
    const [path, request] = mocks.posts.mock.calls[0]!;
    expect(path).toBe('/me/sendMail');
    expect(request.headers).toEqual({ 'Content-Type': 'text/plain' });
    const mime = atob(request.body as string);
    expect(mime).toContain(`To: ${a.recipient}\r\n`);
    expect(mime).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    expect(mime).toContain(row.messageId);
    vi.setSystemTime(at(344)); await fetchPixel(new Request(a.imageUrl), env); expect(await loads()).toBe(0);
    vi.setSystemTime(at(345)); await fetchPixel(new Request(a.imageUrl), env); expect(await loads()).toBe(1);
    await runAutomation(env, at(360)); expect(mocks.posts).toHaveBeenCalledTimes(1);
  });
  it('never arms tracking before a delayed submission is accepted', async () => {
    const a = await fixture(); await queue([a]);
    vi.setSystemTime(at(400)); await fetchPixel(new Request(a.imageUrl), env); expect(await loads()).toBe(0);
    await runAutomation(env, at(400)); expect((await current(a.id)).trackingStartsAt).toBe(at(400).toISOString());
  });
  it('blocks an opt-out before dispatch and preserves existing pairings', async () => {
    const a = await fixture(); await queue([a]); await dnc(a.recipient); await runAutomation(env, at(300));
    expect((await current(a.id)).state).toBe('blocked'); expect(mocks.posts).not.toHaveBeenCalled();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM opt_out_links').first<number>('n')).toBe(1);
  });
  it('rechecks an opt-out after token preparation and before the external sending request', async () => {
    const a = await fixture(); await queue([a]);
    mocks.graph.mockImplementation(async (_env, _path, _init, before) => { await dnc(a.recipient); await before(); mocks.posts(); return new Response(null, { status: 202 }); });
    await runAutomation(env, at(300));
    expect(mocks.posts).not.toHaveBeenCalled(); expect((await current(a.id)).state).toBe('blocked');
  });
  it('cancels a queued send and rejects a stale reschedule version', async () => {
    const a = await fixture(); await queue([a]); const row = await current(a.id);
    await api(`/api/automation/${row.id}/reschedule`, { version: row.version, sendAt: at(600).toISOString(), timeZone: 'UTC' });
    await failure(`/api/automation/${row.id}/reschedule`, { version: row.version, sendAt: at(700).toISOString(), timeZone: 'UTC' }, 'RESCHEDULE_CHANGED');
    const changed = await current(a.id); expect(changed).toMatchObject({ sendAt: at(600).toISOString(), timeZone: 'UTC', version: 2 });
    await api(`/api/automation/${changed.id}/cancel`, { version: changed.version }); await runAutomation(env, at(600));
    expect((await current(a.id)).state).toBe('cancelled'); expect(mocks.posts).not.toHaveBeenCalled();
  });
  it('retains acceptance truth when cancellation arrives during the provider request and leaves capture stopped', async () => {
    const a = await fixture(); await queue([a]);
    mocks.graph.mockImplementation(async (_env, _path, _init, before) => {
      await before(); mocks.posts(); const row = await current(a.id); await api(`/api/automation/${row.id}/cancel`, { version: row.version });
      return new Response(null, { status: 202 });
    });
    await runAutomation(env, at(300));
    expect(await current(a.id)).toMatchObject({ state: 'accepted', cancelRequested: true, acceptedAt: at(300).toISOString() });
    vi.setSystemTime(at(400)); await fetchPixel(new Request(a.imageUrl), env); expect(await loads()).toBe(0);
  });
  it('retains acceptance truth when opt-out arrives during the provider request and leaves capture stopped', async () => {
    const a = await fixture(); await queue([a]);
    mocks.graph.mockImplementation(async (_env, _path, _init, before) => { await before(); mocks.posts(); await dnc(a.recipient); return new Response(null, { status: 202 }); });
    await runAutomation(env, at(300));
    expect(await current(a.id)).toMatchObject({ state: 'accepted', cancelRequested: true });
    expect(await env.DB.prepare('SELECT status FROM pixels WHERE id=?').bind(a.pixelId).first('status')).not.toBe('armed');
  });
  it('allows only one concurrent worker to submit the same email', async () => {
    const a = await fixture(); await queue([a]); await Promise.all([runAutomation(env, at(300)), runAutomation(env, at(300))]);
    expect(mocks.posts).toHaveBeenCalledTimes(1); expect((await current(a.id)).state).toBe('accepted');
  });
  it('does not retry a timed-out or uncertain sending request', async () => {
    const a = await fixture(); await queue([a]);
    mocks.graph.mockImplementation(async (_env, _path, init, before) => { if (init?.method !== 'POST') return Response.json({ value: [] }); await before(); mocks.posts(); throw new Error('Network error containing private material'); });
    await runAutomation(env, at(300)); await runAutomation(env, at(600));
    expect(await current(a.id)).toMatchObject({ state: 'needs_attention', attempts: 1 }); expect(mocks.posts).toHaveBeenCalledTimes(1);
    expect((await current(a.id)).lastError).not.toContain('private material');
  });
  it('honors a rate-limit pause without automatically resending the failed message', async () => {
    const a = await fixture(), b = await fixture('bob@example.net'); await queue([a, b]);
    mocks.graph.mockImplementation(async (_env, _path, init, before) => { if (init?.method !== 'POST') return Response.json({ value: [] }); await before(); mocks.posts(); return new Response(null, { status: 429, headers: { 'Retry-After': '600' } }); });
    await runAutomation(env, at(300)); await runAutomation(env, at(360));
    expect((await current(a.id)).state).toBe('needs_attention'); expect((await current(b.id)).state).toBe('pending'); expect(mocks.posts).toHaveBeenCalledTimes(1);
  });
  it('leaves pending sends intact while paused or disconnected and is inert when disabled', async () => {
    const a = await fixture(); await queue([a]); await api('/api/automation/pause', { paused: true }); await runAutomation(env, at(300));
    expect((await current(a.id)).state).toBe('pending'); expect(mocks.posts).not.toHaveBeenCalled();
    await api('/api/automation/pause', { paused: false }); mocks.status.mockResolvedValue({ connected: false, sendingEnabled: true }); await runAutomation(env, at(300)); expect(mocks.posts).not.toHaveBeenCalled();
    const db = { prepare() { throw new Error('Must not access DB'); } } as unknown as D1Database;
    await runAutomation({ ...env, OUTREACH_SENDING_ENABLED: 'false', DB: db }, at(300));
  });
  it('requires explicit sending consent and rejects duplicate, unapproved, invalid and over-cap batches', async () => {
    const a = await fixture();
    await failure('/api/automation/schedule', { items: [a], sendAt: at(300).toISOString(), timeZone: 'UTC', spacingMinutes: 1 }, 'SEND_CONFIRMATION_REQUIRED');
    await failure('/api/automation/schedule', { items: [{ id: a.id, version: 1 }, { id: a.id, version: 1 }], sendAt: at(300).toISOString(), timeZone: 'UTC', spacingMinutes: 1, confirmSending: true }, 'DUPLICATE_SELECTION');
    await expect(queue([a], 300, { spacingMinutes: 0 })).rejects.toMatchObject({ code: 'INVALID_SPACING' });
    await expect(queue([a], 300, { spacingMinutes: 1 })).rejects.toMatchObject({ code: 'INVALID_SPACING' });
    await expect(queue([a], 300, { timeZone: 'Not/a-zone' })).rejects.toMatchObject({ code: 'INVALID_TIMEZONE' });
    const batch = [a]; for (let index = 1; index < 21; index++) batch.push(await fixture(`fixture${index}@example.net`));
    await expect(queue(batch)).rejects.toMatchObject({ code: 'SCHEDULE_CHANGED' }); expect((await api()).data.deliveries).toHaveLength(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM outreach_jobs WHERE state='approved'").first<number>('n')).toBe(21);
  });
  it('refuses late messages and refuses sending a changed approved version', async () => {
    const a = await fixture(); await queue([a]); await runAutomation(env, at(1201));
    expect((await current(a.id)).state).toBe('needs_attention'); expect(mocks.posts).not.toHaveBeenCalled();
    const b = await fixture('bob@example.net'); await queue([b]);
    await env.DB.prepare('UPDATE outreach_jobs SET version=2 WHERE id=?').bind(b.id).run(); await runAutomation(env, at(300));
    expect((await current(b.id)).state).toBe('needs_attention'); expect(mocks.posts).not.toHaveBeenCalled();
  });
  it('requires precise Sent Items identity and distinguishes observation from acceptance and delivery', async () => {
    const a = await fixture(); await queue([a]); await runAutomation(env, at(300)); const row = await current(a.id);
    mocks.graph.mockResolvedValue(Response.json({ value: [{ id: 'provider-id', internetMessageId: row.messageId, subject: a.subject, toRecipients: [{ emailAddress: { address: a.recipient } }], ccRecipients: [], bccRecipients: [], isDraft: false, sentDateTime: at(301).toISOString() }] }));
    await runAutomation(env, at(360));
    expect(await current(a.id)).toMatchObject({ state: 'sent', acceptedAt: at(300).toISOString(), sentAt: at(301).toISOString(), nativeUnsubscribeVerified: false });
    expect((await api()).data.activity.some(entry => entry.kind === 'sent_item_observed' && entry.message.includes('not delivery'))).toBe(true);
  });
  it('will not recycle a cancelled or already-submitted job into a second send', async () => {
    const a = await fixture(); await queue([a]); const row = await current(a.id); await api(`/api/automation/${row.id}/cancel`, { version: row.version });
    await env.DB.prepare("UPDATE outreach_jobs SET state='approved',scheduled_at=NULL,approved_version=1 WHERE id=?").bind(a.id).run();
    await expect(queue([a])).rejects.toMatchObject({ code: 'SCHEDULE_CHANGED' }); expect((await current(a.id)).state).toBe('cancelled');
    expect(await env.DB.prepare('SELECT state FROM outreach_jobs WHERE id=?').bind(a.id).first('state')).toBe('approved');
  });
  it('enforces the test-recipient allowlist both when scheduling and after a saved schedule', async () => {
    const a = await fixture(); env.OUTREACH_TEST_RECIPIENT = 'test@example.net';
    await expect(queue([a])).rejects.toMatchObject({ code: 'TEST_RECIPIENT_ONLY' });
    expect((await api()).data.testRecipient).toBe('test@example.net');
    delete env.OUTREACH_TEST_RECIPIENT; await queue([a]); env.OUTREACH_TEST_RECIPIENT = 'test@example.net';
    await runAutomation(env, at(300)); expect(mocks.posts).not.toHaveBeenCalled(); expect((await current(a.id)).state).toBe('needs_attention');
  });
  it('preserves queued approval while a connection refresh fails before any external send', async () => {
    const a = await fixture(); await queue([a]);
    mocks.graph.mockRejectedValue(new HttpError(409, 'MAILBOX_RECONNECT_REQUIRED', 'Reconnect Microsoft.'));
    await runAutomation(env, at(300));
    expect(await current(a.id)).toMatchObject({ state: 'pending', attempts: 0, submittedAt: null }); expect(mocks.posts).not.toHaveBeenCalled();
  });
  it('preserves all pending items when Pause arrives while the first connection is being prepared', async () => {
    const a = await fixture(), b = await fixture('bob@example.net'); await queue([a, b]);
    mocks.graph.mockImplementation(async (_env, _path, _init, before) => { await api('/api/automation/pause', { paused: true }); await before(); mocks.posts(); return new Response(null, { status: 202 }); });
    await runAutomation(env, at(400));
    expect((await current(a.id)).state).toBe('pending'); expect((await current(b.id)).state).toBe('pending'); expect(mocks.posts).not.toHaveBeenCalled();
  });
  it('rechecks a correlated reply hold after connection preparation and leaves capture stopped', async () => {
    const a = await fixture(); await queue([a]);
    mocks.graph.mockImplementation(async (_env, _path, _init, before) => {
      const row = await current(a.id);
      await env.DB.prepare("INSERT INTO outreach_recipient_stops(recipient,kind,created_at,source_message_id,delivery_id,message) VALUES(?,'reply',?,'synthetic-reply',?,'Reply observed. Review before further outreach.')")
        .bind(a.recipient, at(300).toISOString(), row.id).run();
      await before(); mocks.posts(); return new Response(null, { status: 202 });
    });
    await runAutomation(env, at(300));
    expect(await current(a.id)).toMatchObject({ state: 'blocked', cancelRequested: true }); expect(mocks.posts).not.toHaveBeenCalled();
  });
  it('rejects a message whose approved HTML does not contain its paired tracking image', async () => {
    const a = await fixture(); await env.DB.prepare("UPDATE outreach_jobs SET prepared_html='<p>Wrong tracking pair</p>' WHERE id=?").bind(a.id).run();
    await expect(queue([a])).rejects.toMatchObject({ code: 'SCHEDULE_CHANGED' }); expect((await api()).data.deliveries).toHaveLength(0);
  });
  it('checks the late-send deadline again after slow connection preparation', async () => {
    const a = await fixture(); await queue([a]);
    mocks.graph.mockImplementation(async (_env, _path, _init, before) => { vi.setSystemTime(at(1201)); await before(); mocks.posts(); return new Response(null, { status: 202 }); });
    await runAutomation(env, at(300)); expect(mocks.posts).not.toHaveBeenCalled(); expect((await current(a.id)).state).toBe('needs_attention');
  });
  it('lets the owner safely queue and reschedule while paused without resuming due sends', async () => {
    const a = await fixture(); await api('/api/automation/pause', { paused: true }); await queue([a]); const row = await current(a.id);
    await api(`/api/automation/${row.id}/reschedule`, { version: row.version, sendAt: at(600).toISOString(), timeZone: 'UTC' });
    await runAutomation(env, at(600)); expect(mocks.posts).not.toHaveBeenCalled(); expect(await current(a.id)).toMatchObject({ state: 'pending', sendAt: at(600).toISOString() });
  });
  it('lets the owner explicitly reschedule an untouched late message but never an uncertain attempted message', async () => {
    const a = await fixture(); await queue([a]); await runAutomation(env, at(1201)); const late = await current(a.id);
    await api(`/api/automation/${late.id}/reschedule`, { version: late.version, sendAt: at(1500).toISOString(), timeZone: 'UTC' });
    expect(await current(a.id)).toMatchObject({ state: 'pending', attempts: 0, sendAt: at(1500).toISOString() });
    mocks.graph.mockImplementation(async (_env, _path, _init, before) => { await before(); throw new Error('Unknown result'); });
    await runAutomation(env, at(1500)); const uncertain = await current(a.id);
    await failure(`/api/automation/${uncertain.id}/reschedule`, { version: uncertain.version, sendAt: at(1800).toISOString(), timeZone: 'UTC' }, 'RESCHEDULE_CHANGED');
  });
  it('blocks a separate known future manual tracking plan for the same recipient', async () => {
    const a = await fixture(), legacy = await fixture(a.recipient);
    await env.DB.prepare("UPDATE pixels SET status='armed',scheduled_send_at=?,armed_at=?,activation_id='legacy' WHERE id=?").bind(at(200).toISOString(), at(245).toISOString(), legacy.pixelId).run();
    await expect(queue([a])).rejects.toMatchObject({ code: 'SCHEDULE_CHANGED' }); expect((await api()).data.deliveries).toHaveLength(0);
  });
  it('spreads an office-hours batch across the 20-per-UTC-day boundary before it is saved', async () => {
    const batch = []; for (let index = 0; index < 21; index++) batch.push(await fixture(`plan${index}@example.net`));
    const page = await queue(batch, 300, { businessHours: true, spreadAcrossDays: true });
    const times = page.deliveries.map(row => row.sendAt).sort();
    expect(times[0]).toBe('2026-11-09T14:00:00.000Z');
    expect(times[19]).toBe('2026-11-09T14:38:00.000Z');
    expect(times[20]).toBe('2026-11-10T14:00:00.000Z');
    expect(mocks.posts).not.toHaveBeenCalled();
  });
  it('rejects an exact-time confirmation if a newly saved reservation changes the reviewed plan', async () => {
    const a = await fixture(), b = await fixture('bob@example.net'); await queue([b]);
    await expect(queue([a], 300, { spreadAcrossDays: true, expectedSendTimes: [at(300).toISOString()] })).rejects.toMatchObject({ code: 'PLAN_CHANGED' });
    expect((await api()).data.deliveries).toHaveLength(1);
    await queue([a], 300, { spreadAcrossDays: true, expectedSendTimes: [at(420).toISOString()] });
    expect((await current(a.id)).sendAt).toBe(at(420).toISOString());
  });
  it('bounds real connection queries with due, reconciliation and expired-claim backlogs, including short-token refreshes', async () => {
    const jobs: Awaited<ReturnType<typeof fixture>>[] = [];
    for (let index = 0; index < 6; index++) jobs.push(await fixture(`budget${index}@example.net`));
    await queue(jobs);
    const deliveries = await listDeliveriesForJobs(env);
    const byJob = new Map(deliveries.map(row => [row.jobId, row]));
    for (const job of jobs.slice(0, 2)) await env.DB.prepare("UPDATE outreach_deliveries SET state='accepted',submitted_at=?,accepted_at=? WHERE job_id=?")
      .bind(at(-1200).toISOString(), at(-1200).toISOString(), job.id).run();
    for (const job of jobs.slice(2, 4)) await env.DB.prepare("UPDATE outreach_deliveries SET state='submitting',lease_until=? WHERE job_id=?")
      .bind(at(999).toISOString(), job.id).run();
    const tenant = '10000000-0000-4000-8000-000000000001', client = '20000000-0000-4000-8000-000000000002', owner = '30000000-0000-4000-8000-000000000003';
    const tokenKey = btoa('K'.repeat(32)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('K'.repeat(32)), 'AES-GCM', false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
      additionalData: new TextEncoder().encode(`maildesk-v1|${tenant}|${owner}|${client}|${origin}/api/mailbox/callback|tokens`) }, key,
    new TextEncoder().encode(JSON.stringify({ accessToken: 'synthetic-access-token', refreshToken: 'synthetic-refresh-token' })));
    const encryptedTokens = `v1.${Buffer.from(iv).toString('base64')}.${Buffer.from(encrypted).toString('base64')}`;
    await env.DB.prepare(`UPDATE mailbox_connection SET tenant_id=?,client_id=?,owner_id=?,account_email=?,encrypted_tokens=?,access_expires_at=?,version=0 WHERE id=1`)
      .bind(tenant, client, owner, env.OWNER_EMAIL, encryptedTokens, 0).run();
    let queries = 0;
    const originals = new WeakMap<object, D1PreparedStatement>();
    const statement = (target: D1PreparedStatement): D1PreparedStatement => {
      const wrapped = new Proxy(target, { get(value, property) {
        if (property === 'bind') return (...args: unknown[]) => statement(value.bind(...args));
        const method = Reflect.get(value, property);
        if (typeof method !== 'function') return method;
        return (...args: unknown[]) => { if (['run', 'first', 'all', 'raw'].includes(String(property))) queries++; return Reflect.apply(method, value, args); };
      } });
      originals.set(wrapped, target); return wrapped;
    };
    const countedDB = new Proxy(env.DB, { get(target, property) {
      if (property === 'prepare') return (sql: string) => statement(target.prepare(sql));
      if (property === 'batch') return (values: D1PreparedStatement[]) => { queries++; return target.batch(values.map(value => originals.get(value) ?? value)); };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const actual = await vi.importActual<typeof import('../../src/server/mailbox')>('../../src/server/mailbox');
    mocks.status.mockImplementation(actual.mailboxStatus); mocks.graph.mockImplementation(actual.mailboxGraphFetch);
    const realEnv: Env = { ...env, DB: countedDB, MICROSOFT_TENANT_ID: tenant, MICROSOFT_CLIENT_ID: client,
      MICROSOFT_OWNER_ID: owner, MICROSOFT_CLIENT_SECRET: 'synthetic-client-secret', MAILBOX_TOKEN_KEY: tokenKey };
    let refreshes = 0, reads = 0, submissions = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      if (url.hostname === 'login.microsoftonline.com') { refreshes++; return Response.json({ access_token: 'refreshed-synthetic-access', refresh_token: 'synthetic-refresh-token', token_type: 'Bearer', expires_in: 60, scope: 'User.Read Mail.Read Mail.Send' }); }
      if (init.method === 'POST') { submissions++; return new Response(null, { status: 202 }); }
      reads++;
      const id = /'(<[^']+>)'/u.exec(url.searchParams.get('$filter') ?? '')?.[1];
      const job = jobs.find(value => byJob.get(value.id)?.messageId === id)!;
      return Response.json({ value: [{ id: 'synthetic-sent-item', internetMessageId: id, subject: job.subject, toRecipients: [{ emailAddress: { address: job.recipient } }], ccRecipients: [], bccRecipients: [], isDraft: false, sentDateTime: at(-1199).toISOString() }] });
    }));
    vi.setSystemTime(at(1000)); await runAutomation(realEnv, at(1000));
    const dispatchQueries = queries;
    expect(dispatchQueries).toBeLessThanOrEqual(22); expect(submissions).toBe(1); expect(reads).toBe(0);
    expect(refreshes).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM outreach_deliveries WHERE state='submitting'").first<number>('n')).toBe(1);
    expect(await env.DB.prepare('SELECT SUM(reconcile_attempts) AS n FROM outreach_deliveries').first<number>('n')).toBe(0);
    // Remove the remaining untouched due item: the next idle phase can then
    // reconcile one accepted record and recover one expired claim, never all.
    await env.DB.prepare("UPDATE outreach_deliveries SET send_at=? WHERE state='pending'").bind(at(2000).toISOString()).run();
    queries = 0; await runAutomation(realEnv, at(1000));
    expect(queries).toBeLessThanOrEqual(18); expect(reads).toBe(1); expect(submissions).toBe(1); expect(refreshes).toBe(2);
    expect(await env.DB.prepare('SELECT SUM(reconcile_attempts) AS n FROM outreach_deliveries').first<number>('n')).toBe(1);
  });
});
