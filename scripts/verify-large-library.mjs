// Exercise migration and normal browsing with a library large enough to stall the original panel.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as portServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Cdp, localFixtureExtension, until } from "./extension-fixture.mjs";

const singlePage = process.argv.includes("--single-page");
const counts = singlePage ? [25_000] : Array(100).fill(250);
const legacyKey = "allhere.library.v1";
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><rect width="30" height="24" fill="#1683f1"/></svg>';
const server = createServer((request, response) => {
  if (request.url.endsWith(".svg")) {
    response.writeHead(200, { "content-type": "image/svg+xml" }).end(svg);
    return;
  }
  response.writeHead(200, { "content-type": "text/html" })
    .end('<!doctype html><title>New source</title><img src="/fresh.svg" alt="New artwork">');
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const base = "http://127.0.0.1:" + server.address().port;
const port = await new Promise(done => {
  const probe = portServer();
  probe.listen(0, "127.0.0.1", () => { const available = probe.address().port; probe.close(() => done(available)); });
});
const debug = "http://127.0.0.1:" + port;
const profile = await mkdtemp(join(tmpdir(), "stashwell-library-scale-"));
const extension = await localFixtureExtension(profile, [base]);
const browser = spawn(process.env.STASHWELL_BROWSER_PATH ?? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [
  "--user-data-dir=" + profile, "--remote-debugging-port=" + port, "--headless=new", "--no-first-run",
  "--disable-extensions-except=" + extension, "--load-extension=" + extension, "about:blank",
], { windowsHide: true, stdio: "ignore" });
const clients = [];
let controller;

function seedLegacy(origin, sizes) {
  const capturedAt = "2026-11-22T00:00:00.000Z";
  const description = "AbCdEf0123".repeat(30);
  const captures = sizes.map((size, page) => {
    const pageUrl = origin + "/history-" + page;
    const pageTitle = "History source " + page;
    const resources = Array.from({ length: size }, (_, index) => {
      const label = "Artwork " + page + "-" + index;
      const url = "data:image/svg+xml," + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><desc>' + description + " " + label + '</desc><rect width="24" height="24" fill="#1683f1"/></svg>',
      );
      return {
        id: "r-" + page + "-" + index, kind: "image", url, label, alt: label,
        saved: index === size - 1, pageUrl, pageTitle, capturedAt, width: 48, height: 24, mimeType: "image/svg+xml",
        security: {
          transport: "local", relation: "unknown", hostname: "", checkedAt: capturedAt,
          signals: [{ id: "local-resource", level: "local-only", label: "Embedded data URL", detail: "Stored in the library." }],
          method: "local-heuristics",
        },
      };
    });
    return { id: "p-" + page, pageUrl, pageTitle, hostname: "127.0.0.1", capturedAt, resources };
  });
  return chrome.storage.local.set({
    "allhere.library.v1": captures,
    "allhere.capture-exclusions.v1": { pages: [origin + "/discarded"], resources: {} },
  });
}

async function connect(url) {
  const client = new Cdp(url);
  clients.push(client);
  await client.ready();
  return client;
}

async function connectTarget(id) {
  const target = await until(async () => (await (await fetch(debug + "/json/list")).json()).find(item => item.id === id), "Browser target did not open");
  return connect(target.webSocketDebuggerUrl);
}

try {
  const metadata = await until(async () => {
    try { return await (await fetch(debug + "/json/version")).json(); } catch { return null; }
  }, "Browser did not start");
  controller = await connect(metadata.webSocketDebuggerUrl);
  const workerTarget = await until(async () => (await controller.send("Target.getTargets")).targetInfos
    .find(item => item.type === "service_worker" && item.url.endsWith("/service-worker.js")), "Extension worker did not start");
  const worker = await connectTarget(workerTarget.targetId);
  await until(() => worker.evaluate("typeof chrome!=='undefined'&&Boolean(chrome.runtime?.id)"), "Extension worker did not initialize");
  const open = async (url, background = false) => connectTarget((await controller.send("Target.createTarget", { url, background })).targetId);
  const source = await open(base + "/new");
  await source.send("Page.bringToFront");
  await until(() => source.evaluate("document.readyState==='complete'&&location.pathname==='/new'"), "Source page did not load");

  // Store the history through the previous release's schema before opening the panel.
  await worker.evaluate("(" + seedLegacy + ")(" + JSON.stringify(base) + "," + JSON.stringify(counts) + ")");
  const openedAt = performance.now();
  const panel = await open("chrome-extension://" + new URL(workerTarget.url).hostname + "/index.html", true);
  const ready = () => panel.evaluate("!!document.querySelector('.page-scope__trigger')&&!document.querySelector('.loading-state')&&document.querySelector('.button--scan')?.disabled===false");
  await until(ready, "Migrated library did not open", 30_000);
  const migrationMs = Math.round(performance.now() - openedAt);
  const migrated = await worker.evaluate("fixtureHistory.read().then(data=>({pages:data['allhere.library.v1'].map(p=>p.id),items:data['allhere.library.v1'].reduce((n,p)=>n+p.resources.length,0),bookmarks:data['allhere.library.v1'].flatMap(p=>p.resources.filter(r=>r.saved)).length,excluded:data['allhere.capture-exclusions.v1'].pages}))");
  assert.deepEqual(migrated, {
    pages: counts.map((_, index) => "p-" + index),
    items: 25_000,
    bookmarks: counts.length,
    excluded: [base + "/discarded"],
  });
  assert.equal(await worker.evaluate("chrome.storage.local.get(" + JSON.stringify(legacyKey) + ").then(data=>Object.hasOwn(data," + JSON.stringify(legacyKey) + "))"), false);

  // A scan of an unrelated page should not read or rewrite any old resource blocks.
  await worker.evaluate("globalThis.captureReads=[];globalThis.captureWrites=[];const read=IDBObjectStore.prototype.get,put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.get=function(key){if(this.name==='pages'||this.name==='resources')captureReads.push([this.name,key]);return read.call(this,key)};IDBObjectStore.prototype.put=function(value,key){if(this.name==='resources')captureWrites.push(key);return put.apply(this,arguments)};");
  const click = selector => panel.evaluate("document.querySelector(" + JSON.stringify(selector) + ").click()", true);
  const scanStart = performance.now();
  await click(".button--scan");
  await until(() => panel.evaluate("document.querySelector('.notice')?.textContent.includes('saved from')"), "A new page could not be scanned");
  const scanMs = Math.round(performance.now() - scanStart);
  assert.deepEqual(await worker.evaluate("captureReads"), [["pages", base + "/new"]]);
  assert.deepEqual(await worker.evaluate("captureWrites"), [[base + "/new", 0]]);

  await panel.evaluate("globalThis.beforeLibraryReload=true");
  const reopenStart = performance.now();
  await panel.send("Page.reload");
  await until(async () => !await panel.evaluate("Boolean(window.beforeLibraryReload)") && await ready(), "Library did not reopen");
  const reopenMs = Math.round(performance.now() - reopenStart);

  const menu = async name => {
    await click(".library-menu__trigger");
    await until(() => panel.evaluate("Boolean(document.querySelector('.library-menu__panel'))"), "Library menu did not open");
    await panel.evaluate("[...document.querySelectorAll('.library-menu__item')].find(item=>item.textContent.startsWith(" + JSON.stringify(name) + ")).click()", true);
  };
  await menu("All resources");
  const albums = await until(() => panel.evaluate("document.querySelectorAll('.page-albums').length"), "History albums did not appear");
  assert.ok(albums <= 5, "The overview must mount a limited number of source pages");
  await click(".page-scope__trigger");
  assert.ok(await panel.evaluate("document.querySelectorAll('.page-scope__option').length <= 42"), "The source picker mounted the entire history");
  await click(".page-scope__trigger");
  const gridStart = performance.now();
  await click('[data-resource-tab="images"]');
  const first = await until(() => panel.evaluate("document.querySelector('.resource-card')?.getAttribute('aria-label')"), "The photo history did not open");
  const gridMs = Math.round(performance.now() - gridStart);
  assert.equal(await panel.evaluate("document.querySelectorAll('.resource-card').length"), 48);
  await click('.resource-section button[aria-label="Next page"]');
  await until(() => panel.evaluate("document.querySelector('.resource-card')?.getAttribute('aria-label')!==" + JSON.stringify(first)), "The next page reused the first page's results");
  await click('[aria-label="List view"]');
  await until(() => panel.evaluate("document.querySelectorAll('.resource-table tbody tr').length===48"), "The list view must also limit mounted rows");
  await click('[aria-label="Grid view"]');

  const lastPage = counts.length - 1;
  const lastLabel = "Artwork " + lastPage + "-" + (counts[lastPage] - 2);
  await panel.evaluate("(()=>{const input=document.querySelector('.searchbox input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input," + JSON.stringify(lastLabel) + ");input.dispatchEvent(new Event('input',{bubbles:true}));})()", true);
  await until(() => panel.evaluate("document.querySelectorAll('.resource-card').length===1&&document.querySelector('.resource-card')?.getAttribute('aria-label')===" + JSON.stringify(lastLabel)), "Search missed an item on the last archived page");
  await click(".resource-card");
  await until(() => panel.evaluate("document.querySelector('.resource-modal img.resource-art__image')?.naturalWidth===48"), "An archived image could not be previewed");
  await click('.resource-modal button[aria-label="Close preview"]');
  await until(() => panel.evaluate("!document.querySelector('.resource-modal')"), "The preview did not close");

  await panel.evaluate("globalThis.chunksRead=0;const oldGet=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(key){if(this.name==='resources')chunksRead++;return oldGet.call(this,key)};");
  await click('.resource-actions__trigger');
  await until(() => panel.evaluate("Boolean(document.querySelector('.resource-actions__menu'))"), "The archived item menu did not open");
  await panel.evaluate("[...document.querySelectorAll('.resource-actions__menu button')].find(item=>item.textContent.trim()==='Save to Saved items').click()", true);
  await until(() => panel.evaluate("document.querySelector('.notice')?.textContent.includes('Resource saved in Saved items')"), "An archived item could not be bookmarked");
  await until(() => panel.evaluate("chunksRead>0"), "The panel did not receive the bookmark change");
  assert.equal(await panel.evaluate("chunksRead"), 1, "A bookmark should reload only its changed resource block");

  const total = await worker.evaluate("fixtureHistory.read().then(data=>data['allhere.library.v1'].reduce((n,p)=>n+p.resources.length,0))");
  assert.equal(total, 25_001);
  console.log("PASS 25,000 saved resources across " + counts.length + " pages. Migration " + migrationMs +
    " ms, reopen " + reopenMs + " ms, scan " + scanMs + " ms, grid " + gridMs +
    " ms. Search, pagination, preview, bookmarks, and isolated updates verified.");
} finally {
  if (controller) await controller.send("Browser.close").catch(() => {});
  for (const client of clients) client.close();
  browser.kill();
  server.closeAllConnections();
  server.close();
  const target = resolve(profile);
  if (target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith("stashwell-library-scale-")) {
    await rm(target, { recursive: true, force: true }).catch(() => {});
  }
}
