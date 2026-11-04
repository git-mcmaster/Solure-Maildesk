import { authenticate, isDevelopment, validateMutationOrigin } from './auth';
import { getPixel, getSettings, listNotifications, listPixels, notificationConfigured } from './db';
import { errorResponse, HttpError, json, onlyFields, readJson, securityHeaders, stringField } from './http';
import { dispatchNotifications, enforceRetention } from './notifications';
import { parseRequestMetadata } from './request-metadata';
import type { Bootstrap, Env, LoadEvent, LoadEventPage, PixelStatus } from './types';

const statuses = new Set<PixelStatus>(['draft', 'armed', 'paused', 'archived']);
const opaqueId = /^[a-f0-9-]{32,36}$/u;
const eventId = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/u;
interface EventRow { id: string; created_at: string; phase: LoadEvent['phase']; request_metadata: string | null }
interface EventCursor { v: 1; p: string; t: string; i: string }

function encodeEventCursor(cursor: EventCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function decodeEventCursor(value: string, pixelId: string): EventCursor {
  const invalid = () => new HttpError(400, 'INVALID_QUERY', 'Choose a valid history page.');
  if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw invalid();
  try {
    const decoded: unknown = JSON.parse(atob(value.replace(/-/gu, '+').replace(/_/gu, '/')));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw invalid();
    const cursor = decoded as Record<string, unknown>;
    if (Object.keys(cursor).sort().join(',') !== 'i,p,t,v' || cursor.v !== 1 || cursor.p !== pixelId
      || typeof cursor.i !== 'string' || !eventId.test(cursor.i) || typeof cursor.t !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(cursor.t)
      || new Date(cursor.t).toISOString() !== cursor.t) throw invalid();
    const valid = cursor as unknown as EventCursor;
    if (encodeEventCursor(valid) !== value) throw invalid();
    return valid;
  } catch { throw invalid(); }
}

async function listEvents(env: Env, pixelId: string, params: URLSearchParams): Promise<LoadEvent[] | LoadEventPage> {
  for (const key of params.keys()) {
    if (!['limit', 'cursor'].includes(key) || params.getAll(key).length !== 1) throw new HttpError(400, 'INVALID_QUERY', 'Choose a valid history page.');
  }
  const paged = params.has('limit') || params.has('cursor');
  const limitValue = params.get('limit');
  const limit = limitValue === null ? (paged ? 100 : 1000) : Number(limitValue);
  if (limitValue !== null && (!/^[1-9][0-9]{0,2}$/u.test(limitValue) || limit > 200)) throw new HttpError(400, 'INVALID_QUERY', 'Choose 1 to 200 history events per page.');
  const cursorValue = params.get('cursor');
  const cursor = cursorValue === null ? null : decodeEventCursor(cursorValue, pixelId);
  // Cursor state is not authorization. The owner check and this pixel filter
  // always apply; keyset order remains stable when earlier rows are added/deleted.
  const before = cursor ? ' AND (created_at,id)<(?,?)' : '';
  const args: (string | number)[] = cursor ? [pixelId, cursor.t, cursor.i, limit + 1] : [pixelId, paged ? limit + 1 : limit];
  const rows = await env.DB.prepare(`SELECT id,created_at,phase,request_metadata FROM events WHERE pixel_id=?${before} ORDER BY created_at DESC,id DESC LIMIT ?`).bind(...args).all<EventRow>();
  const page = rows.results.slice(0, limit);
  const items = page.map((row): LoadEvent => ({ id: row.id, createdAt: row.created_at, phase: row.phase, metadata: parseRequestMetadata(row.request_metadata) }));
  if (!paged) return items;
  const last = page.at(-1);
  return { items, nextCursor: rows.results.length > limit && last ? encodeEventCursor({ v: 1, p: pixelId, t: last.created_at, i: last.id }) : null };
}

function recipientField(value: unknown): string {
  const recipient = stringField(value, 'Recipient', 254);
  if (recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipient)) throw new HttpError(400, 'INVALID_RECIPIENT', 'Enter one email address, or leave the recipient blank.');
  return recipient;
}

async function requirePixel(env: Env, id: string) {
  if (!opaqueId.test(id)) throw new HttpError(404, 'NOT_FOUND', 'This pixel could not be found.');
  const pixel = await getPixel(env, id);
  if (!pixel) throw new HttpError(404, 'NOT_FOUND', 'This pixel could not be found.');
  return pixel;
}

