import assert from 'node:assert/strict';

const accessHost = 'throbbing-morning-dbde.cloudflareaccess.com';

export function validateResponse(response, expected, url) {
  // Only checks whose contract is denial may accept an identified edge
  // challenge. Login redirects and receiver behavior remain strict checks.
  if (expected.edgeDenial && response.status === 403
    && response.headers.get('cf-mitigated') === 'challenge'
    && response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() === 'text/html') return 'challenge';

  assert.equal(response.status, expected.status, `Expected HTTP ${expected.status}; received ${response.status}`);
  if (expected.access) {
    const location = response.headers.get('Location');
    assert.ok(location, 'Missing owner-login redirect');
    const destination = new URL(location, url);
    assert.equal(destination.protocol, 'https:');
    assert.equal(destination.hostname, accessHost, 'Unexpected sign-in destination');
  }
  if (expected.type) assert.ok(response.headers.get('Content-Type')?.startsWith(expected.type), 'Unexpected content type');
  return 'expected';
}
