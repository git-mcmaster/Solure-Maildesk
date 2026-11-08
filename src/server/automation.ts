import { AUTOMATION_POLICY, type AutomaticDelivery, type AutomaticDeliveryState, type AutomationActivity, type AutomationPage } from '../shared/automation';
import { planSendTimes } from '../shared/send-plan';
import { prepareUnsubscribeHeaders } from '../shared/unsubscribe';
import { HttpError, json, onlyFields, readJson } from './http';
import { mailboxGraphFetch, mailboxStatus } from './mailbox';
import { cancelInactiveNotifications } from './notifications';
import { outreachMime } from './outreach-mime';
import { normalizedRecipient } from './opt-out';
import { plannedTrackingTime } from './scheduling';
import type { Env } from './types';

interface DeliveryRow {
  id: string; job_id: string; version: number; approved_version: number; recipient: string; label: string; subject: string;
  body_html: string; body_text: string; pixel_id: string | null; opt_out_url: string; message_id: string;
  state: AutomaticDeliveryState; send_at: string; time_zone: string; tracking_starts_at: string; queued_at: string;
  updated_at: string; submitted_at: string | null; accepted_at: string | null; sent_at: string | null;
  cancel_requested: number; attempts: number; claim_token: string | null; lease_until: string | null; last_error: string | null;
  reconcile_attempts: number; next_reconcile_at: string | null;
}
interface Job {
  id: string; version: number; approved_version: number | null; state: string; recipient: string; label: string; subject: string;
  prepared_html: string | null; prepared_text: string | null; pixel_id: string | null; opt_out_url: string | null;
  scheduled_at: string | null; tracking_starts_at: string | null;
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const noContact = 'This recipient is on the do-not-contact list.';
const approvedSnapshot = `j.version=d.approved_version AND j.approved_version=d.approved_version
  AND j.recipient=d.recipient AND j.subject=d.subject AND j.prepared_html=d.body_html AND j.prepared_text=d.body_text
  AND j.pixel_id=d.pixel_id AND j.opt_out_url=d.opt_out_url
  AND EXISTS (SELECT 1 FROM pixels p JOIN opt_out_links l ON l.pixel_id=p.id AND l.recipient=lower(trim(p.recipient))
    WHERE p.id=d.pixel_id AND lower(trim(p.recipient))=d.recipient AND l.token=substr(d.opt_out_url,-64)
      AND (instr(j.prepared_html,'/p/'||p.token||'/logo.png')>0 OR instr(j.prepared_html,'/p/'||p.token||'.gif')>0)
      AND instr(j.prepared_html,j.opt_out_url)>0 AND instr(j.prepared_text,j.opt_out_url)>0
      AND p.status IN ('draft','paused'))
  AND NOT EXISTS (SELECT 1 FROM do_not_contact n WHERE n.recipient=d.recipient)
  AND NOT EXISTS (SELECT 1 FROM outreach_recipient_stops s WHERE s.recipient=d.recipient)
  AND NOT EXISTS (SELECT 1 FROM pixels other WHERE other.id!=d.pixel_id AND lower(trim(other.recipient))=d.recipient
    AND other.status='armed' AND other.scheduled_send_at>=d.queued_at)`;
const eligibleJob = `${approvedSnapshot} AND j.state='scheduled'`;

function view(row: DeliveryRow): AutomaticDelivery {
  return { id: row.id, jobId: row.job_id, version: row.version, approvedVersion: row.approved_version,
    recipient: row.recipient, label: row.label, subject: row.subject, state: row.state,
    sendAt: row.send_at, timeZone: row.time_zone, trackingStartsAt: row.tracking_starts_at,
    queuedAt: row.queued_at, submittedAt: row.submitted_at, acceptedAt: row.accepted_at, sentAt: row.sent_at,
    cancelRequested: row.cancel_requested === 1, lastError: row.last_error, messageId: row.message_id, attempts: row.attempts,
    nativeUnsubscribeVerified: false };
}
async function rowFor(env: Env, id: string): Promise<DeliveryRow> {
  if (!uuid.test(id)) throw new HttpError(404, 'NOT_FOUND', 'This sending record could not be found.');
  const row = await env.DB.prepare('SELECT * FROM outreach_deliveries WHERE id=?').bind(id).first<DeliveryRow>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'This sending record could not be found.');
  return row;
}
export async function getDeliveryForJob(env: Env, jobId: string): Promise<AutomaticDelivery | null> {
  const row = await env.DB.prepare('SELECT * FROM outreach_deliveries WHERE job_id=?').bind(jobId).first<DeliveryRow>();
  return row ? view(row) : null;
}
export async function hasManagedDelivery(env: Env, jobId: string): Promise<boolean> {
  return !!await env.DB.prepare('SELECT 1 FROM outreach_deliveries WHERE job_id=?').bind(jobId).first();
}
export async function listDeliveriesForJobs(env: Env, ids?: string[]): Promise<AutomaticDelivery[]> {
  if (ids && !ids.length) return [];
  const rows = ids ? await env.DB.prepare('SELECT * FROM outreach_deliveries WHERE job_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<DeliveryRow>()
    : await env.DB.prepare('SELECT * FROM outreach_deliveries ORDER BY queued_at DESC LIMIT 500').all<DeliveryRow>();
  return rows.results.map(view);
}
async function activity(env: Env, deliveryId: string, kind: string, message: string, now: string) {
  await env.DB.prepare('INSERT INTO outreach_delivery_activity(id,delivery_id,created_at,kind,message) VALUES(?,?,?,?,?)')
    .bind(crypto.randomUUID(), deliveryId, now, kind, message).run();
}
export async function automationPage(env: Env): Promise<AutomationPage> {
  const [mailbox, paused, deliveries, rows] = await Promise.all([
    mailboxStatus(env), env.DB.prepare('SELECT paused FROM outreach_automation_settings WHERE id=1').first<number>('paused'),
    listDeliveriesForJobs(env), env.DB.prepare('SELECT id,delivery_id,created_at,kind,message FROM outreach_delivery_activity ORDER BY created_at DESC,id DESC LIMIT 100').all<{ id: string; delivery_id: string; created_at: string; kind: string; message: string }>(),
  ]);
  const entries: AutomationActivity[] = rows.results.map(row => ({ id: row.id, deliveryId: row.delivery_id, createdAt: row.created_at, kind: row.kind, message: row.message }));
  return { mailbox, paused: paused !== 0, testRecipient: testRecipient(env), deliveries, activity: entries, policy: AUTOMATION_POLICY };
}
function testRecipient(env: Env): string | null {
  if (env.OUTREACH_TEST_RECIPIENT === undefined) return null;
  try { return normalizedRecipient(env.OUTREACH_TEST_RECIPIENT); }
  catch { throw new HttpError(503, 'INVALID_TEST_RECIPIENT', 'The test-only sending address must be corrected before sending is enabled.'); }
}
function expectedVersion(body: Record<string, unknown>): number {
  if (!Number.isSafeInteger(body.version) || Number(body.version) < 1) throw new HttpError(400, 'INVALID_VERSION', 'Refresh the sending record before making changes.');
  return Number(body.version);
}
function timeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) throw new HttpError(400, 'INVALID_TIMEZONE', 'Choose the time zone for this sending schedule.');
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); }
  catch { throw new HttpError(400, 'INVALID_TIMEZONE', 'Choose a valid time zone.'); }
  return value;
}
function picks(value: unknown): { id: string; version: number }[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new HttpError(400, 'INVALID_SELECTION', 'Choose 1 to 100 approved messages.');
  const items = value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'INVALID_SELECTION', 'Choose current approved messages.');
    const entry = raw as Record<string, unknown>; onlyFields(entry, ['id', 'version']);
    if (typeof entry.id !== 'string' || !uuid.test(entry.id)) throw new HttpError(400, 'INVALID_SELECTION', 'Choose valid approved messages.');
    return { id: entry.id, version: expectedVersion(entry) };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new HttpError(400, 'DUPLICATE_SELECTION', 'Choose each message once.');
  return items;
}
async function readyToSchedule(env: Env) {
  const status = await mailboxStatus(env);
  if (env.OUTREACH_SENDING_ENABLED !== 'true' || !status.sendingEnabled || !status.connected) throw new HttpError(409, 'SENDING_NOT_READY', 'Connect the approved Microsoft account and enable sending before scheduling emails.');
}
async function schedule(env: Env, body: Record<string, unknown>): Promise<Response> {
  onlyFields(body, ['items', 'sendAt', 'timeZone', 'spacingMinutes', 'businessHours', 'spreadAcrossDays', 'expectedSendTimes', 'confirmSending']);
  if (body.confirmSending !== true) throw new HttpError(400, 'SEND_CONFIRMATION_REQUIRED', 'Review the exact messages and confirm that Maildesk should send this batch.');
  await readyToSchedule(env);
  const selected = picks(body.items), zone = timeZone(body.timeZone), now = new Date(), owner = normalizedRecipient(env.OWNER_EMAIL), testOnly = testRecipient(env);
  const first = plannedTrackingTime(body.sendAt, now);
  if (Date.parse(first.sendAt) <= now.getTime()) throw new HttpError(400, 'INVALID_SCHEDULE', 'Choose a future sending time.');
  if (!Number.isInteger(body.spacingMinutes) || Number(body.spacingMinutes) < AUTOMATION_POLICY.minimumSpacingMinutes || Number(body.spacingMinutes) > 1440) throw new HttpError(400, 'INVALID_SPACING', 'Space messages by 2 to 1,440 minutes.');
  if ((body.businessHours !== undefined && typeof body.businessHours !== 'boolean') || (body.spreadAcrossDays !== undefined && typeof body.spreadAcrossDays !== 'boolean')) throw new HttpError(400, 'INVALID_PLAN', 'Choose valid office-hours and day-spreading settings.');
  const reservations = await listDeliveriesForJobs(env);
  let sendTimes: string[];
  try {
    sendTimes = planSendTimes({ sendAt: first.sendAt, timeZone: zone, spacingMinutes: Number(body.spacingMinutes), count: selected.length,
      businessHours: body.businessHours as boolean | undefined, spreadAcrossDays: body.spreadAcrossDays as boolean | undefined,
      reserved: reservations.map(value => ({ sendAt: value.sendAt, active: ['pending', 'submitting'].includes(value.state),
        countsTowardDailyLimit: ['pending', 'submitting', 'accepted', 'sent'].includes(value.state) || value.attempts > 0 })) });
  } catch (error) { throw new HttpError(409, 'SCHEDULE_CHANGED', error instanceof Error ? error.message : 'The sending plan changed. Review the exact times again.'); }
  if (body.expectedSendTimes !== undefined) {
    if (!Array.isArray(body.expectedSendTimes) || body.expectedSendTimes.length !== selected.length || body.expectedSendTimes.some(value => typeof value !== 'string')) throw new HttpError(400, 'INVALID_PLAN', 'Review the complete sending plan before confirming.');
    if (JSON.stringify(body.expectedSendTimes) !== JSON.stringify(sendTimes)) throw new HttpError(409, 'PLAN_CHANGED', 'The sending plan changed after review. Review and confirm the new exact times before scheduling.');
  }
  const rows = (await env.DB.prepare('SELECT * FROM outreach_jobs WHERE id IN (SELECT json_extract(value,\'$.id\') FROM json_each(?))').bind(JSON.stringify(selected)).all<Job>()).results;
  if (rows.length !== selected.length || new Set(rows.map(row => row.recipient)).size !== rows.length) throw new HttpError(409, 'SELECTION_CHANGED', 'Choose one available approved message per recipient.');
  const records = selected.map((pick, index) => {
    const row = rows.find(value => value.id === pick.id)!;
    if (testOnly && row.recipient !== testOnly) throw new HttpError(409, 'TEST_RECIPIENT_ONLY', 'This connection is in test mode. Only the configured test address can be scheduled.');
    if (row.version !== pick.version || row.approved_version !== pick.version || row.state !== 'approved' || !row.prepared_html || !row.prepared_text || !row.pixel_id || !row.opt_out_url || row.scheduled_at || row.tracking_starts_at) throw new HttpError(409, 'NOT_APPROVED', 'Every selected message must have current complete approval and no separate tracking schedule.');
    try { prepareUnsubscribeHeaders(row.opt_out_url, env.PIXEL_ORIGIN); }
    catch { throw new HttpError(409, 'INVALID_UNSUBSCRIBE_ORIGIN', 'Automatic sending requires the verified HTTPS public image and unsubscribe origin.'); }
    const id = crypto.randomUUID(), sendAt = sendTimes[index]!;
    if (Date.parse(sendAt) > now.getTime() + 30 * 86400000) throw new HttpError(400, 'INVALID_SCHEDULE', 'Keep the complete batch within 30 days.');
    return { id, jobId: row.id, version: pick.version, sendAt, startsAt: new Date(Date.parse(sendAt) + 45_000).toISOString(), messageId: `<${id}@maildesk.${owner.split('@')[1]}>` };
  });
  // An atomic all-or-none insertion rechecks approval, pairing, suppression,
  // overlapping sends and the per-day/spacing bounds after the initial review.
  const sql = `WITH chosen AS MATERIALIZED (SELECT json_extract(value,'$.id') id,json_extract(value,'$.jobId') job_id,json_extract(value,'$.version') version,
      json_extract(value,'$.sendAt') send_at,json_extract(value,'$.startsAt') starts_at,json_extract(value,'$.messageId') message_id FROM json_each(?)),
    eligible AS MATERIALIZED (SELECT c.*,j.recipient,j.label,j.subject,j.prepared_html,j.prepared_text,j.pixel_id,j.opt_out_url FROM chosen c JOIN outreach_jobs j ON j.id=c.job_id
      JOIN pixels p ON p.id=j.pixel_id AND lower(trim(p.recipient))=j.recipient
      JOIN opt_out_links l ON l.pixel_id=p.id AND l.recipient=j.recipient AND l.token=substr(j.opt_out_url,-64)
      WHERE j.version=c.version AND j.approved_version=c.version AND j.state='approved' AND j.prepared_html IS NOT NULL AND j.prepared_text IS NOT NULL
        AND j.scheduled_at IS NULL AND j.tracking_starts_at IS NULL AND p.status IN ('draft','paused')
        AND (instr(j.prepared_html,'/p/'||p.token||'/logo.png')>0 OR instr(j.prepared_html,'/p/'||p.token||'.gif')>0)
        AND instr(j.prepared_html,j.opt_out_url)>0 AND instr(j.prepared_text,j.opt_out_url)>0
        AND NOT EXISTS (SELECT 1 FROM do_not_contact n WHERE n.recipient=j.recipient)
        AND NOT EXISTS (SELECT 1 FROM outreach_recipient_stops s WHERE s.recipient=j.recipient)
        AND NOT EXISTS (SELECT 1 FROM pixels other WHERE other.id!=p.id AND lower(trim(other.recipient))=j.recipient
          AND other.status='armed' AND other.scheduled_send_at>=?)
        AND NOT EXISTS (SELECT 1 FROM outreach_deliveries d WHERE d.job_id=j.id OR (d.recipient=j.recipient AND d.state IN ('pending','submitting')))
        AND NOT EXISTS (SELECT 1 FROM outreach_deliveries d WHERE d.state IN ('pending','submitting') AND abs((julianday(d.send_at)-julianday(c.send_at))*86400)<119.99)
        AND (SELECT COUNT(*) FROM chosen c2 WHERE substr(c2.send_at,1,10)=substr(c.send_at,1,10))+
          (SELECT COUNT(*) FROM outreach_deliveries d WHERE substr(d.send_at,1,10)=substr(c.send_at,1,10) AND (d.state IN ('pending','submitting','accepted','sent') OR d.attempts=1))<=20
      )
    INSERT INTO outreach_deliveries(id,job_id,approved_version,recipient,label,subject,body_html,body_text,pixel_id,opt_out_url,message_id,send_at,time_zone,tracking_starts_at,queued_at,updated_at)
    SELECT id,job_id,version,recipient,label,subject,prepared_html,prepared_text,pixel_id,opt_out_url,message_id,send_at,?,starts_at,?,? FROM eligible
      WHERE (SELECT COUNT(*) FROM eligible)=?`;
  const saved = await env.DB.batch([
    env.DB.prepare(sql).bind(JSON.stringify(records), first.now, zone, first.now, first.now, records.length),
    env.DB.prepare(`UPDATE outreach_jobs SET state='scheduled',scheduled_at=(SELECT send_at FROM outreach_deliveries d WHERE d.job_id=outreach_jobs.id),tracking_starts_at=NULL,updated_at=?
      WHERE id IN (SELECT json_extract(value,'$.jobId') FROM json_each(?)) AND EXISTS (SELECT 1 FROM outreach_deliveries d WHERE d.job_id=outreach_jobs.id
        AND d.id IN (SELECT json_extract(value,'$.id') FROM json_each(?)))`).bind(first.now, JSON.stringify(records), JSON.stringify(records)),
    env.DB.prepare(`INSERT INTO outreach_delivery_activity(id,delivery_id,created_at,kind,message)
      SELECT lower(hex(randomblob(16))),d.id,?,'scheduled','Approved email scheduled in Maildesk. Outlook scheduling is not needed.' FROM outreach_deliveries d
      WHERE d.id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`).bind(first.now, JSON.stringify(records)),
  ]);
  if (saved[0]?.meta.changes !== records.length) throw new HttpError(409, 'SCHEDULE_CHANGED', 'A message changed, opted out, overlaps another send or exceeds the 20-per-day limit. Nothing from this batch was scheduled.');
  return json(await automationPage(env));
}

