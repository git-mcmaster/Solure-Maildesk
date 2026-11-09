import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// This smoke check never uses a real tracking or opt-out capability. It does
// not sign in, send mail, or apply a database migration.
const dashboard = 'https://maildesk.soluredigitalworks.com';
const collector = 'https://pixel.soluredigitalworks.com';
const accessHost = 'throbbing-morning-dbde.cloudflareaccess.com';
const unknown = randomBytes(32).toString('hex');
const index = await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8');
const asset = /src="(\/assets\/[^"\s]+\.js)"/u.exec(index)?.[1];
assert.ok(asset, 'The built client asset must exist before live verification.');

async function check(name, url, expected, init = {}) {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 Solure-Maildesk-Release-Verification/1.0', ...init.headers },
      signal: AbortSignal.timeout(10000),
    });
    try {
      assert.equal(response.status, expected.status, 'Unexpected HTTP status');
      if (expected.access) {
        const location = response.headers.get('Location');
        assert.ok(location, 'Missing owner-login redirect');
        const destination = new URL(location, url);
        assert.equal(destination.protocol, 'https:');
        assert.equal(destination.hostname, accessHost, 'Unexpected sign-in destination');
      }
      if (expected.type) assert.ok(response.headers.get('Content-Type')?.startsWith(expected.type), 'Unexpected content type');
      console.log(`PASS ${name} (${response.status})`);
    } finally {
      await response.body?.cancel();
    }
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : 'request failed'}`);
    process.exitCode = 1;
  }
}

await check('Dashboard requires owner sign-in', dashboard + '/', { status: 302, access: true });
await check('Mailbox status requires owner sign-in', dashboard + '/api/mailbox/status', { status: 302, access: true });
await check('Built client requires owner sign-in', dashboard + asset, { status: 302, access: true });
await check('Collector does not expose private APIs', collector + '/api/automation', { status: 404 });
await check('Static logo remains public without recording', collector + '/brand/solure-logo-v1.png', { status: 200, type: 'image/png' }, { method: 'HEAD' });
await check('Unknown unsubscribe GET stays unavailable', collector + '/outreach/unsubscribe/' + unknown, { status: 404 });
await check('Unknown unsubscribe HEAD stays unavailable', collector + '/outreach/unsubscribe/' + unknown, { status: 404 }, { method: 'HEAD' });
await check('Malformed unsubscribe POST is rejected before lookup', collector + '/outreach/unsubscribe/' + unknown, { status: 400 }, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'invalid=true',
});
