/* ===========================================================================
   Launcher that makes Node's fetch respect the environment's proxy.

   Node's built-in fetch (undici) ignores HTTPS_PROXY unless it is told to
   read it. Behind a proxying network that is not a slow path or a warning —
   the request leaves by a different route entirely and is refused, so every
   market feed reports itself down while curl on the same box succeeds. The
   failure looks exactly like a bad API key, which is what makes it expensive.

   `--use-env-proxy` (Node >= 22.21) installs the proxy-aware dispatcher. It
   has to be set before Node boots, so it cannot live in .env.local; hence
   this wrapper, which every npm script goes through.

   It is a no-op when no proxy is configured, so nothing changes on a normal
   machine. Cross-platform: no shell-specific env syntax.

   Usage:  node scripts/run.mjs <command> [args...]
   ========================================================================= */

import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);

// `--env KEY=VALUE` pairs, consumed before the command. Lets package.json set
// variables without shell-specific syntax that breaks on Windows.
const overrides = [];
while (argv[0] === '--env') {
  argv.shift();
  const pair = argv.shift();
  if (pair) overrides.push(pair);
}

const [command, ...args] = argv;

if (!command) {
  console.error('usage: node scripts/run.mjs <command> [args...]');
  process.exit(2);
}

const env = { ...process.env };

for (const pair of overrides) {
  const eq = pair.indexOf('=');
  if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
}

const proxy = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
if (proxy) {
  const existing = env.NODE_OPTIONS ?? '';
  if (!existing.includes('--use-env-proxy')) {
    env.NODE_OPTIONS = `${existing} --use-env-proxy`.trim();
  }
  // The experimental warning fires on every worker Next spawns; the setting
  // is deliberate, so the noise is not useful.
  env.NODE_NO_WARNINGS = env.NODE_NO_WARNINGS ?? '1';
}

const child = spawn(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (err) => {
  console.error(`failed to launch ${command}:`, err.message);
  process.exit(1);
});