async function cancel(env: Env, row: DeliveryRow, body: Record<string, unknown>): Promise<Response> {
  onlyFields(body, ['version']); const version = expectedVersion(body), now = new Date().toISOString();
  if (version !== row.version) throw new HttpError(409, 'VERSION_CHANGED', 'Refresh this sending record before cancelling.');
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE outreach_deliveries SET version=version+1,cancel_requested=1,cancelled_at=?,updated_at=?,
      state=CASE WHEN state='pending' OR (state='needs_attention' AND attempts=0 AND submitted_at IS NULL) THEN 'cancelled' ELSE state END,
      last_error=CASE WHEN state='submitting' THEN 'Cancellation saved; a request already in progress cannot be recalled.' ELSE last_error END
      WHERE id=? AND version=?`).bind(now, now, row.id, version),
    env.DB.prepare(`UPDATE pixels SET status='paused',scheduled_send_at=NULL,updated_at=? WHERE id=? AND EXISTS
      (SELECT 1 FROM outreach_deliveries WHERE id=? AND version=? AND cancel_requested=1)`).bind(now, row.pixel_id, row.id, version + 1),
    env.DB.prepare(`UPDATE outreach_jobs SET state=CASE WHEN EXISTS (SELECT 1 FROM do_not_contact WHERE recipient=outreach_jobs.recipient) THEN 'blocked' ELSE 'cancelled' END,
      updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM outreach_deliveries WHERE id=? AND version=? AND cancel_requested=1)`).bind(now, row.job_id, row.id, version + 1),
    env.DB.prepare(cancelInactiveNotifications),
  ]);
  if (!result[0]?.meta.changes) throw new HttpError(409, 'VERSION_CHANGED', 'The sending record changed. Refresh before cancelling.');
  await activity(env, row.id, 'cancelled', row.state === 'pending' || (row.state === 'needs_attention' && !row.attempts && !row.submitted_at)
    ? 'Unsubmitted email cancelled. Saved history remains.' : 'Stop requested. Tracking stopped; accepted or in-flight email cannot be recalled.', now);
  return json(await automationPage(env));
}
async function reschedule(env: Env, row: DeliveryRow, body: Record<string, unknown>): Promise<Response> {
  onlyFields(body, ['version', 'sendAt', 'timeZone']); const expected = expectedVersion(body), zone = timeZone(body.timeZone);
  await readyToSchedule(env);
  const timing = plannedTrackingTime(body.sendAt);
  if (Date.parse(timing.sendAt) <= Date.now()) throw new HttpError(400, 'INVALID_SCHEDULE', 'Choose a future sending time.');
  const saved = await env.DB.batch([
    env.DB.prepare(`UPDATE outreach_deliveries AS d SET state='pending',version=version+1,send_at=?,time_zone=?,tracking_starts_at=?,updated_at=?,last_error=NULL
      WHERE id=? AND version=? AND state IN ('pending','needs_attention') AND attempts=0 AND submitted_at IS NULL AND cancel_requested=0
        AND EXISTS (SELECT 1 FROM outreach_jobs j WHERE j.id=d.job_id AND ${approvedSnapshot} AND j.state IN ('scheduled','needs_attention'))
        AND NOT EXISTS (SELECT 1 FROM outreach_deliveries other WHERE other.id!=d.id AND other.state IN ('pending','submitting') AND abs((julianday(other.send_at)-julianday(?))*86400)<119.99)
        AND (SELECT COUNT(*) FROM outreach_deliveries other WHERE other.id!=d.id AND substr(other.send_at,1,10)=substr(?,1,10) AND (other.state IN ('pending','submitting','accepted','sent') OR other.attempts=1))<20`)
      .bind(timing.sendAt, zone, timing.startsAt, timing.now, row.id, expected, timing.sendAt, timing.sendAt),
    env.DB.prepare(`UPDATE outreach_jobs SET state='scheduled',scheduled_at=?,updated_at=? WHERE id=? AND EXISTS
      (SELECT 1 FROM outreach_deliveries WHERE id=? AND version=? AND send_at=?)`).bind(timing.sendAt, timing.now, row.job_id, row.id, expected + 1, timing.sendAt),
  ]);
  if (!saved[0]?.meta.changes) throw new HttpError(409, 'RESCHEDULE_CHANGED', 'Only an unchanged, unsubmitted email can be rescheduled within the spacing and daily limits. Refresh this record.');
  await activity(env, row.id, 'rescheduled', 'The unsubmitted email and its tracking time were rescheduled together.', timing.now);
  return json(await automationPage(env));
}

/** Existing exact-owner authentication and mutation-origin checks run before this router. */
export async function automationApi(request: Request, env: Env): Promise<Response | null> {
  const { pathname: path, search } = new URL(request.url);
  if (!path.startsWith('/api/automation')) return null;
  if (search) throw new HttpError(400, 'INVALID_QUERY', 'Use the saved automation controls.');
  if (path === '/api/automation' && request.method === 'GET') return json(await automationPage(env));
  if (path === '/api/automation/schedule' && request.method === 'POST') return schedule(env, await readJson(request));
  if (path === '/api/automation/pause' && request.method === 'POST') {
    const body = await readJson(request); onlyFields(body, ['paused']);
    if (typeof body.paused !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'Choose whether automatic sending is paused.');
    await env.DB.prepare('UPDATE outreach_automation_settings SET paused=? WHERE id=1').bind(body.paused ? 1 : 0).run();
    return json(await automationPage(env));
  }
  const match = /^\/api\/automation\/([^/]+)\/(cancel|reschedule)$/u.exec(path);
  if (match && request.method === 'POST') {
    const row = await rowFor(env, match[1]!), body = await readJson(request);
    return match[2] === 'cancel' ? cancel(env, row, body) : reschedule(env, row, body);
  }
  throw new HttpError(request.method === 'GET' ? 404 : 405, 'ACTION_UNAVAILABLE', 'This automation action is unavailable.');
}

async function markAttention(env: Env, row: DeliveryRow, message: string, now: string) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE outreach_deliveries SET state='needs_attention',last_error=?,updated_at=?,lease_until=NULL WHERE id=? AND state IN ('pending','submitting')`).bind(message, now, row.id),
    env.DB.prepare(`UPDATE outreach_jobs SET state=CASE WHEN EXISTS(SELECT 1 FROM do_not_contact WHERE recipient=outreach_jobs.recipient) THEN 'blocked' ELSE 'needs_attention' END,last_error=?,updated_at=?
      WHERE id=? AND state IN ('scheduled','submitting')`).bind(message, now, row.job_id),
  ]);
  await activity(env, row.id, 'needs_attention', message, now);
}

