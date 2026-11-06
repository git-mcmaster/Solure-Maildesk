import { authenticate, isDevelopment, validateMutationOrigin } from './auth';
import { getPixel, getSettings, listNotifications, listPixels, notificationConfigured } from './db';
import { errorResponse, HttpError, json, onlyFields, readJson, securityHeaders, stringField } from './http';
import { cancelInactiveNotifications, dispatchNotifications, enforceRetention } from './notifications';
import { parseRequestMetadata } from './request-metadata';
import { dispatchPixelReports, getPixelReport, listReports, queuePixelReports } from './reports';
import { addDoNotContact, getOrCreateOptOutLink, isDoNotContact, listDoNotContact } from './opt-out';
import { outreachApi } from './outreach';
import { scheduleManualPixel } from './scheduling';
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

async function protectQueuedPixel(env: Env, id: string) {
  const active = await env.DB.prepare(`SELECT 1 FROM outreach_jobs WHERE pixel_id=? AND state IN
    ('draft','prepared','approved','scheduled','submitting','awaiting_confirmation','cooldown','tracking','needs_attention')`).bind(id).first();
  if (active) throw new HttpError(409, 'SCHEDULE_MANAGED_PIXEL', 'Cancel or stop this item in Draft review before deleting its image or history.');
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
  if (path === '/api/outreach' || path.startsWith('/api/outreach/')) return outreachApi(request, env);
  if (path === '/api/health' && method === 'GET') {
    await env.DB.prepare('SELECT id FROM settings WHERE id=1').first();
    return json({ ok: true, notificationConfigured: notificationConfigured(env) });
  }
  if (path === '/api/bootstrap' && method === 'GET') {
    const [page, notifications, settings, counts, unread] = await Promise.all([listPixels(env), listNotifications(env), getSettings(env),
      env.DB.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(status='armed' AND armed_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=lower(trim(pixels.recipient)))),0) AS armed,COALESCE(SUM(load_count>0),0) AS loaded FROM pixels").first<{ total: number; armed: number; loaded: number }>(),
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
    if (q.length > 200 || (status && status !== 'active' && status !== 'inactive' && status !== 'all' && !statuses.has(status as PixelStatus)) || !Number.isInteger(offset) || offset < 0 || offset > 50_000 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, 'INVALID_QUERY', 'Choose a valid search, status and page.');
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
  if (path === '/api/do-not-contact') {
    if (method === 'GET') return json(await listDoNotContact(env, url.searchParams));
    if (method === 'POST') {
      const body = await readJson(request);
      onlyFields(body, ['recipient']);
      return json(await addDoNotContact(env, body.recipient), 201);
    }
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This action is not supported.');
  }
  const planned = /^\/api\/pixels\/([^/]+)\/schedule$/u.exec(path);
  if (planned) {
    const pixel = await requirePixel(env, planned[1]!);
    if (method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Set the tracking plan from your dashboard.');
    return scheduleManualPixel(env, pixel, await readJson(request));
  }
  const optOut = /^\/api\/pixels\/([^/]+)\/opt-out-link$/u.exec(path);
  if (optOut) {
    const pixel = await requirePixel(env, optOut[1]!);
    if (method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Create the link from your dashboard.');
    onlyFields(await readJson(request), []);
    return json(await getOrCreateOptOutLink(env, pixel.id, pixel.recipient));
  }
  const match = /^\/api\/pixels\/([^/]+)(\/(?:events|report))?$/u.exec(path);
  if (match) {
    const id = match[1]!;
    const pixel = await requirePixel(env, id);
    if (match[2] === '/report') {
      if (method === 'GET') return json(await getPixelReport(env, id));
    } else if (match[2]) {
      if (method === 'GET') {
        return json(await listEvents(env, id, url.searchParams));
      }
      if (method === 'DELETE') {
        await protectQueuedPixel(env, id);
        await env.DB.batch([
          env.DB.prepare('DELETE FROM events WHERE pixel_id=?').bind(id),
          env.DB.prepare('DELETE FROM notifications WHERE pixel_id=?').bind(id),
          env.DB.prepare('UPDATE pixels SET first_loaded_at=NULL,last_loaded_at=NULL,load_count=0,early_load_count=0,updated_at=? WHERE id=?').bind(new Date().toISOString(), id),
        ]);
        return json({ deleted: true });
      }
    } else {
      if (method === 'GET') return json(pixel);
      if (method === 'DELETE') {
        await protectQueuedPixel(env, id);
        await env.DB.batch([
          env.DB.prepare('DELETE FROM pixel_reports WHERE source_pixel_id=?').bind(id),
          env.DB.prepare('DELETE FROM pixels WHERE id=?').bind(id),
        ]);
        return json({ deleted: true });
      }
      if (method === 'PATCH') {
        const body = await readJson(request);
        onlyFields(body, ['label', 'recipient', 'notes', 'status', 'preserveUnloaded', 'enableEmailAlerts']);
        if (pixel.status === 'armed' && pixel.scheduledSendAt && pixel.armedAt && pixel.armedAt > new Date().toISOString()) {
          if (body.status === 'armed') throw new HttpError(409, 'TRACKING_PLAN_PENDING', 'Tracking already has a future start. Reschedule or stop this plan instead of starting early.');
          if (body.recipient !== undefined && body.recipient !== pixel.recipient) throw new HttpError(409, 'TRACKING_PLAN_PENDING', 'Stop the pending tracking plan before changing its recipient.');
        }
        if (body.status !== undefined || body.recipient !== undefined) {
          const managed = await env.DB.prepare('SELECT 1 FROM outreach_jobs WHERE pixel_id=?').bind(id).first();
          if (managed) throw new HttpError(409, 'SCHEDULE_MANAGED_PIXEL', 'Manage this image and its timing from Draft review. Its approved recipient and tracking delay are protected.');
        }
        if (body.preserveUnloaded !== undefined && typeof body.preserveUnloaded !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'Pixel preservation must be on or off.');
        if (body.status !== undefined && !statuses.has(body.status as PixelStatus)) throw new HttpError(400, 'INVALID_STATUS', 'Choose a valid pixel status.');
        if (body.enableEmailAlerts !== undefined && (body.enableEmailAlerts !== true || body.status !== 'armed')) throw new HttpError(400, 'INVALID_FIELD', 'Start tracking to enable email alerts.');
        if (body.enableEmailAlerts === true && !notificationConfigured(env)) throw new HttpError(409, 'NOTIFICATION_NOT_CONFIGURED', 'Configure notification sending before starting email alerts.');
        const recipient = body.recipient === undefined ? null : recipientField(body.recipient);
        const guardRecipient = body.status === 'armed' || recipient !== null;
        if (guardRecipient && (body.status ?? pixel.status) === 'armed' && await isDoNotContact(env, recipient ?? pixel.recipient)) {
          throw new HttpError(409, 'DO_NOT_CONTACT', 'This address has opted out. Do not send further sales emails.');
        }
        const now = new Date().toISOString();
        const status = body.status ?? null;
        const edits: D1PreparedStatement[] = [];
        if (body.enableEmailAlerts === true) {
          // Resuming the shared master starts future-only notification windows
          // for every tracking message. Disabled historical alerts stay disabled.
          edits.push(env.DB.prepare(`UPDATE pixels SET activation_id=lower(hex(randomblob(16))),activation_alert_at=NULL,armed_at=CASE WHEN scheduled_send_at IS NOT NULL THEN armed_at ELSE ? END,updated_at=?
            WHERE status='armed' AND armed_at<=? AND EXISTS (SELECT 1 FROM settings WHERE id=1 AND email_enabled=0)
              AND EXISTS (SELECT 1 FROM pixels target WHERE target.id=?
                AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=lower(trim(COALESCE(?,target.recipient)))) )`).bind(now, now, now, id, recipient));
        }
        // Every omitted value is preserved by the write itself. A stale label
        // save cannot undo a concurrent Start/Pause or restore old notes.
        edits.push(env.DB.prepare(`UPDATE pixels SET label=COALESCE(?,label),recipient=COALESCE(?,recipient),notes=COALESCE(?,notes),
          scheduled_send_at=CASE WHEN ? IS NOT NULL AND ?!='armed' THEN NULL ELSE scheduled_send_at END,
          activation_id=CASE WHEN ?='armed' AND (status!='armed' OR activation_id IS NULL) THEN ? ELSE activation_id END,
          activation_alert_at=CASE WHEN ?='armed' AND (status!='armed' OR activation_id IS NULL) THEN NULL ELSE activation_alert_at END,
          armed_at=CASE WHEN ?='armed' AND (status!='armed' OR activation_id IS NULL) THEN ? ELSE armed_at END,
          status=COALESCE(?,status),preserve_unloaded=COALESCE(?,preserve_unloaded),updated_at=? WHERE id=?
          AND (?=0 OR COALESCE(?,status)!='armed' OR NOT EXISTS
            (SELECT 1 FROM do_not_contact d WHERE d.recipient=lower(trim(COALESCE(?,pixels.recipient)))))
          AND (? IS NULL OR scheduled_send_at IS NULL OR status!='armed' OR armed_at<=? OR lower(trim(recipient))=lower(trim(?)))`)
          .bind(body.label === undefined ? null : stringField(body.label, 'Label', 150) || 'Unlabeled pixel',
            recipient, body.notes === undefined ? null : stringField(body.notes, 'Notes', 2000),
            status, status, status, crypto.randomUUID(), status, status, now, status,
            body.preserveUnloaded === undefined ? null : Number(body.preserveUnloaded), now, id, Number(guardRecipient), status, recipient, recipient, now, recipient));
        if (body.enableEmailAlerts === true) edits.push(env.DB.prepare(`UPDATE settings SET email_enabled=1 WHERE id=1
          AND EXISTS (SELECT 1 FROM pixels p WHERE p.id=? AND p.status='armed'
            AND (? IS NULL OR p.recipient=?)
            AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=lower(trim(p.recipient))))`).bind(id, recipient, recipient));
        edits.push(env.DB.prepare(cancelInactiveNotifications));
        await env.DB.batch(edits);
        const saved = await getPixel(env, id);
        if (!saved) throw new HttpError(404, 'NOT_FOUND', 'This pixel could not be found.');
        if (guardRecipient && (body.status ?? pixel.status) === 'armed' && await isDoNotContact(env, recipient ?? pixel.recipient)) {
          throw new HttpError(409, 'DO_NOT_CONTACT', 'This address has opted out. Do not send further sales emails.');
        }
        if (recipient !== null && saved.recipient !== recipient) throw new HttpError(409, 'SCHEDULE_CHANGED', 'The recipient is protected by a pending tracking plan. Stop it before changing the recipient.');
        return json(saved);
      }
    }
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This action is not supported.');
  }
  if (path === '/api/settings' && method === 'GET') return json(await getSettings(env));
  if (path === '/api/settings' && method === 'PATCH') {
    const body = await readJson(request);
    onlyFields(body, ['emailEnabled', 'retentionDays', 'repeatAlerts', 'captureRequestDetails', 'keepUnloadedPixels']);
    if (body.emailEnabled !== undefined && typeof body.emailEnabled !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'Email alerts must be on or off.');
    if (body.repeatAlerts !== undefined && typeof body.repeatAlerts !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'Repeat alerts must be on or off.');
    if (body.captureRequestDetails !== undefined && typeof body.captureRequestDetails !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'Request details must be on or off.');
    if (body.keepUnloadedPixels !== undefined && typeof body.keepUnloadedPixels !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'Unused pixel preservation must be on or off.');
    if (body.retentionDays !== undefined && ![30, 90, 180].includes(body.retentionDays as number)) throw new HttpError(400, 'INVALID_FIELD', 'Choose 30, 90 or 180 days of history.');
    if (body.emailEnabled === true && !notificationConfigured(env)) throw new HttpError(409, 'NOTIFICATION_NOT_CONFIGURED', 'Configure notification sending before enabling email alerts. Dashboard notifications already work.');
    // Omitted fields are preserved inside the write, so a concurrent retention
    // save cannot restore a stale capture=true after the owner disabled it.
    const edits: D1PreparedStatement[] = [];
    if (body.emailEnabled === true) {
      const now = new Date().toISOString();
      edits.push(env.DB.prepare(`UPDATE pixels SET activation_id=lower(hex(randomblob(16))),activation_alert_at=NULL,armed_at=CASE WHEN scheduled_send_at IS NOT NULL THEN armed_at ELSE ? END,updated_at=?
        WHERE status='armed' AND armed_at<=? AND EXISTS (SELECT 1 FROM settings WHERE id=1 AND email_enabled=0)`).bind(now, now, now));
    }
    edits.push(env.DB.prepare('UPDATE settings SET email_enabled=COALESCE(?,email_enabled),retention_days=COALESCE(?,retention_days),repeat_alerts=COALESCE(?,repeat_alerts),capture_request_details=COALESCE(?,capture_request_details),keep_unloaded_pixels=COALESCE(?,keep_unloaded_pixels) WHERE id=1')
      .bind(body.emailEnabled === undefined ? null : Number(body.emailEnabled), body.retentionDays ?? null, body.repeatAlerts === undefined ? null : Number(body.repeatAlerts), body.captureRequestDetails === undefined ? null : Number(body.captureRequestDetails), body.keepUnloadedPixels === undefined ? null : Number(body.keepUnloadedPixels)));
    edits.push(env.DB.prepare(cancelInactiveNotifications));
    await env.DB.batch(edits);
    return json(await getSettings(env));
  }
  if (path === '/api/notifications' && method === 'GET') return json(await listNotifications(env));
  if (path === '/api/reports' && method === 'GET') {
    for (const key of url.searchParams.keys()) if (!['limit', 'offset'].includes(key) || url.searchParams.getAll(key).length !== 1) throw new HttpError(400, 'INVALID_QUERY', 'Choose a valid report page.');
    const limit = url.searchParams.get('limit') ?? '100';
    const offset = url.searchParams.get('offset') ?? '0';
    if (!/^[1-9][0-9]{0,2}$/u.test(limit) || Number(limit) > 200 || !/^(?:0|[1-9][0-9]{0,6})$/u.test(offset)) throw new HttpError(400, 'INVALID_QUERY', 'Choose 1 to 200 reports per page and a valid offset.');
    return json(await listReports(env, Number(limit), Number(offset)));
  }
  const reportDelete = /^\/api\/reports\/([^/]+)$/u.exec(path);
  if (reportDelete && method === 'DELETE') {
    if (!opaqueId.test(reportDelete[1]!)) throw new HttpError(404, 'NOT_FOUND', 'This report could not be found.');
    const deleted = await env.DB.prepare('DELETE FROM pixel_reports WHERE id=? AND pixel_id IS NULL').bind(reportDelete[1]!).run();
    if (deleted.meta.changes !== 1) throw new HttpError(409, 'REPORT_NOT_DELETABLE', 'Delete the linked pixel to remove its report, or refresh if this report was already removed.');
    return json({ deleted: true });
  }
  const reportRetry = /^\/api\/reports\/([^/]+)\/retry$/u.exec(path);
  if (reportRetry && method === 'POST') {
    if (!opaqueId.test(reportRetry[1]!)) throw new HttpError(404, 'NOT_FOUND', 'This report could not be found.');
    onlyFields(await readJson(request), []);
    const retry = await env.DB.prepare("UPDATE pixel_reports SET status='pending',attempts=0,last_error=NULL,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND status='failed'")
      .bind(new Date().toISOString(), reportRetry[1]!).run();
    if (retry.meta.changes !== 1) throw new HttpError(409, 'REPORT_NOT_RETRYABLE', 'Only failed reports can be retried.');
    return json({ queued: true });
  }
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
          controller.enqueue(encoder.encode(['Message', 'Recipient', 'Status', 'Created', 'First image load', 'Latest image load', 'Image requests', 'Before arming', 'Notes', 'Do not contact'].map(csvCell).join(',') + '\r\n'));
          headerSent = true;
        }
        const page = await listPixels(env, { offset, limit: 100 });
        for (const p of page.items) controller.enqueue(encoder.encode([p.label, p.recipient, p.status, p.createdAt, p.firstLoadedAt, p.lastLoadedAt, p.loadCount, p.earlyLoadCount, p.notes, p.doNotContact ? 'Yes' : 'No'].map(csvCell).join(',') + '\r\n'));
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

export async function runScheduled(env: Env, time = new Date()): Promise<void> {
  await queuePixelReports(env, time);
  await dispatchPixelReports(env, time);
  await enforceRetention(env, time);
  await dispatchNotifications(env, time);
}

export default {
  fetch: fetchDashboard,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): void { ctx.waitUntil(runScheduled(env)); },
};
