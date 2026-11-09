// Layout check: opens every tab of the live dashboard in headless Chrome at phone and
// desktop sizes, checks the nav and page geometry, and saves a screenshot of each.
// Exits 1 if any check fails. Normally started by run.sh, which mints the token.
//
// usage: node check-layout.mjs <tokenFile> <outDir>
//   SMARTHOME_HOST (required), CHROME (optional binary path)
// Needs Node 22+ (built-in WebSocket and fetch).
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const [tokFile, out] = process.argv.slice(2);
const HOST = process.env.SMARTHOME_HOST;
if (!tokFile || !out || !HOST) {
  console.error('usage: SMARTHOME_HOST=... node check-layout.mjs <tokenFile> <outDir>');
  process.exit(2);
}
const token = readFileSync(tokFile, 'utf8').trim();
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9339;
const VIEWPORTS = [
  { name: 'phone-360', width: 360, height: 740, mobile: true },
  { name: 'phone-390', width: 390, height: 844, mobile: true },
  { name: 'desktop', width: 1280, height: 800, mobile: false },
];
const TABS = ['Home', 'Agent', 'Rooms', 'Routines', 'Settings'];

const profile = join(out, 'chrome-profile');
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch { /* Chrome not up yet */ }
}
if (!wsUrl) { console.error('Chrome did not start'); chrome.kill(); process.exit(2); }

const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((r) => {
  const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

// Runs in the page. Returns the geometry the checks below need.
const MEASURE = `(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const nav = document.querySelector('nav');
  const main = document.querySelector('main');
  const fabBtn = [...document.querySelectorAll('main button')].find((b) => /Add device|Pairing/i.test(b.innerText));
  // Elements that stick out past the right edge, unless a sideways scroller holds them on purpose.
  const overflow = [];
  for (const el of document.querySelectorAll('main *, nav *')) {
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0 || b.right <= innerWidth + 1) continue;
    let p = el.parentElement, scrolled = false;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') { scrolled = true; break; }
      p = p.parentElement;
    }
    if (scrolled) continue;
    const label = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
    overflow.push(label + ' right=' + Math.round(b.right));
    if (overflow.length >= 5) break;
  }
  return {
    vw: innerWidth, vh: innerHeight,
    docScrollW: document.documentElement.scrollWidth,
    nav: nav && r(nav), main: main && r(main), fab: fabBtn ? r(fabBtn) : null,
    tabs: nav ? [...nav.querySelectorAll('button')].map((b) => ({ text: b.innerText.trim(), ...r(b) })) : [],
    overflow,
  };
})()`;

const failures = [];
const fail = (where, msg) => { failures.push(`${where}: ${msg}`); };
const overlaps = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

function check(where, g, vp, tab) {
  if (!g.nav) return fail(where, 'no <nav>');
  if (!g.main) return fail(where, 'no <main>');
  if (g.docScrollW > g.vw + 1) fail(where, `page scrolls sideways (scrollWidth ${g.docScrollW} > ${g.vw})`);
  if (vp.mobile) {
    if (Math.abs(g.nav.b - g.vh) > 1) fail(where, `bottom nav not pinned (nav bottom ${Math.round(g.nav.b)}, viewport ${g.vh})`);
    if (g.main.b > g.nav.t + 1) fail(where, `main runs under the nav (main bottom ${Math.round(g.main.b)}, nav top ${Math.round(g.nav.t)})`);
  } else if (Math.abs(g.nav.h - g.vh) > 1) {
    fail(where, `sidebar is not full height (${Math.round(g.nav.h)} of ${g.vh})`);
  }
  for (const t of TABS) {
    const b = g.tabs.find((x) => x.text.includes(t));
    if (!b) { fail(where, `nav tab "${t}" missing`); continue; }
    if (b.l < -1 || b.r > g.vw + 1 || b.t < -1 || b.b > g.vh + 1) fail(where, `nav tab "${t}" is off-screen`);
  }
  if (tab === 'Home' && g.fab && overlaps(g.fab, g.nav)) fail(where, 'Add Device button covers the nav');
  for (const o of g.overflow) fail(where, `sticks out past the right edge: ${o}`);
}

try {
  await send('Network.enable');
  await send('Network.setCookie', { name: 'access_token', value: token, domain: HOST, path: '/', secure: true, httpOnly: true });
  await send('Page.enable');

  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.mobile ? 2 : 1, mobile: vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile, maxTouchPoints: vp.mobile ? 5 : 1 });
    await send('Page.navigate', { url: `https://${HOST}:8000/` });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {  // up to 30 s: the bundle comes over Tailscale
      ready = await evaluate(`!!document.querySelector('nav')`);
      if (!ready) await sleep(500);
    }
    if (!ready) { fail(vp.name, 'dashboard never rendered (token rejected or site down?)'); continue; }
    await sleep(1500);  // first device fetch

    for (const tab of TABS) {
      const where = `${vp.name}/${tab}`;
      const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find((b) => b.innerText.trim().includes(${JSON.stringify(tab)})); if (!b) return false; b.click(); return true; })()`);
      if (!clicked) { fail(where, 'could not click the tab'); continue; }
      await sleep(1200);
      check(where, await evaluate(MEASURE), vp, tab);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(out, `${vp.name}-${tab.toLowerCase()}.png`), Buffer.from(shot.result.data, 'base64'));
    }
  }
} finally {
  ws.close();
  chrome.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still holds a lock */ }
}

console.log(`screenshots: ${out}`);
if (failures.length) {
  console.log(`FAIL (${failures.length})`);
  for (const f of failures) console.log('  ' + f);
  process.exit(1);
}
console.log(`PASS: ${VIEWPORTS.length} viewports x ${TABS.length} tabs`);
