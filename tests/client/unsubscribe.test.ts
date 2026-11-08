import { describe, expect, it } from 'vitest';
import { prepareUnsubscribeHeaders } from '../../src/shared/unsubscribe';

const base = 'https://pixel.example.com';
const token = 'a1'.repeat(32);
const stop = `${base}/outreach/stop/${token}`;

describe('RFC 8058 header preparation', () => {
  it('preserves the existing recipient token and creates separate exact email headers', () => {
    const result = prepareUnsubscribeHeaders(stop, `${base}/`);
    expect(result.oneClickUrl).toBe(`${base}/outreach/unsubscribe/${token}`);
    expect(result.headers).toEqual({
      'List-Unsubscribe': `<${base}/outreach/unsubscribe/${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(result.headerText).toBe(`List-Unsubscribe: <${base}/outreach/unsubscribe/${token}>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click`);
    expect(result).not.toHaveProperty('html');
    expect(result).not.toHaveProperty('sentAt');
  });

  it.each([
    stop.replace('https:', 'http:'),
    stop.replace('pixel.example.com', 'attacker.example'),
    stop.replace('https://', 'https://owner:password@'),
    `${stop}?recipient=someone@example.com`,
    `${stop}#recipient`,
    stop.replace('/stop/', '/unsubscribe/'),
    stop.replace(token, 'a'.repeat(63)),
    stop.replace(token, token.toUpperCase()),
    stop.replace(token, `%61${token.slice(1)}`),
    `/outreach/stop/${token}`,
    `${stop}\r\nBcc: other@example.com`,
    ` ${stop}`,
  ])('rejects unsafe or non-paired source addresses: %s', (url) => {
    expect(() => prepareUnsubscribeHeaders(url, base)).toThrow();
  });

  it.each([
    'http://127.0.0.1:8788',
    `${base}/unexpected-path`,
    `${base}?anything=1`,
    `${base}#fragment`,
    'https://owner:password@pixel.example.com',
    `${base}\n`,
    'not an origin',
  ])('rejects unsafe or non-HTTPS configured public origins: %s', (origin) => {
    expect(() => prepareUnsubscribeHeaders(stop, origin)).toThrow();
  });

  it('keeps recipients’ existing tokens distinct without deriving identifiers from email addresses', () => {
    const first = prepareUnsubscribeHeaders(stop, base);
    const second = prepareUnsubscribeHeaders(stop.replace(token, 'b2'.repeat(32)), base);
    expect(first.oneClickUrl).not.toBe(second.oneClickUrl);
    expect(first.headerText).not.toContain('@');
  });
});
