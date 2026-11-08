import { readFile, readdir } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { fetchDashboard } from '../../src/server/dashboard';
import type { Env } from '../../src/server/types';
import type { OutreachItem, OutreachPage } from '../../src/shared/outreach';

const origin = 'http://127.0.0.1:8787';
const migrations = new URL('../../migrations/', import.meta.url);
let mf: Miniflare, env: Env;
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("fixture"); } };', compatibilityDate: '2026-07-30', d1Databases: { DB: 'batch-review-tests' } });
  const DB = await mf.getD1Database('DB') as unknown as D1Database;
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(new URL(name, migrations), 'utf8')).replace(/--[^\n]*/gu, '');
    const tail = sql.indexOf('CREATE TRIGGER');
    await DB.batch((tail < 0 ? sql : sql.slice(0, tail)).split(';').map(value => value.trim()).filter(Boolean).map(value => DB.prepare(value)));
    if (tail >= 0) await DB.prepare(sql.slice(tail)).run();
  }
  env = { DB, OWNER_EMAIL: 'owner@example.test', DASHBOARD_ORIGIN: origin, PIXEL_ORIGIN: 'https://pixel.example.test', DEV_AUTH: 'true', EMAIL_MODE: 'dry-run' };
}, 30_000);
beforeEach(async () => {
  await env.DB.batch(['DELETE FROM outreach_jobs', 'DELETE FROM opt_out_links', 'DELETE FROM do_not_contact', 'DELETE FROM pixel_reports', 'DELETE FROM notifications', 'DELETE FROM events', 'DELETE FROM pixels'].map(sql => env.DB.prepare(sql)));
});
afterAll(async () => { await mf?.dispose(); });

