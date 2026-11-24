// Check production permissions and the first-scan boundary in an isolated browser.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as portServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Cdp, delay, localFixtureExtension, until } from "./extension-fixture.mjs";

const sharp = createRequire(createRequire(import.meta.url).resolve("next/package.json", { paths: [resolve("apps/web")] }))("sharp");
const png = await sharp({ create: { width: 200, height: 140, channels: 3, background: "#0b57d0" } }).png().toBuffer();
let pendingImage;
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const path = url.pathname;
  if (path === "/pending.png" && !pendingImage) { pendingImage = response; return; }
  if (path.endsWith(".png")) { response.writeHead(200, { "Content-Type": "image/png" }).end(png); return; }
  if (path === "/favicon.svg") { response.writeHead(200, { "Content-Type": "image/svg+xml" }).end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#0b57d0"/></svg>'); return; }
  const image = (name, title, attributes = '') => `<img src="/order-${name}.png" alt="${title}" width="200" height="140" ${attributes}>`;
  const style = '<style>body{margin:0}img,video,iframe{display:block}#flex{display:flex;flex-direction:column}#row{display:flex;flex-direction:row-reverse;width:400px}#background,#pseudo{width:200px;height:140px}#pseudo::before{content:"";display:block;width:200px;height:140px;background-image:url(/order-pseudo.png)}</style>';
  if (path === '/order-frame') {
    const second = url.searchParams.has('second');
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><title>Ordered frame</title>${style}${image(second ? 'second-before' : 'frame-before', second ? 'Second frame before' : 'Frame before')}${second ? '' : '<iframe src="/order-nested" width="220" height="160"></iframe>'}${image(second ? 'second-after' : 'frame-after', second ? 'Second frame after' : 'Frame after')}`);
    return;
  }
  if (path === '/order-nested') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><title>Nested</title>${style}${image('nested', 'Nested frame')}`);
    return;
  }
  if (path === '/order') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><title>Ordered gallery</title><link rel="icon" href="/favicon.svg">${style}
      <div id="flex">${image('bottom', 'Flex third', 'id="flex-third" style="order:3"')}<div id="background" aria-description="Background first" style="order:1;background-image:url(/order-background.png)"></div><div style="order:2"><img id="blob" alt="Blob second" width="200" height="140"></div></div>
      <div id="row">${image('right', 'Row right')}${image('left', 'Row left')}</div>
      ${image('regular', 'Regular image', 'id="regular"')}<div id="ordered-shadow"></div><div id="pseudo" aria-description="Pseudo before frame"></div>
      <iframe src="/order-frame" width="220" height="470"></iframe><video poster="/order-poster.png" aria-label="Poster image" width="200" height="140"></video>
      ${image('end', 'Last image', 'id="last-image"')}<iframe src="/order-frame?second=1" width="220" height="300"></iframe>
      <div style="width:200px;height:140px;background-image:url(/order-background.png)"></div>${image('hidden', 'Hidden image', 'hidden style="display:none"')}
      <span id="capture-clock">0</span><a id="capture-link" href="/named-link">Original link name</a>
      <script>document.querySelector('#ordered-shadow').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(image('shadow', 'Shadow image'))};(async()=>{const blob=await(await fetch('/order-blob.png')).blob();const image=document.querySelector('#blob');image.src=URL.createObjectURL(blob);await image.decode();window.__orderReady=true;})();</script>`);
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>${path === "/frame" ? "Frame" : "Auto gallery"}</title><link rel="icon" href="/favicon.svg"><div id="shadow-host"></div>${path === "/frame" ? '<img src="/frame.png" alt="Frame image" width="200" height="140">' : Array.from({ length: 12 }, (_, i) => `<img id="image-${i}" src="/image-${i}.png" alt="Image ${i}" width="200" height="140">`).join("")}`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const debugPort = await new Promise(done => { const s = portServer(); s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => done(port)); }); });
const profile = await mkdtemp(join(tmpdir(), "stashwell-auto-"));
const manifest = JSON.parse(await readFile(resolve("apps/extension/out/manifest.json"), "utf8"));
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
const extension = await localFixtureExtension(profile, [base]);
const browser = spawn(process.env.STASHWELL_BROWSER_PATH ?? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
let controller, worker, panel, source, other;
async function connectTarget(targetId) {
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item => item.id === targetId), "Target did not open");
  const client = new Cdp(target.webSocketDebuggerUrl); await client.ready(); return client;
}
try {
  const version = await until(async () => { try { return await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { return null; } }, "Browser did not start");
  controller = new Cdp(version.webSocketDebuggerUrl); await controller.ready();
  const versionTargets = () => controller.send("Target.getTargets");
  const workerTarget = await until(async () => (await versionTargets()).targetInfos.find(item => item.url.endsWith("/service-worker.js")), "Extension did not start");
  worker = await connectTarget(workerTarget.targetId);
  await until(() => worker.evaluate("typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)"), "Extension worker did not initialize");
  const panelUrl = `chrome-extension://${new URL(workerTarget.url).hostname}/index.html`;
  const read = () => worker.evaluate("fixtureHistory.read().then(data=>data['allhere.library.v1']||[])");
  const current = async (url = base + "/gallery") => (await read()).find(page => page.pageUrl === url);
  const add = (name, client = source) => client.evaluate(`(()=>{const image=new Image();image.src='/${name}.png';image.alt=${JSON.stringify(name)};image.width=200;image.height=140;document.body.append(image);})()`);
  const contains = async (name, url) => (await current(url))?.resources.some(resource => [resource.url, ...(resource.variantUrls ?? [])].some(source => source.endsWith(`/${name}.png`)));
  const waitResource = (name, url) => until(() => contains(name, url), `Automatic update missed ${name}`);
  const openPanel = () => controller.send("Target.createTarget", { url: panelUrl, background: true }).then(({ targetId }) => connectTarget(targetId));
  const click = selector => panel.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`, true);
  const menu = async label => {
    await click(".library-menu__trigger");
    await until(() => panel.evaluate("Boolean(document.querySelector('.library-menu__panel'))"), "Library menu did not open");
    await panel.evaluate(`[...document.querySelectorAll('.library-menu__item')].find(button=>button.textContent.trim().startsWith(${JSON.stringify(label)})).click()`, true);
  };
  const watchPermissionRequests = client => client.evaluate("globalThis.__permissionRequests=[];chrome.permissions.request=options=>{globalThis.__permissionRequests.push({origins:options.origins,gesture:navigator.userActivation?.isActive});return Promise.resolve(false);}");
  await watchPermissionRequests(worker);
  source = await connectTarget((await controller.send("Target.createTarget", { url: base + "/gallery" })).targetId);
  await source.send("Page.bringToFront");
  await until(() => source.evaluate("document.readyState==='complete' && !!document.querySelector('#image-0')"), "Gallery did not load");
  await add("before-panel");
  await delay(2800);
  assert.equal(await current(), undefined, "An existing host grant must not enable a tab before its first scan");
  panel = await openPanel();
  const expectScan = state => until(() => panel.evaluate(`document.querySelector('.button--scan')?.dataset.scanState===${JSON.stringify(state)} && !document.querySelector('.button--scan').disabled`), `Scan button did not show ${state}`);
  await expectScan("needed");
  await watchPermissionRequests(panel);
  assert.match(await panel.evaluate("document.querySelector('#scan-update-hint').textContent"), /Scan enables updates/);
  const manual = async () => {
    await until(() => panel.evaluate("document.querySelector('.button--scan')?.disabled===false"), "Scan is still busy");
    await click(".button--scan");
    await until(() => panel.evaluate("document.querySelector('.notice')?.textContent.includes('saved from')"), "Manual refresh did not complete");
  };
  // The source is declared after the page loads and stays pending until released.
  // A scan can save the URL immediately, then update its natural dimensions.
  await source.evaluate("const pending=new Image(50,40);pending.src='/pending.png';pending.alt='Pending image';document.body.append(pending);");
  await until(() => pendingImage, "The deferred image request did not start");
  const startedAt = performance.now();
  await manual();
  const scanTime = performance.now() - startedAt;
  assert.ok(scanTime < 1_150, `Scan stalled on an unfinished image (${Math.round(scanTime)}ms)`);
  await expectScan("ready");
  await waitResource("pending");
  assert.equal(await source.evaluate("document.querySelector('img[alt=\"Pending image\"]').complete"), false);
  pendingImage.writeHead(200, { "Content-Type": "image/png" }).end(png);
  await until(async () => (await current())?.resources.some(resource => resource.alt === "Pending image" && resource.width === 200 && resource.height === 140),
    "Finishing the pending image did not refresh its dimensions");
  await waitResource("before-panel");
  assert.equal((await current()).faviconUrl, base + "/favicon.svg");
  assert.match(await panel.evaluate("document.querySelector('#scan-update-hint').textContent"), /Updates automatically/);
  const first = (await current()).resources.find(resource => resource.url.endsWith("/image-0.png"));
  await panel.evaluate(`fixtureHistory.read().then(data=>{data['allhere.library.v1'][0].resources.find(resource=>resource.id===${JSON.stringify(first.id)}).saved=true;return fixtureHistory.write(data);})`);
  await click('[data-resource-tab="images"]'); await click('[aria-label="List view"]');
  await panel.evaluate("window.scrollTo(0,160)");
  const scroll = await panel.evaluate("window.scrollY");
  await add("automatic-image"); await waitResource("automatic-image");
  await source.evaluate("window.__detached=new Image();window.__detached.src='/detached-auto.png'");
  await waitResource("detached-auto");
  const retained = (await current()).resources.find(resource => resource.id === first.id);
  assert.ok(retained?.saved, "Automatic refresh must retain bookmarks and resource IDs");
  assert.equal(await panel.evaluate("document.querySelector('[aria-selected=true][data-resource-tab]').dataset.resourceTab"), "images");
  assert.equal(await panel.evaluate("document.querySelector('[aria-label=\"List view\"]').getAttribute('aria-pressed')"), "true");
  assert.equal(await panel.evaluate("window.scrollY"), scroll, "Automatic refresh must preserve scroll");
  await source.evaluate("const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='live-svg';svg.setAttribute('aria-label','Dynamic icon');svg.setAttribute('width','24');svg.setAttribute('height','24');svg.innerHTML='<path d=\"M0 0h12v12H0z\"/>';document.body.append(svg)");
  const iconBefore = await until(async () => (await current())?.resources.find(resource => resource.label === 'Dynamic icon'), 'Dynamic SVG was not collected');
  await source.evaluate("document.querySelector('#live-svg path').setAttribute('d','M0 0h20v20H0z')");
  await until(async () => (await current())?.resources.some(resource => resource.label === 'Dynamic icon' && resource.url !== iconBefore.url), 'SVG attribute updates were not collected');
  await source.evaluate("document.querySelector('#live-svg').innerHTML='<circle cx=\"12\" cy=\"12\" r=\"4\" fill=\"red\"/>'");
  const circleBefore = await until(async () => (await current())?.resources.find(resource => resource.label === 'Dynamic icon' && decodeURIComponent(resource.url).includes('r=\"4\"')), 'Circle icon was not collected');
  await source.evaluate("document.querySelector('#live-svg circle').setAttribute('r','9')");
  await until(async () => (await current())?.resources.some(resource => resource.label === 'Dynamic icon' && resource.url !== circleBefore.url && decodeURIComponent(resource.url).includes('r=\"9\"')), 'Circle geometry changes must trigger capture');
  await source.evaluate("const lazy=document.createElement('img');lazy.id='lazy-auto';lazy.setAttribute('data-src','/lazy-auto.png');document.body.append(lazy)");
  await waitResource('lazy-auto');
  const lazyBefore = (await current()).resources.find(resource=>resource.url.endsWith('/lazy-auto.png'));
  await source.evaluate("document.querySelector('#lazy-auto').setAttribute('data-lazy-srcset','/lazy-auto-next.png 2x')");
  await waitResource('lazy-auto-next');
  const lazyAfter = (await current()).resources.filter(resource=>[resource.url,...(resource.variantUrls??[])].some(url=>url.includes('/lazy-auto')));
  assert.equal(lazyAfter.length,1,'Discovering another responsive source must update one item without adding a card');
  assert.equal(lazyAfter[0].id,lazyBefore.id,'Automatic variant discovery must retain the existing image ID');
  await source.evaluate("const host=document.createElement('div');host.id='closed-auto-host';document.body.append(host)");
  await source.evaluate("window.__closedRoot=document.querySelector('#closed-auto-host').attachShadow({mode:'closed'});window.__closedRoot.innerHTML='<img src=\"/closed-auto.png\" width=\"200\" height=\"140\">'");
  await waitResource('closed-auto');
  await source.evaluate("window.__closedRoot.querySelector('img').src='/closed-auto-next.png'");
  await waitResource('closed-auto-next');
  await source.evaluate("const root=document.querySelector('#shadow-host').attachShadow({mode:'open'});root.innerHTML='<img src=\"/shadow-auto.png\" alt=\"Shadow auto\" width=\"200\" height=\"140\">'");
  await waitResource("shadow-auto");
  await source.evaluate("const frame=document.createElement('iframe');frame.src='/frame';document.body.append(frame)");
  await waitResource("frame");
  await source.evaluate("const image=new Image();image.src='/frame-later.png';image.alt='Frame later';image.width=200;image.height=140;document.querySelector('iframe').contentDocument.body.append(image)");
  await waitResource("frame-later");

  await menu("Manage");
  await add("while-managing"); await waitResource("while-managing");
  const clickDelete = async selector => {
    await until(() => panel.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), "Delete button did not render");
    await click(selector);
  };
  await click('[aria-label="Manage items from Auto gallery"]');
  await clickDelete('[aria-label="Delete Image 0"]');
  await until(async () => !(await current())?.resources.some(resource => resource.url.endsWith("/image-0.png")), "Item deletion failed");
  await add("after-item-deletion"); await waitResource("after-item-deletion");
  assert.ok(!(await current()).resources.some(resource => resource.url.endsWith("/image-0.png")), "Background updates restored a deleted item");
  await click('[aria-label="Back to captured pages"]');
  await clickDelete('[aria-label="Delete page Auto gallery"]');
  await until(async () => !await current(), "Page deletion failed");
  await add("after-page-deletion"); await delay(3200);
  assert.equal(await current(), undefined, "Background capture restored a deleted page");
  await menu("All resources");
  await manual(); await waitResource("after-page-deletion");

  assert.deepEqual(await panel.evaluate("window.__permissionRequests"), [], "First scan on an approved site should reuse the grant");
  const panelTarget = (await versionTargets()).targetInfos.find(target => target.url === panelUrl);
  await controller.send("Target.closeTarget", { targetId: panelTarget.targetId });
  panel.close(); panel = undefined;
  await source.send("Page.bringToFront");
  await add("after-panel-close"); await waitResource("after-panel-close");

  const otherUrl = base + "/gallery?second=1";
  other = await connectTarget((await controller.send("Target.createTarget", { url: otherUrl })).targetId);
  await other.send("Page.bringToFront");
  panel = await openPanel();
  await expectScan("needed");
  await watchPermissionRequests(panel);
  await delay(2800);
  assert.equal(await current(otherUrl), undefined, "Another tab must ask for its own first scan on the same site");
  await manual();
  await waitResource("image-0", otherUrl);
  await add("inactive-image"); await delay(3200);
  assert.ok(!await contains("inactive-image"), "Inactive tabs must wait until they become active");
  await source.send("Page.bringToFront"); await waitResource("inactive-image");

  // Pause a worker capture after injection, then navigate before it can save.
  const staleUrl = base + "/gallery?stale=1";
  const nextUrl = base.replace("127.0.0.1", "localhost") + "/gallery?next=1";
  await worker.evaluate(`globalThis.__executeCapture=chrome.scripting.executeScript.bind(chrome.scripting); chrome.scripting.executeScript=async options=>{
    const result=await __executeCapture(options);
    if(options.func && result.some(frame=>frame.result?.pageUrl===${JSON.stringify(staleUrl)})) {
      await new Promise(resolve=>globalThis.__releaseStale=resolve);
    }
    return result;
  };`);
  await source.send("Page.navigate", { url: staleUrl });
  await until(() => worker.evaluate("typeof __releaseStale==='function'"), "Capture did not reach the navigation checkpoint");
  await source.send("Page.navigate", { url: nextUrl });
  await until(() => source.evaluate(`document.readyState==='complete'&&location.href===${JSON.stringify(nextUrl)}`), "Cross-origin page did not load");
  await worker.evaluate("__releaseStale();chrome.scripting.executeScript=__executeCapture;");
  await expectScan("needed");
  await click(".button--scan");
  await until(() => panel.evaluate("document.querySelector('.notice')?.textContent.includes('Website access was declined')"), "A declined grant did not show the scan notice");
  assert.deepEqual(await panel.evaluate("window.__permissionRequests"), [{ origins: ["http://localhost/*"], gesture: true }]);
  assert.equal(await current(nextUrl), undefined, "A different site must not be captured without approval");
  assert.equal(await current(staleUrl), undefined, "An outdated capture was saved after navigation");
  assert.deepEqual(await worker.evaluate("globalThis.__permissionRequests"), [], "Background collection must never request permission");

  const orderUrl = base + '/order';
  await source.send('Page.navigate', { url: orderUrl });
  await until(() => source.evaluate("document.readyState==='complete'&&window.__orderReady"), 'Ordered fixture did not finish loading');
  await expectScan("needed");
  assert.equal(await current(orderUrl), undefined, "Returning to an approved site after leaving its origin must require a scan");
  await manual();
  const names = page => page.resources.filter(resource => resource.kind === 'image').map(resource => resource.description || resource.alt || resource.label);
  const initialOrder = ['Background first', 'Blob second', 'Flex third', 'Row left', 'Row right', 'Regular image', 'Shadow image', 'Pseudo before frame', 'Frame before', 'Nested frame', 'Frame after', 'Poster image', 'Last image', 'Second frame before', 'Second frame after', 'Hidden image'];
  const waitOrder = (expected, message) => until(async () => JSON.stringify(names(await current(orderUrl) ?? { resources: [] })) === JSON.stringify(expected), message);
  await waitOrder(initialOrder, 'Initial image order differs from rendered page order');
  const ordered = await current(orderUrl);
  assert.ok(ordered.resources.every(resource => !('position' in resource)), 'Temporary layout coordinates must not be stored');
  const stable = ordered.resources.find(resource => resource.alt === 'Regular image');
  await panel.evaluate(`fixtureHistory.read().then(data=>{data['allhere.library.v1'].find(page=>page.pageUrl===${JSON.stringify(orderUrl)}).resources.find(resource=>resource.id===${JSON.stringify(stable.id)}).saved=true;return fixtureHistory.write(data);})`);
  const albumNames = await panel.evaluate(`[...document.querySelectorAll('[data-album-page="${ordered.id}"] [data-album-category="images"] .resource-album__tile')].map(button=>button.getAttribute('aria-label').replace(/^Preview /,''))`);
  assert.deepEqual(albumNames, initialOrder.slice(0, 10), 'Image album must keep source order');
  await click('[data-resource-tab="images"]'); await click('[aria-label="Grid view"]');
  await until(() => panel.evaluate(`document.querySelectorAll('.resource-card').length===${initialOrder.length}`), 'Ordered grid did not render');
  assert.deepEqual(await panel.evaluate("[...document.querySelectorAll('.resource-card')].map(button=>button.getAttribute('aria-label'))"), initialOrder, 'Image grid must keep source order');
  await click('[aria-label="List view"]');
  assert.deepEqual(await panel.evaluate("[...document.querySelectorAll('.table-name strong')].map(element=>element.textContent)"), initialOrder, 'Image list must keep source order');

  await source.evaluate("(async()=>{document.body.prepend(document.querySelector('#last-image'));const image=new Image();image.src='/order-new.png';image.alt='New first';image.width=200;image.height=140;document.body.prepend(image);await image.decode();})()");
  const manualOrder = ['New first', 'Last image', ...initialOrder.filter(name => name !== 'Last image')];
  await click('.button--scan');
  await waitOrder(manualOrder, 'Manual rescan retained the old order or appended a new first image');
  await until(() => panel.evaluate("document.querySelector('.button--scan').disabled===false"), 'Ordered manual scan stayed busy');
  await source.evaluate("document.querySelector('#background').style.order='4'");
  const autoOrder = [...manualOrder];
  autoOrder.splice(autoOrder.indexOf('Background first'), 1);
  autoOrder.splice(autoOrder.indexOf('Flex third') + 1, 0, 'Background first');
  await waitOrder(autoOrder, 'An automatic scan ignored an order-only CSS change');
  const afterMove = (await current(orderUrl)).resources.find(resource => resource.id === stable.id);
  assert.ok(afterMove?.saved, 'Reordering must preserve resource IDs and bookmarks');
  const unchangedAt = (await current(orderUrl)).capturedAt;
  await source.evaluate("document.body.setAttribute('class','same-layout')");
  await delay(4200);
  assert.equal((await current(orderUrl)).capturedAt, unchangedAt, 'Unchanged ordering must not rewrite the library');
  await worker.evaluate(`globalThis.__beforeCount=chrome.scripting.executeScript.bind(chrome.scripting);globalThis.__scans=0;
    chrome.scripting.executeScript=options=>{if(options.func)__scans++;return __beforeCount(options);};`);
  await source.evaluate("let ticks=0;window.__ticker=setInterval(()=>{document.querySelector('#capture-clock').textContent=String(++ticks);},90)");
  await delay(4_800);
  assert.equal(await worker.evaluate("__scans"), 0, "An unrelated ticking counter triggered a full scan");
  await source.evaluate("clearInterval(window.__ticker);document.querySelector('#capture-link').textContent='Updated link name';");
  await until(async () => (await current(orderUrl))?.resources.some(resource => resource.label === "Updated link name"), "Link text changes must still refresh names");
  await worker.evaluate("chrome.scripting.executeScript=__beforeCount");
  await source.evaluate("document.querySelector('#flex-third').remove()");
  const retainedOrder = [...autoOrder.filter(name => name !== 'Flex third'), 'Flex third'];
  await waitOrder(retainedOrder, 'Previously captured missing images must be retained after current page images');
  const persisted = await current(orderUrl);
  assert.equal(await panel.evaluate('window.__permissionRequests.length'), 1, 'Ordering must never request additional site access');
  await panel.send('Page.reload');
  await until(() => panel.evaluate("document.querySelector('.button--scan')?.disabled===false"), 'Panel did not reload after ordering');
  assert.deepEqual(names(await current(orderUrl)), names(persisted), 'Image order must persist after reopening');
  console.log("PASS first scan per tab, permissions and navigation, background updates, pending images, idle text, resource names and order, and deletion exclusions.");
} finally {
  try { await controller?.send("Browser.close"); } catch { /* Already closed. */ }
  for (const client of [panel, source, other, worker, controller]) client?.close();
  browser.kill(); server.closeAllConnections(); server.close();
}
