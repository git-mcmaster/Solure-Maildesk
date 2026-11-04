import { isLoopback } from './auth';
import type { Env, PixelReport, PixelRow, ReportPage } from './types';

const day = 86_400_000;
interface ReportRow {
  id: string; pixel_id: string | null; source_pixel_id: string; label: string; recipient: string;
  pixel_created_at: string; due_at: string; created_at: string; status: PixelReport['status'];
  attempts: number; last_error: string | null; delivered_at: string | null; snapshot_text: string;
}

function fromRow(row: ReportRow): PixelReport {
  return { id: row.id, pixelId: row.pixel_id, sourcePixelId: row.source_pixel_id, label: row.label,
    recipient: row.recipient, pixelCreatedAt: row.pixel_created_at, dueAt: row.due_at, createdAt: row.created_at,
    status: row.status, attempts: row.attempts, lastError: row.last_error, deliveredAt: row.delivered_at, text: row.snapshot_text };
}

export async function getPixelReport(env: Env, pixelId: string): Promise<PixelReport | null> {
  const row = await env.DB.prepare('SELECT * FROM pixel_reports WHERE source_pixel_id=?').bind(pixelId).first<ReportRow>();
  return row ? fromRow(row) : null;
}

export async function listReports(env: Env, limit = 100, offset = 0): Promise<ReportPage> {
  const [rows, total] = await Promise.all([
    env.DB.prepare('SELECT * FROM pixel_reports ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(limit, offset).all<ReportRow>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM pixel_reports').first<number>('count'),
  ]);
  return { items: rows.results.map(fromRow), total: total ?? 0, offset, hasMore: offset + rows.results.length < (total ?? 0) };
}

export function reportText(pixel: PixelRow, env: Env, recordedAt: string): string {
  const deadline = new Date(new Date(pixel.created_at).getTime() + 90 * day).toISOString();
  return `Solure Maildesk — 89-day pixel report\n\nMessage: ${pixel.label}\nRecipient label: ${pixel.recipient || 'Not labeled'}\nPixel created: ${pixel.created_at}\nSnapshot recorded: ${recordedAt}\nStatus at snapshot: ${pixel.status}\n\nCurrent recorded image requests: ${pixel.load_count}\nRequests before arming: ${pixel.early_load_count}\nFirst recorded image request: ${pixel.first_loaded_at || 'None in current history'}\nLatest recorded image request: ${pixel.last_loaded_at || 'None in current history'}\nAny image request ever recorded: ${pixel.has_recorded_load === 1 ? 'Yes' : 'No'}\n\nUnused-pixel age threshold (90 days): ${deadline}\nLoaded pixels and their history are kept indefinitely unless you explicitly clear or delete them. Unused pixels are deleted after this age threshold only when preservation is off and the configured email service has accepted this report. Acceptance does not establish delivery to your inbox.\n\nPrivate activity: ${env.DASHBOARD_ORIGIN.replace(/\/$/u, '')}/?pixel=${encodeURIComponent(pixel.id)}\nReport snapshots survive automatic unused-pixel deletion; the activity link may then be unavailable.\n\nAn image request is not proof that a person opened or read an email. Email security scanners and privacy proxies may request images automatically. Counts and timestamps describe current saved history; explicitly cleared history is not reconstructed.\n`;
}

