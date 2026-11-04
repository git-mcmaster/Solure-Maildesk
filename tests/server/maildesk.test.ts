import { readFile, readdir } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authenticate } from '../../src/server/auth';
import { fetchDashboard } from '../../src/server/dashboard';
import { dispatchNotifications, enforceRetention } from '../../src/server/notifications';
import { fetchPixel } from '../../src/server/pixel';
import type { Bootstrap, Env, Pixel, PixelPage } from '../../src/server/types';

let mf: Miniflare;
let env: Env;
const origin = 'http://127.0.0.1:8787';

beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test"); } };', compatibilityDate: '2026-07-30', d1Databases: { DB: 'maildesk-unit-tests' } });
  const DB = await mf.getD1Database('DB') as unknown as D1Database;
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
    const migration = await readFile(new URL(file, migrations), 'utf8');
    // D1.exec is line-oriented and cannot apply a multi-line trigger. Keep that
    // complete CREATE TRIGGER statement intact, just as Wrangler migrations do.
    const sql = migration.replace(/--[^\n]*/gu, '');
    const triggerAt = sql.indexOf('CREATE TRIGGER');
    const setup = sql.slice(0, triggerAt).split(';').map((part) => part.trim()).filter(Boolean);
    await DB.batch(setup.map((statement) => DB.prepare(statement)));
    await DB.prepare(sql.slice(triggerAt)).run();
  }
  env = { DB, OWNER_EMAIL: 'elijah@soluredigitalworks.com', DASHBOARD_ORIGIN: origin, PIXEL_ORIGIN: 'http://127.0.0.1:8788', DEV_AUTH: 'true', EMAIL_MODE: 'dry-run' };
}, 30_000);

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM notifications'), env.DB.prepare('DELETE FROM events'), env.DB.prepare('DELETE FROM pixels'),
    env.DB.prepare('UPDATE settings SET email_enabled=0,repeat_alerts=0,retention_days=90,event_day=NULL,event_count=0 WHERE id=1'),
  ]);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await mf?.dispose(); });

