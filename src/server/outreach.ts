import { HttpError, json, onlyFields, readJson, stringField } from './http';
import { plannedTrackingTime } from './scheduling';
import { cancelInactiveNotifications } from './notifications';
import { normalizedRecipient, isDoNotContact } from './opt-out';
import { emailContent } from '../client/signature';
import { DEFAULT_TRACKING_DELAY_SECONDS, type OutreachInput, type OutreachItem, type OutreachPage, type OutreachState } from '../shared/outreach';
import type { Env } from './types';

interface JobRow {
  id: string; version: number; state: OutreachState | 'submitting' | 'awaiting_confirmation' | 'cooldown'; label: string; recipient: string; subject: string; body: string;
  prepared_html: string | null; prepared_text: string | null; pixel_id: string | null; pixel_token: string | null;
  opt_out_url: string | null; created_at: string; updated_at: string; approved_at: string | null;
  approved_version: number | null; scheduled_at: string | null; tracking_starts_at: string | null;
  delay_seconds: number;
  last_error: string | null; do_not_contact: number; pixel_status: string | null;
}
const select = `SELECT j.*,p.token AS pixel_token,p.status AS pixel_status,
  EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=j.recipient) AS do_not_contact
  FROM outreach_jobs j LEFT JOIN pixels p ON p.id=j.pixel_id`;
