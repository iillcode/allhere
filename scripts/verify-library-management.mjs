// Exercise the built extension in isolated Brave storage, including manual scans.
// Run after building: node scripts/verify-library-management.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as portServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { localFixtureExtension } from "./extension-fixture.mjs";

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(check, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(100); }
  throw new Error(message);
}
class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url); this.id = 0; this.pending = new Map(); this.errors = [];
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Runtime.exceptionThrown") this.errors.push(message.params);
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id); clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
    });
  }
  async ready() {
    if (this.socket.readyState !== WebSocket.OPEN) await new Promise((done, reject) => {
      this.socket.addEventListener("open", done, { once: true }); this.socket.addEventListener("error", reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30_000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

const extension = fileURLToPath(new URL("../apps/extension/out", import.meta.url));
const fontName = (await readdir(join(extension, "assets"))).find((name) => /roboto-latin-400.*\.woff2$/.test(name));
const font = await readFile(join(extension, "assets", fontName));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#d3e3fd"/><circle cx="80" cy="80" r="42" fill="#0b57d0"/></svg>';
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/missing-icon.svg") { response.writeHead(404).end(); return; }
  if (path === "/favicon-a.svg" || path === "/favicon.ico") {
    response.writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "same-origin" });
    response.end(path === "/favicon.ico" ? svg.replaceAll("#0b57d0", "#6941c6") : svg);
    return;
  }
  if (path === "/a" || path === "/b") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><title>${path === "/a" ? "Research resources" : "Another captured page"}</title><img src="/saved-image.svg" alt="Saved image"><img src="/unsaved-image.svg" alt="Unsaved image"><div id="updates"></div>`);
  } else if (path === "/font.woff2") { response.writeHead(200, { "Content-Type": "font/woff2" }); response.end(font); }
  else if (path.endsWith(".svg")) { response.writeHead(200, { "Content-Type": "image/svg+xml" }); response.end(svg); }
  else { response.writeHead(200, { "Content-Type": "text/plain" }); response.end("Fixture resource"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const debugPort = await new Promise((done) => { const socket = portServer(); socket.listen(0, "127.0.0.1", () => { const port = socket.address().port; socket.close(() => done(port)); }); });
const profile = await mkdtemp(join(tmpdir(), "stashwell-management-"));
const installedExtension = await localFixtureExtension(profile);
const browser = spawn(process.env.STASHWELL_BROWSER_PATH ?? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, "--headless=new", "--no-first-run", "--no-default-browser-check",
  `--disable-extensions-except=${installedExtension}`, `--load-extension=${installedExtension}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
let browserCdp, panel, source, web;
const capturedAt = new Date().toISOString();
const kinds = ["image", "icon", "font", "video", "audio", "link", "document"];
const extensions = { image: "svg", icon: "svg", font: "woff2", video: "mp4", audio: "mp3", link: "html", document: "pdf" };
const capture = {
  id: "research", pageUrl: base + "/a", pageTitle: "Research resources", hostname: "127.0.0.1", capturedAt, faviconUrl: base + "/favicon-a.svg",
  resources: kinds.flatMap((kind) => [true, false].map((saved) => ({
    id: `${saved ? "saved" : "unsaved"}-${kind}`, kind, saved: saved || undefined,
    label: `${saved ? "Saved" : "Unsaved"} ${kind}`, url: kind === "font" && saved ? base + "/font.woff2" : `${base}/${saved ? "saved" : "unsaved"}-${kind}.${extensions[kind]}`,
    pageUrl: base + "/a", pageTitle: "Research resources", capturedAt,
    security: { transport: "http", relation: "same-host", hostname: "127.0.0.1", signals: [], checkedAt: capturedAt, method: "local-heuristics" },
  }))),
};
const other = { ...capture, id: "another", pageUrl: base + "/b", pageTitle: "Another captured page", faviconUrl: undefined, resources: [
  { ...capture.resources[0], id: "other-saved-image", label: "Saved second image", url: base + "/second-image.svg", pageUrl: base + "/b" },
  { ...capture.resources[1], id: "other-unsaved-image", label: "Unsaved second image", url: base + "/second-unsaved.svg", pageUrl: base + "/b" },
] };

try {
  const version = await until(async () => { try { return await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { return null; } }, "Brave did not start");
  browserCdp = new Cdp(version.webSocketDebuggerUrl); await browserCdp.ready();
  const worker = await until(async () => (await browserCdp.send("Target.getTargets")).targetInfos.find((target) => /^chrome-extension:/.test(target.url) && target.url.endsWith("service-worker.js")), "Built extension did not load");
  async function openPage(url, background = false) {
    const { targetId } = await browserCdp.send("Target.createTarget", { url, background });
    const target = await until(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((target) => target.id === targetId && target.webSocketDebuggerUrl), "Browser target did not open");
    const client = new Cdp(target.webSocketDebuggerUrl); await client.ready(); await client.send("Runtime.enable");
    return client;
  }
  panel = await openPage(`chrome-extension://${new URL(worker.url).hostname}/index.html`);
  await until(() => panel.evaluate("Boolean(document.querySelector('.stashwell-shell'))"), "Library did not render");
  await panel.evaluate("window.__faviconPermissionRequests=0;const permission=chrome.permissions.request.bind(chrome.permissions);chrome.permissions.request=options=>{window.__faviconPermissionRequests++;return permission(options);}");
  await panel.evaluate(`chrome.storage.local.set({'allhere.library.v1': ${JSON.stringify([capture, other])}, 'allhere.capture-exclusions.v1': {pages:[],resources:{}}})`);
  await until(() => panel.evaluate("Boolean(document.querySelector('.resource-album'))"), "Fixture library did not render");
  const click = (selector) => panel.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const menu = async (name) => {
    if (!await panel.evaluate("Boolean(document.querySelector('.library-menu__panel'))")) await click(".library-menu__trigger");
    await panel.evaluate(`[...document.querySelectorAll('.library-menu__item')].find(button => button.querySelector('span').textContent === ${JSON.stringify(name)}).click()`);
  };
  const tab = (name) => panel.evaluate(`[...document.querySelectorAll('.category-pill')].find(button => button.textContent.startsWith(${JSON.stringify(name)})).click()`);
  const read = () => panel.evaluate("chrome.storage.local.get(['allhere.library.v1','allhere.capture-exclusions.v1'])");
  const waitIcon = async (client, label, url) => {
    const selector = `[aria-label="Manage items from ${label}"] .library-manager__page-mark img`;
    await until(() => client.evaluate(`(()=>{const image=document.querySelector(${JSON.stringify(selector)});return image?.dataset.faviconUrl===${JSON.stringify(url)}&&image.complete&&image.naturalWidth>0;})()`), `Manage did not display the site logo for ${label}`);
  };
  const checkPageIcons = async client => {
    await waitIcon(client, capture.pageTitle, capture.faviconUrl);
    await waitIcon(client, other.pageTitle, base + "/favicon.ico");
  };
  async function shot(name, width) {
    await panel.send("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: false });
    await panel.evaluate("scrollTo(0,0)"); await delay(150);
    assert.ok(await panel.evaluate("document.documentElement.scrollWidth <= innerWidth"), `${name}: horizontal overflow`);
    const alignment = await panel.evaluate("(() => { const menu=document.querySelector('.library-menu__trigger').getBoundingClientRect(), scan=document.querySelector('.button--scan').getBoundingClientRect(); return {menuRight:menu.right,menuLeft:menu.left,scanRight:scan.right,width:document.documentElement.clientWidth}; })()");
    assert.ok(alignment.menuRight <= alignment.width && alignment.menuLeft >= alignment.scanRight && alignment.width-alignment.menuRight <= 15, `${name}: menu must follow the scan button at the far right: ${JSON.stringify(alignment)}`);
    if (process.env.STASHWELL_SKIP_EXTENSION_SHOTS === "1") return;
    await mkdir(resolve(".impeccable/review"), { recursive: true });
    const { data } = await panel.send("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(`.impeccable/review/${name}.png`), Buffer.from(data, "base64"));
  }

  await menu("Saved items");
  for (const [name, count] of [["Images", 2], ["Icons", 1], ["Fonts", 1], ["Video & audio", 2], ["Links", 1], ["Files", 1]]) {
    await tab(name);
    await until(() => panel.evaluate(`document.querySelectorAll('.resource-card, .resource-table tbody tr').length === ${count}`), `${name} did not retain saved-only filtering`);
    assert.ok(await panel.evaluate("[...document.querySelectorAll('.resource-card, .table-name')].every(item => (item.getAttribute('aria-label') || item.querySelector('strong').textContent).startsWith('Saved'))"), `${name} leaked unsaved resources`);
  }
  await click(".page-scope__trigger");
  await panel.evaluate("[...document.querySelectorAll('.page-scope__option')].find(button=>button.textContent.includes('Research resources')).click()");
  await tab("Images");
  await until(() => panel.evaluate("document.querySelectorAll('.resource-card').length === 1"), "Saved source filtering showed unsaved images");
  assert.equal(await panel.evaluate("document.querySelector('.page-scope__count').textContent"), "7", "Saved source count included unsaved items");
  await menu("Saved items");
  await tab("All saved");
  assert.equal(await panel.evaluate("document.querySelector('.collection-meta').textContent.trim()"), "8 resources");
  await shot("saved-320", 320); await shot("saved-390", 390);
  await menu("Manage");
  await until(() => panel.evaluate("Boolean(document.querySelector('.library-manager'))"), "Manage view did not open");
  await checkPageIcons(panel);
  const setOtherIcon = async faviconUrl => {
    const stored = await read();
    stored['allhere.library.v1'].find(page => page.id === other.id).faviconUrl = faviconUrl;
    await panel.evaluate(`chrome.storage.local.set(${JSON.stringify(stored)})`);
  };
  await setOtherIcon(base + "/missing-icon.svg");
  const otherMark = `[aria-label="Manage items from ${other.pageTitle}"] .library-manager__page-mark`;
  await until(() => panel.evaluate(`(()=>{const mark=document.querySelector(${JSON.stringify(otherMark)});return !!mark?.querySelector('svg')&&!mark.querySelector('img');})()`), "Missing site icons must use a globe without a broken image");
  await setOtherIcon("javascript:window.__invalidFaviconExecuted=true");
  await until(() => panel.evaluate(`Boolean(document.querySelector(${JSON.stringify(otherMark)})?.querySelector('svg'))`), "Unsafe icon addresses must use the fallback");
  assert.equal(await panel.evaluate("Boolean(window.__invalidFaviconExecuted)"), false, "Imported favicon URLs must not execute code");
  const inlineFavicon = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  await setOtherIcon(inlineFavicon);
  await waitIcon(panel, other.pageTitle, inlineFavicon);
  await setOtherIcon(undefined);
  await checkPageIcons(panel);
  assert.equal(await panel.evaluate('window.__faviconPermissionRequests'), 0, "Opening Manage must not request site access for logos");
  for (const width of [320, 390, 720]) await shot(`manage-${width}`, width);
  await panel.evaluate("document.querySelector('[aria-label=\"Manage items from Research resources\"]').click()");
  await shot("manage-items-390", 390);
  const initial = await read();
  assert.equal(initial['allhere.library.v1'].find((page) => page.id === capture.id).resources.length, 14);
  await panel.evaluate("window.originalSet=chrome.storage.local.set.bind(chrome.storage.local);chrome.storage.local.set=async()=>{throw new Error('Storage failure fixture')}");
  await panel.evaluate("document.querySelector('[aria-label=\"Delete Saved image\"]').click()");
  await until(() => panel.evaluate("Boolean(document.querySelector('.library-manager__error'))"), "Deletion error was not shown");
  assert.equal((await read())['allhere.library.v1'].find((page) => page.id === capture.id).resources.length, 14, "Failed deletion lost data");
  await panel.evaluate("chrome.storage.local.set=window.originalSet;document.querySelector('[aria-label=\"Delete Saved image\"]').click()");
  await until(async () => !(await read())['allhere.library.v1'].find((page) => page.id === capture.id).resources.some((resource) => resource.id === "saved-image"), "Item deletion did not persist");
  assert.equal((await read())['allhere.library.v1'].find((page) => page.id === other.id).resources.length, 2, "Item deletion affected another page");
  await click(".library-manager__undo button");
  await until(async () => (await read())['allhere.library.v1'].find((page) => page.id === capture.id).resources.some((resource) => resource.id === "saved-image" && resource.saved), "Undo did not restore the saved image");
  await until(() => panel.evaluate("document.querySelector('.library-manager').getAttribute('aria-busy') === 'false'"), "Undo did not finish");
  await panel.evaluate("document.querySelector('[aria-label=\"Select Saved icon\"]').click()");
  await panel.evaluate("document.querySelector('[aria-label=\"Select Unsaved icon\"]').click()");
  await click(".library-manager__delete-selected");
  await until(async () => (await read())['allhere.library.v1'].find((page) => page.id === capture.id).resources.length === 12, "Bulk item deletion did not persist");
  await until(() => panel.evaluate("document.querySelector('.library-manager').getAttribute('aria-busy') === 'false'"), "Bulk deletion did not finish");
  await click(".library-manager__undo button");
  await until(async () => (await read())['allhere.library.v1'].find((page) => page.id === capture.id).resources.length === 14, "Undo did not restore bulk-deleted items");
  await until(() => panel.evaluate("document.querySelector('.library-manager').getAttribute('aria-busy') === 'false'"), "Bulk Undo did not finish");
  await panel.evaluate("document.querySelector('[aria-label=\"Delete Saved image\"]').click()");
  await until(() => panel.evaluate("Boolean(document.querySelector('.library-manager__undo'))"), "Undo notice did not appear");
  await panel.evaluate("document.querySelector('[aria-label=\"Back to captured pages\"]').click()");
  await until(() => panel.evaluate("Boolean(document.querySelector('[aria-label=\"Back to library\"]'))"), "Management page list did not reopen");
  await panel.evaluate("document.querySelector('[aria-label=\"Back to library\"]').click()");
  source = await openPage(base + "/a");
  await until(() => source.evaluate("document.readyState === 'complete'"), "Live source did not load");
  await delay(1800);
  await source.evaluate("document.querySelector('#updates').innerHTML='<img src=\"/late-image.svg\" alt=\"Late image\">'");
  await delay(1800);
  assert.ok(!(await read())['allhere.library.v1'].find((page) => page.id === capture.id)?.resources.some((resource) => resource.label === "Late image"), "Page updates must wait for Scan page");
  assert.ok(!(await read())['allhere.library.v1'].find((page) => page.id === capture.id).resources.some((resource) => resource.url === base + "/saved-image.svg"), "Background scanning restored a deleted item");
  assert.ok(await panel.evaluate("document.querySelector('.saved-scope-back') !== null"), "Live scans exited Saved items");
  await panel.send("Page.reload");
  await until(() => panel.evaluate("Boolean(document.querySelector('.resource-album'))"), "Panel did not reopen");
  await delay(1200);
  assert.ok(!(await read())['allhere.library.v1'].find((page) => page.id === capture.id).resources.some((resource) => resource.url === base + "/saved-image.svg"), "Reopening the panel restored a deleted item");
  await menu("Manage");
  await panel.evaluate("document.querySelector('[aria-label=\"Delete page Research resources\"]').click()");
  await until(async () => !(await read())['allhere.library.v1'].some((page) => page.id === capture.id), "Page deletion did not persist");
  await click(".library-manager__undo button");
  await until(async () => (await read())['allhere.library.v1'].some((page) => page.id === capture.id), "Page Undo did not restore captured resources");
  await panel.evaluate("document.querySelector('[aria-label=\"Delete page Research resources\"]').click()");
  await until(async () => !(await read())['allhere.library.v1'].some((page) => page.id === capture.id), "Second page deletion did not persist");
  await panel.evaluate("document.querySelector('[aria-label=\"Back to library\"]').click()");
  await source.evaluate("document.querySelector('#updates').innerHTML='<img src=\"/later-image.svg\" alt=\"Later image\">'");
  await delay(2200);
  assert.ok(!(await read())['allhere.library.v1'].some((page) => page.pageUrl === base + "/a"), "A background scan restored a deleted page");
  await panel.send("Page.reload"); await until(() => panel.evaluate("Boolean(document.querySelector('.resource-album'))"), "Remaining page did not render"); await delay(1000);
  assert.ok(!(await read())['allhere.library.v1'].some((page) => page.pageUrl === base + "/a"), "Panel reopen restored a deleted page");
  await panel.evaluate("(() => { const button = document.querySelector('.button--scan'); window.__explicitScanState = { sawBusy: button.disabled, finished: false }; const observer = new MutationObserver(() => { if (button.disabled) window.__explicitScanState.sawBusy = true; else if (window.__explicitScanState.sawBusy) { window.__explicitScanState.finished = true; observer.disconnect(); } }); observer.observe(button, { attributes: true, attributeFilter: ['disabled'] }); })()");
  await click(".button--scan");
  await until(() => panel.evaluate("window.__explicitScanState?.finished === true"), "Explicit rescan did not finish successfully");
  await until(async () => (await read())['allhere.library.v1'].some((page) => page.pageUrl === base + "/a" && page.resources.some((resource) => resource.url === base + "/saved-image.svg")), "An explicit rescan did not restore excluded resources");
  assert.deepEqual((await read())['allhere.capture-exclusions.v1'], { pages: [], resources: {} });
  assert.equal(panel.errors.length, 0, "The extension reported an uncaught runtime exception");

  // Optional actual Next.js render of the shared management surface.
  if (process.env.STASHWELL_WEB_URL) {
    web = await openPage(process.env.STASHWELL_WEB_URL);
    const webShot = async (name) => {
      const { data } = await web.send("Page.captureScreenshot", { format: "png" });
      await writeFile(resolve(`.impeccable/review/${name}.png`), Buffer.from(data, "base64"));
    };
    await until(() => web.evaluate("Boolean(document.querySelector('.stashwell-shell--web'))"), "Web library did not render");
    await web.evaluate(`localStorage.setItem('allhere.library.v1', ${JSON.stringify(JSON.stringify([capture, other]))}); location.reload()`);
    try { await until(() => web.evaluate("Boolean(document.querySelector('.resource-album'))"), "Web fixtures did not render"); }
    catch (error) {
      console.error(await web.evaluate("({body:document.body.innerText.slice(0,2000),stored:localStorage.getItem('allhere.library.v1'),url:location.href})"));
      console.error(web.errors);
      throw error;
    }
    await web.evaluate("document.querySelector('.library-menu__trigger').click()");
    await until(() => web.evaluate("Boolean(document.querySelector('.library-menu__panel'))"), "Web library menu did not open");
    await web.evaluate("[...document.querySelectorAll('.library-menu__item')].find(button=>button.textContent.startsWith('Manage')).click()");
    await checkPageIcons(web);
    for (const width of [1440, 390]) {
      await web.send("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: false });
      assert.ok(await web.evaluate("document.documentElement.scrollWidth<=innerWidth"), `Manage logos overflowed at ${width}px`);
      await webShot(`manage-web-logos-${width}`);
    }
    await web.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 850, deviceScaleFactor: 1, mobile: false });
    await web.evaluate("document.querySelector('.searchbox input').focus()");
    await web.send("Input.insertText", { text: "Another" });
    await until(() => web.evaluate("document.querySelectorAll('.library-manager__row--page').length === 1"), "Header search did not filter Manage pages");
    assert.ok(await web.evaluate("document.querySelector('.library-manager__page').textContent.includes('Another captured page')"), "Header search returned the wrong captured page");
    await webShot("manage-web-search-1440");
    await web.evaluate("document.querySelector('.searchbox__clear').click()");
    await until(() => web.evaluate("document.querySelectorAll('.library-manager__row--page').length === 2"), "Clearing header search did not restore Manage pages");
    await web.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 600, deviceScaleFactor: 1, mobile: false });
    await web.evaluate("document.querySelector('[aria-label=\"Manage items from Research resources\"]').click()");
    await until(() => web.evaluate("document.querySelectorAll('.library-manager__row').length === 14"), "Web Manage items did not open");
    await web.evaluate("scrollTo(0,350)");
    await delay(150);
    const sticky = await web.evaluate("({header:document.querySelector('.topbar').getBoundingClientRect().bottom, toolbar:document.querySelector('.library-manager__toolbar').getBoundingClientRect().top})");
    assert.ok(sticky.toolbar >= sticky.header - 1, `Manage toolbar was obscured by mobile header: ${JSON.stringify(sticky)}`);
    await webShot("manage-web-sticky-390");
    await web.evaluate("document.querySelector('[aria-label=\"Back to captured pages\"]').click(); scrollTo(0,0)");
    await web.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 850, deviceScaleFactor: 1, mobile: false });
    await web.evaluate("[...document.querySelectorAll('.page-nav-item')].find(button=>button.textContent.includes('Another captured page')).click()");
    await until(() => web.evaluate("!document.querySelector('.library-manager') && document.querySelector('.content-heading h1').textContent === 'Another captured page'"), "Source-page navigation did not leave Manage");
    await web.evaluate("scrollTo(0,0)");
    await webShot("manage-web-source-exit-1440");
    await web.evaluate("document.querySelector('.library-menu__trigger').click()");
    await web.evaluate("[...document.querySelectorAll('.library-menu__item')].find(button=>button.textContent.startsWith('Manage')).click()");
    for (const width of [390, 1440]) {
      await web.send("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: false });
      await delay(150);
      assert.ok(await web.evaluate("document.documentElement.scrollWidth <= innerWidth"), `Web management overflowed at ${width}px`);
      const { data } = await web.send("Page.captureScreenshot", { format: "png" });
      await writeFile(resolve(`.impeccable/review/manage-web-${width}.png`), Buffer.from(data, "base64"));
    }
  }
  console.log("PASS Brave: Manage site logos from saved URLs and legacy origin favicons; inline logos; missing/unsafe icon fallback; no logo permission prompts; saved filtering; page/item deletion and Undo; failed writes; persistence and explicit rescans; 320/390/720px extension and optional 390/1440px web checks.");
} finally {
  panel?.close(); source?.close(); web?.close();
  if (browserCdp) { try { await browserCdp.send("Browser.close"); } catch { /* Already closed. */ } browserCdp.close(); }
  browser.kill(); server.close();
  const target = resolve(profile);
  if (target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith("stashwell-management-")) {
    for (let attempt = 0; attempt < 10; attempt++) { try { await rm(target, { recursive: true, force: true }); break; } catch { await delay(500); } }
  }
}
