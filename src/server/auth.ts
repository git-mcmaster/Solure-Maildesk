import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './http';
import type { Env } from './types';

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export const isLoopback = (hostname: string): boolean => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);

export function isDevelopment(request: Request, env: Env): boolean {
  return env.DEV_AUTH === 'true' && isLoopback(new URL(request.url).hostname);
}

export async function authenticate(request: Request, env: Env): Promise<void> {
  if (!env.OWNER_EMAIL || !env.DASHBOARD_ORIGIN) throw new HttpError(503, 'AUTH_NOT_CONFIGURED', 'Owner access has not been configured.');
  if (isDevelopment(request, env)) return;
  if (new URL(request.url).origin !== new URL(env.DASHBOARD_ORIGIN).origin) throw new HttpError(403, 'HOST_NOT_ALLOWED', 'This address is not enabled for dashboard access.');
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new HttpError(503, 'AUTH_NOT_CONFIGURED', 'Cloudflare Access must be configured before this dashboard can be used.');
  const team = env.ACCESS_TEAM_DOMAIN.replace(/^https:\/\//u, '').replace(/\/$/u, '');
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/u.test(team)) throw new HttpError(503, 'AUTH_NOT_CONFIGURED', 'The access provider configuration is invalid.');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new HttpError(401, 'SIGN_IN_REQUIRED', 'Please sign in to your dashboard.');
  try {
    const issuer = `https://${team}`;
    let keys = keySets.get(issuer);
    if (!keys) { keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)); keySets.set(issuer, keys); }
    const { payload } = await jwtVerify(token, keys, { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'] });
    if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) throw new Error('Wrong owner');
  } catch { throw new HttpError(403, 'ACCESS_DENIED', 'This account does not have dashboard access.'); }
}

export function validateMutationOrigin(request: Request, env: Env): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('Origin');
  const allowed = new Set([new URL(env.DASHBOARD_ORIGIN).origin]);
  if (isDevelopment(request, env)) allowed.add(new URL(request.url).origin);
  if (!origin || !allowed.has(origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, 'ORIGIN_DENIED', 'This request must come from your dashboard.');
}
