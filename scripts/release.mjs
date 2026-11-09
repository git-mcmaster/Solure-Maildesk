import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const configs = ['wrangler.pixel.jsonc', 'wrangler.dashboard.jsonc'];
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function wrangler(args) {
  return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Existing domains and cron triggers are infrastructure, not part of a code
// release. Upload/deploy versions instead of reapplying those connections.
export function release(sha, run = wrangler, log = console.log) {
  assert.match(sha ?? '', /^[0-9a-f]{40}$/u, 'A complete reviewed commit is required.');
  const releases = [];
  for (const config of configs) {
    const message = `Reviewed release ${sha}`;
    const output = run(['versions', 'upload', '--config', config, '--message', message]);
    log(output);
    const plain = output.replace(/\u001b\[[0-9;]*m/gu, '');
    const ids = [...plain.matchAll(new RegExp(`^Worker Version ID:\\s*(${uuid})\\s*$`, 'gimu'))];
    assert.equal(ids.length, 1, 'Upload must return exactly one Worker version before deployment.');
    const version = ids[0][1];
    log(run(['versions', 'deploy', `${version}@100%`, '--config', config, '--yes', '--message', message]));
    releases.push({ config, version });
  }
  return releases;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const releases = release(process.env.GITHUB_SHA);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `Released commit \`${process.env.GITHUB_SHA}\`\n\n${releases.map(row => `- ${row.config}: \`${row.version}\``).join('\n')}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Worker release failed.');
    process.exitCode = 1;
  }
}