async function recordAcceptance(env: Env, row: DeliveryRow, now: string) {
  const startsAt = row.tracking_starts_at > now ? row.tracking_starts_at : now;
  const activation = `delivery:${row.id}`;
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE outreach_deliveries SET state='accepted',accepted_at=?,updated_at=?,lease_until=NULL,tracking_starts_at=?,last_error=NULL,next_reconcile_at=?
      WHERE id=? AND claim_token=? AND state IN ('submitting','needs_attention')`).bind(now, now, startsAt, now, row.id, row.claim_token),
    env.DB.prepare(`UPDATE pixels SET status='armed',scheduled_send_at=?,armed_at=?,activation_id=?,activation_alert_at=NULL,updated_at=?
      WHERE id=? AND lower(trim(recipient))=? AND EXISTS (SELECT 1 FROM outreach_deliveries d WHERE d.id=? AND d.state='accepted' AND d.cancel_requested=0 AND d.claim_token=?)
        AND NOT EXISTS (SELECT 1 FROM do_not_contact n WHERE n.recipient=lower(trim(pixels.recipient)))
        AND NOT EXISTS (SELECT 1 FROM outreach_recipient_stops s WHERE s.recipient=lower(trim(pixels.recipient)))`).bind(row.send_at, startsAt, activation, now, row.pixel_id, row.recipient, row.id, row.claim_token),
    env.DB.prepare(`UPDATE outreach_jobs SET state='scheduled',tracking_starts_at=?,updated_at=?,last_error=NULL
      WHERE id=? AND version=? AND approved_version=? AND state IN ('scheduled','submitting')
        AND EXISTS (SELECT 1 FROM pixels p WHERE p.id=outreach_jobs.pixel_id AND p.activation_id=? AND p.status='armed')`).bind(startsAt, now, row.job_id, row.approved_version, row.approved_version, activation),
  ]);
  if (results[0]?.meta.changes) await activity(env, row.id, 'accepted', 'Microsoft accepted the submission. Sending, delivery and Inbox placement are not established by this response.', now);
}

async function reconcile(env: Env, time: Date) {
  const now = time.toISOString();
  const rows = await env.DB.prepare(`SELECT * FROM outreach_deliveries WHERE state IN ('accepted','needs_attention') AND submitted_at IS NOT NULL
    AND reconcile_attempts<5 AND (next_reconcile_at IS NULL OR next_reconcile_at<=?) ORDER BY submitted_at LIMIT 1`).bind(now).all<DeliveryRow>();
  for (const row of rows.results) {
    const claimed = await env.DB.prepare('UPDATE outreach_deliveries SET reconcile_attempts=reconcile_attempts+1,next_reconcile_at=? WHERE id=? AND reconcile_attempts=?')
      .bind(new Date(time.getTime() + 5 * 60_000).toISOString(), row.id, row.reconcile_attempts).run();
    if (!claimed.meta.changes) continue;
    try {
      const query = new URLSearchParams({ '$filter': `internetMessageId eq '${row.message_id.replaceAll("'", "''")}'`, '$select': 'id,internetMessageId,subject,toRecipients,ccRecipients,bccRecipients,isDraft,sentDateTime', '$top': '2' });
      const response = await mailboxGraphFetch(env, `/me/mailFolders/sentitems/messages?${query}`);
      if (!response.ok) continue;
      const data = await response.json() as { value?: { id?: string; internetMessageId?: string; subject?: string; toRecipients?: { emailAddress?: { address?: string } }[]; ccRecipients?: unknown[]; bccRecipients?: unknown[]; isDraft?: boolean; sentDateTime?: string }[] };
      const exact = data.value?.filter(message => message.internetMessageId === row.message_id && message.subject === row.subject && message.isDraft === false
        && message.toRecipients?.length === 1 && message.toRecipients[0]?.emailAddress?.address?.toLowerCase() === row.recipient
        && !message.ccRecipients?.length && !message.bccRecipients?.length && message.id && message.sentDateTime && Number.isFinite(Date.parse(message.sentDateTime)));
      if (exact?.length !== 1) continue;
      const found = exact[0]!;
      await env.DB.prepare(`UPDATE outreach_deliveries SET state='sent',sent_at=?,provider_message_id=?,updated_at=?,last_error=NULL WHERE id=? AND state IN ('accepted','needs_attention')`)
        .bind(found.sentDateTime!, found.id!, now, row.id).run();
      await activity(env, row.id, 'sent_item_observed', 'A matching message was observed in Microsoft Sent Items. This is not delivery or Inbox placement proof.', now);
    } catch { /* A read-only reconciliation failure never resubmits an email. */ }
  }
}

