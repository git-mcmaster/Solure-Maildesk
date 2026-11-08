import { describe, expect, it } from 'vitest';
import { allowedTestRecipients, approvalBatchCurrent, messageSnapshot, readySelections } from '../../src/client/automation-selection';
import type { OutreachItem } from '../../src/shared/outreach';

const item = (changes: Partial<OutreachItem> = {}): OutreachItem => ({
  id: 'fixture-one', version: 1, canEdit: true, state: 'prepared', label: 'Local fixture',
  recipient: 'review@example.test', subject: 'A useful observation', body: 'Hello,\nThe reviewed body.',
  preparedHtml: '<p>The reviewed body.</p>', preparedText: 'The reviewed body.\nSignature\nOpt-out address',
  pixelId: 'existing-pixel', pixelUrl: 'https://pixel.example.test/p/local.gif',
  optOutUrl: 'https://pixel.example.test/outreach/stop/existing-token',
  createdAt: '2026-11-08T12:00:00Z', updatedAt: '2026-11-08T12:00:00Z', approvedAt: null,
  scheduledAt: null, trackingStartsAt: null, delaySeconds: 45, doNotContact: false, lastError: null,
  ...changes,
});

describe('automation review selections', () => {
  it('selects only current prepared/approved versions with no opt-out or existing delivery', () => {
    const values = [item(), item({ id: 'approved', state: 'approved' }), item({ id: 'draft', state: 'draft' }),
      item({ id: 'stale', version: 2 }), item({ id: 'dnc', doNotContact: true }),
      item({ id: 'managed', automaticDelivery: { id: 'delivery' } as NonNullable<OutreachItem['automaticDelivery']> })];
    expect(readySelections(values, Object.fromEntries(values.map(value => [value.id, 1]))).map(value => value.id)).toEqual(['fixture-one', 'approved']);
  });

  it('requires a nonempty batch and every original saved message', () => {
    const first = item(), second = item({ id: 'second' });
    expect(approvalBatchCurrent([], [first])).toBe(false);
    expect(approvalBatchCurrent([first, second], [first])).toBe(false);
    expect(approvalBatchCurrent([first, second], [second, { ...first }])).toBe(true);
  });

  it.each([
    ['version', 2], ['recipient', 'changed@example.test'], ['subject', 'Changed subject'], ['body', 'Changed body'],
    ['preparedHtml', '<p>Changed</p>'], ['preparedText', 'Changed plain text'], ['pixelId', 'other-pixel'],
    ['optOutUrl', 'https://pixel.example.test/outreach/stop/other'], ['doNotContact', true], ['state', 'approved'],
  ] as const)('invalidates approval when %s changes', (key, value) => {
    const original = item();
    expect(approvalBatchCurrent([original], [item({ [key]: value })])).toBe(false);
    expect(messageSnapshot([original])).not.toBe(messageSnapshot([item({ [key]: value })]));
  });

  it('invalidates review if another action already created a delivery', () => {
    const original = item();
    expect(approvalBatchCurrent([original], [item({ automaticDelivery: { id: 'new-delivery' } as NonNullable<OutreachItem['automaticDelivery']> })])).toBe(false);
  });

  it('ties a send schedule snapshot to selection order as well as content', () => {
    const first = item({ state: 'approved' }), second = item({ id: 'second', state: 'approved' });
    expect(messageSnapshot([first, second])).not.toBe(messageSnapshot([second, first]));
    expect(messageSnapshot([first])).toBe(messageSnapshot([{ ...first, lastError: 'Harmless status refresh' }]));
  });

  it('keeps controlled-test selection limited to its exact recipient without dropping other selections silently', () => {
    expect(allowedTestRecipients([item()], 'REVIEW@EXAMPLE.TEST')).toBe(true);
    expect(allowedTestRecipients([item(), item({ id: 'other', recipient: 'prospect@example.test' })], 'review@example.test')).toBe(false);
    expect(allowedTestRecipients([item({ recipient: 'other@example.test' })], null)).toBe(true);
  });

});
