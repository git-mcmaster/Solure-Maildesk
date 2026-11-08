import { getPixel, notificationConfigured } from './db';
import { HttpError, json, onlyFields } from './http';
import { cancelInactiveNotifications } from './notifications';
import { isDoNotContact, normalizedRecipient } from './opt-out';
import { DEFAULT_TRACKING_DELAY_SECONDS } from '../shared/outreach';
import type { Env, Pixel } from './types';

/** Owner-entered Outlook time only; this is never evidence of a sent email. */
export function plannedTrackingTime(value: unknown, time = new Date()): { sendAt: string; startsAt: string; now: string } {
  const parts = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value) : null;
  const calendar = parts ? new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))) : null;
  if (!parts || !calendar || calendar.getUTCFullYear() !== Number(parts[1]) || calendar.getUTCMonth() + 1 !== Number(parts[2])
    || calendar.getUTCDate() !== Number(parts[3]) || Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59
    || typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new HttpError(400, 'INVALID_SCHEDULE', 'Choose a complete Outlook send date and time, including its time zone.');
  }
  const milliseconds = Date.parse(value);
  const sendAt = new Date(milliseconds).toISOString();
  const startsAt = new Date(milliseconds + DEFAULT_TRACKING_DELAY_SECONDS * 1000).toISOString();
  if (Date.parse(startsAt) <= time.getTime() || milliseconds > time.getTime() + 30 * 86400000) {
    throw new HttpError(400, 'INVALID_SCHEDULE', 'Choose an Outlook send time within 30 days whose 45-second tracking delay has not finished.');
  }
  return { sendAt, startsAt, now: time.toISOString() };
}

/** Existing manual pixels can be planned without importing or sending a draft. */
export async function scheduleManualPixel(env: Env, pixel: Pixel, body: Record<string, unknown>): Promise<Response> {
  onlyFields(body, ['sendAt', 'enableEmailAlerts']);
  if (body.enableEmailAlerts !== undefined && typeof body.enableEmailAlerts !== 'boolean') throw new HttpError(400, 'INVALID_FIELD', 'Choose whether to enable email alerts.');
  const { sendAt, startsAt, now } = plannedTrackingTime(body.sendAt);
  if (pixel.outreachId) throw new HttpError(409, 'SCHEDULE_MANAGED_PIXEL', 'Manage this image’s timing from Draft review.');
  if (pixel.status === 'archived' || (pixel.status === 'armed' && (!pixel.armedAt || pixel.armedAt <= now))) {
    throw new HttpError(409, 'TRACKING_ALREADY_STARTED', 'Stop active tracking or unarchive this image before making a new tracking plan. Existing history is kept.');
  }
  const recipient = normalizedRecipient(pixel.recipient);
  if (await isDoNotContact(env, recipient)) throw new HttpError(409, 'DO_NOT_CONTACT', 'This recipient is on the do-not-contact list.');
  if (await env.DB.prepare("SELECT 1 FROM outreach_deliveries WHERE recipient=? AND state IN ('pending','submitting')").bind(recipient).first()) {
    throw new HttpError(409, 'AUTOMATIC_DELIVERY_MANAGED', 'This recipient already has an automatic email queued. Manage that send before making a separate Outlook tracking plan.');
  }
  if (body.enableEmailAlerts && !notificationConfigured(env)) throw new HttpError(409, 'NOTIFICATION_NOT_CONFIGURED', 'Configure email alerts before enabling them. Dashboard notifications already work.');
  const activation = crypto.randomUUID();
  const statements = [env.DB.prepare(`UPDATE pixels SET status='armed',scheduled_send_at=?,armed_at=?,activation_id=?,activation_alert_at=NULL,updated_at=?
    WHERE id=? AND lower(trim(recipient))=? AND (status IN ('draft','paused') OR (status='armed' AND armed_at>?))
      AND NOT EXISTS (SELECT 1 FROM outreach_jobs WHERE pixel_id=pixels.id)
      AND NOT EXISTS (SELECT 1 FROM outreach_deliveries a WHERE a.recipient=lower(trim(pixels.recipient)) AND a.state IN ('pending','submitting'))
      AND NOT EXISTS (SELECT 1 FROM do_not_contact d WHERE d.recipient=lower(trim(pixels.recipient)))`)
    .bind(sendAt, startsAt, activation, now, pixel.id, recipient, now)];
  if (body.enableEmailAlerts) {
    // The target’s fresh future window stays intact; resuming the master only
    // resets already-open windows and never replays disabled historical alerts.
    statements.push(env.DB.prepare(`UPDATE pixels SET activation_id=lower(hex(randomblob(16))),activation_alert_at=NULL,
      armed_at=CASE WHEN scheduled_send_at IS NOT NULL THEN armed_at ELSE ? END,updated_at=?
      WHERE status='armed' AND armed_at<=? AND EXISTS (SELECT 1 FROM settings WHERE id=1 AND email_enabled=0)
        AND EXISTS (SELECT 1 FROM pixels target WHERE target.id=? AND target.activation_id=? AND target.status='armed')`)
      .bind(now, now, now, pixel.id, activation));
    statements.push(env.DB.prepare(`UPDATE settings SET email_enabled=1 WHERE id=1
      AND EXISTS (SELECT 1 FROM pixels target WHERE target.id=? AND target.activation_id=? AND target.status='armed')`).bind(pixel.id, activation));
  }
  statements.push(env.DB.prepare(cancelInactiveNotifications));
  const results = await env.DB.batch(statements);
  if (results[0]?.meta.changes !== 1) throw new HttpError(409, 'SCHEDULE_CHANGED', 'This image changed, started tracking or its recipient opted out. Refresh before scheduling.');
  return json(await getPixel(env, pixel.id));
}
