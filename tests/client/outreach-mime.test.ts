import { describe, expect, it } from 'vitest';
import { outreachMime } from '../../src/server/outreach-mime';

const input = {
  from: 'Owner@Example.com', recipient: 'Alice+shop@Example.net', subject: 'A useful heads-up — café ☕',
  html: '<p>Hello, Alice — café ☕</p><a href="https://pixel.example.com/outreach/stop/' + 'a'.repeat(64) + '">Stop outreach emails</a>',
  text: 'Hello, Alice — café ☕\nStop outreach emails', messageId: '<12345678-1234-4123-8123-123456789abc@maildesk.example.com>',
  optOutUrl: 'https://pixel.example.com/outreach/stop/' + 'a'.repeat(64), pixelOrigin: 'https://pixel.example.com', date: new Date('2026-11-08T15:00:00Z'),
};
function decode(value: string) { return new TextDecoder().decode(Uint8Array.from(atob(value), char => char.charCodeAt(0))); }

describe('exact approved outgoing MIME', () => {
  it('preserves Unicode subject and both approved body alternatives and supplies recipient-specific standard headers', () => {
    const { mime, base64 } = outreachMime(input);
    expect(decode(base64)).toBe(mime);
    expect(mime).toContain('From: owner@example.com\r\nTo: alice+shop@example.net\r\n');
    expect(mime).toContain('List-Unsubscribe: <https://pixel.example.com/outreach/unsubscribe/' + 'a'.repeat(64) + '>');
    expect(mime).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    const words = mime.match(/Subject: ([\s\S]+?)\r\nDate:/u)![1]!.match(/=\?UTF-8\?B\?([^?]+)\?=/gu)!;
    expect(words.map(word => decode(word.slice(10, -2))).join('')).toBe(input.subject);
    const parts = [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/gu)];
    expect(parts.map(part => decode(part[1]!.replaceAll('\r\n', '')))).toEqual([input.text, input.html]);
    expect(mime).not.toContain('DKIM-Signature:');
  });
  it('folds long Unicode subjects without breaking encoded words or code points', () => {
    const subject = 'A café ☕ — '.repeat(15);
    const { mime } = outreachMime({ ...input, subject });
    const words = mime.match(/Subject: ([\s\S]+?)\r\nDate:/u)![1]!.match(/=\?UTF-8\?B\?([^?]+)\?=/gu)!;
    expect(words.every(word => word.length <= 75)).toBe(true);
    expect(words.map(word => decode(word.slice(10, -2))).join('')).toBe(subject);
  });
  it('rejects envelope/header injection, invalid identity and foreign opt-out addresses', () => {
    for (const change of [{ subject: 'Hello\r\nBcc: other@example.com' }, { from: 'owner@example.com\r\nTo: other@example.com' },
      { recipient: 'alice@example.net,bob@example.net' }, { messageId: '<hello@example.com>' },
      { optOutUrl: input.optOutUrl.replace('pixel.example.com', 'other.example.com') }, { date: new Date('invalid') }]) {
      expect(() => outreachMime({ ...input, ...change })).toThrow();
    }
  });
});
