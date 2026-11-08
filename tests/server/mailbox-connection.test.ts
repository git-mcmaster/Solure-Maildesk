import { readFile, readdir } from 'node:fs/promises';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { mailboxApi, mailboxGraphFetch, mailboxStatus } from '../../src/server/mailbox';
import { fetchDashboard } from '../../src/server/dashboard';
import type { Env } from '../../src/server/types';

const tenant = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const origin = 'http://127.0.0.1:8787';
const tokenKey = btoa('K'.repeat(32));
const accessToken = 'synthetic-access-token';
const refreshToken = 'synthetic-refresh-token';
let mf: Miniflare, env: Env, privateKey: CryptoKey, jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwk = { ...await exportJWK(pair.publicKey), kid: 'mailbox-test-key', alg: 'RS256', use: 'sig' };
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test"); } };', compatibilityDate: '2026-07-30', d1Databases: { DB: 'mailbox-connection-tests' } });
  const DB = await mf.getD1Database('DB') as unknown as D1Database;
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(new URL(file, migrations), 'utf8')).replace(/--[^\n]*/gu, '');
    const trigger = sql.indexOf('CREATE TRIGGER');
    await DB.batch((trigger < 0 ? sql : sql.slice(0, trigger)).split(';').map(value => value.trim()).filter(Boolean).map(value => DB.prepare(value)));
    if (trigger >= 0) await DB.prepare(sql.slice(trigger)).run();
  }
  env = { DB, OWNER_EMAIL: 'owner@example.test', DASHBOARD_ORIGIN: origin, PIXEL_ORIGIN: 'https://pixel.example.test', DEV_AUTH: 'true', EMAIL_MODE: 'dry-run',
    MICROSOFT_TENANT_ID: tenant, MICROSOFT_CLIENT_ID: client, MICROSOFT_CLIENT_SECRET: 'synthetic-client-secret', MICROSOFT_OWNER_ID: owner, MAILBOX_TOKEN_KEY: tokenKey };
}, 30_000);
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mailbox_oauth_states'),
    env.DB.prepare(`UPDATE mailbox_connection SET tenant_id=NULL,client_id=NULL,owner_id=NULL,account_email=NULL,encrypted_tokens=NULL,access_expires_at=NULL,
      granted_scopes='[]',connected_at=NULL,updated_at=NULL,last_error=NULL,refresh_lease_token=NULL,refresh_lease_until=NULL,version=0,generation=0 WHERE id=1`),
  ]);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected external request'); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(async () => { await mf?.dispose(); });

