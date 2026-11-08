import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { MAILBOX_PERMISSIONS, type MailboxStatus } from '../shared/mailbox';
import { isLoopback } from './auth';
import { HttpError, json, onlyFields, readJson, securityHeaders } from './http';
import type { Env } from './types';

interface Configuration {
  tenant: string; client: string; secret: string; owner: string; ownerEmail: string;
  redirect: string; origin: string; tokenKey: string; local: boolean;
}
interface ConnectionRow {
  tenant_id: string | null; client_id: string | null; owner_id: string | null; account_email: string | null;
  encrypted_tokens: string | null; access_expires_at: number | null; granted_scopes: string;
  connected_at: string | null; updated_at: string | null; last_error: string | null;
  refresh_lease_token: string | null; refresh_lease_until: number | null; version: number; generation: number;
}
interface Tokens { accessToken: string; refreshToken: string }
interface Flow { verifier: string; nonce: string }
interface Grant extends Tokens { expiresAt: number; scopes: string[]; idToken?: string }
const guid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const opaque = /^[A-Za-z0-9_-]{43}$/u;
const requiredScopes = ['User.Read', 'Mail.Read', 'Mail.Send'];
const encoder = new TextEncoder();
const reconnect = 'Microsoft needs you to reconnect before Maildesk can continue.';
const failedConnection = 'The Microsoft connection was not completed. Check the selected Solure account and try again.';

function configuration(env: Env): Configuration | null {
  try {
    const tenant = env.MICROSOFT_TENANT_ID?.trim().toLowerCase() ?? '';
    const client = env.MICROSOFT_CLIENT_ID?.trim().toLowerCase() ?? '';
    const owner = env.MICROSOFT_OWNER_ID?.trim().toLowerCase() ?? '';
    const secret = env.MICROSOFT_CLIENT_SECRET ?? '';
    const tokenKey = env.MAILBOX_TOKEN_KEY ?? '';
    const base = new URL(env.DASHBOARD_ORIGIN);
    const local = env.DEV_AUTH === 'true' && isLoopback(base.hostname);
    if (![tenant, client, owner].every(value => guid.test(value)) || !secret || secret.length > 4096 || /[\u0000-\u001f\u007f]/u.test(secret)
      || !/^[A-Za-z0-9+/]{43}=$/u.test(tokenKey) || atob(tokenKey).length !== 32
      || (!local && base.protocol !== 'https:') || !['https:', 'http:'].includes(base.protocol)
      || base.username || base.password || base.pathname !== '/' || base.search || base.hash
      || !env.OWNER_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(env.OWNER_EMAIL)) return null;
    return { tenant, client, owner, secret, tokenKey, local, ownerEmail: env.OWNER_EMAIL.toLowerCase(),
      origin: base.origin, redirect: new URL('/api/mailbox/callback', base.origin).href };
  } catch { return null; }
}

function requireConfiguration(env: Env): Configuration {
  const config = configuration(env);
  if (!config) throw new HttpError(503, 'MAILBOX_NOT_CONFIGURED', 'Microsoft connection requires the owner, tenant, app and private server settings before it can be used.');
  return config;
}

function bytes64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}
function unbase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
function random(length = 32): string {
  return bytes64(crypto.getRandomValues(new Uint8Array(length))).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
async function hash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
function associatedData(config: Configuration, purpose: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`maildesk-v1|${config.tenant}|${config.owner}|${config.client}|${config.redirect}|${purpose}`);
}
async function key(config: Configuration): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', unbase64(config.tokenKey), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encrypt(config: Configuration, value: unknown, purpose: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedData(config, purpose) }, await key(config), encoder.encode(JSON.stringify(value)));
  return `v1.${bytes64(iv)}.${bytes64(new Uint8Array(ciphertext))}`;
}
async function decrypt<T>(config: Configuration, value: string, purpose: string): Promise<T> {
  if (value.length > 150_000) throw new Error('Invalid private storage');
  const pieces = value.split('.');
  if (pieces.length !== 3 || pieces[0] !== 'v1' || !pieces[1] || !pieces[2]) throw new Error('Invalid private storage');
  const iv = unbase64(pieces[1]), ciphertext = unbase64(pieces[2]);
  if (iv.length !== 12 || ciphertext.length < 16 || ciphertext.length > 100_000) throw new Error('Invalid private storage');
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: associatedData(config, purpose) }, await key(config), ciphertext);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
}
async function connection(env: Env): Promise<ConnectionRow | null> {
  return env.DB.prepare('SELECT * FROM mailbox_connection WHERE id=1').first<ConnectionRow>();
}
function matches(row: ConnectionRow | null, config: Configuration): row is ConnectionRow {
  return !!row && row.tenant_id === config.tenant && row.client_id === config.client && row.owner_id === config.owner && row.account_email === config.ownerEmail && !!row.encrypted_tokens;
}