export function csvCell(value: unknown): string {
  let cell = String(value ?? '');
  if (/^[\s]*[=+@-]/u.test(cell) || /^[\t\r\n]/u.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/gu, '""')}"`;
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (path === '/api/health' && method === 'GET') {
    await env.DB.prepare('SELECT id FROM settings WHERE id=1').first();
    return json({ ok: true, notificationConfigured: notificationConfigured(env) });
  }
  if (path === '/api/bootstrap' && method === 'GET') {
    const [page, notifications, settings, counts, unread] = await Promise.all([listPixels(env), listNotifications(env), getSettings(env),
      env.DB.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(status='armed'),0) AS armed,COALESCE(SUM(load_count>0),0) AS loaded FROM pixels").first<{ total: number; armed: number; loaded: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL').first<{ count: number }>(),
    ]);
    const data: Bootstrap = { ownerEmail: env.OWNER_EMAIL, pixelBaseUrl: env.PIXEL_ORIGIN,
      mode: isDevelopment(request, env) ? 'development' : 'production', development: isDevelopment(request, env),
      notificationConfigured: notificationConfigured(env), pixels: page.items, notifications, settings,
      stats: { total: counts?.total ?? 0, armed: counts?.armed ?? 0, loaded: counts?.loaded ?? 0, unread: unread?.count ?? 0 } };
    return json(data);
  }
  if (path === '/api/pixels' && method === 'GET') {
    const q = url.searchParams.get('q') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    if (q.length > 200 || (status && status !== 'active' && status !== 'all' && !statuses.has(status as PixelStatus)) || !Number.isInteger(offset) || offset < 0 || offset > 50_000 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, 'INVALID_QUERY', 'Choose a valid search, status and page.');
    return json(await listPixels(env, { q, status, offset, limit }));
  }
  if (path === '/api/pixels' && method === 'POST') {
    const body = await readJson(request);
    onlyFields(body, ['label', 'recipient', 'notes']);
    const id = crypto.randomUUID();
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const now = new Date().toISOString();
    const label = body.label === undefined ? `Unlabeled pixel ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}` : stringField(body.label, 'Label', 150);
    const created = await env.DB.prepare('INSERT INTO pixels (id,token,label,recipient,notes,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM pixels)<50000')
      .bind(id, token, label || 'Unlabeled pixel', body.recipient === undefined ? '' : recipientField(body.recipient), body.notes === undefined ? '' : stringField(body.notes, 'Notes', 2000), now, now).run();
    if (!created.meta.changes) throw new HttpError(409, 'PIXEL_LIMIT', 'This version supports 50,000 saved pixels. Export and delete older records to make room.');
    return json(await getPixel(env, id), 201);
  }
  const match = /^\/api\/pixels\/([^/]+)(\/events)?$/u.exec(path);
  if (match) {
    const id = match[1]!;
    const pixel = await requirePixel(env, id);
    if (match[2]) {
      if (method === 'GET') {
        return json(await listEvents(env, id, url.searchParams));
      }
      if (method === 'DELETE') {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM events WHERE pixel_id=?').bind(id),
          env.DB.prepare('DELETE FROM notifications WHERE pixel_id=?').bind(id),
          env.DB.prepare('UPDATE pixels SET first_loaded_at=NULL,last_loaded_at=NULL,load_count=0,early_load_count=0,updated_at=? WHERE id=?').bind(new Date().toISOString(), id),
        ]);
        return json({ deleted: true });
      }
    } else {
      if (method === 'GET') return json(pixel);
      if (method === 'DELETE') { await env.DB.prepare('DELETE FROM pixels WHERE id=?').bind(id).run(); return json({ deleted: true }); }
      if (method === 'PATCH') {
        const body = await readJson(request);
        onlyFields(body, ['label', 'recipient', 'notes', 'status']);
        const status = body.status === undefined ? pixel.status : body.status as PixelStatus;
        if (!statuses.has(status)) throw new HttpError(400, 'INVALID_STATUS', 'Choose a valid pixel status.');
        const now = new Date().toISOString();
        const edits = [env.DB.prepare('UPDATE pixels SET label=?,recipient=?,notes=?,status=?,armed_at=?,updated_at=? WHERE id=?')
          .bind(body.label === undefined ? pixel.label : stringField(body.label, 'Label', 150) || 'Unlabeled pixel', body.recipient === undefined ? pixel.recipient : recipientField(body.recipient),
            body.notes === undefined ? pixel.notes : stringField(body.notes, 'Notes', 2000), status,
            status === 'armed' && pixel.status !== 'armed' ? now : pixel.armedAt, now, id)];
        if (status !== 'armed') edits.push(env.DB.prepare("UPDATE notifications SET status='disabled' WHERE pixel_id=? AND status IN ('pending','failed')").bind(id));
        await env.DB.batch(edits);
        return json(await getPixel(env, id));
      }
    }
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This action is not supported.');
  }
  if (path === '/api/settings' && method === 'GET') return json(await getSettings(env));
  if (path === '/api/settings' && method === 'PATCH') {
    const body = await readJson(request);
    onlyFields(body, ['emailEnabled', 'retentionDays', 'repeatAlerts', 'captureRequestDetails']);
    if (body.emailEnabled !== undefined && typeof body.emailEnabled !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'Email alerts must be on or off.');
    if (body.repeatAlerts !== undefined && typeof body.repeatAlerts !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'Repeat alerts must be on or off.');
    if (body.captureRequestDetails !== undefined && typeof body.captureRequestDetails !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'Request details must be on or off.');
    if (body.retentionDays !== undefined && ![30, 90, 180].includes(body.retentionDays as number)) throw new HttpError(400, 'INVALID_FIELD', 'Choose 30, 90 or 180 days of history.');
    if (body.emailEnabled === true && !notificationConfigured(env)) throw new HttpError(409, 'NOTIFICATION_NOT_CONFIGURED', 'Configure notification sending before enabling email alerts. Dashboard notifications already work.');
    // Omitted fields are preserved inside the write, so a concurrent retention
    // save cannot restore a stale capture=true after the owner disabled it.
    await env.DB.prepare('UPDATE settings SET email_enabled=COALESCE(?,email_enabled),retention_days=COALESCE(?,retention_days),repeat_alerts=COALESCE(?,repeat_alerts),capture_request_details=COALESCE(?,capture_request_details) WHERE id=1')
      .bind(body.emailEnabled === undefined ? null : Number(body.emailEnabled), body.retentionDays ?? null, body.repeatAlerts === undefined ? null : Number(body.repeatAlerts), body.captureRequestDetails === undefined ? null : Number(body.captureRequestDetails)).run();
    return json(await getSettings(env));
  }
  if (path === '/api/notifications' && method === 'GET') return json(await listNotifications(env));
  if (path === '/api/notifications/read' && method === 'POST') {
    const body = await readJson(request);
    onlyFields(body, ['ids']);
    const ids = body.ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== 'string' || !opaqueId.test(id)))) throw new HttpError(400, 'INVALID_IDS', 'Choose valid notification IDs.');
    if (ids === undefined) await env.DB.prepare('UPDATE notifications SET read_at=? WHERE read_at IS NULL').bind(new Date().toISOString()).run();
    else if (ids.length) await env.DB.batch(ids.map((id: string) => env.DB.prepare('UPDATE notifications SET read_at=? WHERE id=? AND read_at IS NULL').bind(new Date().toISOString(), id)));
    return json({ updated: true });
  }
  if (path === '/api/export.csv' && method === 'GET') {
    const encoder = new TextEncoder();
    let offset = 0;
    let headerSent = false;
    const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
      try {
        if (!headerSent) {
          controller.enqueue(encoder.encode(['Message', 'Recipient', 'Status', 'Created', 'First image load', 'Latest image load', 'Image requests', 'Before arming', 'Notes'].map(csvCell).join(',') + '\r\n'));
          headerSent = true;
        }
        const page = await listPixels(env, { offset, limit: 100 });
        for (const p of page.items) controller.enqueue(encoder.encode([p.label, p.recipient, p.status, p.createdAt, p.firstLoadedAt, p.lastLoadedAt, p.loadCount, p.earlyLoadCount, p.notes].map(csvCell).join(',') + '\r\n'));
        offset += page.items.length;
        if (!page.hasMore) controller.close();
      } catch (error) { controller.error(error); }
    } });
    return new Response(stream, { headers: { ...securityHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="solure-maildesk.csv"' } });
  }
  throw new HttpError(404, 'NOT_FOUND', 'This page could not be found.');
}

export async function fetchDashboard(request: Request, env: Env): Promise<Response> {
  try {
    await authenticate(request, env);
    validateMutationOrigin(request, env);
    if (new URL(request.url).pathname.startsWith('/api/')) return await api(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This action is not supported.');
    if (!env.ASSETS) return new Response('Dashboard assets have not been built.', { status: 503, headers: securityHeaders });
    const response = await env.ASSETS.fetch(request);
    const secured = new Response(response.body, response);
    for (const [key, value] of Object.entries(securityHeaders)) secured.headers.set(key, value);
    return secured;
  } catch (error) {
    if (!(error instanceof HttpError)) console.error('Dashboard request failed');
    return errorResponse(error);
  }
}

export async function runScheduled(env: Env): Promise<void> {
  await enforceRetention(env);
  await dispatchNotifications(env);
}

export default {
  fetch: fetchDashboard,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): void { ctx.waitUntil(runScheduled(env)); },
};
