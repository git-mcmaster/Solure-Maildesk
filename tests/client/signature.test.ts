import { describe, expect, it } from 'vitest';
import { emailContent, imageAddresses } from '../../src/client/signature';

const first = 'https://pixel.soluredigitalworks.com/p/0123456789abcdef0123456789abcdef.gif';
const second = 'https://pixel.soluredigitalworks.com/p/ffffffffffffffffffffffffffffffff.gif';
const owner = 'elijah@soluredigitalworks.com';

describe('message-specific email signatures', () => {
  it('copies one visible tracked logo and readable contact text without a second pixel', () => {
    const content = emailContent(first, owner, 'signature');
    expect(content.html.match(/<img\b/gu)).toHaveLength(1);
    expect(content.html).toContain('src="https://pixel.soluredigitalworks.com/p/0123456789abcdef0123456789abcdef/logo.png"');
    expect(content.html).toContain('width="48" height="50" alt="Solure Digital Works logo"');
    expect(content.html).not.toContain('.gif');
    expect(content.html).toContain('>Elijah McMaster</strong>');
    expect(content.html).toContain('>Solure Digital Works</span>');
    expect(content.html).toContain(`>${owner}</a>`);
    expect(content.html).toContain('href="https://soluredigitalworks.com"');
    expect(content.plainText).toBe(`Elijah McMaster\nSolure Digital Works\n${owner}\nsoluredigitalworks.com`);
    expect(content.plainText).not.toMatch(/<img|\/p\/|logo\.png/gu);
  });

  it('keeps two messages’ logo URLs separate while the preview URL has no message identifier', () => {
    expect(imageAddresses(first).logo).not.toBe(imageAddresses(second).logo);
    expect(imageAddresses(first).preview).toBe(imageAddresses(second).preview);
    expect(imageAddresses(first).preview).toBe('https://pixel.soluredigitalworks.com/brand/solure-logo-v1.png');
    expect(imageAddresses(first).preview).not.toContain('0123456789abcdef');
  });

  it('retains the existing transparent-pixel HTML as the alternative, without a logo', () => {
    const content = emailContent(first, owner, 'pixel');
    expect(content.html.match(/<img\b/gu)).toHaveLength(1);
    expect(content.html).toContain(`src="${first}" width="1" height="1" alt=""`);
    expect(content.html).not.toContain('logo.png');
    expect(content.plainText).toBe('');
  });

  it('escapes text and encodes the contact link instead of introducing HTML attributes', () => {
    const content = emailContent(first, 'a&b@example.com', 'signature');
    expect(content.html).toContain('>a&amp;b@example.com</a>');
    expect(content.html).toContain('href="mailto:a%26b@example.com"');
    expect(content.html).not.toContain('>a&b@example.com</a>');
    expect(content.plainText).toContain('a&b@example.com');
  });

  it('rejects an injected contact address rather than interpolating markup', () => {
    expect(() => emailContent(first, 'x" onerror="alert(1)@example.com', 'signature')).toThrow('email address');
    expect(() => emailContent(first, '<script>@example.com', 'signature')).toThrow('email address');
  });

  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://user:password@pixel.soluredigitalworks.com/p/0123456789abcdef0123456789abcdef.gif',
    'https://pixel.soluredigitalworks.com/p/not-a-token.gif',
    'https://pixel.soluredigitalworks.com/p/0123456789abcdef0123456789abcdef.gif/other',
  ])('rejects an invalid image address: %s', (url) => {
    expect(() => emailContent(url, owner, 'signature')).toThrow();
  });

  it('keeps the local test image origin and discards query/fragment data', () => {
    const urls = imageAddresses('http://127.0.0.1:8788/p/0123456789abcdef0123456789abcdef.gif?untrusted=%22#fragment');
    expect(urls.logo).toBe('http://127.0.0.1:8788/p/0123456789abcdef0123456789abcdef/logo.png');
    expect(urls.preview).toBe('http://127.0.0.1:8788/brand/solure-logo-v1.png');
    expect(urls.pixel).toBe('http://127.0.0.1:8788/p/0123456789abcdef0123456789abcdef.gif');
  });
});
