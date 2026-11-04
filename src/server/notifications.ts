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
  const due = await env.DB.prepare("SELECT id FROM notifications WHERE status IN ('pending','failed') AND attempts<5 AND next_attempt_at<=? ORDER BY created_at LIMIT 10").bind(now).all<{ id: string }>();
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
  const setting = await env.DB.prepare('SELECT retention_days FROM settings WHERE id=1').first<{ retention_days: number }>();
  const cutoff = new Date(time.getTime() - (setting?.retention_days ?? 90) * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE id IN (SELECT id FROM events WHERE created_at<? LIMIT 1000)').bind(cutoff),
    env.DB.prepare('DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE created_at<? LIMIT 1000)').bind(cutoff),
  ]);
  // Pixel-level counts and first/last timestamps are aggregate history retained
  // until the owner explicitly clears history or deletes the pixel.
}