async function api<T = unknown>(path: string, method = 'GET', body?: unknown, override: Partial<Env> = {}) {
  const response = await fetchDashboard(new Request(`${origin}${path}`, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { ...env, ...override });
  const payload = await response.json() as { data: T; error?: { code: string } };
  return { response, data: payload.data, error: payload.error };
}
async function create(label = 'A proposal'): Promise<Pixel> { return (await api<Pixel>('/api/pixels', 'POST', { label })).data; }
async function load(pixel: Pixel) { return fetchPixel(new Request(pixel.pixelUrl), env); }
async function arm(pixel: Pixel) { return api<Pixel>(`/api/pixels/${pixel.id}`, 'PATCH', { status: 'armed' }); }

describe('owner access and request validation', () => {
  it('fails closed without production Access configuration, even if local bypass is accidentally set', async () => {
    const response = await fetchDashboard(new Request('https://maildesk.soluredigitalworks.com/api/bootstrap'), { ...env, DASHBOARD_ORIGIN: 'https://maildesk.soluredigitalworks.com', DEV_AUTH: 'true' });
    expect(response.status).toBe(503);
    const noBypass = await api('/api/bootstrap', 'GET', undefined, { DEV_AUTH: undefined });
    expect(noBypass.response.status).toBe(503);
  });

  it('validates the Access signature, issuer, audience and exact owner email', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } })));
    const issuer = 'https://maildesk-test.cloudflareaccess.com';
    const production: Env = { ...env, DEV_AUTH: undefined, DASHBOARD_ORIGIN: 'https://maildesk.soluredigitalworks.com', ACCESS_TEAM_DOMAIN: 'maildesk-test.cloudflareaccess.com', ACCESS_AUD: 'dashboard-audience' };
    const tokenFor = (email: string, aud = 'dashboard-audience', iss = issuer) => new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(iss).setAudience(aud).setExpirationTime('5m').sign(privateKey);
    const requestFor = (token: string) => new Request(`${production.DASHBOARD_ORIGIN}/api/bootstrap`, { headers: { 'Cf-Access-Jwt-Assertion': token } });
    await expect(authenticate(requestFor(await tokenFor(env.OWNER_EMAIL)), production)).resolves.toBeUndefined();
    await expect(authenticate(requestFor(await tokenFor('someone@soluredigitalworks.com')), production)).rejects.toMatchObject({ status: 403 });
    await expect(authenticate(requestFor(await tokenFor(env.OWNER_EMAIL, 'other-app')), production)).rejects.toMatchObject({ status: 403 });
    await expect(authenticate(requestFor(await tokenFor(env.OWNER_EMAIL, 'dashboard-audience', 'https://other.cloudflareaccess.com')), production)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a missing token when production Access is otherwise configured', async () => {
    const production: Env = { ...env, DEV_AUTH: undefined, DASHBOARD_ORIGIN: 'https://maildesk.soluredigitalworks.com', ACCESS_TEAM_DOMAIN: 'missing-token-test.cloudflareaccess.com', ACCESS_AUD: 'missing-token-audience' };
    const response = await fetchDashboard(new Request(`${production.DASHBOARD_ORIGIN}/api/bootstrap`), production);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'SIGN_IN_REQUIRED' } });
  });

  it('rejects an expired token even when its signature and owner are valid', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = { ...await exportJWK(publicKey), kid: 'expired-key', alg: 'RS256' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } })));
    const production: Env = { ...env, DEV_AUTH: undefined, DASHBOARD_ORIGIN: 'https://maildesk.soluredigitalworks.com', ACCESS_TEAM_DOMAIN: 'expired-token-test.cloudflareaccess.com', ACCESS_AUD: 'expired-token-audience' };
    const token = await new SignJWT({ email: env.OWNER_EMAIL }).setProtectedHeader({ alg: 'RS256', kid: 'expired-key' })
      .setIssuer('https://expired-token-test.cloudflareaccess.com').setAudience('expired-token-audience')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(privateKey);
    await expect(authenticate(new Request(`${production.DASHBOARD_ORIGIN}/api/bootstrap`, { headers: { 'Cf-Access-Jwt-Assertion': token } }), production)).rejects.toMatchObject({ status: 403, code: 'ACCESS_DENIED' });
  });

  it('rejects a tampered signature on an otherwise valid owner token', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = { ...await exportJWK(publicKey), kid: 'tampered-key', alg: 'RS256' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } })));
    const production: Env = { ...env, DEV_AUTH: undefined, DASHBOARD_ORIGIN: 'https://maildesk.soluredigitalworks.com', ACCESS_TEAM_DOMAIN: 'tampered-token-test.cloudflareaccess.com', ACCESS_AUD: 'tampered-token-audience' };
    const token = await new SignJWT({ email: env.OWNER_EMAIL }).setProtectedHeader({ alg: 'RS256', kid: 'tampered-key' })
      .setIssuer('https://tampered-token-test.cloudflareaccess.com').setAudience('tampered-token-audience').setExpirationTime('5m').sign(privateKey);
    const [header, payload, signature] = token.split('.') as [string, string, string];
    const changedSignature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
    const request = new Request(`${production.DASHBOARD_ORIGIN}/api/bootstrap`, { headers: { 'Cf-Access-Jwt-Assertion': `${header}.${payload}.${changedSignature}` } });
    await expect(authenticate(request, production)).rejects.toMatchObject({ status: 403, code: 'ACCESS_DENIED' });
  });

  it('rejects an alternate production hostname before accepting any token', async () => {
    const production: Env = { ...env, DEV_AUTH: undefined, DASHBOARD_ORIGIN: 'https://maildesk.soluredigitalworks.com', ACCESS_TEAM_DOMAIN: 'wrong-host-test.cloudflareaccess.com', ACCESS_AUD: 'wrong-host-audience' };
    const response = await fetchDashboard(new Request('https://alternate.example.com/api/bootstrap', { headers: { 'Cf-Access-Jwt-Assertion': 'untrusted-token' } }), production);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'HOST_NOT_ALLOWED' } });
  });

  it('never invokes the static asset binding for an unauthenticated production request', async () => {
    const assetFetch = vi.fn(async () => new Response('Private dashboard HTML'));
    const production: Env = { ...env, DEV_AUTH: undefined, DASHBOARD_ORIGIN: 'https://maildesk.soluredigitalworks.com', ACCESS_TEAM_DOMAIN: 'static-auth-test.cloudflareaccess.com', ACCESS_AUD: 'static-auth-audience', ASSETS: { fetch: assetFetch } as unknown as Fetcher };
    const response = await fetchDashboard(new Request(`${production.DASHBOARD_ORIGIN}/assets/dashboard.js`), production);
    expect(response.status).toBe(401);
    expect(assetFetch).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('Private dashboard HTML');
  });

  it('denies cross-origin and missing-origin mutations', async () => {
    for (const requestOrigin of ['https://attacker.example', null]) {
      const response = await fetchDashboard(new Request(`${origin}/api/pixels`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(requestOrigin ? { Origin: requestOrigin } : {}) }, body: '{}' }), env);
      expect(response.status).toBe(403);
    }
    expect((await api<PixelPage>('/api/pixels')).data.items).toEqual([]);
  });

  it('validates editable fields and rejects attempts to inject an alert destination', async () => {
    const result = await api('/api/pixels', 'POST', { label: 'x', to: 'attacker@example.com' });
    expect(result.response.status).toBe(400);
    expect((await api('/api/pixels', 'POST', { recipient: 'not an address' })).response.status).toBe(400);
    expect((await api('/api/settings', 'PATCH', { retentionDays: 1 })).response.status).toBe(400);
  });
});