function request(path: string, method = 'GET', body?: unknown, cookie?: string): Request {
  return new Request(origin + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function start(overrides: Partial<Env> = {}) {
  const response = await mailboxApi(request('/api/mailbox/connect', 'POST', { acknowledgePermissions: true }), { ...env, ...overrides });
  expect(response?.status).toBe(200);
  const data = await response!.json() as { data: { authorizeUrl: string } };
  const url = new URL(data.data.authorizeUrl);
  return { response: response!, url, state: url.searchParams.get('state')!, nonce: url.searchParams.get('nonce')!, cookie: response!.headers.get('Set-Cookie')!.split(';')[0]! };
}
type Started = Awaited<ReturnType<typeof start>>;
interface ProviderOptions {
  claims?: JWTPayload;
  profile?: Record<string, unknown>;
  token?: (fields: URLSearchParams) => Promise<Response> | Response;
  graph?: (url: URL, init: RequestInit) => Promise<Response> | Response;
}
async function provider(flow: Started, options: ProviderOptions = {}) {
  const signed = await new SignJWT({ oid: owner, tid: tenant, nonce: flow.nonce, ...options.claims })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject('synthetic-owner').setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`)
    .setAudience(client).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const calls: { url: string; method: string; headers: Headers; body: string }[] = [];
  const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const grant = (extra: Record<string, unknown> = {}) => json({ access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 3600,
    scope: 'User.Read Mail.Read Mail.Send', id_token: signed, ...extra });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : '';
    calls.push({ url: url.href, method: init.method ?? 'GET', headers: new Headers(init.headers), body });
    expect(init.redirect).toBe('manual');
    if (url.href === `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`) return options.token ? options.token(new URLSearchParams(body)) : grant();
    if (url.href === `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`) return json({ keys: [jwk] });
    if (url.href === 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName') return json(options.profile ?? { id: owner, mail: env.OWNER_EMAIL, userPrincipalName: env.OWNER_EMAIL });
    if (url.host === 'graph.microsoft.com') return options.graph ? options.graph(url, init) : json({ value: [] });
    throw new Error('Unapproved provider host');
  }));
  return { calls, grant, json };
}
async function finish(flow: Started, query = `code=synthetic-code&state=${flow.state}`) {
  return mailboxApi(request(`/api/mailbox/callback?${query}`, 'GET', undefined, flow.cookie), env);
}
async function connected(options: ProviderOptions = {}) {
  const flow = await start();
  const mocked = await provider(flow, options);
  const response = await finish(flow);
  expect(response?.status).toBe(303);
  expect(response?.headers.get('Location')).toBe(`${origin}/?mailbox=connected`);
  expect((await mailboxStatus(env)).connected).toBe(true);
  return { flow, ...mocked };
}

describe('single-owner Microsoft connection', () => {
  it('stays disabled without complete owner/app/key settings and does not query new tables', async () => {
    const DB = { prepare: vi.fn(() => { throw new Error('No migration'); }) } as unknown as D1Database;
    for (const missing of ['MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_OWNER_ID', 'MAILBOX_TOKEN_KEY'] as const) {
      const incomplete = { ...env, DB, [missing]: undefined };
      expect(await mailboxStatus(incomplete)).toMatchObject({ configured: false, connected: false, sendingEnabled: false, nativeUnsubscribeVerified: false });
      await expect(mailboxApi(request('/api/mailbox/connect', 'POST', { acknowledgePermissions: true }), incomplete)).rejects.toMatchObject({ code: 'MAILBOX_NOT_CONFIGURED' });
    }
    expect(DB.prepare).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it('requires acknowledgement and uses PKCE, single-tenant endpoints, exact callback and a bound secure browser cookie', async () => {
    await expect(mailboxApi(request('/api/mailbox/connect', 'POST', {}), env)).rejects.toMatchObject({ code: 'MAILBOX_PERMISSION_ACKNOWLEDGEMENT' });
    await expect(mailboxApi(request('/api/mailbox/connect', 'POST', { acknowledgePermissions: true, redirect: 'https://other.example' }), env)).rejects.toMatchObject({ code: 'UNKNOWN_FIELD' });
    const flow = await start();
    expect(flow.url.origin).toBe('https://login.microsoftonline.com');
    expect(flow.url.pathname).toBe(`/${tenant}/oauth2/v2.0/authorize`);
    expect(flow.url.searchParams.get('redirect_uri')).toBe(`${origin}/api/mailbox/callback`);
    expect(flow.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(flow.url.searchParams.get('scope')?.split(' ')).toEqual(['User.Read', 'Mail.Read', 'Mail.Send', 'offline_access', 'openid', 'profile']);
    expect(flow.response.headers.get('Set-Cookie')).toContain('HttpOnly; SameSite=Lax; Max-Age=600');
    const saved = await env.DB.prepare('SELECT * FROM mailbox_oauth_states').first<Record<string, unknown>>();
    expect(saved?.state_hash).not.toBe(flow.state); expect(saved?.browser_hash).not.toBe(flow.cookie.split('=')[1]);
    expect(saved?.encrypted_flow).not.toContain(flow.nonce); expect(fetch).not.toHaveBeenCalled();
    const secure = await start({ DEV_AUTH: undefined, DASHBOARD_ORIGIN: 'https://maildesk.example.test' });
    expect(secure.response.headers.get('Set-Cookie')).toMatch(/^__Host-maildesk-ms=.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/u);
  });

  it('protects connection routes through the existing owner authentication and mutation-origin checks', async () => {
    const production = { ...env, DEV_AUTH: undefined, DASHBOARD_ORIGIN: 'https://maildesk.example.test', ACCESS_TEAM_DOMAIN: 'mailbox-test.cloudflareaccess.com', ACCESS_AUD: 'mailbox-test' };
    expect((await fetchDashboard(new Request(`${production.DASHBOARD_ORIGIN}/api/mailbox/status`), production)).status).toBe(401);
    const hostile = new Request(`${origin}/api/mailbox/connect`, { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ acknowledgePermissions: true }) });
    expect((await fetchDashboard(hostile, env)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('binds callback to the initiating browser, refuses stale/duplicate parameters and cannot replay state', async () => {
    const flow = await start();
    const mock = await provider(flow);
    await expect(mailboxApi(request(`/api/mailbox/callback?code=synthetic-code&state=${flow.state}`), env)).rejects.toMatchObject({ code: 'MAILBOX_INVALID_STATE' });
    await expect(finish(flow, `code=synthetic-code&state=${flow.state}&state=${flow.state}`)).rejects.toMatchObject({ code: 'MAILBOX_INVALID_CALLBACK' });
    expect(mock.calls).toHaveLength(0);
    expect((await finish(flow))?.headers.get('Location')).toBe(`${origin}/?mailbox=connected`);
    await expect(finish(flow)).rejects.toMatchObject({ code: 'MAILBOX_INVALID_STATE' });
    expect(mock.calls.filter(call => call.url.includes('/token'))).toHaveLength(1);
    const next = await start();
    await env.DB.prepare('UPDATE mailbox_oauth_states SET expires_at=0').run();
    await expect(finish(next)).rejects.toMatchObject({ code: 'MAILBOX_INVALID_STATE' });
  });

  it('stores only encrypted credentials, validates the owner and emits no credential through status or redirect', async () => {
    const mock = await connected();
    const state = await env.DB.prepare('SELECT COUNT(*) AS n FROM mailbox_oauth_states').first('n');
    expect(state).toBe(0);
    const stored = await env.DB.prepare('SELECT * FROM mailbox_connection').first<Record<string, unknown>>();
    expect(stored?.encrypted_tokens).toMatch(/^v1\./u);
    for (const value of [accessToken, refreshToken, env.MICROSOFT_CLIENT_SECRET]) expect(JSON.stringify(stored)).not.toContain(value);
    const grantCall = mock.calls.find(call => call.url.includes('/token'))!;
    const fields = new URLSearchParams(grantCall.body);
    expect(fields.get('redirect_uri')).toBe(`${origin}/api/mailbox/callback`);
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fields.get('code_verifier')!))).toString('base64url');
    expect(challenge).toBe(mock.flow.url.searchParams.get('code_challenge'));
    const status = await mailboxStatus(env);
    expect(status).toMatchObject({ configured: true, connected: true, connectedEmail: 'owner@example.test', sendingEnabled: false, nativeUnsubscribeVerified: false });
    expect((await mailboxStatus({ ...env, OUTREACH_SENDING_ENABLED: 'true' })).sendingEnabled).toBe(true);
    for (const value of [accessToken, refreshToken, env.MICROSOFT_CLIENT_SECRET]) expect(JSON.stringify(status)).not.toContain(value);
  });

  it('rejects wrong owner, tenant, nonce, profile identity and missing required grant scope without saving tokens', async () => {
    for (const options of [
      { claims: { oid: other } }, { claims: { tid: other } }, { claims: { nonce: 'wrong-nonce' } },
      { profile: { id: other, mail: env.OWNER_EMAIL } }, { profile: { id: owner, mail: 'other@example.test', userPrincipalName: 'other@example.test' } },
      { token: () => new Response(JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 3600, scope: 'User.Read Mail.Send' }), { headers: { 'Content-Type': 'application/json' } }) },
    ] satisfies ProviderOptions[]) {
      const flow = await start(); await provider(flow, options);
      const response = await finish(flow);
      expect(response?.headers.get('Location')).toBe(`${origin}/?mailbox=error`);
      expect((await mailboxStatus(env)).connected).toBe(false);
      expect(await env.DB.prepare('SELECT encrypted_tokens FROM mailbox_connection').first('encrypted_tokens')).toBeNull();
    }
  });

  it('consumes cancelled/error callbacks and redirects only to the dashboard without exposing provider details', async () => {
    const flow = await start();
    const response = await finish(flow, `error=access_denied&error_description=private-address-secret&error_uri=https://hostile.example&state=${flow.state}`);
    expect(response?.headers.get('Location')).toBe(`${origin}/?mailbox=error`);
    expect(JSON.stringify(await mailboxStatus(env))).not.toContain('private-address-secret');
    await expect(finish(flow)).rejects.toMatchObject({ code: 'MAILBOX_INVALID_STATE' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cannot resurrect a connection when disconnect happens during OAuth exchange', async () => {
    const flow = await start();
    const mock = await provider(flow, { token: async () => {
      await mailboxApi(request('/api/mailbox/disconnect', 'POST', {}), env);
      return mock.grant();
    } });
    expect((await finish(flow))?.headers.get('Location')).toBe(`${origin}/?mailbox=error`);
    expect((await mailboxStatus(env)).connected).toBe(false);
    expect(await env.DB.prepare('SELECT encrypted_tokens FROM mailbox_connection').first('encrypted_tokens')).toBeNull();
    expect(mock.calls.some(call => call.url.startsWith('https://graph.microsoft.com'))).toBe(false);
  });

  it('forces fixed owner Graph origin and immutable IDs, strips caller credentials and blocks destructive mutations', async () => {
    const mock = await connected(); mock.calls.length = 0;
    for (const path of ['https://hostile.example/v1.0/me/messages', 'https://graph.microsoft.com/v1.0/users/other/messages', '//hostile.example/v1.0/me', '/v1.0/me/messages/../../users/other', '/me/messages/%252e%252e/users', '/me/messages#fragment']) {
      await expect(mailboxGraphFetch(env, path)).rejects.toMatchObject({ code: 'MAILBOX_INVALID_PATH' });
    }
    for (const [path, method] of [['/me/messages', 'POST'], ['/me/messages/id', 'PATCH'], ['/me/messages/id', 'DELETE'], ['/me/sendMail?unexpected=true', 'POST']]) {
      await expect(mailboxGraphFetch(env, path!, { method })).rejects.toMatchObject({ code: 'MAILBOX_INVALID_METHOD' });
    }
    expect(mock.calls).toHaveLength(0);
    expect((await mailboxGraphFetch(env, '/me/mailFolders/inbox/messages/delta?$select=id', { headers: { Authorization: 'Bearer hostile', Cookie: 'private-cookie', Prefer: 'IdType="MutableId", outlook.body-content-type="text"' } })).status).toBe(200);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.headers.get('Authorization')).toBe(`Bearer ${accessToken}`);
    expect(mock.calls[0]?.headers.has('Cookie')).toBe(false);
    expect(mock.calls[0]?.headers.get('Prefer')).toBe('outlook.body-content-type="text", IdType="ImmutableId"');
  });

  it('runs the final eligibility callback after refresh and before submission, and never sends when it rejects', async () => {
    const mock = await connected(); mock.calls.length = 0;
    await env.DB.prepare('UPDATE mailbox_connection SET access_expires_at=0').run();
    let guardCalled = false;
    const guard = async () => {
      guardCalled = true;
      expect(mock.calls.filter(call => call.url.includes('/token'))).toHaveLength(1);
      expect(mock.calls.some(call => call.url.endsWith('/sendMail'))).toBe(false);
      throw new Error('Synthetic cancellation');
    };
    await expect(mailboxGraphFetch(env, '/me/sendMail', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'synthetic-mime' }, guard)).rejects.toThrow('Synthetic cancellation');
    expect(guardCalled).toBe(true); expect(mock.calls.some(call => call.url.endsWith('/sendMail'))).toBe(false);
  });

  it('refreshes encrypted tokens once, rotates the refresh token and preserves a reconnect-safe lease', async () => {
    const mock = await connected(); mock.calls.length = 0;
    await env.DB.prepare('UPDATE mailbox_connection SET access_expires_at=0').run();
    const refreshed = await provider(mock.flow, { token: fields => {
      expect(fields.get('grant_type')).toBe('refresh_token'); expect(fields.get('refresh_token')).toBe(refreshToken);
      return mock.grant({ access_token: 'new-synthetic-access', refresh_token: 'new-synthetic-refresh' });
    } });
    expect((await mailboxGraphFetch(env, '/me/messages?$top=1')).status).toBe(200);
    expect(refreshed.calls.filter(call => call.url.includes('/token'))).toHaveLength(1);
    expect(refreshed.calls.at(-1)?.headers.get('Authorization')).toBe('Bearer new-synthetic-access');
    const stored = await env.DB.prepare('SELECT * FROM mailbox_connection').first<Record<string, unknown>>();
    expect(stored?.refresh_lease_token).toBeNull(); expect(stored?.refresh_lease_until).toBeNull();
    expect(JSON.stringify(stored)).not.toContain('new-synthetic-refresh');
    await mailboxGraphFetch(env, '/me/messages?$top=1');
    expect(refreshed.calls.filter(call => call.url.includes('/token'))).toHaveLength(1);
  });

  it('allows only one refresh lease and does not restore credentials after a concurrent disconnect', async () => {
    const mock = await connected();
    await env.DB.prepare('UPDATE mailbox_connection SET access_expires_at=0').run();
    let release!: () => void, announce!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { announce = resolve; });
    const next = await provider(mock.flow, { token: async () => { announce(); await blocked; return mock.grant({ access_token: 'new-access' }); } });
    const pending = mailboxGraphFetch(env, '/me/messages');
    await started;
    await expect(mailboxGraphFetch(env, '/me/messages')).rejects.toMatchObject({ code: 'MAILBOX_REFRESH_BUSY' });
    await mailboxApi(request('/api/mailbox/disconnect', 'POST', {}), env);
    release();
    await expect(pending).rejects.toMatchObject({ code: 'MAILBOX_CONNECTION_CHANGED' });
    expect(next.calls.filter(call => call.url.includes('/token'))).toHaveLength(1);
    expect(next.calls.some(call => call.url.startsWith('https://graph.microsoft.com'))).toBe(false);
    expect((await mailboxStatus(env)).connected).toBe(false);
  });

  it('handles revoked refresh grants and tampered ciphertext without exposing or reusing credentials', async () => {
    const mock = await connected();
    await env.DB.prepare('UPDATE mailbox_connection SET access_expires_at=0').run();
    await provider(mock.flow, { token: () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'sensitive-provider-details' }), { status: 400 }) });
    await expect(mailboxGraphFetch(env, '/me/messages')).rejects.toMatchObject({ code: 'MAILBOX_RECONNECT_REQUIRED' });
    expect((await mailboxStatus(env)).connected).toBe(false); expect(JSON.stringify(await mailboxStatus(env))).not.toContain('sensitive-provider-details');
    await connected();
    await env.DB.prepare("UPDATE mailbox_connection SET encrypted_tokens='v1.invalid.invalid'").run();
    await expect(mailboxGraphFetch(env, '/me/messages')).rejects.toMatchObject({ code: 'MAILBOX_RECONNECT_REQUIRED' });
    expect((await mailboxStatus(env)).connected).toBe(false);
  });

  it('returns safe errors and Retry-After, never follows Graph redirects and never retries a timed-out send', async () => {
    const mock = await connected();
    for (const status of [302, 403, 429, 500]) {
      const next = await provider(mock.flow, { graph: () => new Response('private-provider-body', { status, headers: { 'Retry-After': '15', Location: 'https://hostile.example' } }) });
      const response = await mailboxGraphFetch(env, '/me/messages');
      expect(response.status).toBe(status === 302 ? 502 : status);
      expect(response.headers.get('Location')).toBeNull(); expect(response.headers.get('Retry-After')).toBe('15');
      expect(await response.text()).not.toContain('private-provider-body'); expect(next.calls).toHaveLength(1);
    }
    const next = await provider(mock.flow, { graph: () => { throw new TypeError('private network details'); } });
    await expect(mailboxGraphFetch(env, '/me/sendMail', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'synthetic-mime' }))
      .rejects.toMatchObject({ code: 'MAILBOX_REQUEST_UNCERTAIN', message: 'Microsoft did not return a confirmed outcome. No automatic retry was made.' });
    expect(next.calls).toHaveLength(1);
  });

  it('preserves Microsoft acceptance when noncritical connection-warning cleanup fails afterward', async () => {
    const mock = await connected();
    const next = await provider(mock.flow, { graph: () => new Response(null, { status: 202 }) });
    const DB = { prepare(sql: string) {
      if (sql.startsWith('UPDATE mailbox_connection SET last_error=NULL')) throw new Error('Synthetic cleanup failure');
      return env.DB.prepare(sql);
    } } as unknown as D1Database;
    const response = await mailboxGraphFetch({ ...env, DB }, '/me/sendMail', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'synthetic-mime' });
    expect(response.status).toBe(202); expect(next.calls).toHaveLength(1);
  });

  it('disconnects locally, invalidates pending sign-ins and stops future Graph calls without deleting mail', async () => {
    const mock = await connected();
    const pending = await start(); mock.calls.length = 0;
    const response = await mailboxApi(request('/api/mailbox/disconnect', 'POST', {}), env);
    expect(response?.status).toBe(200); expect((await mailboxStatus(env)).connected).toBe(false);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM mailbox_oauth_states').first('n')).toBe(0);
    await expect(finish(pending)).rejects.toMatchObject({ code: 'MAILBOX_INVALID_STATE' });
    await expect(mailboxGraphFetch(env, '/me/messages')).rejects.toMatchObject({ code: 'MAILBOX_NOT_CONNECTED' });
    expect(mock.calls).toHaveLength(0);
  });
});
