import assert from 'node:assert/strict';
import test from 'node:test';
import { release } from './release.mjs';

const sha = 'a'.repeat(40);
const collector = '11111111-1111-1111-1111-111111111111';
const dashboard = '22222222-2222-2222-2222-222222222222';
const quiet = () => {};

test('an incomplete commit cannot invoke the deployment tool', () => {
  let invoked = false;
  assert.throws(() => release('main', () => { invoked = true; return ''; }, quiet));
  assert.equal(invoked, false);
});

test('missing or ambiguous upload identity never deploys a version', () => {
  for (const output of ['', `Worker Version ID: ${collector}\nWorker Version ID: ${dashboard}\n`]) {
    const calls = [];
    assert.throws(() => release(sha, args => { calls.push(args); return output; }, quiet));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'upload');
  }
});

test('releases the exact uploaded collector before touching the dashboard', () => {
  const calls = [];
  const result = release(sha, args => {
    calls.push(args);
    if (args[1] === 'upload') return `Worker Version ID: ${args.includes('wrangler.pixel.jsonc') ? collector : dashboard}\n`;
    return 'Deployment complete';
  }, quiet);
  assert.deepEqual(calls.map(args => [args[1], args[args.indexOf('--config') + 1]]), [
    ['upload', 'wrangler.pixel.jsonc'], ['deploy', 'wrangler.pixel.jsonc'],
    ['upload', 'wrangler.dashboard.jsonc'], ['deploy', 'wrangler.dashboard.jsonc'],
  ]);
  assert.equal(calls[1][2], `${collector}@100%`);
  assert.equal(calls[3][2], `${dashboard}@100%`);
  assert.deepEqual(result.map(row => row.version), [collector, dashboard]);
});

test('a collector deployment failure prevents every dashboard operation', () => {
  const calls = [];
  assert.throws(() => release(sha, args => {
    calls.push(args);
    if (args[1] === 'deploy') throw new Error('provider rejected the collector deployment');
    return `Worker Version ID: ${collector}\n`;
  }, quiet));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(args => args.includes('wrangler.pixel.jsonc')));
});
