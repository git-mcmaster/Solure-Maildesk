import type { Env, Notification, Pixel, PixelPage, PixelRow, Settings } from './types';

const pixelSelect = `SELECT p.*, (SELECT n.status FROM notifications n WHERE n.pixel_id=p.id ORDER BY n.created_at DESC, n.id DESC LIMIT 1) AS notification_status FROM pixels p`;

export function pixelFromRow(row: PixelRow, env: Env): Pixel {
  return { id: row.id, token: row.token, label: row.label, recipient: row.recipient, notes: row.notes, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, armedAt: row.armed_at, firstAlertAt: row.first_alert_at, firstLoadedAt: row.first_loaded_at,
    lastLoadedAt: row.last_loaded_at, loadCount: row.load_count, earlyLoadCount: row.early_load_count,
    hasRecordedLoad: row.has_recorded_load === 1, preserveUnloaded: row.preserve_unloaded === 1,
    pixelUrl: `${env.PIXEL_ORIGIN.replace(/\/$/u, '')}/p/${row.token}.gif`, notificationStatus: row.notification_status || 'none' };
}

export async function listPixels(env: Env, options: { q?: string; status?: string; offset?: number; limit?: number } = {}): Promise<PixelPage> {
  const clauses: string[] = [];
  const args: (string | number)[] = [];
  if (options.q) {
    clauses.push("(instr(lower(p.label),?)>0 OR instr(lower(p.recipient),?)>0 OR instr(lower(p.notes),?)>0)");
    args.push(options.q.toLowerCase(), options.q.toLowerCase(), options.q.toLowerCase());
  }
  if (options.status === 'active') clauses.push("p.status!='archived'");
  else if (options.status && options.status !== 'all') { clauses.push('p.status=?'); args.push(options.status); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 100;
  const [rows, count] = await Promise.all([
    env.DB.prepare(`${pixelSelect}${where} ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset).all<PixelRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM pixels p${where}`).bind(...args).first<{ count: number }>(),
  ]);
  const total = count?.count ?? 0;
  return { items: rows.results.map((row) => pixelFromRow(row, env)), total, offset, hasMore: offset + rows.results.length < total };
}

export async function getPixel(env: Env, id: string): Promise<Pixel | null> {
  const row = await env.DB.prepare(`${pixelSelect} WHERE p.id=?`).bind(id).first<PixelRow>();
  return row ? pixelFromRow(row, env) : null;
}

export async function getSettings(env: Env): Promise<Settings> {
  const row = await env.DB.prepare('SELECT * FROM settings WHERE id=1').first<{ email_enabled: number; retention_days: 30 | 90 | 180; repeat_alerts: number; capture_request_details: number; keep_unloaded_pixels: number }>();
  if (!row) throw new Error('Database migration missing');
  return { emailEnabled: row.email_enabled === 1, retentionDays: row.retention_days, repeatAlerts: row.repeat_alerts === 1, captureRequestDetails: row.capture_request_details === 1, keepUnloadedPixels: row.keep_unloaded_pixels === 1 };
}

export async function listNotifications(env: Env): Promise<Notification[]> {
  const rows = await env.DB.prepare(`SELECT n.*,p.label FROM notifications n JOIN pixels p ON p.id=n.pixel_id ORDER BY n.created_at DESC,n.id DESC LIMIT 200`).all<Record<string, unknown>>();
  return rows.results.map((row) => ({ id: String(row.id), pixelId: String(row.pixel_id), label: String(row.label), createdAt: String(row.created_at), readAt: row.read_at ? String(row.read_at) : null, status: row.status as Notification['status'], attempts: Number(row.attempts), lastError: row.last_error ? String(row.last_error) : null }));
}

export function notificationConfigured(env: Env): boolean {
  return env.EMAIL_MODE === 'dry-run' || (env.EMAIL_MODE === 'live' && !!env.EMAIL && !!env.EMAIL_FROM);
}