export async function queuePixelReports(env: Env, time = new Date()): Promise<void> {
  const now = time.toISOString();
  const cutoff = new Date(time.getTime() - 89 * day).toISOString();
  // The partial index visits only unqueued candidates. The unique source ID and
  // insert/marker batch prevent concurrent cron runs from duplicating snapshots.
  const due = await env.DB.prepare('SELECT * FROM pixels WHERE report_queued_at IS NULL AND created_at<=? ORDER BY created_at,id LIMIT 100')
    .bind(cutoff).all<PixelRow>();
  if (!due.results.length) return;
  await env.DB.batch(due.results.flatMap((pixel) => [
    env.DB.prepare(`INSERT OR IGNORE INTO pixel_reports
      (id,pixel_id,source_pixel_id,label,recipient,pixel_created_at,due_at,created_at,snapshot_text,next_attempt_at)
      SELECT ?,p.id,p.id,?,?,?,?,?,?,? FROM pixels p WHERE p.id=? AND p.report_queued_at IS NULL AND p.created_at<=?`)
      .bind(crypto.randomUUID(), pixel.label, pixel.recipient, pixel.created_at,
        new Date(new Date(pixel.created_at).getTime() + 89 * day).toISOString(), now, reportText(pixel, env, now), now, pixel.id, cutoff),
    env.DB.prepare('UPDATE pixels SET report_queued_at=COALESCE(report_queued_at,?) WHERE id=? AND EXISTS (SELECT 1 FROM pixel_reports WHERE source_pixel_id=?)')
      .bind(now, pixel.id, pixel.id),
  ]));
}

function localDryRun(env: Env): boolean {
  if (env.EMAIL_MODE !== 'dry-run' || env.DEV_AUTH !== 'true') return false;
  try { return isLoopback(new URL(env.DASHBOARD_ORIGIN).hostname) && isLoopback(new URL(env.PIXEL_ORIGIN).hostname); }
  catch { return false; }
}

export async function dispatchPixelReports(env: Env, time = new Date()): Promise<void> {
  const dryRun = localDryRun(env);
  const address = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
  if (!address.test(env.OWNER_EMAIL) || (!dryRun && (env.EMAIL_MODE !== 'live' || !env.EMAIL || !env.EMAIL_FROM || !address.test(env.EMAIL_FROM)))) return;
  const now = time.toISOString();
  await env.DB.prepare("UPDATE pixel_reports SET status='failed',lease_until=NULL,lease_token=NULL,last_error='Email delivery was interrupted. A retry may duplicate a previously accepted message.' WHERE status='sending' AND lease_until<?").bind(now).run();
  const due = await env.DB.prepare("SELECT id FROM pixel_reports WHERE status IN ('pending','failed') AND attempts<5 AND next_attempt_at<=? ORDER BY created_at,id LIMIT 5")
    .bind(now).all<{ id: string }>();
  for (const { id } of due.results) {
    const lease = crypto.randomUUID();
    const until = new Date(time.getTime() + 300_000).toISOString();
    const claim = await env.DB.prepare("UPDATE pixel_reports SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1,last_error=NULL WHERE id=? AND status IN ('pending','failed') AND attempts<5 AND next_attempt_at<=?")
      .bind(lease, until, id, now).run();
    if (claim.meta.changes !== 1) continue;
    const item = await env.DB.prepare('SELECT * FROM pixel_reports WHERE id=? AND lease_token=?').bind(id, lease).first<ReportRow>();
    if (!item) continue;
    try {
      if (!dryRun) await env.EMAIL!.send({ to: env.OWNER_EMAIL, from: env.EMAIL_FROM!,
        subject: `89-day pixel report — ${item.label.replace(/[\r\n]/gu, ' ').slice(0, 150)}`, text: item.snapshot_text });
      // A provider may accept just before a crash. Durable claims prevent normal
      // concurrent duplicates, but this API does not promise exactly-once email.
      await env.DB.batch([
        env.DB.prepare('UPDATE pixel_reports SET status=?,delivered_at=?,lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?')
          .bind(dryRun ? 'dry_run' : 'sent', now, id, lease),
        env.DB.prepare("UPDATE pixels SET report_sent_at=? WHERE id=? AND EXISTS (SELECT 1 FROM pixel_reports WHERE id=? AND status='sent')")
          .bind(now, item.source_pixel_id, id),
      ]);
    } catch {
      const delay = Math.min(60, 2 ** item.attempts) * 60_000;
      await env.DB.prepare("UPDATE pixel_reports SET status='failed',last_error=?,next_attempt_at=?,lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?")
        .bind(item.attempts >= 5 ? 'Email delivery failed after five attempts. Check sending configuration, then retry this report.' : 'Email delivery failed. The service will retry automatically, up to five attempts.',
          new Date(time.getTime() + delay).toISOString(), id, lease).run();
    }
  }
}
