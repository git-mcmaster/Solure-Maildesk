import type { Env } from './types';

// One transparent GIF, with identical public responses for known and unknown IDs.
const image = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));
const headers = { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store', Pragma: 'no-cache', Expires: '0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': '*' };

export async function fetchPixel(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/p\/([a-f0-9]{32})\.gif$/u.exec(url.pathname);
  if (!match) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  if (request.method === 'HEAD') return new Response(null, { headers });
  try {
    const now = new Date().toISOString();
    const day = now.slice(0, 10);
    await env.DB.prepare(`INSERT INTO events (id,pixel_id,created_at,phase)
      SELECT ?,p.id,?,CASE WHEN p.status='armed' AND p.armed_at IS NOT NULL AND p.armed_at<=? THEN 'after_arming' ELSE 'before_arming' END
      FROM pixels p WHERE p.token=? AND p.status!='archived'
      AND CASE WHEN p.daily_load_day=? THEN p.daily_load_count ELSE 0 END<200
      AND (SELECT CASE WHEN event_day=? THEN event_count ELSE 0 END FROM settings WHERE id=1)<10000`)
      .bind(crypto.randomUUID(), now, now, match[1], day, day).run();
  } catch {
    // An image-load event is best effort. Do not reveal storage failures, or
    // break a recipient's email rendering because the tracking service failed.
    console.error('Pixel event recording failed');
  }
  return new Response(image.slice(), { headers });
}

export default { fetch: fetchPixel };