const editable = ['draft', 'prepared', 'approved', 'cancelled', 'blocked'];
const editableSql = "('draft','prepared','approved','cancelled','blocked')";
const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const noContact = 'This recipient is on the do-not-contact list.';
const origin = (value: string) => value.replace(/\/$/u, '');
const randomToken = (size: number) => Array.from(crypto.getRandomValues(new Uint8Array(size)), value => value.toString(16).padStart(2, '0')).join('');
const escapeHtml = (value: string) => value.replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function item(row: JobRow, env: Env): OutreachItem {
  let state: OutreachState = ['submitting', 'awaiting_confirmation', 'cooldown'].includes(row.state) ? 'needs_attention' : row.state as OutreachState;
  if (state === 'scheduled' && row.tracking_starts_at && row.tracking_starts_at <= new Date().toISOString()) state = row.pixel_status === 'armed' && row.pixel_token ? 'tracking' : 'needs_attention';
  return { id: row.id, version: row.version, canEdit: isEditable(row), state, label: row.label, recipient: row.recipient,
    subject: row.subject, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at,
    approvedAt: row.approved_at, scheduledAt: row.scheduled_at, trackingStartsAt: row.tracking_starts_at,
    delaySeconds: row.delay_seconds, pixelId: row.pixel_id,
    pixelUrl: row.pixel_token ? `${origin(env.PIXEL_ORIGIN)}/p/${row.pixel_token}.gif` : null,
    optOutUrl: row.opt_out_url, preparedHtml: row.prepared_html, preparedText: row.prepared_text,
    doNotContact: row.do_not_contact === 1, lastError: row.last_error };
}
async function getJob(env: Env, id: string): Promise<JobRow> {
  if (!idPattern.test(id)) throw new HttpError(404, 'NOT_FOUND', 'This review item could not be found.');
  const row = await env.DB.prepare(`${select} WHERE j.id=?`).bind(id).first<JobRow>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'This review item could not be found.');
  return row;
}
function version(body: Record<string, unknown>): number {
  if (!Number.isSafeInteger(body.version) || Number(body.version) < 1) throw new HttpError(400, 'INVALID_VERSION', 'Refresh this item before making changes.');
  return body.version as number;
}
function requireVersion(row: JobRow, expected: number) {
  if (row.version !== expected) throw new HttpError(409, 'VERSION_CHANGED', 'This draft changed. Refresh and review the current version.');
}
function isEditable(row: JobRow): boolean {
  return editable.includes(row.state) && !(row.tracking_starts_at && row.tracking_starts_at <= new Date().toISOString());
}
function requireEditable(row: JobRow) {
  if (!isEditable(row)) throw new HttpError(409, 'ITEM_LOCKED', 'Cancel a pending tracking plan before editing. After tracking has started, stop it and import a new draft for a separate message. Existing history is kept.');
}
function input(raw: unknown): OutreachInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'INVALID_IMPORT', 'Each imported draft must be an object.');
  const value = raw as Record<string, unknown>;
  onlyFields(value, ['label', 'recipient', 'subject', 'body']);
  const label = stringField(value.label, 'Label', 150);
  const subject = stringField(value.subject, 'Subject', 200);
  const body = stringField(value.body, 'Body', 10_000);
  if (!label || !subject || !body || /[\r\n]/u.test(subject)) throw new HttpError(400, 'INVALID_IMPORT', 'Each draft needs a label, one-line subject and message body.');
  return { label, subject, body, recipient: normalizedRecipient(value.recipient) };
}
async function readImport(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'JSON_REQUIRED', 'Import a JSON file.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'INVALID_IMPORT', 'Choose a JSON file containing your drafts.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    length += next.value.byteLength;
    if (length > 1_048_576) { await reader.cancel(); throw new HttpError(413, 'BODY_TOO_LARGE', 'Import files must be no larger than 1 MB.'); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'INVALID_IMPORT', 'This file is not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'INVALID_IMPORT', 'Use an object containing an items array.');
  return value as Record<string, unknown>;
}
export async function listOutreach(env: Env): Promise<OutreachPage> {
  const rows = await env.DB.prepare(`${select} ORDER BY j.created_at DESC,j.id DESC LIMIT 500`).all<JobRow>();
  return { items: rows.results.map(row => item(row, env)), scheduling: { mode: 'planned-time',
    description: 'Set the same planned send time in Outlook. Tracking starts 45 seconds later. Maildesk does not send email or confirm that Outlook sent it.' } };
}
async function importDrafts(request: Request, env: Env) {
  const body = await readImport(request); onlyFields(body, ['items']);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) throw new HttpError(400, 'INVALID_IMPORT', 'Import 1 to 100 drafts at a time.');
  const values = body.items.map(input);
  if (new Set(values.map(value => value.recipient)).size !== values.length) throw new HttpError(400, 'DUPLICATE_RECIPIENT', 'Use one draft per recipient in an import batch.');
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM outreach_jobs').first<number>('count');
  if ((count ?? 0) + values.length > 500) throw new HttpError(409, 'QUEUE_LIMIT', 'This review queue supports 500 items.');
  const now = new Date().toISOString();
  const imported = values.map(value => ({ ...value, id: crypto.randomUUID() }));
  const saved = await env.DB.prepare(`WITH capacity AS MATERIALIZED (SELECT COUNT(*)+?<=500 AS allowed FROM outreach_jobs)
    INSERT INTO outreach_jobs (id,label,recipient,subject,body,state,created_at,updated_at,last_error)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.label'),json_extract(value,'$.recipient'),json_extract(value,'$.subject'),json_extract(value,'$.body'),
      CASE WHEN EXISTS (SELECT 1 FROM do_not_contact WHERE recipient=json_extract(value,'$.recipient')) THEN 'blocked' ELSE 'draft' END,?,?,
      CASE WHEN EXISTS (SELECT 1 FROM do_not_contact WHERE recipient=json_extract(value,'$.recipient')) THEN ? ELSE NULL END
    FROM json_each(?) WHERE (SELECT allowed FROM capacity)=1`)
    .bind(imported.length, now, now, noContact, JSON.stringify(imported)).run();
  if (saved.meta.changes !== imported.length) throw new HttpError(409, 'QUEUE_LIMIT', 'The review queue reached its 500-item limit. Nothing from this import was added.');
  return json(await listOutreach(env), 201);
}
async function editDraft(row: JobRow, body: Record<string, unknown>, env: Env) {
  onlyFields(body, ['version', 'label', 'recipient', 'subject', 'body']);
  const expected = version(body); requireVersion(row, expected); requireEditable(row);
  const draft = input({ label: body.label ?? row.label, recipient: body.recipient ?? row.recipient, subject: body.subject ?? row.subject, body: body.body ?? row.body });
  const now = new Date().toISOString();
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE pixels SET status='paused',updated_at=? WHERE id IN
      (SELECT pixel_id FROM outreach_jobs WHERE id=? AND version=? AND state IN ${editableSql})`).bind(now, row.id, expected),
    env.DB.prepare(`UPDATE outreach_jobs SET version=version+1,label=?,recipient=?,subject=?,body=?,state='draft',
      prepared_html=NULL,prepared_text=NULL,pixel_id=NULL,opt_out_url=NULL,approved_at=NULL,approved_version=NULL,
      scheduled_at=NULL,tracking_starts_at=NULL,last_error=NULL,updated_at=?
      WHERE id=? AND version=? AND state IN ${editableSql}`)
      .bind(draft.label, draft.recipient, draft.subject, draft.body, now, row.id, expected),
  ]);
  if (!result[1]?.meta.changes) throw new HttpError(409, 'VERSION_CHANGED', 'This item changed. Refresh before editing.');
  return json(item(await getJob(env, row.id), env));
}
async function prepareDraft(row: JobRow, body: Record<string, unknown>, env: Env) {
  onlyFields(body, ['version']); const expected = version(body); requireVersion(row, expected); requireEditable(row);
  if (await isDoNotContact(env, row.recipient)) throw new HttpError(409, 'DO_NOT_CONTACT', noContact);
  if (row.state === 'prepared' || row.state === 'approved') return json(item(row, env));
  const now = new Date().toISOString(), pixelId = crypto.randomUUID(), token = randomToken(16), optToken = randomToken(32);
  const pixelUrl = `${origin(env.PIXEL_ORIGIN)}/p/${token}.gif`, optUrl = `${origin(env.PIXEL_ORIGIN)}/outreach/stop/${optToken}`;
  const footer = emailContent(pixelUrl, env.OWNER_EMAIL, 'signature', optUrl);
  // Imported copy is plain text. It cannot inject markup, tracking resources or scripts.
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;">${escapeHtml(row.body).replace(/\r?\n/gu, '<br>')}</div><br>${footer.html}`;
  const text = `${row.body}\n\n${footer.plainText}`;
  const guard = `EXISTS (SELECT 1 FROM outreach_jobs j WHERE j.id=? AND j.version=? AND j.state IN ('draft','cancelled','blocked')
    AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=j.recipient))`;
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO pixels (id,token,label,recipient,notes,created_at,updated_at)
      SELECT ?,?,?,?,'Prepared by the review queue. Manage its schedule in Draft review.',?,? WHERE ${guard}
        AND (SELECT COUNT(*) FROM pixels)<50000`).bind(pixelId, token, row.label, row.recipient, now, now, row.id, expected),
    env.DB.prepare(`INSERT INTO opt_out_links (token,pixel_id,recipient,created_at) SELECT ?,id,lower(trim(recipient)),?
      FROM pixels WHERE id=? AND ${guard}`).bind(optToken, now, pixelId, row.id, expected),
    env.DB.prepare(`UPDATE outreach_jobs SET state='prepared',pixel_id=?,opt_out_url=?,prepared_html=?,prepared_text=?,
      approved_at=NULL,approved_version=NULL,scheduled_at=NULL,last_error=NULL,updated_at=?
      WHERE id=? AND version=? AND state IN ('draft','cancelled','blocked') AND EXISTS (SELECT 1 FROM pixels WHERE id=?)
        AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=outreach_jobs.recipient)`)
      .bind(pixelId, optUrl, html, text, now, row.id, expected, pixelId),
  ]);
  if (!results[2]?.meta.changes) throw new HttpError(409, 'PREPARATION_CHANGED', 'This item changed, opted out or reached the saved-pixel limit. Refresh before preparing.');
  return json(item(await getJob(env, row.id), env));
}
async function approveDraft(row: JobRow, body: Record<string, unknown>, env: Env) {
  onlyFields(body, ['version']); const expected = version(body); requireVersion(row, expected);
  const now = new Date().toISOString();
  const saved = await env.DB.prepare(`UPDATE outreach_jobs SET state='approved',approved_at=?,approved_version=version,updated_at=?
    WHERE id=? AND version=? AND state='prepared' AND prepared_html IS NOT NULL AND prepared_text IS NOT NULL AND pixel_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=outreach_jobs.recipient)`)
    .bind(now, now, row.id, expected).run();
  if (!saved.meta.changes) throw new HttpError(409, 'NOT_APPROVABLE', 'Prepare the current draft and check its do-not-contact status before approving.');
  return json(item(await getJob(env, row.id), env));
}
async function cancelDraft(row: JobRow, body: Record<string, unknown>, env: Env) {
  onlyFields(body, ['version']); const expected = version(body); requireVersion(row, expected);
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE pixels SET status='paused',scheduled_send_at=NULL,updated_at=? WHERE id IN
      (SELECT pixel_id FROM outreach_jobs WHERE id=? AND version=?)`).bind(now, row.id, expected),
    env.DB.prepare(`UPDATE outreach_jobs SET state='cancelled',approved_at=NULL,approved_version=NULL,
      scheduled_at=CASE WHEN tracking_starts_at>? THEN NULL ELSE scheduled_at END,
      tracking_starts_at=CASE WHEN tracking_starts_at>? THEN NULL ELSE tracking_starts_at END,
      updated_at=?,last_error=NULL WHERE id=? AND version=?`).bind(now, now, now, row.id, expected),
    env.DB.prepare(cancelInactiveNotifications),
  ]);
  if (!results[1]?.meta.changes) throw new HttpError(409, 'VERSION_CHANGED', 'This item changed. Refresh before stopping its tracking plan.');
  return json(item(await getJob(env, row.id), env));
}

