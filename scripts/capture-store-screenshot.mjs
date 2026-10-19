import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { localFixtureExtension } from "./extension-fixture.mjs";

const width = Number(process.env.STASHWELL_SCREENSHOT_WIDTH ?? 640);
const height = Number(process.env.STASHWELL_SCREENSHOT_HEIGHT ?? 400);
const scale = Number(process.env.STASHWELL_SCREENSHOT_SCALE ?? 1);
const scrollY = Number(process.env.STASHWELL_SCREENSHOT_SCROLL_Y ?? 80);
const view = process.env.STASHWELL_SCREENSHOT_VIEW ?? "images";
const source = process.env.STASHWELL_SCREENSHOT_SOURCE ?? "installed";
if (![1, 2].includes(scale) || ![[1280, 800], [640, 400]].some(([expectedWidth, expectedHeight]) => width * scale === expectedWidth && height * scale === expectedHeight)) {
  throw new Error("Store screenshots must be 1280x800 or 640x400.");
}
const destination = resolve(`docs/chrome-web-store-assets/stashwell-screenshot-${view}${scrollY ? "-scrolled" : ""}-${width * scale}x${height * scale}.png`);
const webUrl = process.env.STASHWELL_WEB_URL ?? "http://127.0.0.1:3002/";
const port = await new Promise((done) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const assigned = server.address().port;
    server.close(() => done(assigned));
  });
});
const profile = join(tmpdir(), `stashwell-store-screenshot-${crypto.randomUUID()}`);
const extensionPath = source === "installed" ? await localFixtureExtension(profile, [webUrl]) : undefined;
const browser = spawn(process.env.STASHWELL_BROWSER_PATH ?? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  ...(source === "installed" ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] : []),
  "about:blank",
], { windowsHide: true, stdio: "ignore" });

