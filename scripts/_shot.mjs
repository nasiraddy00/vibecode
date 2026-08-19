import { chromium } from 'playwright';
const [,, url, out, w, h, full] = process.argv;

// The session's HTTPS_PROXY leaks into Chromium and breaks even localhost
// fetches, so the browser is launched with proxy resolution disabled entirely.
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-proxy-server', '--disable-features=NetworkService'],
  env: { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '' },
});
const p = await b.newPage({ viewport: { width: Number(w||1600), height: Number(h||1000) }, deviceScaleFactor: 2 });
// External font hosts are unreachable under this egress policy; abort them so
// the page does not wait on a request that can never resolve.
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('requestfailed', r => { const u = r.url(); if (!/fonts\.(googleapis|gstatic)/.test(u)) errs.push('REQFAIL: ' + u.slice(0,110) + ' → ' + r.failure()?.errorText); });
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(2500);
await p.screenshot({ path: out, fullPage: full === 'full' });
console.log(errs.length ? errs.slice(0,6).join('\n') : 'clean');
await b.close();