function selectedItems(value: unknown): { id: string; version: number }[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new HttpError(400, 'INVALID_SCHEDULE', 'Select 1 to 100 approved drafts.');
  const selected = value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'INVALID_SCHEDULE', 'Select current approved drafts.');
    const entry = raw as Record<string, unknown>; onlyFields(entry, ['id', 'version']);
    if (typeof entry.id !== 'string' || !idPattern.test(entry.id)) throw new HttpError(400, 'INVALID_SCHEDULE', 'Select valid drafts.');
    return { id: entry.id, version: version(entry) };
  });
  if (new Set(selected.map(entry => entry.id)).size !== selected.length) throw new HttpError(400, 'INVALID_SCHEDULE', 'Select each draft once.');
  return selected;
}
async function scheduleDrafts(body: Record<string, unknown>, env: Env) {
  onlyFields(body, ['items', 'sendAt', 'delaySeconds']);
  if (body.delaySeconds !== DEFAULT_TRACKING_DELAY_SECONDS) throw new HttpError(400, 'INVALID_DELAY', 'Tracking starts 45 seconds after your planned Outlook send time.');
  const { sendAt, startsAt, now } = plannedTrackingTime(body.sendAt);
  const selected = selectedItems(body.items), selectedJson = JSON.stringify(selected);
  const result = await env.DB.prepare(`${select} WHERE j.id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`).bind(selectedJson).all<JobRow>();
  const rows = result.results;
  if (rows.length !== selected.length) throw new HttpError(409, 'SCHEDULE_CHANGED', 'A selected draft is unavailable. Refresh your review.');
  if (new Set(rows.map(row => row.recipient)).size !== rows.length) throw new HttpError(409, 'DUPLICATE_RECIPIENT', 'Choose one message per recipient in this tracking batch. Review duplicate imports before proceeding.');
  for (const row of rows) {
    requireVersion(row, selected.find(entry => entry.id === row.id)!.version);
    if (row.state !== 'approved' || row.approved_version !== row.version || row.do_not_contact || !row.pixel_id || !row.prepared_html) throw new HttpError(409, 'NOT_SCHEDULABLE', 'Every selected draft must have current approval, a prepared image and no opt-out.');
  }
  const activation = crypto.randomUUID();
  // Materialize the complete eligible set before changing either table. A DNC
  // or version race cannot leave only part of the selected batch scheduled.
  const results = await env.DB.batch([
    env.DB.prepare(`WITH selected AS MATERIALIZED
        (SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.version') AS version FROM json_each(?)),
      eligible AS MATERIALIZED (SELECT j.pixel_id FROM outreach_jobs j JOIN selected s ON s.id=j.id AND s.version=j.version
        WHERE j.approved_version=j.version AND j.state='approved' AND j.prepared_html IS NOT NULL AND j.prepared_text IS NOT NULL
          AND EXISTS (SELECT 1 FROM pixels p WHERE p.id=j.pixel_id AND lower(trim(p.recipient))=j.recipient AND p.status!='armed')
          AND NOT EXISTS (SELECT 1 FROM outreach_jobs pending WHERE pending.recipient=j.recipient AND pending.id NOT IN (SELECT id FROM selected)
            AND pending.state='scheduled' AND pending.tracking_starts_at>?)
          AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=j.recipient))
      UPDATE pixels SET status='armed',scheduled_send_at=?,armed_at=?,activation_id=?||':'||id,activation_alert_at=NULL,updated_at=?
      WHERE id IN (SELECT pixel_id FROM eligible) AND (SELECT COUNT(*) FROM eligible)=?`)
      .bind(selectedJson, now, sendAt, startsAt, activation, now, selected.length),
    env.DB.prepare(`UPDATE outreach_jobs SET state='scheduled',scheduled_at=?,tracking_starts_at=?,delay_seconds=45,updated_at=?,last_error=NULL
      WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND state='approved' AND approved_version=version
        AND EXISTS (SELECT 1 FROM pixels p WHERE p.id=outreach_jobs.pixel_id AND p.activation_id=?||':'||p.id)`)
      .bind(sendAt, startsAt, now, selectedJson, activation),
    env.DB.prepare(cancelInactiveNotifications),
  ]);
  if (results[1]?.meta.changes !== selected.length) throw new HttpError(409, 'SCHEDULE_CHANGED', 'A selected draft changed, opted out or already has another pending tracking plan. Nothing was scheduled; refresh your review.');
  return json(await listOutreach(env));
}