async function api<T = unknown>(path: string, method = 'GET', body?: unknown, extra: Partial<Env> = {}) {
  const response = await fetchDashboard(new Request(origin + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { ...env, ...extra });
  return { response, ...await response.json() as { data: T; error?: { code: string } } };
}
async function ready(count = 2) {
  const imported = await api<OutreachPage>('/api/outreach/import', 'POST', { items: Array.from({ length: count }, (_, index) => ({
    label: `Batch review ${index}`, recipient: `person-${index}@example.test`, subject: 'Owner-provided subject', body: 'Owner-provided copy.\nA second line.',
  })) });
  for (const item of imported.data.items) await api(`/api/outreach/${item.id}/prepare`, 'POST', { version: item.version });
  return (await api<OutreachPage>('/api/outreach')).data.items;
}
const picks = (items: OutreachItem[]) => items.map(({ id, version }) => ({ id, version }));
async function approve(items: { id: string; version: number }[], fields = {}) {
  return api<OutreachPage>('/api/outreach/approve-batch', 'POST', { items, confirmReviewed: true, ...fields });
}
async function approvedCount() { return env.DB.prepare("SELECT COUNT(*) AS n FROM outreach_jobs WHERE state='approved'").first<number>('n'); }

describe('complete batch review and approval', () => {
  it('approves reviewed current versions without sending, scheduling or replacing their pairs', async () => {
    const items = await ready();
    const pairs = (await env.DB.prepare('SELECT * FROM opt_out_links ORDER BY token').all()).results;
    const pixels = (await env.DB.prepare('SELECT * FROM pixels ORDER BY id').all()).results;
    const result = await approve(picks(items));
    expect(result.response.status).toBe(200);
    expect(result.data.items).toHaveLength(2);
    for (const item of result.data.items) {
      const before = items.find(value => value.id === item.id)!;
      expect(item).toMatchObject({ state: 'approved', version: before.version, preparedHtml: before.preparedHtml, preparedText: before.preparedText, pixelId: before.pixelId, optOutUrl: before.optOutUrl, scheduledAt: null, trackingStartsAt: null, automaticDelivery: null });
    }
    expect((await env.DB.prepare('SELECT * FROM opt_out_links ORDER BY token').all()).results).toEqual(pairs);
    expect((await env.DB.prepare('SELECT * FROM pixels ORDER BY id').all()).results).toEqual(pixels);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM outreach_deliveries').first<number>('n')).toBe(0);
  });

  it('requires explicit reviewed confirmation, exact fields, unique versions and a nonempty bounded selection', async () => {
    const items = await ready();
    expect((await approve(picks(items), { confirmReviewed: false })).error?.code).toBe('REVIEW_REQUIRED');
    expect((await approve(picks(items), { send: true })).response.status).toBe(400);
    expect((await approve([])).response.status).toBe(400);
    expect((await approve([picks(items)[0]!, picks(items)[0]!])).response.status).toBe(400);
    expect((await approve(picks(items).map(value => ({ ...value, version: 0 })))).response.status).toBe(400);
    expect(await approvedCount()).toBe(0);
  });

  it('rejects an entire stale batch without approving the unchanged members', async () => {
    const items = await ready();
    await api(`/api/outreach/${items[0]!.id}`, 'PATCH', { version: items[0]!.version, body: 'A revised version that needs review.' });
    expect((await approve(picks(items))).error?.code).toBe('APPROVAL_CHANGED');
    expect(await approvedCount()).toBe(0);
  });

  it('rejects an entire batch after one recipient opts out and retains that preference', async () => {
    const items = await ready();
    await api('/api/do-not-contact', 'POST', { recipient: items[0]!.recipient });
    expect((await approve(picks(items))).response.status).toBe(409);
    expect(await approvedCount()).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM do_not_contact').first<number>('n')).toBe(1);
  });

  it('rejects a missing or substituted persisted opt-out identity', async () => {
    const items = await ready();
    await env.DB.prepare('UPDATE outreach_jobs SET opt_out_url=? WHERE id=?').bind('https://other.example.test/outreach/stop/' + 'a'.repeat(64), items[0]!.id).run();
    expect((await approve(picks(items))).response.status).toBe(409);
    expect(await approvedCount()).toBe(0);
  });

  it('rejects mixed already-approved/prepared selections instead of changing part of the batch', async () => {
    const items = await ready();
    await api(`/api/outreach/${items[0]!.id}/approve`, 'POST', { version: items[0]!.version });
    expect((await approve(picks(items))).response.status).toBe(409);
    expect(await approvedCount()).toBe(1);
  });

  it('keeps both private owner authentication and mutation origin validation', async () => {
    const items = await ready();
    const response = await fetchDashboard(new Request(origin + '/api/outreach/approve-batch', { method: 'POST', headers: { Origin: 'https://other.example.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ items: picks(items), confirmReviewed: true }) }), env);
    expect(response.status).toBe(403);
    const unauthenticated = await fetchDashboard(new Request('https://maildesk.example.test/api/outreach/approve-batch', { method: 'POST', headers: { Origin: 'https://maildesk.example.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ items: picks(items), confirmReviewed: true }) }), { ...env, DEV_AUTH: undefined, DASHBOARD_ORIGIN: 'https://maildesk.example.test', ACCESS_TEAM_DOMAIN: 'owner.cloudflareaccess.com', ACCESS_AUD: 'fixture' });
    expect(unauthenticated.status).toBe(401);
    expect(await approvedCount()).toBe(0);
  });

  it('prevents manual queue edits and parallel Outlook tracking once an automatic send owns the message', async () => {
    const items = await ready(1), row = items[0]!;
    await approve(picks(items));
    const deliveryId = crypto.randomUUID(), now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO outreach_deliveries
      (id,job_id,approved_version,recipient,label,subject,body_html,body_text,pixel_id,opt_out_url,message_id,send_at,time_zone,tracking_starts_at,queued_at,updated_at)
      SELECT ?,id,version,recipient,label,subject,prepared_html,prepared_text,pixel_id,opt_out_url,?,?,'UTC',?,?,? FROM outreach_jobs WHERE id=?`)
      .bind(deliveryId, `<${deliveryId}@maildesk.example.test>`, now, now, now, now, row.id).run();
    const current = (await api<OutreachPage>('/api/outreach')).data.items[0]!;
    expect(current.canEdit).toBe(false);
    expect(current.automaticDelivery?.id).toBe(deliveryId);
    expect((await api(`/api/outreach/${row.id}`, 'PATCH', { version: row.version, body: 'Changed copy' })).error?.code).toBe('AUTOMATIC_DELIVERY_MANAGED');
    expect((await api(`/api/outreach/${row.id}/cancel`, 'POST', { version: row.version })).error?.code).toBe('AUTOMATIC_DELIVERY_MANAGED');
    expect((await api('/api/outreach/schedule', 'POST', { items: picks(items), sendAt: new Date(Date.now() + 300_000).toISOString(), delaySeconds: 45 })).error?.code).toBe('AUTOMATIC_DELIVERY_MANAGED');
    const manual = await api<{ id: string }>('/api/pixels', 'POST', { label: 'Separate manual draft', recipient: row.recipient });
    expect((await api(`/api/pixels/${manual.data.id}/schedule`, 'POST', { sendAt: new Date(Date.now() + 300_000).toISOString() })).error?.code).toBe('AUTOMATIC_DELIVERY_MANAGED');
    // A separate legacy plan can be between its past send time and its future
    // 45-second gate. Rescheduling it must not bypass an automatic-send hold.
    const imported = await api<OutreachPage>('/api/outreach/import', 'POST', { items: [{ label: 'Legacy manual plan', recipient: row.recipient, subject: 'Legacy subject', body: 'Legacy owner copy.' }] });
    const legacy = imported.data.items.find(value => value.label === 'Legacy manual plan')!;
    await api(`/api/outreach/${legacy.id}/prepare`, 'POST', { version: legacy.version });
    await api(`/api/outreach/${legacy.id}/approve`, 'POST', { version: legacy.version });
    const prepared = (await api<OutreachPage>('/api/outreach')).data.items.find(value => value.id === legacy.id)!;
    const past = new Date(Date.now() - 10_000).toISOString(), future = new Date(Date.now() + 35_000).toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE outreach_jobs SET state='scheduled',scheduled_at=?,tracking_starts_at=? WHERE id=?").bind(past, future, legacy.id),
      env.DB.prepare("UPDATE pixels SET status='armed',scheduled_send_at=?,armed_at=? WHERE id=?").bind(past, future, prepared.pixelId),
    ]);
    const before = await env.DB.prepare('SELECT * FROM pixels WHERE id=?').bind(prepared.pixelId).first();
    expect((await api(`/api/outreach/${legacy.id}/reschedule`, 'POST', { version: legacy.version, sendAt: new Date(Date.now() + 600_000).toISOString() })).error?.code).toBe('AUTOMATIC_DELIVERY_MANAGED');
    expect(await env.DB.prepare('SELECT * FROM pixels WHERE id=?').bind(prepared.pixelId).first()).toEqual(before);
    expect(await env.DB.prepare('SELECT state FROM outreach_deliveries WHERE id=?').bind(deliveryId).first('state')).toBe('pending');
  });
});
