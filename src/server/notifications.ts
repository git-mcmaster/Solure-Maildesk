import type { Env } from './types';

interface OutboxItem { id: string; pixel_id: string; label: string; created_at: string; attempts: number; lease_token: string }

// Cancellation retains an in-flight lease: a provider call already started may
// still succeed, and its actual accepted outcome must remain recordable.
export const cancelInactiveNotifications = `UPDATE notifications SET status='disabled',
  lease_token=CASE WHEN status='sending' THEN lease_token ELSE NULL END,
  lease_until=CASE WHEN status='sending' THEN lease_until ELSE NULL END
  WHERE status IN ('pending','failed','sending') AND (
    NOT EXISTS (SELECT 1 FROM settings WHERE id=1 AND email_enabled=1)
    OR NOT EXISTS (SELECT 1 FROM pixels p WHERE p.id=notifications.pixel_id AND p.status='armed'
      AND p.activation_id=notifications.activation_id))`;

export async function dispatchNotifications(env: Env, time = new Date()): Promise<void> {
  const now = time.toISOString();
  await env.DB.prepare(cancelInactiveNotifications).run();
  const settings = await env.DB.prepare('SELECT email_enabled FROM settings WHERE id=1').first<{ email_enabled: number }>();
  if (!settings || settings.email_enabled !== 1) return;
  if (env.EMAIL_MODE !== 'dry-run' && (env.EMAIL_MODE !== 'live' || !env.EMAIL || !env.EMAIL_FROM)) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(env.OWNER_EMAIL)) return;
  // An accepted provider call followed by a process failure can still duplicate
  // on retry. Neither Pause nor disabling alerts can recall an accepted email.
  await env.DB.prepare("UPDATE notifications SET status='failed',lease_until=NULL,lease_token=NULL WHERE status='sending' AND lease_until<?").bind(now).run();
  const due = await env.DB.prepare("SELECT id FROM notifications WHERE status IN ('pending','failed') AND attempts<5 AND next_attempt_at<=? ORDER BY created_at LIMIT 5").bind(now).all<{ id: string }>();
  for (const { id } of due.results) {
    const lease = crypto.randomUUID();
    const until = new Date(time.getTime() + 300_000).toISOString();
    const claim = await env.DB.prepare(`UPDATE notifications SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1,last_error=NULL
      WHERE id=? AND status IN ('pending','failed') AND attempts<5 AND next_attempt_at<=?
      AND EXISTS (SELECT 1 FROM settings WHERE id=1 AND email_enabled=1)
      AND EXISTS (SELECT 1 FROM pixels p WHERE p.id=notifications.pixel_id AND p.status='armed' AND p.activation_id=notifications.activation_id)`)
      .bind(lease, until, id, now).run();
    if (claim.meta.changes !== 1) continue;
    const item = await env.DB.prepare('SELECT n.*,p.label FROM notifications n JOIN pixels p ON p.id=n.pixel_id WHERE n.id=? AND n.lease_token=?').bind(id, lease).first<OutboxItem>();
    if (!item) continue;
    try {
      // Last awaited check before the external call. A saved Pause/master-off or
      // restarted activation invalidates even a previously claimed queue item.
      const eligible = await env.DB.prepare(`SELECT p.label FROM notifications n JOIN pixels p ON p.id=n.pixel_id
        WHERE n.id=? AND n.lease_token=? AND n.status='sending' AND p.status='armed'
          AND p.activation_id=n.activation_id AND EXISTS (SELECT 1 FROM settings WHERE id=1 AND email_enabled=1)`)
        .bind(id, lease).first<{ label: string }>();
      if (!eligible) {
        await env.DB.prepare("UPDATE notifications SET status='disabled',lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?").bind(id, lease).run();
        continue;
      }
      if (env.EMAIL_MODE !== 'dry-run') {
        const safeLabel = eligible.label.replace(/[\r\n]/gu, ' ').slice(0, 150);
        await env.EMAIL!.send({
          to: env.OWNER_EMAIL,
          from: env.EMAIL_FROM!,
          subject: `Image loaded — ${safeLabel}`,
          text: `A tracking image was requested for “${eligible.label}”.\n\nRecorded: ${item.created_at}\n\nView the activity: ${env.DASHBOARD_ORIGIN}/?pixel=${encodeURIComponent(item.pixel_id)}\n\nThis records an image request, not proof that a person read your email. Privacy services and email security tools may load images automatically.`,
        });
      }
      // Keep accepted outcomes truthful if Pause happened during EMAIL.send.
      await env.DB.prepare('UPDATE notifications SET status=?,delivered_at=?,lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?')
        .bind(env.EMAIL_MODE === 'dry-run' ? 'dry_run' : 'sent', now, id, lease).run();
    } catch {
      const delay = Math.min(60, 2 ** item.attempts) * 60_000;
      await env.DB.prepare(`UPDATE notifications SET
        status=CASE WHEN status='disabled' THEN 'disabled' ELSE 'failed' END,
        last_error=CASE WHEN status='disabled' THEN 'Email delivery failed after alerts were stopped. No retry is scheduled.' ELSE ? END,
        next_attempt_at=?,lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?`)
        .bind(item.attempts >= 5 ? 'Email delivery failed after five attempts. Check the sending configuration.' : 'Email delivery failed. The service will retry automatically, up to five attempts.', new Date(time.getTime() + delay).toISOString(), id, lease).run();
    }
  }
}

export async function enforceRetention(env: Env, time = new Date()): Promise<void> {
  const keep = await env.DB.prepare('SELECT keep_unloaded_pixels FROM settings WHERE id=1').first<number>('keep_unloaded_pixels');
  if (keep !== 0) return;
  const cutoff = new Date(time.getTime() - 90 * 86_400_000).toISOString();
  // One serialized write rechecks every safeguard. A recorded first load and
  // its durable flag commit together, so cleanup cannot interleave between them.
  // Loaded events/metadata/notifications have no automatic expiry.
  await env.DB.prepare(`DELETE FROM pixels WHERE id IN (
    SELECT p.id FROM pixels p
    WHERE p.has_recorded_load=0 AND p.preserve_unloaded=0 AND p.report_sent_at IS NOT NULL AND p.created_at<?
      AND EXISTS (SELECT 1 FROM settings WHERE id=1 AND keep_unloaded_pixels=0)
      AND p.load_count=0 AND p.early_load_count=0 AND p.daily_load_count=0
      AND p.first_loaded_at IS NULL AND p.last_loaded_at IS NULL AND p.first_alert_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.pixel_id=p.id)
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.pixel_id=p.id)
      AND EXISTS (SELECT 1 FROM pixel_reports r WHERE r.source_pixel_id=p.id AND r.status='sent')
    ORDER BY p.created_at,p.id LIMIT 1000
  )`).bind(cutoff).run();
}