async function rescheduleDraft(row: JobRow, body: Record<string, unknown>, env: Env) {
  onlyFields(body, ['version', 'sendAt']); const expected = version(body); requireVersion(row, expected);
  const { sendAt, startsAt, now } = plannedTrackingTime(body.sendAt), activation = crypto.randomUUID();
  if (row.state !== 'scheduled' || !row.tracking_starts_at || row.tracking_starts_at <= now) throw new HttpError(409, 'TRACKING_ALREADY_STARTED', 'Only pending tracking plans can be rescheduled. Stop active tracking and keep its history.');
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE pixels SET scheduled_send_at=?,armed_at=?,activation_id=?,activation_alert_at=NULL,updated_at=?
      WHERE id=? AND status='armed' AND armed_at>? AND lower(trim(recipient))=?
        AND EXISTS (SELECT 1 FROM outreach_jobs j WHERE j.id=? AND j.version=? AND j.approved_version=j.version
          AND j.state='scheduled' AND j.tracking_starts_at>?)
        AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=lower(trim(pixels.recipient)))`)
      .bind(sendAt, startsAt, activation, now, row.pixel_id, now, row.recipient, row.id, expected, now),
    env.DB.prepare(`UPDATE outreach_jobs SET scheduled_at=?,tracking_starts_at=?,updated_at=?,last_error=NULL WHERE id=? AND version=? AND state='scheduled'
      AND EXISTS (SELECT 1 FROM pixels p WHERE p.id=outreach_jobs.pixel_id AND p.activation_id=?)`)
      .bind(sendAt, startsAt, now, row.id, expected, activation),
    env.DB.prepare(cancelInactiveNotifications),
  ]);
  if (results[1]?.meta.changes !== 1) throw new HttpError(409, 'SCHEDULE_CHANGED', 'This plan changed, started tracking or its recipient opted out. Refresh before rescheduling.');
  return json(item(await getJob(env, row.id), env));
}

/** Owner authentication and mutation-origin checks run before this router. */
export async function outreachApi(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname, method = request.method;
  if (path === '/api/outreach' && method === 'GET') return json(await listOutreach(env));
  if (path === '/api/outreach/import' && method === 'POST') return importDrafts(request, env);
  if (path === '/api/outreach/schedule' && method === 'POST') return scheduleDrafts(await readJson(request), env);
  const match = /^\/api\/outreach\/([^/]+)(?:\/(prepare|approve|cancel|reschedule))?$/u.exec(path);
  if (match) {
    const row = await getJob(env, match[1]!);
    if (method === 'PATCH' && !match[2]) return editDraft(row, await readJson(request), env);
    if (method === 'POST' && match[2]) {
      const body = await readJson(request);
      if (match[2] === 'prepare') return prepareDraft(row, body, env);
      if (match[2] === 'approve') return approveDraft(row, body, env);
      if (match[2] === 'reschedule') return rescheduleDraft(row, body, env);
      return cancelDraft(row, body, env);
    }
  }
  throw new HttpError(404, 'NOT_FOUND', 'This review action could not be found.');
}
