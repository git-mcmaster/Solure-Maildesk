import type { RequestMetadata } from './types';

function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  // Bound work before cleaning controls and whitespace; never retain hidden bidi.
  return value.slice(0, limit).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/gu, ' ').trim() || null;
}

function ipv4(value: string): boolean {
  const groups = value.split('.');
  return groups.length === 4 && groups.every((part) => /^(0|[1-9][0-9]{0,2})$/u.test(part) && Number(part) <= 255);
}

function ipv6(value: string): boolean {
  if (!value.includes(':') || !/^[0-9a-f:.]+$/iu.test(value)) return false;
  const halves = value.split('::');
  if (halves.length > 2) return false;
  const parts = halves.flatMap((part) => part ? part.split(':') : []);
  let count = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.includes('.')) {
      if (i !== parts.length - 1 || !value.endsWith(part) || !ipv4(part)) return false;
      count += 2;
    } else {
      if (!/^[0-9a-f]{1,4}$/iu.test(part)) return false;
      count++;
    }
  }
  return halves.length === 2 ? count < 8 : count === 8;
}

export function validatedIp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const ip = value.trim();
  return ipv4(ip) || ipv6(ip) ? ip.toLowerCase() : null;
}

function country(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z]{2}$/u.test(value)) return null;
  const code = value.toUpperCase();
  return code === 'XX' ? null : code;
}

function asn(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 4_294_967_295 ? value : null;
}

export function reportedUserAgent(value: unknown): Pick<RequestMetadata, 'userAgent' | 'client' | 'platform' | 'device' | 'proxy'> {
  const userAgent = text(value, 512);
  const empty = { userAgent, client: null, platform: null, device: null, proxy: null };
  if (!userAgent) return empty;
  // A proxy may impersonate an ordinary browser. Its tokens take priority and
  // its platform/device must not be attributed to the recipient.
  const proxy = /GoogleImageProxy/iu.test(userAgent) ? 'Google image proxy'
    : /(?:Outlook|Microsoft)[ ._-]?(?:Mail[ ._-]?)?Image[ ._-]?Proxy/iu.test(userAgent) ? 'Microsoft image proxy'
      : /Yahoo[ ._-]?(?:Mail[ ._-]?)?(?:Image[ ._-]?)?Proxy/iu.test(userAgent) ? 'Yahoo image proxy' : null;
  if (proxy) return { ...empty, client: proxy, proxy };
  const client = /Outlook/iu.test(userAgent) ? 'Outlook'
    : /Thunderbird\//iu.test(userAgent) ? 'Thunderbird'
      : /Apple[ _-]?Mail/iu.test(userAgent) ? 'Apple Mail'
        : /\bGmail\//iu.test(userAgent) ? 'Gmail'
          : /\b(?:Edg|EdgiOS|EdgA)\//u.test(userAgent) ? 'Microsoft Edge'
            : /\b(?:Firefox|FxiOS)\//u.test(userAgent) ? 'Firefox'
              : /\b(?:Chrome|CriOS)\//u.test(userAgent) ? 'Chrome'
                : /\bSafari\//u.test(userAgent) ? 'Safari'
                  : /\bcurl\//iu.test(userAgent) ? 'curl' : /\bWget\//iu.test(userAgent) ? 'Wget' : null;
  const platform = /\biPad\b/iu.test(userAgent) ? 'iPadOS'
    : /\b(?:iPhone|iPod)\b/iu.test(userAgent) ? 'iOS'
      : /\bAndroid\b/iu.test(userAgent) ? 'Android'
        : /Windows (?:NT|Phone)/iu.test(userAgent) ? 'Windows'
          : /\bCrOS\b/iu.test(userAgent) ? 'ChromeOS'
            : /Macintosh|Mac OS X/iu.test(userAgent) ? 'macOS'
              : /\bLinux\b/iu.test(userAgent) ? 'Linux' : null;
  const device = /\biPad\b|\bTablet\b/iu.test(userAgent) ? 'Tablet'
    : /\biPhone\b|\biPod\b|Android.*\bMobile\b|Windows Phone/iu.test(userAgent) ? 'Phone'
      : /Windows NT|Macintosh|\bX11\b|\bCrOS\b/iu.test(userAgent) ? 'Desktop' : null;
  return { userAgent, client, platform, device, proxy: null };
}

export function collectRequestMetadata(request: Pick<Request, 'headers'> & { cf?: unknown }): RequestMetadata {
  const cf = request.cf && typeof request.cf === 'object' && !Array.isArray(request.cf) ? request.cf as Record<string, unknown> : {};
  const canonicalIp = validatedIp(request.headers.get('CF-Connecting-IP'));
  let requestIp = canonicalIp;
  // Cloudflare preserves IPv6 in this second header when Pseudo IPv4 overwrites
  // the canonical IP with a Class E (240/4) value. Do not let an unrelated or
  // client-supplied IPv6 header override an ordinary or missing canonical IP.
  if (canonicalIp && !canonicalIp.includes(':') && Number(canonicalIp.split('.')[0]) >= 240) {
    const connectingIpv6 = validatedIp(request.headers.get('CF-Connecting-IPv6'));
    if (connectingIpv6?.includes(':')) requestIp = connectingIpv6;
  }
  return {
    requestIp,
    city: text(cf.city, 128), region: text(cf.region, 128), country: country(cf.country), timezone: text(cf.timezone, 64),
    asn: asn(cf.asn), network: text(cf.asOrganization, 128), ...reportedUserAgent(request.headers.get('User-Agent')),
  };
}

export function parseRequestMetadata(value: unknown): RequestMetadata | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const row: unknown = JSON.parse(value);
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const data = row as Record<string, unknown>;
    return {
      requestIp: validatedIp(data.requestIp), city: text(data.city, 128), region: text(data.region, 128), country: country(data.country),
      timezone: text(data.timezone, 64), asn: asn(data.asn), network: text(data.network, 128), userAgent: text(data.userAgent, 512),
      client: text(data.client, 64), platform: text(data.platform, 32), device: text(data.device, 32), proxy: text(data.proxy, 64),
    };
  } catch { return null; }
}
