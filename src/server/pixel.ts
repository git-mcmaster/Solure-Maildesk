import type { Env } from './types';
import { collectRequestMetadata } from './request-metadata';
import { brandLogo } from './brand-logo';

// One transparent GIF, with identical public responses for known and unknown IDs.
const image = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));
const headers = { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store', Pragma: 'no-cache', Expires: '0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': '*' };
const logoHeaders = { ...headers, 'Content-Type': 'image/png' };
const previewHeaders = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': '*' };

export async function fetchPixel(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const preview = url.pathname === '/brand/solure-logo-v1.png';
  const match = /^\/p\/([a-f0-9]{32})(\.gif|\/logo\.png)$/u.exec(url.pathname);
  if (!match && !preview) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  // Dashboard previews use this untracked asset rather than the message URL.
  if (preview) return new Response(request.method === 'HEAD' ? null : brandLogo.slice(), { headers: previewHeaders });
  const responseHeaders = match![2] === '/logo.png' ? logoHeaders : headers;
  const responseImage = match![2] === '/logo.png' ? brandLogo : image;
  if (request.method === 'HEAD') return new Response(null, { headers: responseHeaders });
  try {
    const now = new Date().toISOString();
    const day = now.slice(0, 10);
    const capture = await env.DB.prepare('SELECT capture_request_details FROM settings WHERE id=1').first<number>('capture_request_details');
    const metadata = capture === 1 ? JSON.stringify(collectRequestMetadata(request)) : null;
    await env.DB.prepare(`INSERT INTO events (id,pixel_id,created_at,phase,request_metadata)
      SELECT ?,p.id,?,'after_arming',
        CASE WHEN (SELECT capture_request_details FROM settings WHERE id=1)=1 THEN ? ELSE NULL END
      FROM pixels p WHERE p.token=? AND p.status='armed' AND p.activation_id IS NOT NULL AND p.armed_at IS NOT NULL AND p.armed_at<=?
      AND CASE WHEN p.daily_load_day=? THEN p.daily_load_count ELSE 0 END<200
      AND (SELECT CASE WHEN event_day=? THEN event_count ELSE 0 END FROM settings WHERE id=1)<10000`)
      .bind(crypto.randomUUID(), now, metadata, match![1], now, day, day).run();
  } catch {
    // An image-load event is best effort. Do not reveal storage failures, or
    // break a recipient's email rendering because the tracking service failed.
    console.error('Pixel event recording failed');
  }
  return new Response(responseImage.slice(), { headers: responseHeaders });
}

export default { fetch: fetchPixel };
