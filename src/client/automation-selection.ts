import type { OutreachItem } from '../shared/outreach';

/** Keep a selection tied to its saved versions and exclude managed/opted-out mail. */
export function readySelections(items: OutreachItem[], checked: Record<string, number>): OutreachItem[] {
  return items.filter(item => ['prepared', 'approved'].includes(item.state) && !item.doNotContact
    && !item.automaticDelivery && checked[item.id] === item.version);
}

/** Compare the actual reviewed content and pairing, not only its label or position. */
export function messageSnapshot(items: OutreachItem[]): string {
  return JSON.stringify(items.map(item => ({ id: item.id, version: item.version,
    state: item.state, recipient: item.recipient, subject: item.subject, body: item.body,
    preparedHtml: item.preparedHtml, preparedText: item.preparedText, pixelId: item.pixelId,
    optOutUrl: item.optOutUrl, doNotContact: item.doNotContact,
    deliveryId: item.automaticDelivery?.id ?? null })));
}

export function approvalBatchCurrent(snapshots: OutreachItem[], items: OutreachItem[]): boolean {
  return snapshots.length > 0 && snapshots.every(snapshot => {
    const current = items.find(item => item.id === snapshot.id);
    return current?.state === 'prepared' && !current.doNotContact && !current.automaticDelivery
      && messageSnapshot([snapshot]) === messageSnapshot([current]);
  });
}

export function allowedTestRecipients(items: OutreachItem[], testRecipient: string | null): boolean {
  return testRecipient === null || items.every(item => item.recipient.trim().toLowerCase() === testRecipient.trim().toLowerCase());
}