export async function mailboxStatus(env: Env): Promise<MailboxStatus> {
  const config = configuration(env);
  // An unconfigured feature must not query new tables on an older deployment.
  const row = config ? await connection(env) : null;
  const connected = !!config && matches(row, config);
  return { configured: !!config, connected, sendingEnabled: connected && env.OUTREACH_SENDING_ENABLED === 'true',
    ownerEmail: env.OWNER_EMAIL, connectedEmail: connected ? row.account_email : null,
    lastError: row?.last_error ?? null, permissions: [...MAILBOX_PERMISSIONS], nativeUnsubscribeVerified: false };
}

function cookieName(config: Configuration): string { return config.local ? 'maildesk-ms-local' : '__Host-maildesk-ms'; }
function cookie(config: Configuration, value = ''): string {
  return `${cookieName(config)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? 600 : 0}${config.local ? '' : '; Secure'}`;
}
function browserCookie(request: Request, config: Configuration): string | null {
  const matches = (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName(config)}=`));
  if (matches.length !== 1) return null;
  const value = matches[0]!.slice(cookieName(config).length + 1);
  return opaque.test(value) ? value : null;
}
function redirect(config: Configuration, result: 'connected' | 'error'): Response {
  return new Response(null, { status: 303, headers: { ...securityHeaders, Location: `${config.origin}/?mailbox=${result}`, 'Set-Cookie': cookie(config) } });
}
async function limitedJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Invalid provider response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 65_536) { await reader.cancel(); throw new Error('Invalid provider response'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid provider response');
  return value as Record<string, unknown>;
}
function tokenString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 32_768 && !/[\u0000-\u0020\u007f]/u.test(value);
}
function scopes(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const granted = value.split(/\s+/u).filter(Boolean).map(scope => scope.replace(/^https:\/\/graph\.microsoft\.com\//iu, '').toLowerCase());
  if (!requiredScopes.every(scope => granted.includes(scope.toLowerCase()))) return null;
  return requiredScopes.filter(scope => granted.includes(scope.toLowerCase()));
}
async function exchange(config: Configuration, fields: Record<string, string>, previous?: Tokens): Promise<Grant> {
  let response: Response;
  try {
    response = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.client, client_secret: config.secret, scope: MAILBOX_PERMISSIONS.join(' '), ...fields }),
    });
  } catch { throw new HttpError(502, 'MAILBOX_TEMPORARILY_UNAVAILABLE', 'Microsoft is temporarily unavailable. Try again later.'); }
  let data: Record<string, unknown>;
  try { data = await limitedJson(response); }
  catch { throw new HttpError(502, 'MAILBOX_PROVIDER_RESPONSE', 'Microsoft returned an incomplete connection response. Try again later.'); }
  if (!response.ok) {
    const needsConsent = ['invalid_grant', 'interaction_required', 'consent_required', 'invalid_client', 'unauthorized_client'].includes(String(data.error));
    throw new HttpError(needsConsent ? 401 : response.status === 429 ? 429 : 502,
      needsConsent ? 'MAILBOX_RECONNECT_REQUIRED' : 'MAILBOX_TEMPORARILY_UNAVAILABLE', needsConsent ? reconnect : 'Microsoft is temporarily unavailable. Try again later.');
  }
  const granted = data.scope === undefined && previous ? requiredScopes : scopes(data.scope);
  const refreshToken = data.refresh_token ?? previous?.refreshToken;
  if (!tokenString(data.access_token) || !tokenString(refreshToken) || data.token_type !== 'Bearer' || !granted
    || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in < 60 || data.expires_in > 86_400
    || (!previous && !tokenString(data.id_token))) throw new HttpError(401, 'MAILBOX_RECONNECT_REQUIRED', reconnect);
  return { accessToken: data.access_token, refreshToken, expiresAt: Date.now() + data.expires_in * 1000, scopes: granted,
    ...(tokenString(data.id_token) ? { idToken: data.id_token } : {}) };
}
async function verifyIdentity(config: Configuration, grant: Grant, nonce: string): Promise<void> {
  const keysResponse = await fetch(`https://login.microsoftonline.com/${config.tenant}/discovery/v2.0/keys`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (!keysResponse.ok) throw new Error('Identity verification unavailable');
  const keys = await limitedJson(keysResponse);
  if (!Array.isArray(keys.keys) || keys.keys.length < 1 || keys.keys.length > 50) throw new Error('Identity verification unavailable');
  const { payload } = await jwtVerify(grant.idToken!, createLocalJWKSet(keys as unknown as JSONWebKeySet), {
    issuer: `https://login.microsoftonline.com/${config.tenant}/v2.0`, audience: config.client, algorithms: ['RS256'],
    requiredClaims: ['sub', 'oid', 'tid', 'nonce', 'exp', 'iat'], clockTolerance: 5, maxTokenAge: '10m',
  });
  if (typeof payload.oid !== 'string' || payload.oid.toLowerCase() !== config.owner || typeof payload.tid !== 'string' || payload.tid.toLowerCase() !== config.tenant || payload.nonce !== nonce) {
    throw new Error('Wrong Microsoft identity');
  }
  const profile = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${grant.accessToken}`, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000),
  });
  if (!profile.ok) throw new Error('Identity verification unavailable');
  const user = await limitedJson(profile);
  if (typeof user.id !== 'string' || user.id.toLowerCase() !== config.owner
    || ![user.mail, user.userPrincipalName].some(value => typeof value === 'string' && value.toLowerCase() === config.ownerEmail)) throw new Error('Wrong Microsoft mailbox');
}

async function connect(request: Request, env: Env, config: Configuration): Promise<Response> {
  const body = await readJson(request);
  onlyFields(body, ['acknowledgePermissions']);
  if (body.acknowledgePermissions !== true) throw new HttpError(400, 'MAILBOX_PERMISSION_ACKNOWLEDGEMENT', 'Review and acknowledge the mailbox permissions before connecting.');
  const state = random(), browser = random(), verifier = random(48), nonce = random();
  const stateHash = await hash(state), browserHash = await hash(browser), now = Date.now();
  const encrypted = await encrypt(config, { verifier, nonce } satisfies Flow, `flow|${stateHash}|${browserHash}`);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mailbox_oauth_states'),
    env.DB.prepare('UPDATE mailbox_connection SET generation=generation+1,version=version+1,refresh_lease_token=NULL,refresh_lease_until=NULL WHERE id=1'),
    env.DB.prepare(`INSERT INTO mailbox_oauth_states(state_hash,browser_hash,encrypted_flow,generation,created_at,expires_at)
      SELECT ?,?,?,generation,?,? FROM mailbox_connection WHERE id=1`).bind(stateHash, browserHash, encrypted, now, now + 600_000),
  ]);
  const challenge = bytes64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)))).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
  const authorize = new URL(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/authorize`);
  authorize.search = new URLSearchParams({ client_id: config.client, response_type: 'code', redirect_uri: config.redirect,
    response_mode: 'query', scope: MAILBOX_PERMISSIONS.join(' '), state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
    login_hint: config.ownerEmail, prompt: 'select_account' }).toString();
  const response = json({ authorizeUrl: authorize.href });
  response.headers.set('Set-Cookie', cookie(config, browser));
  return response;
}
async function callback(request: Request, env: Env, config: Configuration): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const allowed = ['code', 'state', 'session_state', 'error', 'error_description', 'error_uri'];
  if ([...params.keys()].some(value => !allowed.includes(value) || params.getAll(value).length !== 1)) throw new HttpError(400, 'MAILBOX_INVALID_CALLBACK', 'This Microsoft sign-in response is invalid. Start Connect again.');
  const state = params.get('state'), browser = browserCookie(request, config);
  if (!state || !opaque.test(state) || !browser) throw new HttpError(400, 'MAILBOX_INVALID_STATE', 'This Microsoft sign-in has expired or belongs to another browser. Start Connect again.');
  const stateHash = await hash(state), browserHash = await hash(browser);
  // Delete+return is atomic: replay and concurrent callbacks cannot redeem twice.
  const pending = await env.DB.prepare(`DELETE FROM mailbox_oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING encrypted_flow,generation`)
    .bind(stateHash, browserHash, Date.now()).first<{ encrypted_flow: string; generation: number }>();
  if (!pending) throw new HttpError(400, 'MAILBOX_INVALID_STATE', 'This Microsoft sign-in has expired or was already used. Start Connect again.');
  try {
    if (params.has('error') || !tokenString(params.get('code')) || params.get('code')!.length > 4096) throw new Error('Sign-in was not completed');
    const flow = await decrypt<Flow>(config, pending.encrypted_flow, `flow|${stateHash}|${browserHash}`);
    if (!flow || typeof flow.verifier !== 'string' || typeof flow.nonce !== 'string' || !opaque.test(flow.nonce)) throw new Error('Invalid sign-in');
    const grant = await exchange(config, { grant_type: 'authorization_code', code: params.get('code')!, code_verifier: flow.verifier, redirect_uri: config.redirect });
    if ((await connection(env))?.generation !== pending.generation) throw new Error('Connection changed during sign-in');
    await verifyIdentity(config, grant, flow.nonce);
    const encrypted = await encrypt(config, { accessToken: grant.accessToken, refreshToken: grant.refreshToken } satisfies Tokens, 'tokens');
    const now = new Date().toISOString();
    const saved = await env.DB.prepare(`UPDATE mailbox_connection SET tenant_id=?,client_id=?,owner_id=?,account_email=?,encrypted_tokens=?,access_expires_at=?,granted_scopes=?,
      connected_at=?,updated_at=?,last_error=NULL,refresh_lease_token=NULL,refresh_lease_until=NULL,version=version+1 WHERE id=1 AND generation=?`)
      .bind(config.tenant, config.client, config.owner, config.ownerEmail, encrypted, grant.expiresAt, JSON.stringify(grant.scopes), now, now, pending.generation).run();
    if (saved.meta.changes !== 1) throw new Error('Connection changed during sign-in');
    return redirect(config, 'connected');
  } catch {
    await env.DB.prepare('UPDATE mailbox_connection SET last_error=?,updated_at=? WHERE id=1 AND generation=?').bind(failedConnection, new Date().toISOString(), pending.generation).run();
    return redirect(config, 'error');
  }
}

