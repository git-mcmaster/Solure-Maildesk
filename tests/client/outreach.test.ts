import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseOutreachImport, scheduleIso } from '../../src/client/outreach-import';

const draft = { label: 'Owner-supplied draft', recipient: 'recipient@example.com', subject: 'A subject', body: 'A paragraph.\n\nAnother paragraph, with <literal markup>.' };
afterEach(() => vi.useRealTimers());

describe('outreach import and local schedule input', () => {
  it('preserves externally written copy as text for both supported import shapes', () => {
    expect(parseOutreachImport(JSON.stringify([draft]))).toEqual([draft]);
    expect(parseOutreachImport(JSON.stringify({ items: [draft] }))).toEqual([draft]);
  });
  it('rejects hidden send instructions, unknown fields and newline injection', () => {
    expect(() => parseOutreachImport(JSON.stringify({ items: [draft], send: true }))).toThrow('only');
    expect(() => parseOutreachImport(JSON.stringify([{ ...draft, html: '<img src="https://example.com/pixel">' }]))).toThrow('exactly');
    expect(() => parseOutreachImport(JSON.stringify([{ ...draft, subject: 'Subject\nBcc: another@example.com' }]))).toThrow('one line');
  });
  it('rejects an oversized file and more than 100 drafts before submission', () => {
    expect(() => parseOutreachImport(' '.repeat(1_048_577))).toThrow('smaller');
    expect(() => parseOutreachImport(JSON.stringify(Array.from({ length: 101 }, () => draft)))).toThrow('100');
  });
  it('rejects an invalid or elapsed schedule and serializes a future instant', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T15:00:00Z'));
    expect(() => scheduleIso('')).toThrow('valid');
    expect(() => scheduleIso('2026-11-06T14:59:00Z')).toThrow('future');
    expect(scheduleIso('2026-11-06T16:00:00Z')).toBe('2026-11-06T16:00:00.000Z');
  });
});
