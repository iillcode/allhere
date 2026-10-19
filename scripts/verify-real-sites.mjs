// Public-site smoke tests through the built extension, in a fresh browser profile.
// Run after building: node scripts/verify-real-sites.mjs [https://app.example/ ...]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { localFixtureExtension } from "./extension-fixture.mjs";
import { resourceIdentity, resourceIdentityKeys } from "../packages/core/src/index.ts";

const urls = process.argv.slice(2).length ? process.argv.slice(2) : [
  "https://excalidraw.com/", "https://app.diagrams.net/?splash=0&browser=1",
  "https://github.com/microsoft/vscode", "https://lucide.dev/icons/",
];
const delay = ms => new Promise(done => setTimeout(done, ms));
async function until(check, message, timeout = 45_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await delay(200); }
  throw Error(message);
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
      this.pending.set(id, { done, reject, timer: setTimeout(() => { this.pending.delete(id); reject(Error(`${method} timed out`)); }, 60_000) });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const value = await this.send("Runtime.evaluate", { expression, userGesture: true, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
    return value.result.value;
  }
  close() { for (const entry of this.pending.values()) clearTimeout(entry.timer); this.socket.close(); }
}
const profile = await mkdtemp(join(tmpdir(), "stashwell-real-sites-"));
const extension = await localFixtureExtension(profile, urls);
const port = await new Promise(done => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => done(port)); }); });
const browser = spawn(process.env.STASHWELL_BROWSER_PATH ?? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
const clients = [];
const report = { checkedAt: new Date().toISOString(), sites: [] };
let controller;
try {
  const version = await until(async () => { try { return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { return null; } }, "Browser did not start");
  controller = new Cdp(version.webSocketDebuggerUrl); await controller.ready();
  const open = async url => {
    const { targetId } = await controller.send("Target.createTarget", { url });
    const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.id === targetId), "Tab did not open");
    const client = new Cdp(target.webSocketDebuggerUrl); await client.ready(); clients.push(client);
    return { client, targetId };
  };
  const worker = await until(async () => (await controller.send("Target.getTargets")).targetInfos.find(target => target.type === "service_worker" && target.url.endsWith("service-worker.js")), "Extension did not load");
  const { client: panel } = await open(`chrome-extension://${new URL(worker.url).hostname}/index.html`);
  await until(() => panel.evaluate("Boolean(document.querySelector('.button--scan'))"), "Panel did not load");
  // The manual scan path is real; hold watcher notifications to compare snapshots.
  await panel.evaluate(`(()=>{const connect=chrome.tabs.connect.bind(chrome.tabs);chrome.tabs.connect=(...args)=>{const port=connect(...args);if(args[1]?.name==='stashwell.auto-updates')port.onMessage.addListener=()=>{};return port;};
    const execute=chrome.scripting.executeScript.bind(chrome.scripting);window.__scans=0;
    chrome.scripting.executeScript=async options=>{const result=await execute(options);if(options.func){window.__scans++;window.__lastScan=result;}return result;};})()`);
  for (const url of urls) {
    const result = { url };
    let targetId;
    let sourcePage;
    try {
      const opened = await open(url); const page = opened.client; targetId = opened.targetId;
      sourcePage = page;
      await page.send("Page.bringToFront");
      await until(() => page.evaluate("document.readyState==='complete' && document.body?.children.length>0"), `Page did not load: ${url}`);
      await delay(3_000);
      if (new URL(url).hostname === "app.diagrams.net") await until(() => page.evaluate("Boolean(document.querySelector('.geDiagramContainer'))&&!/Starting(?:\\.{3}|…)|Loading(?:\\.{3}|…)/i.test(document.body.innerText)"), "diagrams.net did not finish starting the editor", 60_000);
      const finalUrl = await page.evaluate("location.href");
      assert.ok(finalUrl.startsWith("https://") || finalUrl.startsWith("http://"), "Browser could not reach this site");
      const scan = async () => {
        await until(() => panel.evaluate("document.querySelector('.button--scan')?.disabled===false"), "Scan remained busy");
        const previous = await panel.evaluate("window.__scans");
        await panel.evaluate("document.querySelector('.button--scan').click()");
        await until(() => panel.evaluate(`window.__scans>${previous}&&document.querySelector('.button--scan')?.disabled===false`), `Scan failed: ${url}`);
        return panel.evaluate(`chrome.storage.local.get('allhere.library.v1').then(data=>(data['allhere.library.v1']||[]).find(page=>page.pageUrl===${JSON.stringify(finalUrl)}))`);
      };
      const first = await scan();
      assert.ok(first?.resources.length > 5, "Scan must find a usable app, not a network/challenge page");
      const inventory = await page.evaluate(`(()=>{const elements=[];const visit=root=>{for(const el of root.querySelectorAll('*')){elements.push(el);if(el.shadowRoot)visit(el.shadowRoot);}};visit(document);
        return {title:document.title,images:elements.filter(el=>el.tagName==='IMG'&&el.complete&&el.naturalWidth>0).map(el=>el.currentSrc||el.src),
          paths:[...new Set(elements.filter(el=>el.localName==='path'&&el.getAttribute('d')&&el.closest('svg')?.getBoundingClientRect().width>0).map(el=>el.getAttribute('d')))],
          renderedSvg:elements.filter(el=>el.tagName.toLowerCase()==='svg'&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0).length};})()`);
      // App menus can finish mounting while the first scan is in flight. Audit
      // the observed DOM against the subsequent scan of that mounted state.
      const second = await scan();
      const identities = new Set(second.resources.flatMap(resourceIdentityKeys));
      const missingImages = inventory.images.filter(url => !url.startsWith("blob:") && !identities.has(resourceIdentity({ kind: "image", url })));
      const iconPreview = await panel.evaluate(`(async()=>{const icons=${JSON.stringify(second.resources.filter(resource => resource.kind === "icon" && resource.url.startsWith("data:")).map(({ label, url }) => ({ label, url })))};const failures=[];
        for(const icon of icons){const image=new Image();try{image.src=icon.url;await image.decode();const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,64,64);if(!ctx.getImageData(0,0,64,64).data.some((v,i)=>i%4===3&&v))failures.push({label:icon.label,reason:'empty pixels'});}catch{failures.push({label:icon.label,reason:'decode failure'});}}return {checked:icons.length,failures};})()`);
      const capturedPaths = await panel.evaluate(`(()=>{const urls=${JSON.stringify(second.resources.filter(resource=>resource.url.startsWith('data:image/svg+xml')).map(resource=>resource.url))};return [...new Set(urls.flatMap(url=>{const data=url.slice(url.indexOf(',')+1);const markup=/;base64,/i.test(url)?atob(data):decodeURIComponent(data);return [...new DOMParser().parseFromString(markup,'image/svg+xml').querySelectorAll('path[d]')].map(path=>path.getAttribute('d'));}))];})()`);
      const missingSvgPaths = inventory.paths.filter(path => !capturedPaths.includes(path));
      const secondIdentities = new Set(second.resources.map(resourceIdentity));
      const lost = first.resources.filter(resource => !secondIdentities.has(resourceIdentity(resource)));
      const counts = Object.fromEntries([...new Set(second.resources.map(resource => resource.kind))].map(kind => [kind, second.resources.filter(resource => resource.kind === kind).length]));
      Object.assign(result, { finalUrl, title: inventory.title, resources: second.resources.length, counts, renderedSvg: inventory.renderedSvg,
        loadedImages: inventory.images.length, missingImages, uniqueSvgPaths: inventory.paths.length, missingSvgPaths, inlineIcons: iconPreview, duplicates: second.resources.length - secondIdentities.size, lostOnRescan: lost.length });
      assert.equal(missingImages.length, 0, "Loaded image URLs were missed");
      assert.equal(missingSvgPaths.length, 0, "Visible SVG geometry was missed");
      assert.equal(iconPreview.failures.length, 0, "Captured icons must decode and contain visible pixels");
      assert.equal(result.duplicates, 0, "Rescan created duplicate identities");
      assert.equal(lost.length, 0, "Rescan lost previous resources");
      const previousIds = new Map(first.resources.map(resource => [resourceIdentity(resource), resource.id]));
      for (const resource of second.resources) if (previousIds.has(resourceIdentity(resource))) assert.equal(resource.id, previousIds.get(resourceIdentity(resource)), "Rescan changed a resource ID");
      result.status = "passed";
      await mkdir(resolve(".impeccable/review"), { recursive: true });
      const screenshot = await page.send("Page.captureScreenshot", { format: "png" });
      await writeFile(resolve(`.impeccable/review/live-${new URL(url).hostname}.png`), Buffer.from(screenshot.data, "base64"));
    } catch (error) {
      result.status = "failed"; result.error = error.message; process.exitCode = 1;
      if (sourcePage) Object.assign(result, await sourcePage.evaluate("({title:document.title,bodyExcerpt:document.body?.innerText.slice(0,500),images:document.images.length})").catch(()=>({})));
    }
    report.sites.push(result); console.log(JSON.stringify(result));
    if (targetId) await controller.send("Target.closeTarget", { targetId });
  }
} finally {
  await mkdir(resolve(".impeccable/review"), { recursive: true });
  await writeFile(resolve(".impeccable/review/real-sites.json"), JSON.stringify(report, null, 2));
  clients.forEach(client => client.close());
  if (controller) { await controller.send("Browser.close").catch(() => {}); controller.close(); }
  browser.kill();
  const target = resolve(profile);
  if (target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith("stashwell-real-sites-")) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await rm(target, { recursive: true, force: true }); break; } catch { await delay(500); }
    }
  }
}