/** The dashboard authenticates the exact owner and validates POST Origin first. */
export async function mailboxApi(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/mailbox/')) return null;
  if (path === '/api/mailbox/status' && request.method === 'GET') return json(await mailboxStatus(env));
  if (path === '/api/mailbox/disconnect' && request.method === 'POST') {
    onlyFields(await readJson(request), []);
    await env.DB.batch([
      env.DB.prepare(`UPDATE mailbox_connection SET encrypted_tokens=NULL,access_expires_at=NULL,granted_scopes='[]',account_email=NULL,tenant_id=NULL,client_id=NULL,owner_id=NULL,
        connected_at=NULL,updated_at=?,last_error=NULL,refresh_lease_token=NULL,refresh_lease_until=NULL,version=version+1,generation=generation+1 WHERE id=1`).bind(new Date().toISOString()),
      env.DB.prepare('DELETE FROM mailbox_oauth_states'),
    ]);
    return json(await mailboxStatus(env));
  }
  if (path === '/api/mailbox/connect' && request.method === 'POST') return connect(request, env, requireConfiguration(env));
  if (path === '/api/mailbox/callback' && request.method === 'GET') return callback(request, env, requireConfiguration(env));
  if (['/api/mailbox/status', '/api/mailbox/connect', '/api/mailbox/callback', '/api/mailbox/disconnect'].includes(path)) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use the Microsoft connection controls in Maildesk.');
  throw new HttpError(404, 'NOT_FOUND', 'This connection action could not be found.');
}

