import { readFile, readdir } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authenticate } from '../../src/server/auth';
import { fetchDashboard } from '../../src/server/dashboard';
import { dispatchNotifications, enforceRetention } from '../../src/server/notifications';
import { fetchPixel } from '../../src/server/pixel';
import type { Bootstrap, Env, LoadEvent, LoadEventPage, Pixel, PixelPage, Settings } from '../../src/server/types';

let mf: Miniflare;
let env: Env;
const origin = 'http://127.0.0.1:8787';
const migrations = new URL('../../migrations/', import.meta.url);

async function applyMigration(DB: D1Database, file: string) {
  const migration = await readFile(new URL(file, migrations), 'utf8');
  // Keep a complete trigger intact; plain additive migrations have no trigger.
  const sql = migration.replace(/--[^\n]*/gu, '');
  const triggerAt = sql.indexOf('CREATE TRIGGER');
  const setup = (triggerAt < 0 ? sql : sql.slice(0, triggerAt)).split(';').map((part) => part.trim()).filter(Boolean);
  await DB.batch(setup.map((statement) => DB.prepare(statement)));
  if (triggerAt >= 0) await DB.prepare(sql.slice(triggerAt)).run();
}

beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test"); } };', compatibilityDate: '2026-07-30', d1Databases: { DB: 'maildesk-unit-tests', LEGACY_DB: 'maildesk-migration-tests' } });
  const DB = await mf.getD1Database('DB') as unknown as D1Database;
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
    await applyMigration(DB, file);
  }
  env = { DB, OWNER_EMAIL: 'elijah@soluredigitalworks.com', DASHBOARD_ORIGIN: origin, PIXEL_ORIGIN: 'http://127.0.0.1:8788', DEV_AUTH: 'true', EMAIL_MODE: 'dry-run' };
}, 30_000);

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM notifications'), env.DB.prepare('DELETE FROM events'), env.DB.prepare('DELETE FROM pixels'),
    env.DB.prepare('UPDATE settings SET email_enabled=0,repeat_alerts=0,capture_request_details=0,keep_unloaded_pixels=0,retention_days=90,event_day=NULL,event_count=0 WHERE id=1'),
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

