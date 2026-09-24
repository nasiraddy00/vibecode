#!/usr/bin/env node
/* ===========================================================================
   Builds the single-file browser edition of the terminal.

   The whole engine — indicators, signals, options pricing, backtest metrics —
   is pure TypeScript with no server dependency once the data source is the
   simulator, so it compiles straight to a self-contained page: JS and CSS
   inlined, no external requests except the Google Fonts stylesheet.
   ========================================================================= */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist-standalone');
mkdirSync(out, { recursive: true });

// --- 1. bundle the app ------------------------------------------------------
// next/link and next/navigation are aliased to hash-routing shims; there is no
// Next runtime in this build.
const result = await build({
  entryPoints: [resolve(root, 'src/standalone/main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  jsx: 'automatic',
  write: false,
  loader: { '.json': 'json' },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.MERIDIAN_OFFLINE': '"1"',
    // No server to stream from, and the artifact sandbox blocks WebSockets.
    'process.env.MERIDIAN_STANDALONE': '"1"',
    'process.env.MERIDIAN_CACHE_TTL': '"45"',
    'process.env.SEC_USER_AGENT': 'undefined',
    'process.env.FINNHUB_API_KEY': 'undefined',
    'process.env.COINGECKO_API_KEY': 'undefined',
  },
  alias: {
    'next/link': resolve(root, 'src/standalone/nextlink.tsx'),
    'next/navigation': resolve(root, 'src/standalone/nextnav.tsx'),
  },
  logLevel: 'warning',
});

const js = result.outputFiles[0].text;

// --- 2. compile the stylesheet ----------------------------------------------
execSync(
  `npx @tailwindcss/cli -i ${resolve(root, 'src/app/globals.css')} -o ${resolve(out, 'app.css')} --minify`,
  { cwd: root, stdio: 'inherit' },
);
const css = readFileSync(resolve(out, 'app.css'), 'utf8');

// --- 3. inline into one page --------------------------------------------------
const html = `<title>Meridian Terminal</title>
<meta name="description" content="Day-trading signal terminal: multi-factor technical, fundamental, flow and volatility analysis with explicit data provenance.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`;

const target = resolve(out, 'meridian-terminal.html');
writeFileSync(target, html);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`\nJS   ${kb(js.length)}`);
console.log(`CSS  ${kb(css.length)}`);
console.log(`HTML ${kb(html.length)}  →  ${target}\n`);
