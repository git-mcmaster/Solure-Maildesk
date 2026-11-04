import { spawn } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';

if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars');

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`)));
  });
}

await run(['db:local']);
await run(['build']);
const common = ['--ip', '127.0.0.1', '--persist-to', '.wrangler/state'];
const options = { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } };
const children = [
  spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', 'wrangler.dashboard.jsonc', '--port', '8787', '--inspector-port', '9231', '--test-scheduled', ...common,
    '--var', 'DASHBOARD_ORIGIN:http://127.0.0.1:5173', '--var', 'PIXEL_ORIGIN:http://127.0.0.1:8788'], options),
  spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', 'wrangler.pixel.jsonc', '--port', '8788', '--inspector-port', '9232', ...common,
    '--var', 'PIXEL_ORIGIN:http://127.0.0.1:8788'], options),
  spawn('pnpm', ['exec', 'vite'], options),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