/** Reconciliation runs only while no send is due, keeping each connected cron phase within the Free query budget. */
export async function runAutomation(env: Env, time = new Date()): Promise<void> {
  if (env.OUTREACH_SENDING_ENABLED !== 'true') return;
  const status = await mailboxStatus(env);
  if (!status.connected || !status.sendingEnabled) return;
  const now = time.toISOString();
  const clockNow = () => new Date(Math.max(time.getTime(), Date.now()));
  const resumeAfter = await env.DB.prepare('SELECT resume_after FROM outreach_automation_settings WHERE id=1').first<string>('resume_after');
  if (resumeAfter && resumeAfter > now) return;
  const due = await env.DB.prepare("SELECT * FROM outreach_deliveries WHERE state='pending' AND send_at<=? ORDER BY send_at,id LIMIT 1").bind(now).all<DeliveryRow>();
  if (!due.results.length) await reconcile(env, time);
  const expired = await env.DB.prepare("SELECT * FROM outreach_deliveries WHERE state='submitting' AND lease_until<? LIMIT 1").bind(now).all<DeliveryRow>();
  for (const row of expired.results) await markAttention(env, row, 'The submission outcome is uncertain. It will not be retried automatically; check Sent Items before taking any further action.', now);
  if ((await env.DB.prepare('SELECT paused FROM outreach_automation_settings WHERE id=1').first<number>('paused')) !== 0) return;
  for (const initial of due.results) {
    if (env.OUTREACH_SENDING_ENABLED !== 'true') return;
    const currentStatus = await mailboxStatus(env);
    if (!currentStatus.connected || !currentStatus.sendingEnabled
      || (await env.DB.prepare('SELECT paused FROM outreach_automation_settings WHERE id=1').first<number>('paused')) !== 0) return;
    if (testRecipient(env) && initial.recipient !== testRecipient(env)) {
      await markAttention(env, initial, 'This connection is in test mode. This recipient cannot be submitted.', now); continue;
    }
    if (Date.parse(initial.send_at) < time.getTime() - AUTOMATION_POLICY.maxLatenessMinutes * 60_000) {
      await markAttention(env, initial, 'The sending time is more than 15 minutes late. Review this message instead of sending it unexpectedly.', now); continue;
    }
    const token = crypto.randomUUID();
    const claimed = await env.DB.prepare(`UPDATE outreach_deliveries AS d SET state='submitting',attempts=1,claim_token=?,lease_until=?,updated_at=?
      WHERE id=? AND state='pending' AND attempts=0 AND cancel_requested=0
        AND EXISTS (SELECT 1 FROM outreach_jobs j WHERE j.id=d.job_id AND ${eligibleJob})
        AND EXISTS (SELECT 1 FROM outreach_automation_settings WHERE id=1 AND paused=0)`)
      .bind(token, new Date(time.getTime() + 5 * 60_000).toISOString(), now, initial.id).run();
    if (!claimed.meta.changes) {
      const fresh = await rowFor(env, initial.id);
      if (fresh.state === 'pending' && (await env.DB.prepare('SELECT paused FROM outreach_automation_settings WHERE id=1').first<number>('paused')) === 0) await markAttention(env, fresh, 'The approved message, pairing or tracking state changed. Review it before sending.', now);
      continue;
    }
    const row = { ...initial, claim_token: token };
    let networkStarted = false;
    try {
      const payload = outreachMime({ from: env.OWNER_EMAIL, recipient: row.recipient, subject: row.subject, html: row.body_html, text: row.body_text,
        messageId: row.message_id, optOutUrl: row.opt_out_url, pixelOrigin: env.PIXEL_ORIGIN, date: time });
      const response = await mailboxGraphFetch(env, '/me/sendMail', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: payload.base64 }, async () => {
        if (env.OUTREACH_SENDING_ENABLED !== 'true') throw new HttpError(409, 'AUTOMATION_WAIT', 'Automatic sending is disabled.');
        if (testRecipient(env) && row.recipient !== testRecipient(env)) throw new HttpError(409, 'AUTOMATION_WAIT', 'The test-only sending address changed before submission.');
        const submitTime = clockNow();
        if (Date.parse(row.send_at) < submitTime.getTime() - AUTOMATION_POLICY.maxLatenessMinutes * 60_000) throw new HttpError(409, 'AUTOMATION_TOO_LATE', 'The sending time expired while the Microsoft connection was being prepared. Review before sending.');
        const submitted = submitTime.toISOString();
        const final = await env.DB.prepare(`UPDATE outreach_deliveries AS d SET submitted_at=?,updated_at=?
          WHERE id=? AND state='submitting' AND claim_token=? AND cancel_requested=0
            AND EXISTS (SELECT 1 FROM outreach_jobs j WHERE j.id=d.job_id AND ${eligibleJob})
            AND EXISTS (SELECT 1 FROM outreach_automation_settings WHERE id=1 AND paused=0 AND (resume_after IS NULL OR resume_after<=?))
            AND (SELECT COUNT(*) FROM outreach_deliveries other WHERE other.id!=d.id AND substr(other.submitted_at,1,10)=?)<20
            AND NOT EXISTS (SELECT 1 FROM outreach_deliveries other WHERE other.id!=d.id AND other.submitted_at>?)`)
          .bind(submitted, submitted, row.id, token, submitted, submitted.slice(0, 10), new Date(submitTime.getTime() - AUTOMATION_POLICY.minimumSpacingMinutes * 60_000).toISOString()).run();
        if (!final.meta.changes) throw new HttpError(409, 'AUTOMATION_WAIT', 'The message was stopped, changed, paused or reached a sending limit before submission.');
        networkStarted = true;
      });
      if (response.status === 202) await recordAcceptance(env, row, clockNow().toISOString());
      else {
        if (response.status === 429) {
          const value = response.headers.get('Retry-After');
          const delay = value && /^\d+$/u.test(value) ? Number(value) * 1000 : value ? Date.parse(value) - time.getTime() : 60_000;
          const next = new Date(time.getTime() + Math.max(60_000, Math.min(86400000, Number.isFinite(delay) ? delay : 60_000))).toISOString();
          await env.DB.prepare('UPDATE outreach_automation_settings SET resume_after=? WHERE id=1').bind(next).run();
        }
        const reason = response.status === 429 ? 'Microsoft rate-limited the submission. Review it before rescheduling; no automatic resend was attempted.'
          : 'Microsoft did not return submission acceptance. Review the sending record and Sent Items before any further action.';
        await markAttention(env, row, reason, now);
      }
    } catch (error) {
      if (!networkStarted && error instanceof HttpError && (error.code === 'AUTOMATION_WAIT' || error.code.startsWith('MAILBOX_'))) {
        await env.DB.prepare(`UPDATE outreach_deliveries SET state='pending',attempts=0,claim_token=NULL,lease_until=NULL,updated_at=?,last_error=? WHERE id=? AND state='submitting' AND claim_token=? AND cancel_requested=0`)
          .bind(now, error.code.startsWith('MAILBOX_') ? 'Microsoft is not ready. Reconnect or wait for its connection before this scheduled email can be submitted.' : null, row.id, token).run();
        const fresh = await rowFor(env, row.id);
        if (fresh.cancel_requested && fresh.state === 'submitting') await env.DB.prepare("UPDATE outreach_deliveries SET state=CASE WHEN EXISTS (SELECT 1 FROM do_not_contact n WHERE n.recipient=outreach_deliveries.recipient) THEN 'blocked' ELSE 'cancelled' END,lease_until=NULL WHERE id=? AND claim_token=?")
          .bind(row.id, token).run();
        else if (fresh.state === 'pending') {
          const held = await env.DB.prepare('SELECT message FROM outreach_recipient_stops WHERE recipient=?').bind(row.recipient).first<string>('message');
          if (held) await env.DB.batch([
            env.DB.prepare("UPDATE outreach_deliveries SET state='blocked',cancel_requested=1,last_error=?,updated_at=? WHERE id=? AND state='pending'").bind(held, now, row.id),
            env.DB.prepare("UPDATE outreach_jobs SET state='needs_attention',last_error=?,updated_at=? WHERE id=? AND state='scheduled'").bind(held, now, row.job_id),
          ]);
          else if (error.code === 'AUTOMATION_WAIT' && !await env.DB.prepare(`SELECT 1 FROM outreach_deliveries d JOIN outreach_jobs j ON j.id=d.job_id WHERE d.id=? AND ${eligibleJob}`).bind(row.id).first()) {
            await markAttention(env, fresh, 'The approved message or recipient pairing changed before submission. Review it before sending.', now);
          }
        }
      } else await markAttention(env, row, networkStarted
        ? 'The submission outcome is uncertain. It will not be retried automatically; check Sent Items before taking any further action.'
        : error instanceof HttpError && error.code === 'AUTOMATION_TOO_LATE' ? error.message
        : 'Microsoft could not be prepared for this submission. Reconnect if needed, then review this message; nothing was automatically retried.', now);
    }
  }
}
