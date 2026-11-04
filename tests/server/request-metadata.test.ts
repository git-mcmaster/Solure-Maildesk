import { describe, expect, it } from 'vitest';
import { collectRequestMetadata, parseRequestMetadata, reportedUserAgent, validatedIp } from '../../src/server/request-metadata';

function request(headers: Record<string, string> = {}, cf?: unknown) {
  return { headers: new Headers(headers), cf };
}

describe('bounded request metadata', () => {
  it('accepts ordinary IPv4 and IPv6 forms without accepting addresses with ports, lists, zones or invalid groups', () => {
    for (const value of ['198.51.100.23', '0.0.0.0', '::', '::1', '2001:db8::20', '2001:DB8:0:0:0:ff00:42:8329', '::ffff:192.0.2.128', '2001:db8:0:0:0:ffff:192.0.2.1']) {
      expect(validatedIp(value)).toBe(value.toLowerCase());
    }
    for (const value of ['', '256.0.0.1', '012.0.0.1', '1.2.3', '1.2.3.4:80', '1.2.3.4, 5.6.7.8', '[2001:db8::1]', 'fe80::1%eth0', '1::2::3', ':1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8::', '::ffff:256.1.1.1', '192.0.2.1::', '::ffff:192.0.2.1:1234', 'a'.repeat(65)]) {
      expect(validatedIp(value)).toBeNull();
    }
    expect(validatedIp(123)).toBeNull();
  });

  it('uses canonical connecting IP and only accepts preserved IPv6 for Cloudflare Class E pseudo IPv4', () => {
    for (const canonical of ['198.51.100.23', '239.255.255.255', '2001:db8::20']) {
      expect(collectRequestMetadata(request({ 'CF-Connecting-IPv6': '2001:db8::10', 'CF-Connecting-IP': canonical })).requestIp).toBe(canonical);
    }
    expect(collectRequestMetadata(request({ 'CF-Connecting-IPv6': '2001:db8::10' })).requestIp).toBeNull();
    expect(collectRequestMetadata(request({ 'CF-Connecting-IPv6': '2001:db8::10', 'CF-Connecting-IP': 'invalid' })).requestIp).toBeNull();
    expect(collectRequestMetadata(request({ 'CF-Connecting-IPv6': '2001:db8::10', 'CF-Connecting-IP': '240.16.0.1' })).requestIp).toBe('2001:db8::10');
    for (const value of ['not an IP', '198.51.100.99']) {
      expect(collectRequestMetadata(request({ 'CF-Connecting-IPv6': value, 'CF-Connecting-IP': '240.16.0.1' })).requestIp).toBe('240.16.0.1');
    }
    expect(collectRequestMetadata(request({ 'X-Forwarded-For': '192.0.2.1', 'X-Real-IP': '192.0.2.2' })).requestIp).toBeNull();
  });

  it('collects only the bounded connection fields and reported UA hints', () => {
    const result = collectRequestMetadata(request({ 'CF-Connecting-IP': '198.51.100.23', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/130.0' }, {
      city: 'Test city', region: 'Test region', country: 'us', timezone: 'America/New_York', asn: 64500, asOrganization: 'Example network', latitude: '12.34', longitude: '56.78', postalCode: '12345', cookie: 'private',
    }));
    expect(result).toMatchObject({ requestIp: '198.51.100.23', city: 'Test city', region: 'Test region', country: 'US', timezone: 'America/New_York', asn: 64500, network: 'Example network', client: 'Firefox', platform: 'Windows', device: 'Desktop', proxy: null });
    expect(Object.keys(result).sort()).toEqual(['requestIp', 'city', 'region', 'country', 'timezone', 'asn', 'network', 'userAgent', 'client', 'platform', 'device', 'proxy'].sort());
  });

  it('prioritizes explicit image proxies over their impersonated browser, platform and device', () => {
    const result = reportedUserAgent('Mozilla/5.0 (Windows NT 6.1; WOW64; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)');
    expect(result).toMatchObject({ proxy: 'Google image proxy', client: 'Google image proxy', platform: null, device: null });
    expect(reportedUserAgent('OutlookImageProxy Windows NT Firefox/130.0')).toMatchObject({ proxy: 'Microsoft image proxy', platform: null, device: null });
    expect(reportedUserAgent('YahooMailProxy Mozilla/5.0')).toMatchObject({ proxy: 'Yahoo image proxy', platform: null, device: null });
    expect(collectRequestMetadata(request({ 'User-Agent': 'Mozilla/5.0' }, { asn: 714, asOrganization: 'Apple Inc.' }))).toMatchObject({ proxy: null, client: null, device: null, platform: null });
  });

  it('supports missing Cloudflare metadata and unknown or explicitly reported mobile clients', () => {
    const empty = collectRequestMetadata(request());
    expect(Object.values(empty).every((value) => value === null)).toBe(true);
    expect(collectRequestMetadata(request({}, 'invalid'))).toEqual(empty);
    expect(collectRequestMetadata(request({}, { country: 'XX' })).country).toBeNull();
    expect(reportedUserAgent('Outlook-iOS/4.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toMatchObject({ client: 'Outlook', platform: 'iOS', device: 'Phone', proxy: null });
    expect(reportedUserAgent('Mozilla/5.0 (Android 14) Chrome/130.0')).toMatchObject({ client: 'Chrome', platform: 'Android', device: null });
    expect(reportedUserAgent('unrecognized-client')).toMatchObject({ client: null, platform: null, device: null });
  });

  it('bounds hostile strings, removes controls and refuses invalid scalar values', () => {
    const result = collectRequestMetadata(request({ 'User-Agent': 'x'.repeat(100_000), 'CF-Connecting-IP': 'x'.repeat(1000) }, {
      city: 'c'.repeat(100_000), region: '\u202eevil\nregion\u0000', country: 'USA', timezone: 't'.repeat(1000), asn: '64500', asOrganization: 'n'.repeat(1000),
    }));
    expect(result.userAgent).toHaveLength(512);
    expect(result.city).toHaveLength(128);
    expect(result.network).toHaveLength(128);
    expect(result.timezone).toHaveLength(64);
    expect(result.region).toBe('evil region');
    expect(result.country).toBeNull();
    expect(result.asn).toBeNull();
    expect(result.requestIp).toBeNull();
    expect(reportedUserAgent('Firefox/1\u0001\u202e Windows NT')).toMatchObject({ userAgent: 'Firefox/1 Windows NT' });
    for (const value of [-1, 0, 1.5, Infinity, 4_294_967_296]) expect(collectRequestMetadata(request({}, { asn: value })).asn).toBeNull();
  });

  it('returns null for absent, malformed or oversized stored JSON and revalidates its allowed fields', () => {
    for (const value of [null, undefined, 3, '', 'not JSON', 'null', '[]', '3', ' '.repeat(8193)]) expect(parseRequestMetadata(value)).toBeNull();
    const result = parseRequestMetadata(JSON.stringify({ requestIp: 'not an IP', city: 'c'.repeat(500), country: 'gb', asn: 64500, userAgent: 'ua', latitude: 123, cookie: 'secret', client: 'Firefox\u202e', platform: 'Windows' }));
    expect(result).toMatchObject({ requestIp: null, country: 'GB', asn: 64500, userAgent: 'ua', client: 'Firefox', platform: 'Windows' });
    expect(result?.city).toHaveLength(128);
    expect(result).not.toHaveProperty('latitude');
    expect(result).not.toHaveProperty('cookie');
  });
});