describe('image requests and manual labeling', () => {
  it('records early loads without notifying and preserves events when labeled afterward', async () => {
    const pixel = await create();
    await load(pixel);
    const changed = await api<Pixel>(`/api/pixels/${pixel.id}`, 'PATCH', { label: 'Website proposal', recipient: 'client@example.com' });
    expect(changed.data).toMatchObject({ label: 'Website proposal', loadCount: 1, earlyLoadCount: 1, notificationStatus: 'none' });
    expect((await api<{ phase: string }[]>(`/api/pixels/${pixel.id}/events`)).data[0]?.phase).toBe('before_arming');
  });

  it('creates exactly one first-load outbox item under concurrent requests', async () => {
    const pixel = await create();
    await api('/api/settings', 'PATCH', { emailEnabled: true });
    await arm(pixel);
    await Promise.all(Array.from({ length: 12 }, () => load(pixel)));
    const result = await api<Bootstrap>('/api/bootstrap');
    expect(result.data.pixels[0]?.loadCount).toBe(12);
    expect(result.data.notifications).toHaveLength(1);
    expect(result.data.notifications[0]?.status).toBe('pending');
  });

  it('keeps known and unknown image responses identical, and HEAD does not record', async () => {
    const pixel = await create();
    const head = await fetchPixel(new Request(pixel.pixelUrl, { method: 'HEAD' }), env);
    expect(head.status).toBe(200);
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`)).data.loadCount).toBe(0);
    const valid = await load(pixel);
    const unknown = await fetchPixel(new Request(`${env.PIXEL_ORIGIN}/p/${'0'.repeat(32)}.gif`), env);
    expect(await valid.arrayBuffer()).toEqual(await unknown.arrayBuffer());
    expect(unknown.headers.get('Cache-Control')).toContain('no-store');
    const malformed = await fetchPixel(new Request(`${env.PIXEL_ORIGIN}/api/bootstrap`), env);
    expect(malformed.status).toBe(404);
  });

  it('returns the image when storage is unavailable', async () => {
    const pixel = await create();
    const response = await fetchPixel(new Request(pixel.pixelUrl), { ...env, DB: { prepare() { throw new Error('Unavailable'); } } as unknown as D1Database });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/gif');
  });

  it('stops recording archived pixels and cascades deletion of stored records', async () => {
    const pixel = await create();
    await arm(pixel);
    await load(pixel);
    await api(`/api/pixels/${pixel.id}`, 'PATCH', { status: 'archived' });
    await load(pixel);
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`)).data.loadCount).toBe(1);
    await api(`/api/pixels/${pixel.id}`, 'DELETE');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM events').first('count')).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM notifications').first('count')).toBe(0);
  });

  it('caps stored requests per pixel per day', async () => {
    const pixel = await create();
    const now = new Date().toISOString();
    await env.DB.batch(Array.from({ length: 200 }, () => env.DB.prepare("INSERT INTO events (id,pixel_id,created_at,phase) VALUES (?,?,?,'before_arming')").bind(crypto.randomUUID(), pixel.id, now)));
    await load(pixel);
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`)).data.loadCount).toBe(200);
  });

  it('keeps daily caps atomic under concurrent requests and resets them on a new day', async () => {
    const pixel = await create();
    const now = new Date().toISOString();
    await env.DB.batch(Array.from({ length: 199 }, () => env.DB.prepare("INSERT INTO events (id,pixel_id,created_at,phase) VALUES (?,?,?,'before_arming')").bind(crypto.randomUUID(), pixel.id, now)));
    await Promise.all(Array.from({ length: 8 }, () => load(pixel)));
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`)).data.loadCount).toBe(200);
    expect(await env.DB.prepare('SELECT event_count FROM settings WHERE id=1').first('event_count')).toBe(200);
    await env.DB.prepare("UPDATE pixels SET daily_load_day='2000-01-01' WHERE id=?").bind(pixel.id).run();
    await env.DB.prepare("UPDATE settings SET event_day='2000-01-01',event_count=10000 WHERE id=1").run();
    await load(pixel);
    expect(await env.DB.prepare('SELECT daily_load_count FROM pixels WHERE id=?').bind(pixel.id).first('daily_load_count')).toBe(1);
    expect(await env.DB.prepare('SELECT event_count FROM settings WHERE id=1').first('event_count')).toBe(1);
    await env.DB.prepare('UPDATE settings SET event_count=10000 WHERE id=1').run();
    await load(pixel);
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`)).data.loadCount).toBe(201);
  });

  it('neutralizes spreadsheet formulas in exported labels and notes', async () => {
    const pixel = await create('=HYPERLINK("https://example.com")');
    await api(`/api/pixels/${pixel.id}`, 'PATCH', { notes: '+SUM(1,2)' });
    const response = await fetchDashboard(new Request(`${origin}/api/export.csv`), env);
    const csv = await response.text();
    expect(csv).toContain('"\'=HYPERLINK');
    expect(csv).toContain('"\'+SUM(1,2)"');
  });

  it('searches older records on the server and returns truthful page totals and global statistics', async () => {
    const rows = Array.from({ length: 105 }, (_, i) => env.DB.prepare('INSERT INTO pixels (id,token,label,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), crypto.randomUUID().replace(/-/gu, ''), i === 0 ? 'Older matching proposal' : `Message ${i}`, i === 1 ? 'archived' : 'draft', new Date(1_700_000_000_000 + i * 1000).toISOString(), new Date().toISOString()));
    await env.DB.batch(rows);
    const bootstrap = (await api<Bootstrap>('/api/bootstrap')).data;
    expect(bootstrap.pixels).toHaveLength(100);
    expect(bootstrap.stats.total).toBe(105);
    const page = (await api<PixelPage>('/api/pixels?limit=100&status=active')).data;
    expect(page).toMatchObject({ total: 104, hasMore: true, offset: 0 });
    const search = (await api<PixelPage>('/api/pixels?q=Older%20matching')).data;
    expect(search.total).toBe(1);
    expect(search.items[0]?.label).toBe('Older matching proposal');
    const second = (await api<PixelPage>('/api/pixels?offset=100&status=active')).data;
    expect(second.items).toHaveLength(4);
    expect(second.hasMore).toBe(false);
  });
});

describe('notification outbox and retention', () => {
  it('sends dry-run notifications without calling an external provider', async () => {
    const send = vi.fn();
    const pixel = await create();
    await api('/api/settings', 'PATCH', { emailEnabled: true });
    await arm(pixel);
    await load(pixel);
    await dispatchNotifications({ ...env, EMAIL: { send } });
    expect(send).not.toHaveBeenCalled();
    expect((await api<Bootstrap>('/api/bootstrap')).data.notifications[0]?.status).toBe('dry_run');
  });

  it('retries a failed send, restricts it to the owner, and does not resend a delivered item', async () => {
    const pixel = await create('Notification test');
    await api('/api/settings', 'PATCH', { emailEnabled: true });
    await arm(pixel);
    await load(pixel);
    const send = vi.fn().mockRejectedValueOnce(new Error('Provider secret must not leak')).mockResolvedValue({ messageId: 'accepted' });
    const live: Env = { ...env, EMAIL_MODE: 'live', EMAIL_FROM: 'alerts@notify.soluredigitalworks.com', EMAIL: { send } };
    const now = new Date();
    await dispatchNotifications(live, now);
    const failed = (await api<Bootstrap>('/api/bootstrap')).data.notifications[0]!;
    expect(failed.status).toBe('failed');
    expect(failed.lastError).not.toContain('secret');
    await dispatchNotifications(live, new Date(now.getTime() + 600_000));
    await dispatchNotifications(live, new Date(now.getTime() + 900_000));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].to).toBe(env.OWNER_EMAIL);
    expect((await api<Bootstrap>('/api/bootstrap')).data.notifications[0]?.status).toBe('sent');
  });

  it('claims a notification once across concurrent dispatchers', async () => {
    const pixel = await create();
    await api('/api/settings', 'PATCH', { emailEnabled: true });
    await arm(pixel);
    await load(pixel);
    const send = vi.fn(async () => ({ messageId: 'accepted' }));
    const live: Env = { ...env, EMAIL_MODE: 'live', EMAIL_FROM: 'alerts@notify.soluredigitalworks.com', EMAIL: { send } };
    await Promise.all([dispatchNotifications(live), dispatchNotifications(live)]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('cancels queued email when the pixel is paused or archived', async () => {
    for (const status of ['paused', 'archived']) {
      const pixel = await create(status);
      await api('/api/settings', 'PATCH', { emailEnabled: true });
      await arm(pixel);
      await load(pixel);
      await api(`/api/pixels/${pixel.id}`, 'PATCH', { status });
    }
    const send = vi.fn(async () => ({ messageId: 'accepted' }));
    await dispatchNotifications({ ...env, EMAIL_MODE: 'live', EMAIL_FROM: 'alerts@notify.soluredigitalworks.com', EMAIL: { send } });
    expect(send).not.toHaveBeenCalled();
    expect((await api<Bootstrap>('/api/bootstrap')).data.notifications.every((n) => n.status === 'disabled')).toBe(true);
  });

  it('applies a rolling hour cooldown across a clock-hour boundary', async () => {
    const pixel = await create();
    await arm(pixel);
    await api('/api/settings', 'PATCH', { repeatAlerts: true });
    const insert = (at: string) => env.DB.prepare("INSERT INTO events (id,pixel_id,created_at,phase) VALUES (?,?,?,'after_arming')").bind(crypto.randomUUID(), pixel.id, at).run();
    await insert('2026-11-02T12:59:59.000Z');
    await insert('2026-11-02T13:00:00.000Z');
    expect((await api<Bootstrap>('/api/bootstrap')).data.notifications).toHaveLength(1);
    await insert('2026-11-02T14:00:00.000Z');
    expect((await api<Bootstrap>('/api/bootstrap')).data.notifications).toHaveLength(2);
  });

  it('retains first-alert suppression after event history expires', async () => {
    const pixel = await create();
    await arm(pixel);
    await load(pixel);
    await env.DB.prepare("UPDATE notifications SET created_at='2025-01-01T00:00:00.000Z',status='failed',attempts=5").run();
    await env.DB.prepare("UPDATE events SET created_at='2025-01-01T00:00:00.000Z'").run();
    await enforceRetention(env);
    await load(pixel);
    expect((await api<Bootstrap>('/api/bootstrap')).data.notifications).toHaveLength(0);
    const retained = (await api<Pixel>(`/api/pixels/${pixel.id}`)).data;
    expect(retained.loadCount).toBe(2);
    expect(retained.firstAlertAt).not.toBeNull();
  });
});
