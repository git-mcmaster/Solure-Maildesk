/** Connection readiness only. Connecting does not approve or schedule outreach. */
export interface MailboxStatus {
  configured: boolean;
  connected: boolean;
  sendingEnabled: boolean;
  ownerEmail: string;
  connectedEmail: string | null;
  lastError: string | null;
  permissions: string[];
  nativeUnsubscribeVerified: false;
}

export const MAILBOX_PERMISSIONS = ['User.Read', 'Mail.Read', 'Mail.Send', 'offline_access', 'openid', 'profile'] as const;
