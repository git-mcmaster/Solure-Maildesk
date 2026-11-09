import assert from 'node:assert/strict';
import test from 'node:test';
import { validateResponse } from './verify-response.mjs';

const url = 'https://maildesk.soluredigitalworks.com/';
const challenge = { 'cf-mitigated': 'challenge', 'Content-Type': 'text/html; charset=UTF-8' };
const deny = { status: 302, access: true, edgeDenial: true };

test('normal login responses must redirect to the exact HTTPS owner gateway', () => {
  const expected = { status: 302, access: true };
  assert.equal(validateResponse(new Response(null, { status: 302, headers: {
    Location: 'https://throbbing-morning-dbde.cloudflareaccess.com/cdn-cgi/access/login',
  } }), expected, url), 'expected');
  for (const Location of ['https://other.cloudflareaccess.com/', 'http://throbbing-morning-dbde.cloudflareaccess.com/']) {
    assert.throws(() => validateResponse(new Response(null, { status: 302, headers: { Location } }), expected, url));
  }
});

test('an identified Cloudflare challenge is accepted only for an opted-in denial check', () => {
  assert.equal(validateResponse(new Response(null, { status: 403, headers: challenge }), deny, url), 'challenge');
  assert.throws(() => validateResponse(new Response(null, { status: 403, headers: challenge }), { status: 302, access: true }, url));
});

test('an ordinary 403 or an unrecognized challenge cannot satisfy a denial check', () => {
  for (const headers of [{}, { 'cf-mitigated': 'unknown', 'Content-Type': 'text/html' },
    { 'cf-mitigated': 'challenge', 'Content-Type': 'application/json' }]) {
    assert.throws(() => validateResponse(new Response(null, { status: 403, headers }), deny, url));
  }
});

test('private content returned with HTTP 200 always fails, including with challenge headers', () => {
  assert.throws(() => validateResponse(new Response('private content', { status: 200, headers: challenge }), deny, url));
});

test('public API denial and malformed unsubscribe responses retain their exact contracts', () => {
  assert.equal(validateResponse(new Response(null, { status: 404 }), { status: 404, edgeDenial: true }, url), 'expected');
  assert.equal(validateResponse(new Response(null, { status: 400 }), { status: 400 }, url), 'expected');
  assert.throws(() => validateResponse(new Response(null, { status: 403, headers: challenge }), { status: 400 }, url));
});
