import type { OutreachState } from '../shared/outreach';

export type PixelStatus = 'draft' | 'armed' | 'paused' | 'archived';
export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'dry_run' | 'disabled';

export interface Pixel {
  id: string;
  token: string;
  label: string;
  recipient: string;
  notes: string;
  status: PixelStatus;
  createdAt: string;
  updatedAt: string;
  armedAt: string | null;
  scheduledSendAt: string | null;
  activationId: string | null;
  activationAlertAt: string | null;
  firstAlertAt: string | null;
  firstLoadedAt: string | null;
  lastLoadedAt: string | null;
  loadCount: number;
  earlyLoadCount: number;
  hasRecordedLoad: boolean;
  preserveUnloaded: boolean;
  pixelUrl: string;
  notificationStatus: DeliveryStatus | 'none';
  doNotContact: boolean;
  optOutUrl: string | null;
  outreachId?: string | null;
  outreachState?: OutreachState | null;
}

export interface LoadEvent {
  id: string;
  createdAt: string;
  phase: 'before_arming' | 'after_arming';
  metadata: RequestMetadata | null;
}

export interface LoadEventPage {
  items: LoadEvent[];
  nextCursor: string | null;
}

// These describe the fetching connection and reported UA, not a reader identity.
export interface RequestMetadata {
  requestIp: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  timezone: string | null;
  asn: number | null;
  network: string | null;
  userAgent: string | null;
  client: string | null;
  platform: string | null;
  device: string | null;
  proxy: string | null;
}

export interface PixelPage {
  items: Pixel[];
  total: number;
  offset: number;
  hasMore: boolean;
}

export interface Notification {
  id: string;
  pixelId: string;
  label: string;
  createdAt: string;
  readAt: string | null;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
}

export type ReportStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'dry_run';

export interface PixelReport {
  id: string;
  pixelId: string | null;
  sourcePixelId: string;
  label: string;
  recipient: string;
  pixelCreatedAt: string;
  dueAt: string;
  createdAt: string;
  status: ReportStatus;
  attempts: number;
  lastError: string | null;
  deliveredAt: string | null;
  text: string;
}

export interface ReportPage {
  items: PixelReport[];
  total: number;
  offset: number;
  hasMore: boolean;
}

export interface DoNotContactEntry {
  recipient: string;
  createdAt: string;
  source: 'recipient' | 'owner';
}

export interface DoNotContactPage {
  items: DoNotContactEntry[];
  total: number;
  offset: number;
  hasMore: boolean;
}

export interface OptOutLink {
  url: string;
  recipient: string;
}

export interface Settings {
  emailEnabled: boolean;
  /** Legacy compatibility value; automatic loaded-history expiry is disabled. */
  retentionDays: 30 | 90 | 180;
  repeatAlerts: boolean;
  captureRequestDetails: boolean;
  keepUnloadedPixels: boolean;
}

export interface Bootstrap {
  ownerEmail: string;
  pixelBaseUrl: string;
  mode: 'development' | 'production';
  development: boolean;
  notificationConfigured: boolean;
  settings: Settings;
  pixels: Pixel[];
  notifications: Notification[];
  stats: { total: number; armed: number; loaded: number; unread: number };
}

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  OWNER_EMAIL: string;
  DASHBOARD_ORIGIN: string;
  PIXEL_ORIGIN: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_AUTH?: string;
  EMAIL_MODE?: 'dry-run' | 'live';
  EMAIL_FROM?: string;
  MICROSOFT_TENANT_ID?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_OWNER_ID?: string;
  MAILBOX_TOKEN_KEY?: string;
  /** Prospect sending stays disabled until explicitly configured and connected. */
  OUTREACH_SENDING_ENABLED?: 'true' | 'false';
  /** Optional rollout guard: restrict submissions to one approved test inbox. */
  OUTREACH_TEST_RECIPIENT?: string;
  EMAIL?: { send(message: { to: string; from: string; subject: string; text: string }): Promise<{ messageId: string }> };
}

export interface PixelRow {
  id: string;
  token: string;
  label: string;
  recipient: string;
  notes: string;
  status: PixelStatus;
  created_at: string;
  updated_at: string;
  armed_at: string | null;
  scheduled_send_at: string | null;
  activation_id: string | null;
  activation_alert_at: string | null;
  first_alert_at: string | null;
  first_loaded_at: string | null;
  last_loaded_at: string | null;
  load_count: number;
  early_load_count: number;
  has_recorded_load: number;
  preserve_unloaded: number;
  notification_status?: DeliveryStatus | null;
  do_not_contact?: number;
  opt_out_token?: string | null;
  outreach_id?: string | null;
  outreach_state?: OutreachState | null;
}
