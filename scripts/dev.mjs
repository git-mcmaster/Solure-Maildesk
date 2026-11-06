import { spawn } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';

if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars');

const children = new Set();
const grouped = process.platform !== 'win32';
const options = { stdio: 'inherit', detached: grouped, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } };
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // pnpm and Wrangler start descendants. Stop only these process groups so a
  // failed preview does not leave an orphan holding the local SQLite lock.
  for (const child of children) {
    try { if (grouped && child.pid) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') console.error(error.message); }
  }
  process.exitCode = code;
}
function start(args, persistent = true) {
  const child = spawn('pnpm', args, options);
  children.add(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { children.delete(child); if (persistent && !stopping) stop(code ?? 1); });
  return child;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

function run(args) {
  return new Promise((resolve, reject) => {
    const child = start(args, false);
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`)));
  });
}
async function waitForService(url) {
  const deadline = Date.now() + 180_000;
  while (!stopping && Date.now() < deadline) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Server startup. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('The local preview could not start. Check the service output above.');
}

try {
  await run(['db:local']);
  await run(['build']);
  // Custom production routes otherwise make Wrangler forward a production
  // hostname, which correctly fails the app’s loopback-only development check.
  const common = ['--ip', '127.0.0.1', '--host', '127.0.0.1', '--persist-to', '.wrangler/state'];
  start(['exec', 'wrangler', 'dev', '--config', 'wrangler.dashboard.jsonc', '--port', '8787', '--inspector-port', '9231', '--test-scheduled', ...common,
    '--var', 'DASHBOARD_ORIGIN:http://127.0.0.1:5173', '--var', 'PIXEL_ORIGIN:http://127.0.0.1:8788', '--var', 'DEV_AUTH:true', '--var', 'EMAIL_MODE:dry-run']);
  // Both services share one SQLite file. Serial startup avoids simultaneous
  // recovery of that file while preserving the existing two-service layout.
  await waitForService('http://127.0.0.1:8787/api/health');
  start(['exec', 'wrangler', 'dev', '--config', 'wrangler.pixel.jsonc', '--port', '8788', '--inspector-port', '9232', ...common,
    '--var', 'PIXEL_ORIGIN:http://127.0.0.1:8788']);
  await waitForService('http://127.0.0.1:8788/brand/solure-logo-v1.png');
  start(['exec', 'vite']);
  // Tracking uses the stored activation timestamp on each image request.
  // It needs neither a mailbox connection nor a browser-side timer.
} catch (error) { console.error(error.message); stop(1); }
