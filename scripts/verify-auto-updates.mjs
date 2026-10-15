// Built-extension checks. The extension-tab fixture models a visible side panel;
// only the local fixture host is pre-granted. Native missing access is tested too.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as portServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { localFixtureExtension } from "./extension-fixture.mjs";

const delay = ms => new Promise(done => setTimeout(done, ms));
async function until(check, message, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await check(); if (result) return result; await delay(100); }
  throw new Error(message);
}
class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url); this.next = 0; this.pending = new Map();
    this.socket.addEventListener("message", event => {
      const value = JSON.parse(event.data), entry = this.pending.get(value.id);
      if (!entry) return;
      this.pending.delete(value.id); clearTimeout(entry.timer);
      value.error ? entry.reject(Error(value.error.message)) : entry.done(value.result);
    });
  }
  async ready() { if (this.socket.readyState !== WebSocket.OPEN) await new Promise(done => this.socket.addEventListener("open", done, { once: true })); }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((done, reject) => {
      this.pending.set(id, { done, reject, timer: setTimeout(() => reject(Error(`${method} timed out`)), 25_000) });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, userGesture = false) {
    const value = await this.send("Runtime.evaluate", { expression, userGesture, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
    return value.result.value;
  }
  close() { for (const entry of this.pending.values()) clearTimeout(entry.timer); this.socket.close(); }
}
const sharp = createRequire(createRequire(import.meta.url).resolve("next/package.json", { paths: [resolve("apps/web")] }))("sharp");
const png = await sharp({ create: { width: 200, height: 140, channels: 3, background: "#0b57d0" } }).png().toBuffer();
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path.endsWith(".png")) { response.writeHead(200, { "Content-Type": "image/png" }).end(png); return; }
  if (path === "/favicon.svg") { response.writeHead(200, { "Content-Type": "image/svg+xml" }).end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#0b57d0"/></svg>'); return; }
  response.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>${path === "/frame" ? "Frame" : "Auto gallery"}</title><link rel="icon" href="/favicon.svg"><div id="shadow-host"></div>${path === "/frame" ? '<img src="/frame.png" alt="Frame image" width="200" height="140">' : Array.from({ length: 12 }, (_, i) => `<img id="image-${i}" src="/image-${i}.png" alt="Image ${i}" width="200" height="140">`).join("")}`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const debugPort = await new Promise(done => { const s = portServer(); s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => done(port)); }); });
const profile = await mkdtemp(join(tmpdir(), "allhere-auto-"));
const extension = await localFixtureExtension(profile);
const browser = spawn(process.env.ALLHERE_BROWSER_PATH ?? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
let controller, panel, source, other;
async function connectTarget(targetId) {
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item => item.id === targetId), "Target did not open");
  const client = new Cdp(target.webSocketDebuggerUrl); await client.ready(); return client;
}
try {
  const version = await until(async () => { try { return await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { return null; } }, "Browser did not start");
  controller = new Cdp(version.webSocketDebuggerUrl); await controller.ready();
  const worker = await until(async () => (await controller.send("Target.getTargets")).targetInfos.find(item => item.url.endsWith("service-worker.js")), "Extension did not start");
  const { targetId } = await controller.send("Target.createTarget", { url: `chrome-extension://${new URL(worker.url).hostname}/index.html` });
  panel = await connectTarget(targetId);
  const modelPanel = `(()=>{if(window.__autoModelInstalled||!globalThis.chrome?.scripting?.executeScript)return;
    window.__panelVisibility='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__panelVisibility});
    window.__captureCount=0;window.__activeCaptures=0;window.__maxCaptures=0;window.__permissionRequests=0;
    const script=chrome.scripting.executeScript.bind(chrome.scripting);chrome.scripting.executeScript=async options=>{
      if(!options.func)return script(options);
      window.__captureCount++;window.__activeCaptures++;window.__maxCaptures=Math.max(window.__maxCaptures,window.__activeCaptures);
      try {const result=await script(options);if(window.__holdNext){window.__holdNext=false;await new Promise(resolve=>window.__releaseAuto=resolve);}return result;}
      finally{window.__activeCaptures--;}
    };const permission=chrome.permissions.request.bind(chrome.permissions);chrome.permissions.request=options=>{window.__permissionRequests++;return permission(options);};window.__autoModelInstalled=true;})();`;
  await panel.send("Page.enable");
  await panel.send("Page.addScriptToEvaluateOnNewDocument", { source: modelPanel });
  await panel.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
  await panel.send("Page.reload");
  await until(() => panel.evaluate("document.querySelector('.button--scan')?.disabled===false"), "Panel did not load");
  await panel.evaluate(modelPanel);
  await panel.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  const sourceId = (await controller.send("Target.createTarget", { url: base + "/gallery" })).targetId;
  source = await connectTarget(sourceId); await source.send("Page.bringToFront");
  await until(() => panel.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>tab?.url===${JSON.stringify(base + "/gallery")}&&tab.status==='complete')`), "Source did not load");
  const read = () => panel.evaluate("chrome.storage.local.get('allhere.library.v1').then(data=>data['allhere.library.v1']||[])");
  const current = async (url = base + "/gallery") => (await read()).find(page => page.pageUrl === url);
  const count = () => panel.evaluate("window.__captureCount");
  const state = () => panel.evaluate("document.querySelector('.auto-updates')?.dataset.autoState");
  const click = selector => panel.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`, true);
  const menu = async label => {
    await click(".library-menu__trigger");
    await until(() => panel.evaluate("Boolean(document.querySelector('.library-menu__panel'))"), "Library menu did not open");
    await panel.evaluate(`[...document.querySelectorAll('.library-menu__item')].find(button=>button.textContent.trim().startsWith(${JSON.stringify(label)})).click()`, true);
  };
  const add = (name, client = source) => client.evaluate(`(()=>{const image=new Image();image.src='/${name}.png';image.alt=${JSON.stringify(name)};image.width=200;image.height=140;document.body.append(image);})()`);
  const contains = async (name, url) => (await current(url))?.resources.some(resource => resource.url.endsWith(`/${name}.png`));
  const waitResource = (name, url) => until(() => contains(name, url), `Automatic update missed ${name}`);
  const manual = async () => {
    await until(() => panel.evaluate("document.querySelector('.button--scan')?.disabled===false&&window.__activeCaptures===0"), "Scan is still busy");
    await click(".button--scan");
    await until(async () => (await state()) === "on", "Manual scan did not authorize automatic updates");
  };
  const record = async name => {
    await mkdir(resolve('.impeccable/review'), { recursive: true });
    // Model a native side panel while foregrounding its extension-tab fixture
    // for compositor capture. Functional checks use the actual tab afterwards.
    await panel.evaluate("(async()=>{window.__shotQuery=chrome.tabs.query.bind(chrome.tabs);const tabs=await window.__shotQuery({active:true,currentWindow:true});chrome.tabs.query=options=>options.active?Promise.resolve(tabs):window.__shotQuery(options);})()");
    try {
      await panel.send('Page.bringToFront');
      for (const width of [320,390,720]) {
        await panel.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
        await panel.evaluate('window.scrollTo(0,0)');
        const bounds=await panel.evaluate("(()=>{const header=document.querySelector('.topbar').getBoundingClientRect(),menu=document.querySelector('.library-menu__trigger').getBoundingClientRect();return {fits:document.documentElement.scrollWidth<=innerWidth,height:header.height,edge:Math.abs(header.right-menu.right)}})()");
        assert.ok(bounds.fits&&bounds.height<=128&&bounds.edge<=1,`Header overflow at ${width}: ${JSON.stringify(bounds)}`);
        const shot=await panel.send('Page.captureScreenshot',{format:'png'});
        await writeFile(resolve(`.impeccable/review/auto-${name}-${width}.png`),Buffer.from(shot.data,'base64'));
      }
    } finally {
      await source.send('Page.bringToFront');
      await panel.evaluate('chrome.tabs.query=window.__shotQuery;delete window.__shotQuery');
      await panel.send('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:1,mobile:false});
    }
  };
  await delay(1800);
  assert.equal(await count(), 0, "Opening the panel or a tab must not scan it");
  assert.equal(await state(), "manual");
  assert.match(await panel.evaluate("document.querySelector('.auto-updates').textContent"), /also keeps this tab updated/, "Consent must be explained before Scan page");
  await record('disclosure');
  await manual();
  await until(async () => (await current())?.resources.length >= 12, "First manual capture did not save");
  await record('on');
  await click('.auto-updates__toggle');
  await record('paused');
  await click('.auto-updates__toggle');
  const first = (await current()).resources.find(resource => resource.url.endsWith("/image-0.png"));
  await panel.evaluate(`chrome.storage.local.get('allhere.library.v1').then(data=>{data['allhere.library.v1'][0].resources.find(resource=>resource.id===${JSON.stringify(first.id)}).saved=true;return chrome.storage.local.set(data);})`);
  await click('[data-resource-tab="images"]'); await click('[aria-label="List view"]');
  await panel.evaluate("window.scrollTo(0,160)");
  const scroll = await panel.evaluate("window.scrollY");
  await add("automatic-image"); await waitResource("automatic-image");
  const retained = (await current()).resources.find(resource => resource.id === first.id);
  assert.ok(retained?.saved, "Automatic refresh must retain bookmarks and resource IDs");
  assert.equal(await panel.evaluate("document.querySelector('[aria-selected=true][data-resource-tab]').dataset.resourceTab"), "images");
  assert.equal(await panel.evaluate("document.querySelector('[aria-label=\"List view\"]').getAttribute('aria-pressed')"), "true");
  assert.equal(await panel.evaluate("window.scrollY"), scroll, "Automatic refresh must preserve scroll");
  await source.evaluate("const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='live-svg';svg.setAttribute('aria-label','Dynamic icon');svg.setAttribute('width','24');svg.setAttribute('height','24');svg.innerHTML='<path d=\"M0 0h12v12H0z\"/>';document.body.append(svg)");
  const iconBefore = await until(async () => (await current())?.resources.find(resource => resource.label === 'Dynamic icon'), 'Dynamic SVG was not collected');
  await source.evaluate("document.querySelector('#live-svg path').setAttribute('d','M0 0h20v20H0z')");
  await until(async () => (await current())?.resources.some(resource => resource.label === 'Dynamic icon' && resource.url !== iconBefore.url), 'SVG attribute updates were not collected');
  await source.evaluate("const root=document.querySelector('#shadow-host').attachShadow({mode:'open'});root.innerHTML='<img src=\"/shadow-auto.png\" alt=\"Shadow auto\" width=\"200\" height=\"140\">'");
  await waitResource("shadow-auto");
  await source.evaluate("const frame=document.createElement('iframe');frame.src='/frame';document.body.append(frame)");
  await waitResource("frame");
  await source.evaluate("const image=new Image();image.src='/frame-later.png';image.alt='Frame later';image.width=200;image.height=140;document.querySelector('iframe').contentDocument.body.append(image)");
  await waitResource("frame-later");

  await panel.evaluate("window.__holdNext=true"); await add("manual-overlap");
  await until(() => panel.evaluate("typeof window.__releaseAuto==='function'"), "Overlap checkpoint did not start");
  const overlapCount = await count();
  await click(".button--scan"); await delay(300);
  assert.equal(await count(), overlapCount, "Manual scans must wait for an automatic capture to finish");
  await panel.evaluate("window.__releaseAuto();delete window.__releaseAuto");
  await waitResource("manual-overlap");
  await until(() => panel.evaluate("document.querySelector('.button--scan').disabled===false"), "Manual scan remained busy");

  await panel.evaluate("window.__holdNext=true"); await add("pending-auto");
  await until(() => panel.evaluate("typeof window.__releaseAuto==='function'"), "Automatic capture did not reach checkpoint");
  const beforePause = await read();
  await click(".auto-updates__toggle");
  await panel.evaluate("window.__releaseAuto();delete window.__releaseAuto");
  await delay(1600);
  assert.deepEqual(await read(), beforePause, "Pausing must discard an unfinished automatic capture");
  const pausedCount = await count(); await add("paused-image"); await delay(2200);
  assert.equal(await count(), pausedCount, "Paused pages must not be scanned");
  await click(".button--scan");
  await until(() => contains("paused-image"), "Manual refresh while paused failed");
  assert.equal(await state(), "paused", "Manual refresh must preserve the user's pause choice");
  await click(".auto-updates__toggle"); await waitResource("pending-auto");
  await panel.evaluate("window.__panelVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'))"); await delay(300);
  const hiddenCount = await count(); await add("hidden-image"); await delay(2200);
  assert.equal(await count(), hiddenCount, "Hidden panels must not start captures");
  assert.ok(!await contains("hidden-image"));
  await panel.evaluate("window.__panelVisibility='visible';document.dispatchEvent(new Event('visibilitychange'))");
  await until(async () => await state() === "manual", "A retained panel document must not preserve consent after hiding");
  assert.equal(await panel.evaluate("document.querySelector('.button--scan').dataset.scanState"), "needed", "Showing the panel again must indicate that a manual scan is needed");
  await delay(1200); assert.ok(!await contains("hidden-image"), "Showing a hidden panel must not restart scanning");
  await manual();
  await waitResource("hidden-image");

  const otherUrl = base + "/gallery?second=1";
  other = await connectTarget((await controller.send("Target.createTarget", { url: otherUrl })).targetId);
  await other.send("Page.bringToFront"); await until(async () => await state() === "manual", "A new tab inherited authorization");
  const inactiveCount = await count(); await add("inactive-image"); await delay(2200);
  assert.equal(await count(), inactiveCount, "Inactive tabs must not scan");
  assert.equal(await current(otherUrl), undefined, "Host permission alone must not authorize another tab");
  await manual(); await add("second-auto", other); await waitResource("second-auto", otherUrl);
  await source.send("Page.bringToFront"); await waitResource("inactive-image");
  const nextUrl = base + "/gallery?next=1";
  await source.send("Page.navigate", { url: nextUrl });
  await until(async () => Boolean(await current(nextUrl)), "Same-origin navigation did not update the authorized tab");

  await menu("Manage");
  await until(() => panel.evaluate("Boolean(document.querySelector('.library-manager'))"), "Manage did not open");
  const manageCount = await count(); await add("manage-image"); await delay(2200);
  assert.equal(await count(), manageCount, "Manage must suspend automatic capture");
  await click('[aria-label="Manage items from Auto gallery"]');
  await click('[aria-label="Delete Image 0"]');
  await until(async () => !(await current(nextUrl)).resources.some(resource => resource.url.endsWith("/image-0.png")), "Item deletion failed");
  await menu("All resources");
  await waitResource("manage-image", nextUrl);
  assert.ok(!(await current(nextUrl)).resources.some(resource => resource.url.endsWith("/image-0.png")), "Automatic updates restored a deleted item");
  await menu("Manage");
  await click('[aria-label="Delete page Auto gallery"]');
  await until(async () => !await current(nextUrl), "Page deletion failed");
  await menu("All resources");
  const deletedCount = await count(); await add("after-delete"); await delay(2200);
  assert.equal(await count(), deletedCount, "Deleted pages must hold automatic updates");
  assert.equal(await current(nextUrl), undefined, "An automatic update restored a deleted page");
  await manual(); await waitResource("after-delete", nextUrl);

  await other.send('Page.bringToFront');
  await until(async()=>await state()==='on','The second authorized tab did not resume');
  await source.send('Page.navigate',{url:base.replace('127.0.0.1','localhost')+'/gallery?background=1'});
  await until(()=>source.evaluate("document.readyState==='complete'&&location.hostname==='localhost'"),'Background navigation did not finish');
  await source.send('Page.navigate',{url:nextUrl});
  await until(()=>source.evaluate("document.readyState==='complete'&&location.hostname==='127.0.0.1'"),'Background return did not finish');
  await add('after-background-origin');
  await source.send('Page.bringToFront');
  await until(async()=>await state()==='manual','An origin change in an inactive tab must end its authorization');
  await delay(1800);
  assert.ok(!await contains('after-background-origin',nextUrl),'A file-host grant must not restore expired consent');
  await manual(); await waitResource('after-background-origin',nextUrl);

  const beforeForeign = await count();
  await source.send("Page.navigate", { url: base.replace("127.0.0.1", "localhost") + "/gallery" });
  await until(async () => await state() === "manual", "Cross-origin navigation must end consent");
  await delay(1800); assert.equal(await count(), beforeForeign, "An ungranted origin must not scan");
  await source.send("Page.navigate", { url: nextUrl });
  await delay(2200); assert.equal(await state(), "manual", "Returning to a previously accessible host must not restore consent");
  assert.equal(await count(), beforeForeign);
  await manual();

  await click(".auto-updates__toggle");
  await panel.evaluate("window.__holdNext=true");
  await click(".button--scan");
  await until(() => panel.evaluate("typeof window.__releaseAuto==='function'"), "Manual scan did not reach the panel-session checkpoint");
  await panel.evaluate("window.__panelVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'));window.__panelVisibility='visible';document.dispatchEvent(new Event('visibilitychange'))");
  await panel.evaluate("window.__releaseAuto();delete window.__releaseAuto");
  await until(() => panel.evaluate("document.querySelector('.button--scan').disabled===false"), "Pending manual scan did not finish");
  assert.equal(await state(), "manual", "An old manual scan must not reauthorize a panel session that ended while it was pending");
  assert.equal(await panel.evaluate("document.querySelector('.button--scan').dataset.scanState"), "needed", "An old scan must not restore the fresh-scan indicator after panel hide");
  const endedSessionCount = await count();
  await add("after-ended-session"); await delay(2200);
  assert.equal(await count(), endedSessionCount, "A scan from an ended panel session must not restart automatic capture");
  await manual(); await waitResource("after-ended-session", nextUrl);
  assert.ok(await panel.evaluate("window.__maxCaptures<=1"), "Automatic captures must not overlap");
  assert.equal(await panel.evaluate("window.__permissionRequests"), 0, "Automatic updates must never request site access");
  const beforeReopen = await read();
  await panel.send("Page.reload");
  await until(() => panel.evaluate("document.querySelector('.button--scan')?.disabled===false"), "Panel did not reopen");
  await panel.evaluate(modelPanel);
  await delay(1800); assert.equal(await count(), 0, "Reopening the panel must require a new manual scan");
  assert.equal(await state(), "manual");
  assert.deepEqual(await read(), beforeReopen, "Reopening the panel must not change the stored collection");
  assert.equal(await panel.evaluate("window.__permissionRequests"), 0);
  const manifest = await panel.evaluate("chrome.runtime.getManifest()");
  assert.ok(!manifest.permissions.includes("tabs"), "Automatic updates must not add broad tab access");
  console.log("PASS automatic updates: first-scan consent per tab/origin; dynamic images, shadow roots and frames; Pause/Resume; stale results discarded; hidden/inactive tabs; same-origin navigation; cross-origin access loss; management exclusions; session reset; zero permission prompts.");
} finally {
  try { await controller?.send("Browser.close"); } catch { /* Already closed. */ }
  for (const client of [panel, source, other, controller]) client?.close();
  browser.kill(); server.closeAllConnections(); server.close();
}