function detailedRequest(pixel: Pixel, method = 'GET') {
  const request = new Request(pixel.pixelUrl, { method, headers: { 'CF-Connecting-IP': '198.51.100.23', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/130.0' } });
  Object.defineProperty(request, 'cf', { value: { city: 'Test city', region: 'Test region', country: 'US', timezone: 'America/New_York', asn: 64500, asOrganization: 'Test network' } });
  return request;
}

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

describe('paginated retained event history', () => {
  it('returns every retained event beyond 1000 in stable timestamp/id order, including null details', async () => {
    const pixel = await create();
    const fixtures = Array.from({ length: 1105 }, (_, index) => ({
      id: (index + 1).toString(16).padStart(32, '0'),
      // At most 180 events per day, with timestamp ties crossing page boundaries.
      createdAt: new Date(Date.UTC(2026, 9, 20) + Math.floor(index / 180) * 86_400_000 + Math.floor(index % 180 / 20) * 1000).toISOString(),
      metadata: index % 17 === 0 ? JSON.stringify({ city: `Request location ${index % 3}`, country: 'US' }) : null,
    }));
    for (let offset = 0; offset < fixtures.length; offset += 100) {
      await env.DB.batch(fixtures.slice(offset, offset + 100).map((row) => env.DB.prepare("INSERT INTO events (id,pixel_id,created_at,phase,request_metadata) VALUES (?,?,?,'before_arming',?)").bind(row.id, pixel.id, row.createdAt, row.metadata)));
    }
    const expected = [...fixtures].sort((a, b) => a.createdAt === b.createdAt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.createdAt < b.createdAt ? 1 : -1);
    const legacy = (await api<LoadEvent[]>(`/api/pixels/${pixel.id}/events`)).data;
    expect(Array.isArray(legacy)).toBe(true);
    expect(legacy.map((event) => event.id)).toEqual(expected.slice(0, 1000).map((row) => row.id));
    const all: LoadEvent[] = [];
    let cursor: string | null = null;
    let complete = false;
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      const result: { data: LoadEventPage } = await api<LoadEventPage>(`/api/pixels/${pixel.id}/events?limit=137${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(result.data.items.length).toBeLessThanOrEqual(137);
      all.push(...result.data.items);
      cursor = result.data.nextCursor;
      if (cursor === null) { complete = true; break; }
    }
    expect(complete).toBe(true);
    expect(all.map((event) => event.id)).toEqual(expected.map((row) => row.id));
    expect(new Set(all.map((event) => event.id)).size).toBe(1105);
    expect(all.some((event) => event.metadata === null)).toBe(true);
    expect(all.some((event) => event.metadata?.city?.startsWith('Request location'))).toBe(true);
  });

  it('keeps older pages stable when newer events arrive or earlier and cursor rows are deleted', async () => {
    const pixel = await create();
    const at = '2026-11-04T00:00:00.000Z';
    const id = (number: number) => number.toString(16).padStart(32, '0');
    await env.DB.batch(Array.from({ length: 6 }, (_, index) => env.DB.prepare("INSERT INTO events (id,pixel_id,created_at,phase) VALUES (?,?,?,'before_arming')").bind(id(index + 1), pixel.id, at)));
    const first = (await api<LoadEventPage>(`/api/pixels/${pixel.id}/events?limit=2`)).data;
    expect(first.items.map((event) => event.id)).toEqual([id(6), id(5)]);
    await env.DB.prepare('DELETE FROM events WHERE id=?').bind(id(6)).run();
    await env.DB.prepare("INSERT INTO events (id,pixel_id,created_at,phase) VALUES (?,?,?,'before_arming')").bind(id(7), pixel.id, '2026-11-04T00:00:01.000Z').run();
    const second = (await api<LoadEventPage>(`/api/pixels/${pixel.id}/events?limit=2&cursor=${first.nextCursor}`)).data;
    expect(second.items.map((event) => event.id)).toEqual([id(4), id(3)]);
    await env.DB.prepare('DELETE FROM events WHERE id=?').bind(id(3)).run();
    const third = (await api<LoadEventPage>(`/api/pixels/${pixel.id}/events?limit=2&cursor=${second.nextCursor}`)).data;
    expect(third.items.map((event) => event.id)).toEqual([id(2), id(1)]);
    expect(third.nextCursor).toBeNull();
    expect(third.items.every((event) => event.metadata === null)).toBe(true);
  });

  it('rejects malformed queries and cursors from another pixel, and supports empty and cursor-only pages', async () => {
    const pixel = await create();
    const other = await create('Other message');
    expect((await api<LoadEventPage>(`/api/pixels/${pixel.id}/events?limit=100`)).data).toEqual({ items: [], nextCursor: null });
    const at = '2026-11-04T00:00:00.000Z';
    await env.DB.batch(Array.from({ length: 2 }, () => env.DB.prepare("INSERT INTO events (id,pixel_id,created_at,phase) VALUES (?,?,?,'before_arming')").bind(crypto.randomUUID(), pixel.id, at)));
    const first = (await api<LoadEventPage>(`/api/pixels/${pixel.id}/events?limit=1`)).data;
    expect(first.nextCursor).toBeTypeOf('string');
    const continuation = (await api<LoadEventPage>(`/api/pixels/${pixel.id}/events?cursor=${first.nextCursor}`)).data;
    expect(continuation.items).toHaveLength(1);
    expect(continuation.nextCursor).toBeNull();
    const crossPixel = await api(`/api/pixels/${other.id}/events?limit=1&cursor=${first.nextCursor}`);
    expect(crossPixel.response.status).toBe(400);
    expect(crossPixel.error?.code).toBe('INVALID_QUERY');
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
    const validShape = { v: 1, p: pixel.id, t: at, i: first.items[0]!.id };
    const cursors = ['garbage', 'a'.repeat(513), encode({}), encode({ ...validShape, v: 2 }), encode({ ...validShape, t: '2026-02-30T00:00:00.000Z' }), encode({ ...validShape, i: "x' OR 1=1--" }), encode({ ...validShape, extra: true })];
    const queries = ['limit=', 'limit=0', 'limit=201', 'limit=-1', 'limit=1.5', 'limit=abc', 'limit=10&limit=20', 'cursor=', 'cursor=%25', 'cursor=a&cursor=b', 'unexpected=1', ...cursors.map((cursor) => `cursor=${cursor}`)];
    for (const query of queries) {
      const response = await api(`/api/pixels/${pixel.id}/events?${query}`);
      expect(response.response.status, query).toBe(400);
      expect(response.error?.code, query).toBe('INVALID_QUERY');
    }
  });
});

describe('optional private request details', () => {
  it('defaults capture off, validates the owner setting, and does not retain details until enabled', async () => {
    expect((await api<Settings>('/api/settings')).data.captureRequestDetails).toBe(false);
    for (const value of ['true', 1, null, {}]) expect((await api('/api/settings', 'PATCH', { captureRequestDetails: value })).response.status).toBe(400);
    const pixel = await create();
    await fetchPixel(detailedRequest(pixel), env);
    expect(await env.DB.prepare('SELECT request_metadata FROM events WHERE pixel_id=?').bind(pixel.id).first('request_metadata')).toBeNull();
    expect((await api<LoadEvent[]>(`/api/pixels/${pixel.id}/events`)).data[0]?.metadata).toBeNull();
    const enabled = await api<Settings>('/api/settings', 'PATCH', { captureRequestDetails: true });
    expect(enabled.response.status).toBe(200);
    expect(enabled.data.captureRequestDetails).toBe(true);
    await fetchPixel(detailedRequest(pixel), env);
    const events = (await api<LoadEvent[]>(`/api/pixels/${pixel.id}/events`)).data;
    expect(events).toHaveLength(2);
    expect(events.filter((event) => event.metadata)).toHaveLength(1);
    expect(events.find((event) => event.metadata)?.metadata).toMatchObject({ requestIp: '198.51.100.23', city: 'Test city', country: 'US', network: 'Test network', client: 'Firefox', platform: 'Windows', device: 'Desktop' });
    await api('/api/settings', 'PATCH', { captureRequestDetails: false });
    await fetchPixel(detailedRequest(pixel), env);
    expect((await api<LoadEvent[]>(`/api/pixels/${pixel.id}/events`)).data.filter((event) => event.metadata)).toHaveLength(1);
  });

  it('never exposes stored details through the public image response or an unauthenticated events API', async () => {
    const pixel = await create();
    await api('/api/settings', 'PATCH', { captureRequestDetails: true });
    const known = await fetchPixel(detailedRequest(pixel), env);
    const unknown = await fetchPixel(detailedRequest({ ...pixel, pixelUrl: `${env.PIXEL_ORIGIN}/p/${'0'.repeat(32)}.gif` }), env);
    expect(await known.arrayBuffer()).toEqual(await unknown.arrayBuffer());
    expect([...known.headers]).toEqual([...unknown.headers]);
    expect(JSON.stringify([...known.headers])).not.toContain('198.51.100.23');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM events').first('count')).toBe(1);
    const production: Env = { ...env, DEV_AUTH: undefined, DASHBOARD_ORIGIN: 'https://maildesk.soluredigitalworks.com', ACCESS_TEAM_DOMAIN: 'private-metadata-test.cloudflareaccess.com', ACCESS_AUD: 'private-metadata-test' };
    const response = await fetchDashboard(new Request(`${production.DASHBOARD_ORIGIN}/api/pixels/${pixel.id}/events`), production);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('198.51.100.23');
    const prepare = vi.fn(() => { throw new Error('HEAD must not query storage'); });
    const head = await fetchPixel(detailedRequest(pixel, 'HEAD'), { ...env, DB: { prepare } as unknown as D1Database });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(prepare).not.toHaveBeenCalled();
    await api(`/api/pixels/${pixel.id}`, 'PATCH', { status: 'archived' });
    await fetchPixel(detailedRequest(pixel), env);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM events').first('count')).toBe(1);
  });

  it('rechecks capture atomically so disabling during a request stores no metadata', async () => {
    const pixel = await create();
    await api('/api/settings', 'PATCH', { captureRequestDetails: true });
    const DB = { prepare(sql: string) {
      if (sql === 'SELECT capture_request_details FROM settings WHERE id=1') return { async first() {
        await env.DB.prepare('UPDATE settings SET capture_request_details=0 WHERE id=1').run();
        return 1;
      } } as unknown as D1PreparedStatement;
      return env.DB.prepare(sql);
    } } as unknown as D1Database;
    await fetchPixel(detailedRequest(pixel), { ...env, DB });
    expect((await api<LoadEvent[]>(`/api/pixels/${pixel.id}/events`)).data).toHaveLength(1);
    expect(await env.DB.prepare('SELECT request_metadata FROM events WHERE pixel_id=?').bind(pixel.id).first('request_metadata')).toBeNull();
  });

  it('does not restore stale capture or cleanup settings after concurrent preservation changes', async () => {
    await api('/api/settings', 'PATCH', { captureRequestDetails: true });
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const DB = { prepare(sql: string) {
      const statement = env.DB.prepare(sql);
      if (sql.startsWith('UPDATE settings SET')) return { bind(...values: unknown[]) {
        return { async run() { entered(); await gate; return statement.bind(...values).run(); } } as unknown as D1PreparedStatement;
      } } as unknown as D1PreparedStatement;
      return statement;
    } } as unknown as D1Database;
    const retentionSave = api<Settings>('/api/settings', 'PATCH', { retentionDays: 30 }, { DB });
    await waiting;
    try { expect((await api<Settings>('/api/settings', 'PATCH', { captureRequestDetails: false, keepUnloadedPixels: true })).data.captureRequestDetails).toBe(false); }
    finally { release(); }
    expect((await retentionSave).response.status).toBe(200);
    expect((await api<Settings>('/api/settings')).data).toMatchObject({ captureRequestDetails: false, retentionDays: 30, keepUnloadedPixels: true });
  });

  it('serves old events with null details and treats corrupted stored metadata as unavailable', async () => {
    const pixel = await create();
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO events (id,pixel_id,created_at,phase) VALUES (?,?,?,'before_arming')").bind(crypto.randomUUID(), pixel.id, now).run();
    expect((await api<LoadEvent[]>(`/api/pixels/${pixel.id}/events`)).data[0]?.metadata).toBeNull();
    await env.DB.prepare("UPDATE events SET request_metadata='not JSON' WHERE pixel_id=?").bind(pixel.id).run();
    expect((await api<LoadEvent[]>(`/api/pixels/${pixel.id}/events`)).data[0]?.metadata).toBeNull();
  });

  it('retains old metadata automatically and removes it only through explicit history clearing or deletion', async () => {
    const pixel = await create();
    await api('/api/settings', 'PATCH', { captureRequestDetails: true });
    await fetchPixel(detailedRequest(pixel), env);
    await env.DB.prepare("UPDATE events SET created_at='2025-01-01T00:00:00.000Z'").run();
    await enforceRetention(env);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM events').first('count')).toBe(1);
    await fetchPixel(detailedRequest(pixel), env);
    expect((await api<LoadEvent[]>(`/api/pixels/${pixel.id}/events`)).data[0]?.metadata?.requestIp).toBe('198.51.100.23');
    await api(`/api/pixels/${pixel.id}/events`, 'DELETE');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM events').first('count')).toBe(0);
    await fetchPixel(detailedRequest(pixel), env);
    await api(`/api/pixels/${pixel.id}`, 'DELETE');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM events').first('count')).toBe(0);
  });
});

describe('permanent loaded history and unused pixel cleanup', () => {
  const cleanupAt = new Date('2030-01-01T00:00:00.000Z');
  const cutoff = cleanupAt.getTime() - 90 * 86_400_000;
  async function aged(label: string, offset = -1): Promise<Pixel> {
    const pixel = await create(label);
    await env.DB.prepare('UPDATE pixels SET created_at=? WHERE id=?').bind(new Date(cutoff + offset).toISOString(), pixel.id).run();
    return pixel;
  }

  it('backfills every legacy load signal without deleting history, and remembers subsequent inserts', async () => {
    const DB = await mf.getD1Database('LEGACY_DB') as unknown as D1Database;
    for (const file of ['0001_initial.sql', '0002_daily_counters.sql', '0003_request_details.sql']) await applyMigration(DB, file);
    const scalarEvidence: [string, number | string][] = [
      ['load_count', 1], ['early_load_count', 1], ['daily_load_count', 1],
      ['first_loaded_at', '2025-01-01T00:00:00.000Z'], ['last_loaded_at', '2025-01-01T00:00:00.000Z'], ['first_alert_at', '2025-01-01T00:00:00.000Z'],
    ];
    const ids = ['unused', ...scalarEvidence.map(([column]) => column), 'event-only', 'notification-only'];
    await DB.batch(ids.map((id, index) => DB.prepare("INSERT INTO pixels(id,token,label,created_at,updated_at) VALUES(?,?,?,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z')").bind(id, index.toString(16).padStart(32, '0'), id)));
    await DB.batch(scalarEvidence.map(([column, value]) => DB.prepare(`UPDATE pixels SET ${column}=? WHERE id=?`).bind(value, column)));
    await DB.prepare("INSERT INTO events(id,pixel_id,created_at,phase) VALUES('legacy-event','event-only','2025-01-01T00:00:00.000Z','before_arming')").run();
    await DB.prepare("UPDATE pixels SET load_count=0,early_load_count=0,daily_load_count=0,first_loaded_at=NULL,last_loaded_at=NULL,first_alert_at=NULL WHERE id='event-only'").run();
    await DB.prepare("INSERT INTO notifications(id,pixel_id,dedupe_key,created_at,status,next_attempt_at) VALUES('legacy-notification','notification-only','legacy-key','2025-01-01T00:00:00.000Z','disabled','2025-01-01T00:00:00.000Z')").run();
    await applyMigration(DB, '0004_permanent_loaded_history.sql');
    const rows = (await DB.prepare('SELECT id,has_recorded_load,preserve_unloaded FROM pixels').all<{ id: string; has_recorded_load: number; preserve_unloaded: number }>()).results;
    expect(rows).toHaveLength(ids.length);
    for (const row of rows) expect(row).toMatchObject({ has_recorded_load: row.id === 'unused' ? 0 : 1, preserve_unloaded: 0 });
    expect(await DB.prepare('SELECT keep_unloaded_pixels FROM settings WHERE id=1').first('keep_unloaded_pixels')).toBe(0);
    expect(await DB.prepare('SELECT COUNT(*) AS count FROM events').first('count')).toBe(1);
    expect(await DB.prepare('SELECT COUNT(*) AS count FROM notifications').first('count')).toBe(1);
    await DB.prepare("INSERT INTO events(id,pixel_id,created_at,phase) VALUES('new-event','unused','2026-11-04T00:00:00.000Z','before_arming')").run();
    await DB.prepare("DELETE FROM events WHERE pixel_id='unused'").run();
    expect(await DB.prepare("SELECT has_recorded_load FROM pixels WHERE id='unused'").first('has_recorded_load')).toBe(1);
  });

  it('deletes only genuinely unused pixels strictly older than 90 days, including archived ones', async () => {
    const old = await aged('Older than cutoff');
    const exact = await aged('At cutoff', 0);
    const newer = await aged('Newer than cutoff', 1);
    const archived = await aged('Archived and unused');
    await api(`/api/pixels/${archived.id}`, 'PATCH', { status: 'archived' });
    await enforceRetention(env, cleanupAt);
    for (const pixel of [old, archived]) expect((await api(`/api/pixels/${pixel.id}`)).response.status).toBe(404);
    for (const pixel of [exact, newer]) expect((await api(`/api/pixels/${pixel.id}`)).response.status).toBe(200);
    await enforceRetention(env, new Date(cleanupAt.getTime() + 1));
    expect((await api(`/api/pixels/${exact.id}`)).response.status).toBe(404);
    expect((await api(`/api/pixels/${newer.id}`)).response.status).toBe(200);
  });

  it('honors global and per-pixel preservation, validates booleans and allows explicit owner deletion', async () => {
    const preserved = await aged('Preserved unused');
    const plain = await aged('Ordinary unused');
    expect((await api<Settings>('/api/settings')).data.keepUnloadedPixels).toBe(false);
    expect(preserved).toMatchObject({ preserveUnloaded: false, hasRecordedLoad: false });
    for (const value of [1, 'true', null]) {
      expect((await api('/api/settings', 'PATCH', { keepUnloadedPixels: value })).response.status).toBe(400);
      expect((await api(`/api/pixels/${preserved.id}`, 'PATCH', { preserveUnloaded: value })).response.status).toBe(400);
    }
    expect((await api<Pixel>(`/api/pixels/${preserved.id}`, 'PATCH', { preserveUnloaded: true })).data.preserveUnloaded).toBe(true);
    await api('/api/settings', 'PATCH', { keepUnloadedPixels: true });
    await enforceRetention(env, cleanupAt);
    for (const pixel of [preserved, plain]) expect((await api(`/api/pixels/${pixel.id}`)).response.status).toBe(200);
    await api('/api/settings', 'PATCH', { keepUnloadedPixels: false });
    await enforceRetention(env, cleanupAt);
    expect((await api(`/api/pixels/${plain.id}`)).response.status).toBe(404);
    expect((await api(`/api/pixels/${preserved.id}`)).response.status).toBe(200);
    await api(`/api/pixels/${preserved.id}`, 'PATCH', { preserveUnloaded: false });
    await enforceRetention(env, cleanupAt);
    expect((await api(`/api/pixels/${preserved.id}`)).response.status).toBe(404);
    const manual = await aged('Manual deletion remains available');
    await api(`/api/pixels/${manual.id}`, 'PATCH', { preserveUnloaded: true });
    await api('/api/settings', 'PATCH', { keepUnloadedPixels: true });
    expect((await api(`/api/pixels/${manual.id}`, 'DELETE')).response.status).toBe(200);
  });

  it('preserves a newer per-pixel override when an unrelated label save completes later', async () => {
    const pixel = await aged('Before label save');
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const DB = { prepare: (sql: string) => env.DB.prepare(sql), async batch(statements: D1PreparedStatement[]) {
      entered(); await gate; return env.DB.batch(statements);
    } } as unknown as D1Database;
    const labelSave = api<Pixel>(`/api/pixels/${pixel.id}`, 'PATCH', { label: 'Saved label' }, { DB });
    await waiting;
    try { await api(`/api/pixels/${pixel.id}`, 'PATCH', { preserveUnloaded: true }); }
    finally { release(); }
    expect((await labelSave).data).toMatchObject({ label: 'Saved label', preserveUnloaded: true });
    await enforceRetention(env, cleanupAt);
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`)).data.preserveUnloaded).toBe(true);
  });

  it('retains loaded archived history, metadata and notifications regardless of legacy retention values', async () => {
    const pixel = await aged('Loaded archived forever');
    await api('/api/settings', 'PATCH', { captureRequestDetails: true });
    await arm(pixel);
    await fetchPixel(detailedRequest(pixel), env);
    await api(`/api/pixels/${pixel.id}`, 'PATCH', { status: 'archived' });
    await env.DB.prepare("UPDATE events SET created_at='2025-01-01T00:00:00.000Z'").run();
    await env.DB.prepare("UPDATE notifications SET created_at='2025-01-01T00:00:00.000Z',status='failed',attempts=5").run();
    for (const retentionDays of [30, 90, 180]) {
      await api('/api/settings', 'PATCH', { retentionDays });
      await enforceRetention(env, cleanupAt);
    }
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`)).data).toMatchObject({ status: 'archived', hasRecordedLoad: true, loadCount: 1 });
    expect((await api<LoadEvent[]>(`/api/pixels/${pixel.id}/events`)).data[0]?.metadata?.requestIp).toBe('198.51.100.23');
    expect((await api<Bootstrap>('/api/bootstrap')).data.notifications).toHaveLength(1);
    await api(`/api/pixels/${pixel.id}`, 'DELETE');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM events').first('count')).toBe(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM notifications').first('count')).toBe(0);
  });

  it('never makes a once-loaded pixel eligible after the owner clears all visible history', async () => {
    const pixel = await aged('Cleared but once loaded');
    await load(pixel);
    await api(`/api/pixels/${pixel.id}/events`, 'DELETE');
    await env.DB.prepare('UPDATE pixels SET daily_load_count=0 WHERE id=?').bind(pixel.id).run();
    await enforceRetention(env, cleanupAt);
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`)).data).toMatchObject({ hasRecordedLoad: true, loadCount: 0, earlyLoadCount: 0, firstLoadedAt: null, lastLoadedAt: null });
    expect((await api<LoadEvent[]>(`/api/pixels/${pixel.id}/events`)).data).toEqual([]);
  });

  it('protects any remaining load evidence even when the durable flag is absent', async () => {
    const columns = ['load_count', 'early_load_count', 'daily_load_count', 'first_loaded_at', 'last_loaded_at', 'first_alert_at'];
    const pixels: Pixel[] = [];
    for (const column of columns) {
      const pixel = await aged(column);
      pixels.push(pixel);
      await env.DB.prepare(`UPDATE pixels SET ${column}=? WHERE id=?`).bind(column.endsWith('_count') ? 1 : '2025-01-01T00:00:00.000Z', pixel.id).run();
    }
    const eventOnly = await aged('Event only');
    pixels.push(eventOnly);
    await load(eventOnly);
    await env.DB.prepare('UPDATE pixels SET has_recorded_load=0,load_count=0,early_load_count=0,daily_load_count=0,first_loaded_at=NULL,last_loaded_at=NULL,first_alert_at=NULL WHERE id=?').bind(eventOnly.id).run();
    const notificationOnly = await aged('Notification only');
    pixels.push(notificationOnly);
    await env.DB.prepare("INSERT INTO notifications(id,pixel_id,dedupe_key,created_at,status,next_attempt_at) VALUES(?,?,?,'2025-01-01T00:00:00.000Z','disabled','2025-01-01T00:00:00.000Z')").bind(crypto.randomUUID(), notificationOnly.id, `guard:${notificationOnly.id}`).run();
    await enforceRetention(env, cleanupAt);
    for (const pixel of pixels) expect((await api(`/api/pixels/${pixel.id}`)).response.status).toBe(200);
  });

  it('short-circuits global preservation and atomically rechecks preservation changed before deletion', async () => {
    const prepare = vi.fn(() => ({ first: async () => 1 }));
    await enforceRetention({ ...env, DB: { prepare } as unknown as D1Database }, cleanupAt);
    expect(prepare).toHaveBeenCalledTimes(1);
    const pixel = await aged('Preserved during cleanup');
    const DB = { prepare(sql: string) {
      if (sql === 'SELECT keep_unloaded_pixels FROM settings WHERE id=1') return { async first() {
        await env.DB.prepare('UPDATE settings SET keep_unloaded_pixels=1 WHERE id=1').run();
        return 0;
      } } as unknown as D1PreparedStatement;
      return env.DB.prepare(sql);
    } } as unknown as D1Database;
    await enforceRetention({ ...env, DB }, cleanupAt);
    expect((await api(`/api/pixels/${pixel.id}`)).response.status).toBe(200);
  });

  it('serializes first-load capture against cleanup without deleting a committed load or resurrecting a deleted pixel', async () => {
    for (let index = 0; index < 12; index++) {
      const pixel = await aged(`First-load race ${index}`);
      const [image] = await Promise.all([load(pixel), enforceRetention(env, cleanupAt)]);
      expect(image.status).toBe(200);
      const row = await env.DB.prepare('SELECT has_recorded_load,load_count FROM pixels WHERE id=?').bind(pixel.id).first<{ has_recorded_load: number; load_count: number }>();
      const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM events WHERE pixel_id=?').bind(pixel.id).first('count');
      if (row) { expect(row).toEqual({ has_recorded_load: 1, load_count: 1 }); expect(count).toBe(1); }
      else expect(count).toBe(0);
    }
  });

  it('bounds cleanup batches without automatically deleting preserved or loaded pixels', async () => {
    const old = new Date(cutoff - 1).toISOString();
    const statements = Array.from({ length: 1005 }, (_, index) => env.DB.prepare('INSERT INTO pixels(id,token,label,created_at,updated_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), index.toString(16).padStart(32, '0'), `Unused ${index}`, old, old));
    await env.DB.batch(statements);
    await enforceRetention(env, cleanupAt);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM pixels').first('count')).toBe(5);
    await enforceRetention(env, cleanupAt);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM pixels').first('count')).toBe(0);
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

  it('retains loaded history and terminal notifications indefinitely without reissuing a first alert', async () => {
    const pixel = await create();
    await arm(pixel);
    await load(pixel);
    await env.DB.prepare("UPDATE notifications SET created_at='2025-01-01T00:00:00.000Z',status='failed',attempts=5").run();
    await env.DB.prepare("UPDATE events SET created_at='2025-01-01T00:00:00.000Z'").run();
    await enforceRetention(env, new Date('2030-01-01T00:00:00.000Z'));
    await load(pixel);
    expect((await api<Bootstrap>('/api/bootstrap')).data.notifications).toHaveLength(1);
    expect((await api<LoadEvent[]>(`/api/pixels/${pixel.id}/events`)).data).toHaveLength(2);
    const retained = (await api<Pixel>(`/api/pixels/${pixel.id}`)).data;
    expect(retained.loadCount).toBe(2);
    expect(retained.firstAlertAt).not.toBeNull();
  });
});