function graphUrl(path: string): URL {
  if (typeof path !== 'string' || path.length > 16_384 || /[\u0000-\u0020\u007f\\]/u.test(path)) throw new HttpError(400, 'MAILBOX_INVALID_PATH', 'Choose a valid Microsoft mailbox action.');
  let url: URL;
  try {
    const relative = path.startsWith('/v1.0/') ? path : path.startsWith('/me') ? `/v1.0${path}` : path.startsWith('/') ? `/v1.0/me${path}` : path;
    url = new URL(relative, 'https://graph.microsoft.com');
    const decoded = decodeURIComponent(url.pathname);
    const normalized = new URL(decoded, 'https://graph.microsoft.com').pathname;
    if (url.protocol !== 'https:' || url.host !== 'graph.microsoft.com' || url.username || url.password || url.hash || decoded.includes('%')
      || !/^\/v1\.0\/me(?:$|\/(?:messages|mailFolders|sendMail)(?:$|\/|\())/iu.test(url.pathname)
      || !/^\/v1\.0\/me(?:$|\/(?:messages|mailFolders|sendMail)(?:$|\/|\())/iu.test(normalized)) throw new Error();
  } catch { throw new HttpError(400, 'MAILBOX_INVALID_PATH', 'Only this connected Microsoft mailbox can be used.'); }
  return url;
}
async function invalidate(env: Env, row: ConnectionRow, message: string, clear = false): Promise<void> {
  await env.DB.prepare(`UPDATE mailbox_connection SET last_error=?,updated_at=?,encrypted_tokens=CASE WHEN ?=1 THEN NULL ELSE encrypted_tokens END,
    access_expires_at=CASE WHEN ?=1 THEN NULL ELSE access_expires_at END WHERE id=1 AND version=?`)
    .bind(message, new Date().toISOString(), clear ? 1 : 0, clear ? 1 : 0, row.version).run();
}
async function usableTokens(env: Env, config: Configuration): Promise<{ tokens: Tokens; row: ConnectionRow }> {
  let row = await connection(env);
  if (!matches(row, config)) throw new HttpError(409, 'MAILBOX_NOT_CONNECTED', reconnect);
  let tokens: Tokens;
  try {
    tokens = await decrypt<Tokens>(config, row.encrypted_tokens!, 'tokens');
    if (!tokenString(tokens.accessToken) || !tokenString(tokens.refreshToken)) throw new Error();
  } catch {
    await invalidate(env, row, reconnect, true);
    throw new HttpError(409, 'MAILBOX_RECONNECT_REQUIRED', reconnect);
  }
  if (row.access_expires_at !== null && row.access_expires_at > Date.now() + 60_000) return { tokens, row };
  const lease = random(), now = Date.now(), claimedVersion = row.version;
  const claimed = await env.DB.prepare(`UPDATE mailbox_connection SET refresh_lease_token=?,refresh_lease_until=?
    WHERE id=1 AND version=? AND encrypted_tokens IS NOT NULL AND (refresh_lease_until IS NULL OR refresh_lease_until<=?)`)
    .bind(lease, now + 60_000, row.version, now).run();
  if (claimed.meta.changes !== 1) throw new HttpError(409, 'MAILBOX_REFRESH_BUSY', 'Microsoft connection is refreshing. Try again shortly.');
  try {
    const grant = await exchange(config, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, tokens);
    const encrypted = await encrypt(config, { accessToken: grant.accessToken, refreshToken: grant.refreshToken } satisfies Tokens, 'tokens');
    const saved = await env.DB.prepare(`UPDATE mailbox_connection SET encrypted_tokens=?,access_expires_at=?,granted_scopes=?,updated_at=?,last_error=NULL,
      refresh_lease_token=NULL,refresh_lease_until=NULL,version=version+1 WHERE id=1 AND version=? AND refresh_lease_token=? AND encrypted_tokens IS NOT NULL`)
      .bind(encrypted, grant.expiresAt, JSON.stringify(grant.scopes), new Date().toISOString(), row.version, lease).run();
    if (saved.meta.changes !== 1) throw new HttpError(409, 'MAILBOX_CONNECTION_CHANGED', 'The Microsoft connection changed. Refresh Maildesk before continuing.');
    row = await connection(env);
    if (!matches(row, config)) throw new HttpError(409, 'MAILBOX_NOT_CONNECTED', reconnect);
    return { tokens: { accessToken: grant.accessToken, refreshToken: grant.refreshToken }, row };
  } catch (error) {
    const permanent = error instanceof HttpError && error.code === 'MAILBOX_RECONNECT_REQUIRED';
    await env.DB.prepare(`UPDATE mailbox_connection SET refresh_lease_token=NULL,refresh_lease_until=NULL,last_error=?,updated_at=?,
      encrypted_tokens=CASE WHEN ?=1 THEN NULL ELSE encrypted_tokens END,access_expires_at=CASE WHEN ?=1 THEN NULL ELSE access_expires_at END
      WHERE id=1 AND version=? AND refresh_lease_token=?`)
      .bind(permanent ? reconnect : 'Microsoft connection could not refresh. Try again later.', new Date().toISOString(), permanent ? 1 : 0, permanent ? 1 : 0, claimedVersion, lease).run();
    throw error;
  }
}

/** Fixed-host internal Graph calls; no automatic retry, including after send timeouts. */
export async function mailboxGraphFetch(env: Env, path: string, init: RequestInit = {}, beforeRequest?: () => Promise<void>): Promise<Response> {
  const config = requireConfiguration(env), target = graphUrl(path);
  const method = (init.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'POST'].includes(method) || (method !== 'POST' && init.body != null)
    || (method === 'POST' && (target.pathname !== '/v1.0/me/sendMail' || target.search))
    || (method !== 'POST' && target.pathname === '/v1.0/me/sendMail')) {
    throw new HttpError(400, 'MAILBOX_INVALID_METHOD', 'Maildesk can read this mailbox and submit approved messages. Other mailbox changes are disabled.');
  }
  const { tokens, row } = await usableTokens(env, config);
  const supplied = new Headers(init.headers), headers = new Headers({ Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' });
  for (const name of ['Content-Type', 'Accept', 'If-Match']) if (supplied.has(name)) headers.set(name, supplied.get(name)!);
  const prefer = (supplied.get('Prefer') ?? '').split(',').map(value => value.trim()).filter(value => value && !/^IdType\s*=/iu.test(value));
  headers.set('Prefer', [...prefer, 'IdType="ImmutableId"'].join(', '));
  const latest = await connection(env);
  if (!matches(latest, config) || latest.version !== row.version) throw new HttpError(409, 'MAILBOX_CONNECTION_CHANGED', 'The Microsoft connection changed. Refresh Maildesk before continuing.');
  // Sending code supplies its fresh version, cancellation and suppression guard.
  // Do not add asynchronous work between this final guard and the external call.
  await beforeRequest?.();
  let response: Response;
  try { response = await fetch(target, { method, headers, body: init.body, redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20_000) }); }
  catch { throw new HttpError(502, 'MAILBOX_REQUEST_UNCERTAIN', 'Microsoft did not return a confirmed outcome. No automatic retry was made.'); }
  if (response.ok) {
    // Warning cleanup is not part of the provider outcome. In particular, an
    // accepted send must remain accepted even when this cosmetic write fails.
    try { await env.DB.prepare('UPDATE mailbox_connection SET last_error=NULL WHERE id=1 AND version=? AND last_error IS NOT NULL').bind(row.version).run(); }
    catch { /* A later connection check can clear the warning. */ }
    return response;
  }
  const unauthorized = response.status === 401;
  const message = unauthorized ? reconnect : response.status === 429 ? 'Microsoft is busy. Try again after the indicated delay.'
    : response.status === 403 ? 'Microsoft did not allow this mailbox action. Review the connection permissions.' : 'Microsoft did not complete this mailbox action.';
  await invalidate(env, row, message, unauthorized);
  const safeHeaders = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  const retry = response.headers.get('Retry-After');
  if (retry && /^\d{1,6}$/u.test(retry)) safeHeaders.set('Retry-After', String(Math.min(86_400, Math.max(1, Number(retry)))));
  // Provider errors can include addresses, message fragments and identifiers.
  // Return only a bounded status/message; never forward redirects or raw bodies.
  await response.body?.cancel();
  return new Response(JSON.stringify({ error: { code: unauthorized ? 'MAILBOX_RECONNECT_REQUIRED' : 'MAILBOX_PROVIDER_ERROR', message } }), {
    status: response.status >= 400 && response.status <= 599 ? response.status : 502, headers: safeHeaders,
  });
}
