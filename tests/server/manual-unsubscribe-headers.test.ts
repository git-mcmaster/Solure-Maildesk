import { readFile, readdir } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { fetchDashboard } from '../../src/server/dashboard';
import type { Env, OptOutLink, Pixel } from '../../src/server/types';
import type { OutreachItem, OutreachPage } from '../../src/shared/outreach';
import type { ManualPreparedUnsubscribeHeaders } from '../../src/shared/unsubscribe';

const dashboardOrigin = 'http://127.0.0.1:8787', publicOrigin = 'https://pixel.example.com';
const migrations = new URL('../../migrations/', import.meta.url);
let mf: Miniflare, env: Env;
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test"); } };', compatibilityDate: '2026-07-30', d1Databases: { DB: 'manual-unsubscribe-header-tests' } });
  const DB = await mf.getD1Database('DB') as unknown as D1Database;
  for (const file of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(new URL(file, migrations), 'utf8')).replace(/--[^\n]*/gu, '');
    const trigger = sql.indexOf('CREATE TRIGGER');
    await DB.batch((trigger < 0 ? sql : sql.slice(0, trigger)).split(';').map(value => value.trim()).filter(Boolean).map(value => DB.prepare(value)));
    if (trigger >= 0) await DB.prepare(sql.slice(trigger)).run();
  }
  env = { DB, OWNER_EMAIL: 'owner@example.com', DASHBOARD_ORIGIN: dashboardOrigin, PIXEL_ORIGIN: publicOrigin, DEV_AUTH: 'true', EMAIL_MODE: 'dry-run' };
}, 30_000);
beforeEach(async () => {
  await env.DB.batch(['DELETE FROM outreach_jobs', 'DELETE FROM opt_out_links', 'DELETE FROM do_not_contact', 'DELETE FROM pixel_reports', 'DELETE FROM notifications', 'DELETE FROM events', 'DELETE FROM pixels'].map(sql => env.DB.prepare(sql)));
});
afterAll(async () => { await mf?.dispose(); });
async function api<T = unknown>(path: string, method = 'GET', body?: unknown, overrides: Partial<Env> = {}) {
  const response = await fetchDashboard(new Request(`${dashboardOrigin}${path}`, { method, headers: { Origin: dashboardOrigin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { ...env, ...overrides });
  const payload = await response.json() as { data: T; error?: { code: string } };
  return { response, data: payload.data, error: payload.error };
}
async function manual(recipient = 'manual@example.com') {
  return (await api<Pixel>('/api/pixels', 'POST', { label: 'Existing manual pairing', recipient })).data;
}
async function paired(recipient?: string) {
  const pixel = await manual(recipient);
  const link = (await api<OptOutLink>(`/api/pixels/${pixel.id}/opt-out-link`, 'POST', {})).data;
  return { pixel, link };
}
function headers(pixel: Pixel, overrides: Partial<Env> = {}) {
  return api<ManualPreparedUnsubscribeHeaders>(`/api/pixels/${pixel.id}/unsubscribe-headers?recipient=${encodeURIComponent(pixel.recipient.trim().toLowerCase())}`, 'GET', undefined, overrides);
}

describe('manual message one-click header preparation', () => {
  it('requires an existing recipient-bound link and never creates one during header export', async () => {
    const pixel = await manual();
    expect((await headers(pixel)).error?.code).toBe('OPT_OUT_NOT_PREPARED');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM opt_out_links').first<number>('n')).toBe(0);
  });

  it('preserves the manual pixel, footer identity and recipient and returns preparation-only metadata', async () => {
    const { pixel, link } = await paired('Manual@Example.com');
    const before = (await api<Pixel>(`/api/pixels/${pixel.id}`)).data;
    const result = await headers(pixel);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get('Cache-Control')).toBe('no-store');
    expect(result.data).toMatchObject({ pixelId: pixel.id, recipient: 'manual@example.com', status: 'prepared-only', transportVerified: false, dkimSigningRequired: true,
      oneClickUrl: link.url.replace('/outreach/stop/', '/outreach/unsubscribe/') });
    expect((await headers(pixel)).data).toEqual(result.data);
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`)).data).toEqual(before);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM opt_out_links').first<number>('n')).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM do_not_contact').first<number>('n')).toBe(0);
  });

  it('rejects strict-query violations, stale recipients, HTTP production headers and missing owner authentication', async () => {
    const { pixel } = await paired();
    for (const query of ['', '?recipient=', '?recipient=invalid', '?recipient=manual@example.com&recipient=manual@example.com', '?recipient=manual@example.com&token=anything']) {
      expect((await api(`/api/pixels/${pixel.id}/unsubscribe-headers${query}`)).response.status).toBe(400);
    }
    expect((await api(`/api/pixels/${pixel.id}/unsubscribe-headers?recipient=other@example.com`)).error?.code).toBe('RECIPIENT_CHANGED');
    expect((await headers(pixel, { PIXEL_ORIGIN: 'http://127.0.0.1:8788' })).error?.code).toBe('INVALID_UNSUBSCRIBE_ORIGIN');
    expect((await api(`/api/pixels/${pixel.id}/unsubscribe-headers?recipient=manual@example.com`, 'POST', {})).response.status).toBe(405);
    const production = { ...env, DEV_AUTH: undefined, DASHBOARD_ORIGIN: 'https://maildesk.example.com', ACCESS_TEAM_DOMAIN: 'manual-headers.cloudflareaccess.com', ACCESS_AUD: 'manual-headers' };
    expect((await fetchDashboard(new Request(`${production.DASHBOARD_ORIGIN}/api/pixels/${pixel.id}/unsubscribe-headers?recipient=manual@example.com`), production)).status).toBe(401);
    expect((await api(`/api/pixels/${crypto.randomUUID()}/unsubscribe-headers?recipient=manual@example.com`)).response.status).toBe(404);
  });

  it('requires the review queue API for queue-managed images and blocks suppressed addresses', async () => {
    const imported = (await api<OutreachPage>('/api/outreach/import', 'POST', { items: [{ label: 'Queued item', recipient: 'queued@example.com', subject: 'Reviewed message', body: 'Prepared copy.' }] })).data.items[0]!;
    const queued = (await api<OutreachItem>(`/api/outreach/${imported.id}/prepare`, 'POST', { version: imported.version })).data;
    const queuedPixel = (await api<Pixel>(`/api/pixels/${queued.pixelId}`)).data;
    expect((await headers(queuedPixel)).error?.code).toBe('REVIEW_QUEUE_REQUIRED');
    const { pixel } = await paired();
    await api('/api/do-not-contact', 'POST', { recipient: pixel.recipient });
    expect((await headers(pixel)).error?.code).toBe('DO_NOT_CONTACT');
  });

  it('rechecks recipient pairing and suppression after the initial pixel read', async () => {
    for (const mutation of ['recipient', 'opt-out'] as const) {
      const { pixel } = await paired(`${mutation}@example.com`);
      let intercepted = false;
      const DB = { prepare(sql: string) {
        const statement = env.DB.prepare(sql);
        if (!sql.startsWith('SELECT l.token FROM pixels p')) return statement;
        return { bind(...values: unknown[]) {
          const bound = statement.bind(...values);
          return { first: async () => {
            if (!intercepted) {
              intercepted = true;
              if (mutation === 'recipient') await api(`/api/pixels/${pixel.id}`, 'PATCH', { recipient: 'changed@example.com' });
              else await api('/api/do-not-contact', 'POST', { recipient: pixel.recipient });
            }
            return bound.first();
          } };
        } } as D1PreparedStatement;
      }, batch: env.DB.batch.bind(env.DB) } as unknown as D1Database;
      const result = await headers(pixel, { DB });
      expect(intercepted).toBe(true); expect(result.error?.code).toBe('UNSUBSCRIBE_CHANGED'); expect(result.data).toBeUndefined();
    }
  });
});
