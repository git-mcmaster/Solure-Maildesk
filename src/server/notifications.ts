import type { Env } from './types';

interface OutboxItem { id: string; pixel_id: string; label: string; created_at: string; attempts: number; lease_token: string }

export async function dispatchNotifications(env: Env, time = new Date()): Promise<void> {
  const now = time.toISOString();
  await env.DB.prepare("UPDATE notifications SET status='disabled' WHERE status IN ('pending','failed') AND pixel_id IN (SELECT id FROM pixels WHERE status!='armed')").run();
  const settings = await env.DB.prepare('SELECT email_enabled FROM settings WHERE id=1').first<{ email_enabled: number }>();
  if (!settings || settings.email_enabled !== 1) {
    await env.DB.prepare("UPDATE notifications SET status='disabled',lease_until=NULL,lease_token=NULL WHERE status IN ('pending','failed')").run();
    return;
  }
  if (env.EMAIL_MODE !== 'dry-run' && (env.EMAIL_MODE !== 'live' || !env.EMAIL || !env.EMAIL_FROM)) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(env.OWNER_EMAIL)) return;
  // Recover abandoned claims. Email providers can accept a message just before
  // a process fails; retries may therefore duplicate an email in that window.
  await env.DB.prepare("UPDATE notifications SET status='failed',lease_until=NULL,lease_token=NULL WHERE status='sending' AND lease_until<?").bind(now).run();
  // Share the free-plan D1 invocation budget with scheduled 89-day reports.
  const due = await env.DB.prepare("SELECT id FROM notifications WHERE status IN ('pending','failed') AND attempts<5 AND next_attempt_at<=? ORDER BY created_at LIMIT 5").bind(now).all<{ id: string }>();
  for (const { id } of due.results) {
    const lease = crypto.randomUUID();
    const until = new Date(time.getTime() + 300_000).toISOString();
    const claim = await env.DB.prepare("UPDATE notifications SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1,last_error=NULL WHERE id=? AND status IN ('pending','failed') AND attempts<5 AND next_attempt_at<=? AND EXISTS (SELECT 1 FROM pixels WHERE pixels.id=notifications.pixel_id AND pixels.status='armed')").bind(lease, until, id, now).run();
    if (claim.meta.changes !== 1) continue;
    const item = await env.DB.prepare('SELECT n.*,p.label FROM notifications n JOIN pixels p ON p.id=n.pixel_id WHERE n.id=? AND n.lease_token=?').bind(id, lease).first<OutboxItem>();
    if (!item) continue;
    try {
      if (env.EMAIL_MODE !== 'dry-run') {
        const safeLabel = item.label.replace(/[\r\n]/gu, ' ').slice(0, 150);
        await env.EMAIL!.send({
          to: env.OWNER_EMAIL,
          from: env.EMAIL_FROM!,
          subject: `Image loaded — ${safeLabel}`,
          text: `A tracking image was requested for “${item.label}”.\n\nRecorded: ${item.created_at}\n\nView the activity: ${env.DASHBOARD_ORIGIN}/?pixel=${encodeURIComponent(item.pixel_id)}\n\nThis records an image request, not proof that a person read your email. Privacy services and email security tools may load images automatically.`,
        });
      }
      await env.DB.prepare('UPDATE notifications SET status=?,delivered_at=?,lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?')
        .bind(env.EMAIL_MODE === 'dry-run' ? 'dry_run' : 'sent', now, id, lease).run();
    } catch {
      const delay = Math.min(60, 2 ** item.attempts) * 60_000;
      await env.DB.prepare("UPDATE notifications SET status='failed',last_error=?,next_attempt_at=?,lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?")
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
