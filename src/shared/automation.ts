import type { MailboxStatus } from './mailbox';

export type AutomaticDeliveryState = 'pending' | 'submitting' | 'accepted' | 'sent' | 'cancelled' | 'blocked' | 'needs_attention';

/** A provider acceptance is neither a sent-item observation nor delivery proof. */
export interface AutomaticDelivery {
  id: string;
  jobId: string;
  version: number;
  approvedVersion: number;
  recipient: string;
  label: string;
  subject: string;
  state: AutomaticDeliveryState;
  sendAt: string;
  timeZone: string;
  trackingStartsAt: string;
  queuedAt: string;
  submittedAt: string | null;
  acceptedAt: string | null;
  sentAt: string | null;
  cancelRequested: boolean;
  lastError: string | null;
  messageId: string;
  attempts: number;
  nativeUnsubscribeVerified: false;
}

export interface AutomationActivity {
  id: string;
  deliveryId: string;
  createdAt: string;
  kind: string;
  message: string;
}

export const AUTOMATION_POLICY = {
  dailyLimit: 20,
  dailyLimitTimeZone: 'UTC',
  minimumSpacingMinutes: 2,
  maxLatenessMinutes: 15,
  trackingDelaySeconds: 45,
  maxDuePerRun: 1,
} as const;

export interface AutomationPage {
  mailbox: MailboxStatus;
  paused: boolean;
  testRecipient: string | null;
  deliveries: AutomaticDelivery[];
  activity: AutomationActivity[];
  policy: typeof AUTOMATION_POLICY;
}