async function until(check, message) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch { /* Browser is still starting. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(message);
}

class Cdp {
  constructor(socketUrl) {
    this.socket = new WebSocket(socketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.socket.addEventListener("message", (event) => {
      const response = JSON.parse(event.data);
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.error) pending.reject(new Error(response.error.message));
      else pending.resolve(response.result);
    });
  }
  async ready() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((done, reject) => {
      this.socket.addEventListener("open", done, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((done, reject) => {
      this.pending.set(id, { resolve: done, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, userGesture = false) {
    const response = await this.send("Runtime.evaluate", { expression, userGesture, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  }
  close() { this.socket.close(); }
}

let controller;
let page;
try {
  const version = await until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).json(), "Brave did not start.");
  controller = new Cdp(version.webSocketDebuggerUrl);
  await controller.ready();
  let url = new URL("demo/extension", webUrl).href;
  if (source === "installed") {
    const worker = await until(async () => {
      const { targetInfos } = await controller.send("Target.getTargets");
      return targetInfos.find((entry) => entry.url?.startsWith("chrome-extension://") && entry.url.endsWith("service-worker.js"));
    }, "The installed extension did not load.");
    url = `chrome-extension://${new URL(worker.url).hostname}/index.html`;
  }
  const { targetId } = await controller.send("Target.createTarget", { url });
  const target = await until(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return targets.find((entry) => entry.id === targetId && entry.webSocketDebuggerUrl);
  }, "The extension interface did not open.");
  page = new Cdp(target.webSocketDebuggerUrl);
  await page.ready();
  if (source === "installed") {
    await page.send("Page.enable");
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});" });
  }
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  await page.send("Page.reload", { ignoreCache: true });
  await until(() => page.evaluate("Boolean(document.querySelector('.stashwell-shell'))"), "The extension interface did not render.");
  if (source === "installed") await page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));");
  if (source === "installed") {
    const { targetId: sourceId } = await controller.send("Target.createTarget", { url: webUrl });
    const sourceTab = await until(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return targets.find((entry) => entry.id === sourceId && entry.webSocketDebuggerUrl);
    }, "The source webpage did not open.");
    const sourcePage = new Cdp(sourceTab.webSocketDebuggerUrl);
    await sourcePage.ready();
    await sourcePage.send("Page.bringToFront");
    await until(() => sourcePage.evaluate("document.readyState === 'complete'"), "The source webpage did not finish loading.");
    // The homepage's lazy demo iframe starts after the outer page load. Wait
    // for that visible product preview before taking a settled-page scan.
    if (await sourcePage.evaluate("Boolean(document.querySelector('iframe[src*=\"/demo/extension\"]'))")) {
      await until(() => sourcePage.evaluate("document.querySelector('iframe[src*=\"/demo/extension\"]')?.contentDocument?.querySelector('.button--scan')?.disabled === false"), "The homepage demo did not finish initializing.");
    }
    await until(() => page.evaluate("document.querySelector('.button--scan')?.disabled === false"), "The saved library did not finish loading.");
    await until(() => page.evaluate(`chrome.tabs.query({active:true,lastFocusedWindow:true}).then(([tab]) => tab?.url === ${JSON.stringify(webUrl)} && tab.status === 'complete' && Boolean(tab.favIconUrl))`), "The source webpage did not become active and finish loading.");
    await until(() => page.evaluate("chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>{const icon=document.querySelector('.scan-favicon img');return icon?.dataset.faviconUrl===tab?.favIconUrl&&icon?.complete&&icon.naturalWidth>0;})"), "The panel did not receive the current tab's favicon.");
    await page.evaluate("document.querySelector('.button--scan').click()", true);
    try {
      await until(() => page.evaluate(`chrome.storage.local.get('allhere.library.v1').then(data => data['allhere.library.v1']?.some(capture => capture.pageUrl === ${JSON.stringify(webUrl)}))`), "The installed extension did not scan the source webpage.");
    } catch (error) {
      console.error(await page.evaluate("({notice:document.querySelector('.notice')?.textContent,state:document.querySelector('.button--scan')?.dataset.scanState})"));
      throw error;
    }
    try {
      await until(() => page.evaluate("document.querySelector('.button--scan')?.dataset.scanState === 'ready'"), "The scan button did not confirm the current page.");
    } catch (error) {
      console.error(await page.evaluate("({notice:document.querySelector('.notice')?.textContent,state:document.querySelector('.button--scan')?.dataset.scanState})"));
      throw error;
    }
    // A real side panel stays beside its source tab. This headless harness uses
    // an extension tab: retain Chrome's source metadata while foregrounding it
    // for reliable screenshots, without changing capture or stored resources.
    await page.evaluate("(async()=>{const query=chrome.tabs.query.bind(chrome.tabs);const source=await query({active:true,currentWindow:true});chrome.tabs.query=options=>options.active?Promise.resolve(source):query(options);})()");
    await page.send("Page.bringToFront");
    sourcePage.close();
  } else {
    await until(() => page.evaluate("document.body.innerText.includes('The activeTab permission')"), "The side panel demo did not load its sample resources.");
  }
  await new Promise((done) => setTimeout(done, 800));
  if (scrollY) {
    await page.evaluate(`window.scrollTo(0, ${scrollY})`);
    await new Promise((done) => setTimeout(done, 200));
  }
  if (view === "images" || view === "download-formats") {
    await page.evaluate("document.querySelector('[data-resource-tab=images]')?.click()");
    await until(() => page.evaluate("Boolean(document.querySelector('.resource-card-frame .resource-actions__trigger'))"), "The image card did not render.");
  }
  if (view === "download-formats") {
    await page.evaluate("document.querySelector('.resource-card-frame .resource-actions__trigger')?.click()");
    await until(() => page.evaluate("Boolean(document.querySelector('.resource-actions__menu .download-format__trigger'))"), "The image actions menu did not open.");
    await page.evaluate("document.querySelector('.resource-actions__menu .download-format__trigger').click()");
    await until(() => page.evaluate("Boolean(document.querySelector('.download-format__options:popover-open'))"), "The format dropdown did not open.");
  }
  if (source === "installed") {
    await until(() => page.evaluate("Boolean(document.querySelector('.resource-art__image--loaded'))"), "The captured image did not load.");
    await page.evaluate("document.querySelector('.notice [aria-label=\"Dismiss message\"]')?.click()");
    await new Promise((done) => setTimeout(done, 150));
  }
  await page.evaluate("document.fonts.ready");
  await until(() => page.evaluate("[...document.querySelectorAll('.resource-art__image')].every(img => img.complete && img.naturalWidth > 0)"), "The visible resource images did not finish loading.");
  const screenshot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(screenshot.data, "base64"));
  console.log(destination);
} finally {
  try { await controller?.send("Browser.close"); } catch { /* Browser may have exited. */ }
  page?.close();
  controller?.close();
  browser.kill();
}
