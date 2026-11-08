/** Existing manual tracking and explicitly approved connected delivery share review. */
import type { AutomaticDelivery } from './automation';
export type { PreparedUnsubscribeHeaders } from './unsubscribe';

export type OutreachState = 'draft' | 'prepared' | 'approved' | 'scheduled' | 'tracking' | 'cancelled' | 'blocked' | 'needs_attention';

export interface OutreachInput {
  label: string;
  recipient: string;
  subject: string;
  body: string;
}

export interface OutreachItem extends OutreachInput {
  id: string;
  version: number;
  canEdit: boolean;
  state: OutreachState;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  scheduledAt: string | null;
  trackingStartsAt: string | null;
  delaySeconds: number;
  pixelId: string | null;
  pixelUrl: string | null;
  optOutUrl: string | null;
  preparedHtml: string | null;
  preparedText: string | null;
  doNotContact: boolean;
  lastError: string | null;
  /** Present only after the separate, explicit automatic-send scheduling step. */
  automaticDelivery?: AutomaticDelivery | null;
}

export interface OutreachPage {
  items: OutreachItem[];
  scheduling: { mode: 'planned-time'; description: string };
}

/** One unique pixel/logo and recipient-bound opt-out link per prepared item. */
export const DEFAULT_TRACKING_DELAY_SECONDS = 45;

// GET /api/outreach -> OutreachPage
// POST /api/outreach/import { items: OutreachInput[] } -> OutreachPage
// PATCH /api/outreach/:id { version, label?, recipient?, subject?, body? } -> OutreachItem
// POST /api/outreach/:id/prepare { version } -> OutreachItem
// POST /api/outreach/:id/approve { version } -> OutreachItem
// POST /api/outreach/approve-batch { items: { id, version }[], confirmReviewed: true } -> OutreachPage
// POST /api/outreach/:id/cancel { version } -> OutreachItem
// POST /api/outreach/:id/reschedule { version, sendAt: ISO } -> OutreachItem
// GET /api/outreach/:id/unsubscribe-headers?version=N -> PreparedUnsubscribeHeaders
// POST /api/outreach/schedule { items: { id, version }[], sendAt: ISO, delaySeconds: 45 } -> OutreachPage
// POST /api/pixels/:id/schedule { sendAt: ISO, enableEmailAlerts?: true } -> Pixel
