import type { OutreachInput } from '../shared/outreach';

export const MAX_IMPORT_BYTES = 1_048_576;

/** Read copy supplied by the owner; never generate or interpret message HTML. */
export function parseOutreachImport(source: string): OutreachInput[] {
  if (new TextEncoder().encode(source).length > MAX_IMPORT_BYTES) throw new Error('Choose a JSON file smaller than 1 MB.');
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error('The import must be valid JSON: an array of drafts, or an object with an “items” array.'); }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (Object.keys(parsed).join(',') !== 'items') throw new Error('The JSON object must contain only an “items” array.');
    parsed = (parsed as { items: unknown }).items;
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 100) throw new Error('Import between 1 and 100 drafts at a time.');
  return parsed.map((entry: unknown, index): OutreachInput => {
    const fail = (detail: string) => new Error(`Draft ${index + 1}: ${detail}`);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw fail('each draft must be an object.');
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).sort().join(',') !== 'body,label,recipient,subject') throw fail('include exactly label, recipient, subject and body.');
    const result = {} as OutreachInput;
    const limits = { label: 150, recipient: 254, subject: 200, body: 10_000 } as const;
    for (const field of Object.keys(limits) as (keyof OutreachInput)[]) {
      const value = row[field];
      if (typeof value !== 'string' || !value.trim() || value.length > limits[field] || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw fail(`${field} must be nonempty text, up to ${limits[field].toLocaleString()} characters.`);
      if (field !== 'body' && /[\r\n]/u.test(value)) throw fail(`${field} must be on one line.`);
      result[field] = value;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(result.recipient.trim())) throw fail('enter one complete recipient email address.');
    return result;
  });
}

export function scheduleIso(value: string): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error('Choose a valid local date and time.');
  if (date.getTime() <= Date.now()) throw new Error('Choose a time in the future.');
  return date.toISOString();
}
