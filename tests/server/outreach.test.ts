import { readFile, readdir } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { fetchDashboard } from '../../src/server/dashboard';
import { fetchPixel } from '../../src/server/pixel';
import { enforceRetention } from '../../src/server/notifications';
import type { Env, Pixel } from '../../src/server/types';
import type { OutreachItem, OutreachPage } from '../../src/shared/outreach';

let mf: Miniflare, env: Env;
const origin = 'http://127.0.0.1:8787';
const base = new Date('2026-11-06T15:00:00.000Z');
const at = (seconds: number) => new Date(base.getTime() + seconds * 1000);
const draft = { label: 'Tracking plan test', recipient: 'test@example.com', subject: 'Contact issue', body: 'Hello,\nThis is imported copy for a manually sent email.' };
const migrations = new URL('../../migrations/', import.meta.url);

async function apply(DB: D1Database, file: string) {
  const sql = (await readFile(new URL(file, migrations), 'utf8')).replace(/--[^\n]*/gu, '');
  const trigger = sql.indexOf('CREATE TRIGGER');
  const setup = (trigger < 0 ? sql : sql.slice(0, trigger)).split(';').map(value => value.trim()).filter(Boolean);
  await DB.batch(setup.map(value => DB.prepare(value)));
  if (trigger >= 0) await DB.prepare(sql.slice(trigger)).run();
}
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test"); } };', compatibilityDate: '2026-07-30', d1Databases: { DB: 'planned-tracking-tests', UPGRADE_DB: 'planned-tracking-upgrade-tests' } });
  const DB = await mf.getD1Database('DB') as unknown as D1Database;
  for (const file of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) await apply(DB, file);
  env = { DB, OWNER_EMAIL: 'elijah@soluredigitalworks.com', DASHBOARD_ORIGIN: origin, PIXEL_ORIGIN: 'http://127.0.0.1:8788', DEV_AUTH: 'true', EMAIL_MODE: 'dry-run' };
});
beforeEach(async () => {
  await env.DB.batch(['DELETE FROM outreach_jobs', 'DELETE FROM opt_out_links', 'DELETE FROM do_not_contact', 'DELETE FROM pixel_reports', 'DELETE FROM notifications', 'DELETE FROM events', 'DELETE FROM pixels', 'UPDATE settings SET email_enabled=0,repeat_alerts=0,capture_request_details=0,keep_unloaded_pixels=0,event_day=NULL,event_count=0 WHERE id=1'].map(sql => env.DB.prepare(sql)));
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(base);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await mf?.dispose(); });
async function api<T = unknown>(path: string, method = 'GET', body?: unknown, overrides: Partial<Env> = {}) {
  const response = await fetchDashboard(new Request(`${origin}${path}`, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { ...env, ...overrides });
  const payload = await response.json() as { data: T; error?: { code: string; message: string } };
  return { response, data: payload.data, error: payload.error };
}
async function imported(value = draft) {
  const before = new Set((await api<OutreachPage>('/api/outreach')).data.items.map(row => row.id));
  const result = await api<OutreachPage>('/api/outreach/import', 'POST', { items: [value] });
  expect(result.response.status).toBe(201);
  const added = result.data.items.find(row => !before.has(row.id)); expect(added).toBeDefined(); return added!;
}
async function action(row: OutreachItem, verb: string, fields = {}) { return api<OutreachItem>(`/api/outreach/${row.id}/${verb}`, 'POST', { version: row.version, ...fields }); }
async function approved(value = draft) { let row = await imported(value); row = (await action(row, 'prepare')).data; return (await action(row, 'approve')).data; }
async function schedule(row: OutreachItem, seconds = 10) {
  const result = await api<OutreachPage>('/api/outreach/schedule', 'POST', { items: [{ id: row.id, version: row.version }], sendAt: at(seconds).toISOString(), delaySeconds: 45 });
  expect(result.response.status).toBe(200); return result.data.items.find(value => value.id === row.id)!;
}
async function current(id: string) { return (await api<OutreachPage>('/api/outreach')).data.items.find(value => value.id === id)!; }
async function pixel(id: string) { return (await api<Pixel>(`/api/pixels/${id}`)).data; }
async function image(row: { pixelUrl: string | null }, logo = false) { return fetchPixel(new Request(logo ? row.pixelUrl!.replace('.gif', '/logo.png') : row.pixelUrl!), env); }
async function manual(recipient = 'manual@example.com') { return (await api<Pixel>('/api/pixels', 'POST', { label: 'Existing manual record', recipient })).data; }
async function manualPlan(row: Pixel, seconds = 10, enableEmailAlerts = false) { return api<Pixel>(`/api/pixels/${row.id}/schedule`, 'POST', { sendAt: at(seconds).toISOString(), enableEmailAlerts }); }

describe('planned Outlook time plus 45 seconds', () => {
  it('prepares escaped copy with unique images and recipient-bound opt-outs, without a mailbox or send action', async () => {
    const importedRows = await api<OutreachPage>('/api/outreach/import', 'POST', { items: [{ ...draft, body: '<img src="https://evil.invalid/a">\nA & B' }, { ...draft, label: 'Second', recipient: 'other@example.com' }] });
    expect(importedRows.response.status).toBe(201); expect(importedRows.data.scheduling.mode).toBe('planned-time');
    const prepared = await Promise.all(importedRows.data.items.map(async row => (await action(row, 'prepare')).data));
    const first = prepared.find(row => row.recipient === draft.recipient)!, second = prepared.find(row => row.recipient === 'other@example.com')!;
    expect(first.preparedHtml).toContain('&lt;img src='); expect(first.preparedHtml).not.toContain('<img src="https://evil.invalid');
    expect(first.preparedHtml).toContain('/logo.png'); expect(first.preparedHtml).toContain(first.optOutUrl);
    expect(first.pixelUrl).not.toBe(second.pixelUrl); expect(first.optOutUrl).not.toBe(second.optOutUrl);
    expect((await pixel(first.pixelId!)).status).toBe('draft'); expect(first).not.toHaveProperty('sentAt');
    expect((await api('/api/outreach/simulate-tick', 'POST', {})).response.status).toBe(404);
    expect((await api(`/api/outreach/${first.id}/send`, 'POST', {})).response.status).toBe(404);
  });

  it('binds preparation and approval to the current content version and retires its prior image after editing', async () => {
    const row = await approved();
    const edited = await api<OutreachItem>(`/api/outreach/${row.id}`, 'PATCH', { version: row.version, body: 'Updated copy from the author.' });
    expect(edited.data.version).toBe(2); expect(edited.data.state).toBe('draft'); expect(edited.data.approvedAt).toBeNull(); expect(edited.data.pixelId).toBeNull();
    expect((await pixel(row.pixelId!)).status).toBe('paused'); expect((await action(row, 'approve')).error?.code).toBe('VERSION_CHANGED');
    const prepared = (await action(edited.data, 'prepare')).data;
    expect(prepared.pixelUrl).not.toBe(row.pixelUrl); expect(prepared.optOutUrl).not.toBe(row.optOutUrl); expect(prepared.preparedText).toContain('Updated copy from the author.');
    expect((await api('/api/outreach/schedule', 'POST', { items: [{ id: prepared.id, version: prepared.version }], sendAt: at(10).toISOString(), delaySeconds: 45 })).response.status).toBe(409);
  });

  it('installs the future gate immediately and starts recording at precisely planned time plus 45 seconds, without any timer tick', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const row = await schedule(await approved());
    expect(row.state).toBe('scheduled'); expect(row.scheduledAt).toBe(at(10).toISOString()); expect(row.trackingStartsAt).toBe(at(55).toISOString()); expect(row).not.toHaveProperty('sentAt');
    const stored = await pixel(row.pixelId!); expect(stored.status).toBe('armed'); expect(stored.armedAt).toBe(at(55).toISOString()); expect(stored.scheduledSendAt).toBe(at(10).toISOString());
    vi.setSystemTime(new Date(at(55).getTime() - 1)); await image(row); await image(row, true); expect((await pixel(row.pixelId!)).loadCount).toBe(0);
    vi.setSystemTime(at(55)); await image(row); expect((await pixel(row.pixelId!)).loadCount).toBe(1); expect((await current(row.id)).state).toBe('tracking'); expect(await current(row.id)).not.toHaveProperty('sentAt');
    expect(network).not.toHaveBeenCalled();
  });

  it('schedules an existing manual image and keeps the same token, prepared footer and private history', async () => {
    const original = await manual();
    const link = await api<{ url: string }>(`/api/pixels/${original.id}/opt-out-link`, 'POST', {});
    const planned = await manualPlan(original, 10, true); expect(planned.response.status).toBe(200);
    expect(planned.data.token).toBe(original.token); expect(planned.data.optOutUrl).toBe(link.data.url); expect(planned.data.scheduledSendAt).toBe(at(10).toISOString());
    expect((await api<{ emailEnabled: boolean }>('/api/settings')).data.emailEnabled).toBe(true);
    vi.setSystemTime(at(54)); await image(original); expect((await pixel(original.id)).loadCount).toBe(0);
    vi.setSystemTime(at(55)); await image(original); expect((await pixel(original.id)).loadCount).toBe(1);
    expect((await api<Pixel>(`/api/pixels/${original.id}`, 'PATCH', { status: 'paused' })).data.scheduledSendAt).toBeNull();
    vi.setSystemTime(at(70)); await image(original); expect((await pixel(original.id)).loadCount).toBe(1);
  });

  it('reschedules manual and reviewed images before their gate using fresh activation windows, and cancels without deleting history', async () => {
    const original = await manual(); const first = (await manualPlan(original)).data;
    const reviewed = await schedule(await approved());
    vi.setSystemTime(at(20));
    const moved = (await manualPlan(first, 40)).data; expect(moved.activationId).not.toBe(first.activationId); expect(moved.armedAt).toBe(at(85).toISOString()); expect(moved.token).toBe(original.token);
    const movedReview = (await action(reviewed, 'reschedule', { sendAt: at(40).toISOString() })).data;
    expect(movedReview.pixelUrl).toBe(reviewed.pixelUrl); expect(movedReview.trackingStartsAt).toBe(at(85).toISOString()); expect(movedReview.approvedAt).toBe(reviewed.approvedAt);
    vi.setSystemTime(at(56)); await image(original); await image(reviewed); expect((await pixel(original.id)).loadCount).toBe(0); expect((await pixel(reviewed.pixelId!)).loadCount).toBe(0);
    const stopped = (await action(movedReview, 'cancel')).data; expect(stopped.state).toBe('cancelled'); expect(stopped.trackingStartsAt).toBeNull();
    await api(`/api/pixels/${original.id}`, 'PATCH', { status: 'paused' }); vi.setSystemTime(at(100)); await image(original); await image(reviewed);
    expect((await pixel(original.id)).loadCount).toBe(0); expect((await pixel(reviewed.pixelId!)).loadCount).toBe(0);
  });

  it('after activation allows stopping but not rewriting the plan or its draft, preserving recorded loads', async () => {
    const row = await schedule(await approved()); vi.setSystemTime(at(55)); await image(row);
    expect((await action(row, 'reschedule', { sendAt: at(100).toISOString() })).error?.code).toBe('TRACKING_ALREADY_STARTED');
    const stopped = (await action(row, 'cancel')).data; expect(stopped.state).toBe('cancelled'); expect(stopped.trackingStartsAt).toBe(at(55).toISOString());
    expect((await action(stopped, 'prepare')).error?.code).toBe('ITEM_LOCKED');
    expect((await api(`/api/outreach/${row.id}`, 'PATCH', { version: row.version, body: 'A second message' })).error?.code).toBe('ITEM_LOCKED');
    vi.setSystemTime(at(90)); await image(row); expect((await pixel(row.pixelId!)).loadCount).toBe(1);
    const active = await manual('active@example.com'); await api(`/api/pixels/${active.id}`, 'PATCH', { status: 'armed' });
    expect((await manualPlan(active, 100)).error?.code).toBe('TRACKING_ALREADY_STARTED');
  });

  it('enforces do-not-contact during preparation, manual scheduling and an already planned window', async () => {
    const first = await imported(); await api('/api/do-not-contact', 'POST', { recipient: first.recipient });
    expect((await action(first, 'prepare')).error?.code).toBe('DO_NOT_CONTACT');
    const original = await manual(first.recipient); expect((await manualPlan(original)).error?.code).toBe('DO_NOT_CONTACT');
    const row = await schedule(await approved({ ...draft, recipient: 'future@example.com' }));
    await api('/api/do-not-contact', 'POST', { recipient: row.recipient }); expect((await current(row.id)).state).toBe('blocked');
    vi.setSystemTime(at(100)); await image(row); expect((await pixel(row.pixelId!)).loadCount).toBe(0);
  });

  it('rechecks opt-outs atomically inside a selected batch and never schedules only part of it', async () => {
    const rows = [await approved({ ...draft, recipient: 'race-a@example.com' }), await approved({ ...draft, recipient: 'race-b@example.com' })];
    let intercepted = false;
    const DB = { prepare: env.DB.prepare.bind(env.DB), batch: async <T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
      if (!intercepted) { intercepted = true; await api('/api/do-not-contact', 'POST', { recipient: rows[0]!.recipient }); }
      return env.DB.batch<T>(statements);
    } } as unknown as D1Database;
    const attempt = await api('/api/outreach/schedule', 'POST', { items: rows.map(row => ({ id: row.id, version: row.version })), sendAt: at(10).toISOString(), delaySeconds: 45 }, { DB });
    expect(attempt.error?.code).toBe('SCHEDULE_CHANGED'); expect((await pixel(rows[0]!.pixelId!)).status).not.toBe('armed'); expect((await pixel(rows[1]!.pixelId!)).status).toBe('draft'); expect((await current(rows[1]!.id)).state).toBe('approved');
  });

  it('stops the current linked image when a delayed edit or cancellation races with preparation in another tab', async () => {
    for (const operation of ['edit', 'cancel'] as const) {
      const row = await imported({ ...draft, recipient: `${operation}-race@example.com` });
      let linked: OutreachItem | undefined;
      const DB = { prepare: env.DB.prepare.bind(env.DB), batch: async <T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
        if (!linked) {
          linked = (await action(row, 'prepare')).data;
          if (operation === 'cancel') linked = await schedule((await action(linked, 'approve')).data);
        }
        return env.DB.batch<T>(statements);
      } } as unknown as D1Database;
      const attempt = operation === 'edit'
        ? await api<OutreachItem>(`/api/outreach/${row.id}`, 'PATCH', { version: row.version, body: 'Replacement copy' }, { DB })
        : await api<OutreachItem>(`/api/outreach/${row.id}/cancel`, 'POST', { version: row.version }, { DB });
      expect(attempt.response.status).toBe(200); expect(linked?.pixelId).toBeTruthy();
      expect((await pixel(linked!.pixelId!)).status).toBe('paused');
      expect(attempt.data.state).toBe(operation === 'edit' ? 'draft' : 'cancelled');
      vi.setSystemTime(at(90)); await image(linked!); expect((await pixel(linked!.pixelId!)).loadCount).toBe(0); vi.setSystemTime(base);
    }
  });

  it('preserves future and opened planned timestamps across both master-email switches without replaying old alerts', async () => {
    const original = await manual(); const reviewed = await schedule(await approved()); await manualPlan(original);
    vi.setSystemTime(at(20)); await api('/api/settings', 'PATCH', { emailEnabled: true });
    expect((await pixel(original.id)).armedAt).toBe(at(55).toISOString()); expect((await pixel(reviewed.pixelId!)).armedAt).toBe(at(55).toISOString());
    await api('/api/settings', 'PATCH', { emailEnabled: false }); vi.setSystemTime(at(55)); await image(original); await image(reviewed);
    const disabled = (await env.DB.prepare("SELECT id FROM notifications WHERE status='disabled'").all<{ id: string }>()).results;
    expect(disabled).toHaveLength(2);
    vi.setSystemTime(at(60)); await api('/api/settings', 'PATCH', { emailEnabled: true });
    expect((await pixel(original.id)).armedAt).toBe(at(55).toISOString()); expect((await pixel(reviewed.pixelId!)).armedAt).toBe(at(55).toISOString());
    expect((await current(reviewed.id)).state).toBe('tracking');
    for (const row of disabled) expect(await env.DB.prepare('SELECT status FROM notifications WHERE id=?').bind(row.id).first('status')).toBe('disabled');
    await image(original); expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE status='pending'").first<number>('n')).toBe(1);
  });

  it('protects queued images and pending manual recipients from accidental immediate activation, edits or deletion', async () => {
    const row = await schedule(await approved());
    expect((await api(`/api/pixels/${row.pixelId}`, 'PATCH', { status: 'armed' })).response.status).toBe(409);
    expect((await api(`/api/pixels/${row.pixelId}`, 'DELETE')).error?.code).toBe('SCHEDULE_MANAGED_PIXEL');
    expect((await api(`/api/pixels/${row.pixelId}/events`, 'DELETE')).error?.code).toBe('SCHEDULE_MANAGED_PIXEL');
    const original = await manual(); await manualPlan(original);
    expect((await api(`/api/pixels/${original.id}`, 'PATCH', { status: 'armed' })).error?.code).toBe('TRACKING_PLAN_PENDING');
    expect((await api(`/api/pixels/${original.id}`, 'PATCH', { recipient: 'changed@example.com' })).error?.code).toBe('TRACKING_PLAN_PENDING');
    expect((await pixel(original.id)).recipient).toBe(original.recipient);
  });

  it('validates explicit time zones, the fixed delay, a bounded future horizon and fields for both scheduling APIs', async () => {
    const original = await manual();
    for (const sendAt of ['invalid', '2026-11-06T15:00:10', '2026-11-31T15:00:10Z', '2026-11-06T24:00:00Z', at(-50).toISOString(), at(31 * 86400).toISOString()]) expect((await api(`/api/pixels/${original.id}/schedule`, 'POST', { sendAt })).response.status).toBe(400);
    expect((await api(`/api/pixels/${original.id}/schedule`, 'POST', { sendAt: at(10).toISOString(), delaySeconds: 1 })).response.status).toBe(400);
    const offset = await api<Pixel>(`/api/pixels/${original.id}/schedule`, 'POST', { sendAt: '2026-11-06T10:00:10-05:00' }); expect(offset.data.scheduledSendAt).toBe(at(10).toISOString());
    const blank = (await api<Pixel>('/api/pixels', 'POST', {})).data; expect((await manualPlan(blank)).response.status).toBe(400);
    const row = await approved(); expect((await api('/api/outreach/schedule', 'POST', { items: [{ id: row.id, version: row.version }], sendAt: at(10).toISOString(), delaySeconds: 0 })).error?.code).toBe('INVALID_DELAY');
  });

  it('keeps owner authentication and same-origin protection on production scheduling endpoints', async () => {
    const original = await manual();
    const production: Env = { ...env, DEV_AUTH: undefined, DASHBOARD_ORIGIN: 'https://maildesk.soluredigitalworks.com', ACCESS_TEAM_DOMAIN: 'planned-test.cloudflareaccess.com', ACCESS_AUD: 'test-audience' };
    const response = await fetchDashboard(new Request(`${production.DASHBOARD_ORIGIN}/api/pixels/${original.id}/schedule`, { method: 'POST', headers: { Origin: production.DASHBOARD_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ sendAt: at(10).toISOString() }) }), production);
    expect(response.status).toBe(401);
    const cross = await fetchDashboard(new Request(`${origin}/api/pixels/${original.id}/schedule`, { method: 'POST', headers: { Origin: 'https://evil.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ sendAt: at(10).toISOString() }) }), env);
    expect(cross.status).toBe(403); expect((await pixel(original.id)).status).toBe('draft');
  });

  it('schedules 100 approved items atomically with bounded query bindings and rejects stale selections', async () => {
    const values = Array.from({ length: 100 }, (_, n) => ({ ...draft, label: `Item ${n}`, recipient: `person${n}@example.com` }));
    const importedRows = await api<OutreachPage>('/api/outreach/import', 'POST', { items: values }); expect(importedRows.response.status).toBe(201);
    for (const row of importedRows.data.items) { await action(row, 'prepare'); await action(row, 'approve'); }
    const selected = importedRows.data.items.map(row => ({ id: row.id, version: row.version }));
    const stale = await api('/api/outreach/schedule', 'POST', { items: selected.map((row, index) => index === 50 ? { ...row, version: 999 } : row), sendAt: at(10).toISOString(), delaySeconds: 45 }); expect(stale.response.status).toBe(409);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM pixels WHERE status='armed'").first<number>('n')).toBe(0);
    const result = await api<OutreachPage>('/api/outreach/schedule', 'POST', { items: selected, sendAt: at(10).toISOString(), delaySeconds: 45 }); expect(result.response.status).toBe(200);
    expect(result.data.items.filter(row => row.state === 'scheduled')).toHaveLength(100); expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM pixels WHERE armed_at=?").bind(at(55).toISOString()).first<number>('n')).toBe(100);
  });

  it('prevents duplicate pending plans for one recipient and permits a separately approved follow-up after the earlier gate', async () => {
    const first = await approved(), second = await approved();
    const duplicate = await api('/api/outreach/schedule', 'POST', { items: [first, second].map(row => ({ id: row.id, version: row.version })), sendAt: at(10).toISOString(), delaySeconds: 45 }); expect(duplicate.error?.code).toBe('DUPLICATE_RECIPIENT');
    const racing = await Promise.all([first, second].map(row => api('/api/outreach/schedule', 'POST', { items: [{ id: row.id, version: row.version }], sendAt: at(10).toISOString(), delaySeconds: 45 })));
    expect(racing.map(row => row.response.status).sort()).toEqual([200, 409]);
    const remaining = (await current(first.id)).state === 'approved' ? first : second;
    vi.setSystemTime(at(56)); expect((await schedule(remaining, 80)).state).toBe('scheduled');
  });

  it('holds a future plan but permits normal no-load retention after its gate, without enabling permanent preservation', async () => {
    const row = await schedule(await approved()); const old = new Date(base.getTime() - 100 * 86400000).toISOString();
    await env.DB.prepare('UPDATE pixels SET created_at=?,report_sent_at=? WHERE id=?').bind(old, old, row.pixelId).run();
    await env.DB.prepare(`INSERT INTO pixel_reports (id,pixel_id,source_pixel_id,label,recipient,pixel_created_at,due_at,created_at,snapshot_text,status,next_attempt_at)
      VALUES (?,?,?,?,?,?,?,?,?,'sent',?)`).bind(crypto.randomUUID(), row.pixelId, row.pixelId, row.label, row.recipient, old, old, old, 'Saved report', old).run();
    expect((await pixel(row.pixelId!)).preserveUnloaded).toBe(false);
    await enforceRetention(env, base); expect((await api(`/api/pixels/${row.pixelId}`)).response.status).toBe(200);
    await enforceRetention(env, at(60)); expect((await api(`/api/pixels/${row.pixelId}`)).response.status).toBe(404);
  });

  it('upgrades old preview timing conservatively without changing manual records, opt-out links or load history', async () => {
    const DB = await mf.getD1Database('UPGRADE_DB') as unknown as D1Database;
    for (const file of (await readdir(migrations)).filter(name => name.endsWith('.sql') && !name.startsWith('0010')).sort()) await apply(DB, file);
    // A local preview may already have applied the unpublished 0009 migration.
    // The release leaves that unused table and its contents intact.
    await DB.prepare('CREATE TABLE simulated_mailbox (id TEXT PRIMARY KEY,job_id TEXT UNIQUE,recipient TEXT,subject TEXT,html TEXT,text TEXT,status TEXT,created_at TEXT,submitted_at TEXT,sent_at TEXT)').run();
    await DB.prepare("INSERT INTO simulated_mailbox(id,job_id,recipient,status,created_at) VALUES('old-simulation','legacy-job:1','old@example.com','sent',?)").bind(base.toISOString()).run();
    const simulationBefore = await DB.prepare('SELECT * FROM simulated_mailbox').all();
    await DB.prepare(`INSERT INTO pixels(id,token,label,recipient,status,created_at,updated_at,armed_at,activation_id) VALUES
      ('legacy-pixel','00000000000000000000000000000001','Prior preview','old@example.com','armed',?,?,?,'prior-activation'),
      ('manual-pixel','00000000000000000000000000000002','Manual image','manual@example.com','armed',?,?,?,'manual-activation')`).bind(base.toISOString(), base.toISOString(), base.toISOString(), base.toISOString(), base.toISOString(), base.toISOString()).run();
    await DB.prepare(`INSERT INTO outreach_jobs(id,label,recipient,subject,body,state,pixel_id,created_at,updated_at,scheduled_at,tracking_starts_at)
      VALUES('legacy-job','Prior preview','old@example.com','Subject','Body','scheduled','legacy-pixel',?,?,?,?)`).bind(base.toISOString(), base.toISOString(), at(10).toISOString(), at(55).toISOString()).run();
    await DB.prepare("INSERT INTO events(id,pixel_id,created_at,phase) VALUES('legacy-load','legacy-pixel',?,'after_arming')").bind(base.toISOString()).run();
    await DB.prepare('INSERT INTO opt_out_links(token,pixel_id,recipient,created_at) VALUES(?,?,?,?)').bind('a'.repeat(64), 'legacy-pixel', 'old@example.com', base.toISOString()).run();
    const manualBefore = await DB.prepare("SELECT * FROM pixels WHERE id='manual-pixel'").first(); const eventsBefore = await DB.prepare('SELECT * FROM events').all(); const linksBefore = await DB.prepare('SELECT * FROM opt_out_links').all();
    await apply(DB, '0010_planned_tracking.sql');
    expect(await DB.prepare("SELECT status FROM pixels WHERE id='legacy-pixel'").first('status')).toBe('paused'); expect(await DB.prepare("SELECT state FROM outreach_jobs WHERE id='legacy-job'").first('state')).toBe('cancelled');
    expect(await DB.prepare("SELECT * FROM pixels WHERE id='manual-pixel'").first()).toEqual({ ...manualBefore, scheduled_send_at: null });
    expect((await DB.prepare('SELECT * FROM events').all()).results).toEqual(eventsBefore.results); expect((await DB.prepare('SELECT * FROM opt_out_links').all()).results).toEqual(linksBefore.results);
    expect((await DB.prepare('SELECT * FROM simulated_mailbox').all()).results).toEqual(simulationBefore.results);
  });
});
