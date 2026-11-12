// Real installed-extension checks for developer inspection. All fixture traffic is local.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { localFixtureExtension } from "./extension-fixture.mjs";
import { createArchive, parseArchive, normalizeDevInspection, selectMostUsedDevColors } from "../packages/core/src/index.ts";

const delay = ms => new Promise(done => setTimeout(done, ms));
async function until(check, message, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(100); }
  throw Error(message);
}
class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url); this.pending = new Map(); this.id = 0;
    this.socket.addEventListener("message", event => {
      const value = JSON.parse(event.data), entry = this.pending.get(value.id);
      if (!entry) return;
      this.pending.delete(value.id); clearTimeout(entry.timer);
      value.error ? entry.reject(Error(value.error.message)) : entry.done(value.result);
    });
  }
  async ready() {
    if (this.socket.readyState !== WebSocket.OPEN) await new Promise((done, reject) => {
      this.socket.addEventListener("open", done, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((done, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`${method} timed out`)); }, 25_000);
      this.pending.set(id, { done, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, userGesture = false) {
    const value = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture });
    if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
    return value.result.value;
  }
  close() { for (const entry of this.pending.values()) clearTimeout(entry.timer); this.pending.clear(); this.socket.close(); }
}

const PRIVATE_FORM = "PRIVATE_FORM_VALUE_7c3f991";
const PRIVATE_INLINE = "PRIVATE_INLINE_STATE_a761b8";
const PRIVATE_CSS = "PRIVATE_CSS_SECRET_3b8a91";
const PRIVATE_API_CSS = "PRIVATE_API_SECRET_519ba7";
const extraColors = Array.from({ length: 18 }, (_, index) => `#${(0x204060 + index * 0x050303).toString(16).padStart(6, "0")}`);
const rankedFixture = extraColors.map((hex, index) => ({ hex, rgb: "", hsl: "", count: index + 2, properties: [], variables: [] }));
assert.deepEqual(selectMostUsedDevColors([...rankedFixture, { ...rankedFixture[0], hex: "#ff000080", count: 999 }]).map(color => color.hex), extraColors.slice(-12).reverse(), "Only the highest 12 opaque repeated colors belong in the selected palette");
assert.equal(selectMostUsedDevColors(rankedFixture.map(color => ({ ...color, count: 1 }))).length, 12, "A page with only single uses still gets a bounded palette");
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#eeb13b"/></svg>';
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (path.endsWith(".svg")) { response.writeHead(200, { "Content-Type": "image/svg+xml" }).end(image); return; }
  if (path === "/_next/static/fixture.js") { response.writeHead(200, { "Content-Type": "text/javascript" }).end("window.__fixtureScriptLoaded=true;"); return; }
  if (path === "/fixture.css") {
    response.writeHead(200, { "Content-Type": "text/css" }).end(`:root{--fixture-accent:#1769e0;--fixture-surface:#f4f7fb;--session-token:"${PRIVATE_CSS}";--apiKey:"${PRIVATE_API_CSS}";--api-key:#1769e0;--authToken:#1769e0;--secret-color:#1769e0;--design-token:#1769e0;--color-token:#1769e0}body{margin:24px;font:16px Arial,sans-serif;background:var(--fixture-surface);color:#182b45}h1,h2,.accent{color:var(--fixture-accent)}.tile{padding:14px;background:var(--fixture-accent);color:white;background-image:linear-gradient(90deg,${extraColors.join(",")})}.alpha{background:rgba(220,40,50,.5);padding:10px}button{border:2px solid var(--fixture-accent);color:var(--fixture-accent)}img{display:block}input,textarea{display:block}`);
    return;
  }
  const second = path === "/second";
  response.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${second ? "Second developer fixture" : "Developer fixture"}</title><meta name="description" content="${second ? "Second page inspection description" : "Developer fixture public description"}"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="index,follow"><meta name="generator" content="Next.js fixture"><meta name="author" content="Fixture author"><meta name="theme-color" content="#1769e0"><meta property="og:title" content="Developer fixture social title"><meta property="og:image" content="/social.svg"><meta name="twitter:card" content="summary_large_image"><link rel="canonical" href="${second ? "/second" : "/canonical"}"><link rel="alternate" hreflang="fr" href="/fr"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/fixture.css"><script src="/_next/static/fixture.js" defer></script></head><body><header>Fixture header</header><main><h1>${second ? "Second page" : "Developer fixture"}</h1><h2>First section</h2><h2>Second section</h2><p class="accent">Public sample</p><div class="tile">Accent surface</div><div class="alpha">Transparent surface</div><img src="/sample.svg" width="120" height="80" alt="Fixture image"><img src="/missing-alt.svg" width="120" height="80"><a href="/another">Internal link</a><a href="http://localhost:${server.address().port}/external">Other host link</a><button type="button">Fixture button</button><form><input value="${PRIVATE_FORM}" autocomplete="off"><textarea>${PRIVATE_FORM}</textarea></form><svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg></main><footer>Fixture footer</footer><script>window.__privateFixtureState=${JSON.stringify(PRIVATE_INLINE)};</script></body></html>`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "stashwell-dev-"));
const extension = await localFixtureExtension(profile, [base]);
const browser = spawn(process.env.STASHWELL_BROWSER_PATH ?? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
let controller, panel, source, secondSource;
const modelPanel = `(()=>{if(globalThis.__devModelInstalled||!globalThis.chrome?.scripting?.executeScript)return;
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});
  globalThis.__captures=0;globalThis.__activeCaptures=0;globalThis.__permissionPrompts=0;
  const execute=chrome.scripting.executeScript.bind(chrome.scripting);chrome.scripting.executeScript=async options=>{
    if(!options.func)return execute(options);globalThis.__captures++;globalThis.__activeCaptures++;
    try{return await execute(options)}finally{globalThis.__activeCaptures--}
  };chrome.permissions.request=async()=>{globalThis.__permissionPrompts++;return false};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{globalThis.__copied=value}}});
  globalThis.__devModelInstalled=true;})();`;
try {
  const port = await until(async () => { try { return Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch { return null; } }, "Browser did not start");
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  controller = new Cdp(version.webSocketDebuggerUrl); await controller.ready();
  const open = async url => {
    const { targetId } = await controller.send("Target.createTarget", { url });
    const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.id === targetId && item.webSocketDebuggerUrl), "Target did not open");
    const client = new Cdp(target.webSocketDebuggerUrl); await client.ready(); await client.send("Page.enable"); return client;
  };
  const worker = await until(async () => (await controller.send("Target.getTargets")).targetInfos.find(item => item.url.startsWith("chrome-extension:") && item.url.endsWith("service-worker.js")), "Extension did not load");
  panel = await open(`chrome-extension://${new URL(worker.url).hostname}/index.html`);
  await panel.send("Page.addScriptToEvaluateOnNewDocument", { source: modelPanel });
  await panel.send("Page.reload");
  await panel.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
  await until(() => panel.evaluate("Boolean(document.querySelector('.button--scan'))"), "Panel did not render");
  await panel.evaluate(modelPanel);
  source = await open(base);
  await source.send("Page.bringToFront");
  await until(() => source.evaluate("document.readyState==='complete' && window.__fixtureScriptLoaded"), "Source fixture did not load");
  await source.evaluate(`(()=>{
    const noise=document.createElement('div'); noise.style.cssText='height:10px;background-image:linear-gradient(90deg,'+Array.from({length:600},(_,i)=>'#'+(0xb00000+i*8).toString(16)).join(',')+')';
    document.querySelector('main').prepend(noise);
    const probes=document.createElement('div');probes.innerHTML='<div style="opacity:.5;background:#12ab34"><span style="background:#23bc45">Faded child</span></div><div style="opacity:0"><span style="background:#34cd56">Invisible child</span></div><div style="filter:opacity(50%);background:#45de67">Filtered</div><svg width="20" height="20"><rect width="20" height="20" fill="#56ef78" fill-opacity=".5" stroke="#67fa89" stroke-width="2" stroke-opacity=".4"/></svg>';
    for(let i=0;i<20;i++){const chip=document.createElement('i');chip.style.cssText='display:inline-block;width:2px;height:2px;background:#d35400';probes.appendChild(chip)}
    const svgText=document.createElementNS('http://www.w3.org/2000/svg','svg');svgText.setAttribute('width','120');svgText.setAttribute('height','40');svgText.innerHTML='<text y="15" fill="#789abc" style="color:#8abcde">Visible fill</text><text y="35" fill="#789abc" style="color:#8abcde">Visible fill</text>';probes.appendChild(svgText);
    document.querySelector('main').appendChild(probes);
  })()`);
  const read = () => panel.evaluate("chrome.storage.local.get('allhere.library.v1').then(value=>value['allhere.library.v1']||[])");
  const current = async (url = base + "/") => (await read()).find(page => page.pageUrl === url);
  const count = () => panel.evaluate("globalThis.__captures");
  const click = (selector, client = panel) => client.evaluate(`(()=>{const target=document.querySelector(${JSON.stringify(selector)});if(!target)throw Error('Missing control: '+${JSON.stringify(selector)});target.click()})()`, true);
  const devSwitch = '[role="switch"][aria-label="Dev mode"]';
  const setDevMode = async (enabled, client = panel) => {
    await until(() => client.evaluate(`document.querySelector(${JSON.stringify(devSwitch)})?.disabled===false`), "Dev mode switch is not ready");
    if (await client.evaluate(`document.querySelector(${JSON.stringify(devSwitch)}).getAttribute('aria-checked')`) !== String(enabled)) await click(devSwitch, client);
    await until(() => client.evaluate(`document.querySelector(${JSON.stringify(devSwitch)}).getAttribute('aria-checked')===${JSON.stringify(String(enabled))}`), "Dev mode switch state did not update");
  };
  const legacy = { id: "dev-fixture-legacy", pageUrl: base + "/", pageTitle: "Developer fixture", hostname: "127.0.0.1", capturedAt: "2026-10-20T00:00:00.000Z", resources: [] };
  await panel.evaluate(`chrome.storage.local.set({'allhere.library.v1':${JSON.stringify([legacy])}})`);
  await panel.send("Page.reload");
  await until(() => panel.evaluate("Boolean(document.querySelector('[data-resource-tab=images]'))"), "Legacy library did not load");
  await panel.evaluate(modelPanel);
  await source.send("Page.bringToFront");
  await until(() => panel.evaluate(`document.querySelector('.page-scope__selection')?.textContent.includes('Developer fixture')`), "Legacy source page did not become active");
  assert.equal(await count(), 0, "Opening an existing library must not scan a page");
  await setDevMode(true);
  assert.equal(await panel.evaluate("document.querySelectorAll('[data-resource-tab]').length"), 0, "Developer tabs must replace resource tabs while enabled");
  assert.equal(await panel.evaluate("document.querySelector('[data-dev-tab=info]')?.getAttribute('role')"), "tab");
  assert.equal(await panel.evaluate("document.querySelector('[data-dev-tab=colors]')?.getAttribute('role')"), "tab");
  assert(await panel.evaluate("(()=>{const tab=document.querySelector('[data-dev-tab=components]');return Boolean(tab&&(tab.disabled||tab.getAttribute('aria-disabled')==='true'))})()"), "Components must be clearly unavailable until implemented");
  await delay(700);
  assert.equal(await count(), 0, "Turning on Dev mode must not inject a scan or request site access");
  assert.equal((await current()).devInspection, undefined);
  assert.match(await panel.evaluate("document.querySelector('[data-dev-panel]')?.textContent||document.querySelector('.resource-section')?.textContent||''"), /scan|capture|inspect/i, "Legacy capture must offer a clear manual rescan empty state");
  console.log("Verified legacy capture empty state and zero scans or prompts on Dev mode toggle.");

  await until(() => panel.evaluate("document.querySelector('.button--scan')?.disabled===false"), "Manual scan unavailable");
  await click(".button--scan");
  const saved = await until(async () => { const page = await current(); return page?.devInspection ? page : null; }, "Manual scan did not save developer metadata");
  const inspection = saved.devInspection;
  const selectedColors = inspection.colors.filter(color => color.count > 1).slice(0, 12);
  assert.equal(inspection.version, 1);
  assert.equal(inspection.page.title, "Developer fixture");
  assert.equal(inspection.page.description, "Developer fixture public description");
  assert.equal(inspection.page.canonicalUrl, `${base}/canonical`);
  assert.equal(inspection.page.ogImageUrl, `${base}/social.svg`);
  assert.equal(inspection.page.language, "en");
  assert.match(inspection.page.viewport, /width=device-width/);
  assert(inspection.page.metadata.some(entry => entry.name === "twitter:card" && entry.value === "summary_large_image"));
  assert(inspection.page.links.some(entry => entry.rel === "alternate" && entry.url === `${base}/fr`));
  assert.equal(inspection.document.headingCounts.h1, 1);
  assert.equal(inspection.document.headingCounts.h2, 2);
  assert.equal(inspection.document.formCount, 1);
  assert(inspection.document.inputCount >= 1);
  assert(inspection.document.imageCount >= 2);
  assert(inspection.document.imagesWithoutAlt >= 1);
  assert(inspection.document.elementCount > inspection.document.imageCount);
  assert(inspection.document.externalLinkCount >= 1);
  assert(inspection.technologies.some(technology => /next\.js/i.test(technology.name) && technology.evidence.length > 0), "Technology detection must have observable evidence");
  const accent = inspection.colors.find(color => color.hex.toLowerCase() === "#1769e0");
  assert(accent && accent.count >= 3, "Repeated rendered accent colors must have meaningful usage counts");
  assert(accent.variables.includes("--fixture-accent"));
  assert(accent.variables.includes("--design-token") && accent.variables.includes("--color-token"), "Ordinary design token names must remain available");
  for (const name of ["--session-token", "--apiKey", "--api-key", "--authToken", "--secret-color"]) {
    assert(!inspection.cssVariables.some(variable => variable.name === name), `Sensitive CSS variable ${name} must not be recorded`);
    assert(!inspection.colors.some(color => color.variables.includes(name)), `Sensitive CSS variable ${name} must not leak through color references`);
  }
  assert(accent.properties.some(property => property === "color" || property === "background-color"));
  assert(inspection.colors.every(color => /^#[\da-f]{6}$/i.test(color.hex)), "Transparent and semi-transparent colors must be excluded");
  for (const hex of extraColors) assert(inspection.colors.some(color => color.hex === hex), `Opaque gradient color ${hex} must be captured`);
  assert(inspection.colors.length > 12, "Fixture must exercise the old most-used palette limit");
  assert.equal(inspection.colors.length, 500, "The persisted color limit must apply after all candidates are counted");
  assert(inspection.colors.some(color => color.hex === "#d35400" && color.count === 20), "A dominant late color must survive 600 earlier one-off colors");
  for (const hex of ["#12ab34", "#23bc45", "#34cd56", "#45de67", "#56ef78", "#67fa89"]) assert(!inspection.colors.some(color => color.hex === hex), `Faded/invisible element or SVG paint ${hex} must not enter the palette`);
  assert(!inspection.colors.some(color => color.hex === "#8abcde"), "Unused SVG text color must not count as painted color");
  assert(inspection.colors.some(color => color.hex === "#789abc" && color.count === 2), "Actual repeated SVG text fill must be counted");
  assert(inspection.cssVariables.some(variable => variable.name === "--fixture-accent"));
  assert(!inspection.colors.some(color => color.hex.toLowerCase() === "#eeb13b"), "Image pixels must not be reported as computed CSS colors");
  assert(inspection.coverage.sampledElements > 0);
  assert(inspection.viewport.width > 0 && inspection.viewport.height > 0);
  assert(!JSON.stringify(inspection).includes(PRIVATE_FORM), "Developer inspection must not capture private form values");
  assert(!JSON.stringify(inspection).includes(PRIVATE_INLINE), "Developer inspection must not capture private inline JavaScript state");
  assert(!JSON.stringify(inspection).includes(PRIVATE_CSS) && !JSON.stringify(inspection).includes(PRIVATE_API_CSS), "Developer inspection must not retain credential values exposed through CSS variables");
  console.log("Verified actual SEO, source URLs, DOM counts, detected technology evidence, opaque colors, transparency exclusion, and private-data exclusions.");

  const archive = createArchive([saved]);
  const archiveJson = JSON.stringify(archive, null, 2);
  const restored = parseArchive(JSON.parse(archiveJson)).captures[0];
  assert.deepEqual(restored.devInspection, inspection, "Developer snapshots must survive JSON backup/import unchanged");
  const tainted = structuredClone(inspection);
  tainted.page.canonicalUrl = "javascript:alert('unsafe-canonical')";
  tainted.page.ogImageUrl = "data:text/html,unsafe-social";
  tainted.page.links.push({ rel: "alternate", url: "javascript:alert('unsafe-link')" });
  tainted.colors.push({ hex: "url(javascript:unsafe-color)", rgb: "url(javascript:unsafe-color)", hsl: "url(javascript:unsafe-color)", count: 1, properties: ["color"], variables: [] });
  for (const hex of ["#12345680", "#12345600", "#654321ff"]) tainted.colors.push({ ...inspection.colors[0], hex });
  tainted.colors[0].properties.push("color; background:url(javascript:unsafe-property)");
  tainted.cssVariables.push({ name: "--injected; color:red", value: "#fff" });
  for (const name of ["--session-token", "--apiKey", "--api-key", "--authToken", "--secret-color"]) {
    tainted.cssVariables.push({ name, value: "#1769e0" });
    tainted.colors[0].variables.push(name);
  }
  const normalized = normalizeDevInspection(tainted);
  assert(normalized, "Rejecting unsafe optional fields must preserve a valid inspection");
  assert(!JSON.stringify(normalized).includes("javascript:"));
  assert(!JSON.stringify(normalized).includes("data:text/html"));
  assert(!normalized.cssVariables.some(variable => variable.name.includes(";")));
  assert(!normalized.colors.some(color => /url\(/i.test(color.hex)));
  assert(!normalized.colors.some(color => color.properties.some(property => property.includes(";"))));
  assert(!normalized.colors.some(color => color.hex.startsWith("#123456")), "Legacy/imported transparent palette entries must be excluded");
  assert(normalized.colors.some(color => color.hex === "#654321"), "Fully opaque eight-digit colors must be retained and canonicalized");
  assert(normalized.cssVariables.some(variable => variable.name === "--design-token"), "Imported ordinary design tokens must survive normalization");
  for (const name of ["--session-token", "--apiKey", "--api-key", "--authToken", "--secret-color"]) {
    assert(!normalized.cssVariables.some(variable => variable.name === name), `Imported sensitive CSS variable ${name} must be removed`);
    assert(!normalized.colors.some(color => color.variables.includes(name)), `Imported sensitive CSS variable reference ${name} must be removed`);
  }
  const archivePath = join(profile, "developer-library.json");
  await writeFile(archivePath, archiveJson, "utf8");
  await panel.send("DOM.enable");
  const { root } = await panel.send("DOM.getDocument");
  const input = await panel.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"][accept*="json"]' });
  assert(input.nodeId, "Library JSON import control is missing");
  await panel.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [archivePath] });
  await until(() => panel.evaluate("document.querySelector('.notice')?.textContent.includes('imported')"), "Actual library JSON import did not finish");
  assert.deepEqual((await current()).devInspection, inspection, "Actual import must retain the developer snapshot");
  console.log("Verified snapshot JSON round trip, actual import, and rejection of unsafe URLs, colors, properties, and custom-property names.");

  await setDevMode(false);
  await click('[data-resource-tab="images"]');
  await click('[aria-label="List view"]');
  assert.equal(await panel.evaluate("document.querySelector('[aria-label=\"List view\"]').getAttribute('aria-pressed')"), "true");
  const beforeToggle = await count();
  await setDevMode(true);
  await click('[data-dev-tab="colors"]');
  assert.equal(await panel.evaluate("document.querySelector('[data-dev-tab=colors]').getAttribute('aria-selected')"), "true");
  await setDevMode(false);
  assert.equal(await panel.evaluate("document.querySelector('[data-resource-tab=images]').getAttribute('aria-selected')"), "true", "Leaving Dev mode must restore the resource category");
  assert.equal(await panel.evaluate("document.querySelector('[aria-label=\"List view\"]').getAttribute('aria-pressed')"), "true", "Leaving Dev mode must restore the selected layout");
  assert.equal(await count(), beforeToggle, "Developer tab and layout changes must not scan the source page");
  await setDevMode(true);
  await click('[data-dev-tab="info"]');
  assert.match(await panel.evaluate("document.querySelector('[data-dev-panel]').textContent"), /Developer fixture public description/);
  assert.equal(await panel.evaluate("document.querySelector('.dev-site__source a')?.href"), base + "/");
  assert.equal(await panel.evaluate("document.querySelectorAll('.dev-palette-strip button').length"), selectedColors.length, "Info must show only the most-used repeated opaque colors");
  await click('[aria-label="Copy most-used colors"]');
  assert.deepEqual((await panel.evaluate("globalThis.__copied")).split("\n"), selectedColors.map(color => color.hex), "Info copy must include exactly the selected most-used colors");
  assert(!await panel.evaluate("document.querySelector('[data-dev-panel]').textContent.includes('Asset path contains') || document.querySelector('[data-dev-panel]').textContent.includes('DOM includes') || document.querySelector('[data-dev-panel]').textContent.includes('Computed CSS from')"), "Info must omit internal detection and coverage explanations");
  assert.match(await panel.evaluate("document.querySelector('.dev-tech-list').textContent"), /Next\.js/, "Technology names must remain visible");
  await click('[aria-label="Copy page URL"]');
  assert.equal(await panel.evaluate("globalThis.__copied"), base + "/", "Info must offer the usable source URL");
  await click('[data-dev-tab="colors"]');
  const rankedHexes = await panel.evaluate("[...document.querySelectorAll('[data-dev-color]')].map(card=>card.dataset.devColor)");
  assert.deepEqual(rankedHexes, selectedColors.map(color => color.hex), "Colors must list only the top repeated opaque colors in usage order");
  const paletteHexes = await panel.evaluate("[...document.querySelectorAll('.dev-palette-strip button')].map(button=>button.getAttribute('aria-label').split(',')[0].slice(5))");
  assert.deepEqual(paletteHexes, rankedHexes, "Most-used palette must include every displayed color in ranked order");
  assert(!await panel.evaluate("document.querySelector('[data-dev-panel]').textContent.includes('CSS custom properties') || document.querySelector('[data-dev-panel]').textContent.includes('Computed CSS from')"), "Colors must omit custom-properties section and scan explanations");
  const rankedCounts = rankedHexes.map(hex => inspection.colors.find(color => color.hex === hex).count);
  assert(rankedCounts.every((count, index) => !index || rankedCounts[index - 1] >= count), "Palette must rank the most-used colors first");
  await click('[aria-label="Copy all colors"]');
  assert.deepEqual((await panel.evaluate("globalThis.__copied")).split("\n"), rankedHexes, "Copy all must use the shown palette order");
  await click('[aria-label="Copy palette CSS"]');
  assert.equal(await panel.evaluate("(()=>{const sheet=new CSSStyleSheet();sheet.replaceSync(globalThis.__copied);return sheet.cssRules[0]?.style.length})()"), selectedColors.length, "Copied palette CSS must contain only the selected colors");
  for (const format of ["RGB", "HSL"]) {
    await panel.evaluate(`[...document.querySelector('[aria-label="Color format"]').querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(format)}).click()`, true);
    assert.match(await panel.evaluate("document.querySelector('.dev-color__heading strong').textContent"), format === "RGB" ? /^rgba?\(/ : /^hsla?\(/);
    await panel.evaluate("document.querySelector('.dev-color__swatch').click()", true);
    assert.match(await panel.evaluate("globalThis.__copied"), format === "RGB" ? /^rgba?\(/ : /^hsla?\(/, "A swatch copy must use the selected format");
  }
  await panel.evaluate("[...document.querySelector('[aria-label=\"Color format\"]').querySelectorAll('button')].find(button=>button.textContent==='HEX').click()", true);
  await panel.evaluate("(()=>{const input=document.querySelector('[aria-label=\"Search colors\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'--fixture-accent');input.dispatchEvent(new Event('input',{bubbles:true}));})()", true);
  await until(() => panel.evaluate("document.querySelectorAll('[data-dev-color]').length===1"), "Color search did not find the matching CSS token");
  assert.equal(await panel.evaluate("document.querySelector('[data-dev-color]').dataset.devColor"), "#1769e0");
  await click('[aria-label="Clear color search"]');
  assert.equal(await panel.evaluate("document.querySelectorAll('[data-dev-color]').length"), selectedColors.length);
  assert(await panel.evaluate("Boolean(document.querySelector('.notice[role=status]'))"), "Copying must confirm the result in a status notice");
  console.log("Verified resource category/layout retention, Info source URL, ranked complete palette, HEX/RGB/HSL copy, reusable CSS, token search, and feedback.");

  await source.send("Page.bringToFront");
  const resourceOrder = (await current()).resources.map(resource => resource.id);
  await source.evaluate("document.documentElement.style.setProperty('--fixture-accent','#ab23cd')");
  const updated = await until(async () => { const page = await current(); return page?.devInspection?.colors.some(color => color.hex.toLowerCase() === "#ab23cd") ? page : null; }, "Real automatic watcher did not persist a CSS-only palette change", 30_000);
  assert.deepEqual(updated.resources.map(resource => resource.id), resourceOrder, "A color-only automatic update must preserve resource IDs/order");
  console.log("Verified CSS-only developer metadata refresh through the actual authorized automatic watcher.");

  secondSource = await open(base + "/second");
  await secondSource.send("Page.bringToFront");
  await until(() => panel.evaluate("document.querySelector('.page-scope__selection')?.textContent.includes('Second developer fixture')"), "Active source change did not reach the panel");
  await setDevMode(true);
  await click('[data-dev-tab="info"]');
  assert(!await panel.evaluate("document.querySelector('[data-dev-panel]')?.textContent.includes('Developer fixture public description')"), "New unscanned source must not show the previous page's inspection");
  const beforeNewTab = await count();
  await delay(800);
  assert.equal(await count(), beforeNewTab, "A new tab must still require its first manual scan");
  await until(() => panel.evaluate("document.querySelector('.button--scan')?.disabled===false"), "Second source scan unavailable");
  await click(".button--scan");
  await until(async () => (await current(base + "/second"))?.devInspection?.page.description === "Second page inspection description", "Second source did not save its own inspection");
  await click(".page-scope__trigger");
  await panel.evaluate(`[...document.querySelectorAll('.page-scope__option')].find(option=>option.title.endsWith(${JSON.stringify(base + "/")})).click()`, true);
  await until(() => panel.evaluate("document.querySelector('[data-dev-panel]')?.textContent.includes('Developer fixture public description')"), "Changing the source selector did not change the inspection");
  assert(!await panel.evaluate("document.querySelector('[data-dev-panel]').textContent.includes('Second page inspection description')"));
  const otherLegacy = { ...legacy, id: "dev-fixture-other-legacy", pageUrl: base + "/legacy-other", pageTitle: "Legacy other source" };
  await panel.evaluate(`chrome.storage.local.get('allhere.library.v1').then(value=>chrome.storage.local.set({'allhere.library.v1':[...value['allhere.library.v1'],${JSON.stringify(otherLegacy)}]}))`);
  await click(".page-scope__trigger");
  await panel.evaluate(`[...document.querySelectorAll('.page-scope__option')].find(option=>option.title.endsWith(${JSON.stringify(otherLegacy.pageUrl)})).click()`, true);
  await until(() => panel.evaluate("document.querySelector('[data-dev-panel]')?.textContent.includes('Scan to inspect this page')"), "Other saved legacy source must show its own inspection empty state");
  assert.equal(await panel.evaluate("[...document.querySelector('[data-dev-panel]').querySelectorAll('button')].filter(button=>button.textContent.trim()==='Scan page').length"), 0, "An inactive saved source must not offer a Scan page CTA that would scan the active tab");
  await click(".page-scope__trigger");
  await panel.evaluate(`[...document.querySelectorAll('.page-scope__option')].find(option=>option.title.endsWith(${JSON.stringify(base + "/")})).click()`, true);
  await until(() => panel.evaluate("document.querySelector('[data-dev-panel]')?.textContent.includes('Developer fixture public description')"), "Returning to the inspected source failed");
  console.log("Verified unscanned-tab isolation, first manual scan per new tab, selected-page scope, and no misleading Scan CTA on another saved legacy source.");

  await mkdir(resolve(".impeccable/review"), { recursive: true });
  // Grid/List intentionally belong to resource categories, not the All resources overview.
  await setDevMode(false);
  await click('[data-resource-tab="images"]');
  await until(() => panel.evaluate("Boolean(document.querySelector('.view-switch'))"), "Image layout controls did not render");
  await setDevMode(true);
  // Freeze only Chrome's active-tab metadata while foregrounding the panel fixture for compositor screenshots.
  await panel.evaluate("(async()=>{globalThis.__shotQuery=chrome.tabs.query.bind(chrome.tabs);const tabs=await __shotQuery({active:true,currentWindow:true});chrome.tabs.query=options=>options.active?Promise.resolve(tabs):__shotQuery(options)})()");
  await panel.send("Page.bringToFront");
  await panel.evaluate("document.querySelector('.notice [aria-label=\"Dismiss message\"]')?.click()");
  for (const width of [320, 390, 720]) {
    await panel.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await panel.evaluate("window.scrollTo(0,0)");
    const controls = await panel.evaluate(`(()=>{const dev=document.querySelector(${JSON.stringify(devSwitch)}).getBoundingClientRect();const layout=document.querySelector('.view-switch').getBoundingClientRect();return {fits:document.documentElement.scrollWidth<=innerWidth,sameRow:Math.abs(dev.top+dev.height/2-layout.top-layout.height/2)<=3,devVisible:dev.left>=0&&dev.right<=innerWidth,text:document.querySelector(${JSON.stringify(devSwitch)}).textContent}})()`);
    assert(controls.fits && controls.sameRow && controls.devVisible && controls.text.includes("Dev mode"), `Developer switch/layout controls must fit together at ${width}px: ${JSON.stringify(controls)}`);
    for (const tab of ["info", "colors"]) {
      await click(`[data-dev-tab="${tab}"]`);
      await panel.evaluate("window.scrollTo(0,0);new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))");
      assert(await panel.evaluate("document.documentElement.scrollWidth<=innerWidth"), `${tab} inspection overflows at ${width}px`);
      if (process.env.STASHWELL_SKIP_EXTENSION_SHOTS !== "1") {
        const png = await panel.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(resolve(`.impeccable/review/dev-mode-${tab}-${width}.png`), Buffer.from(png.data, "base64"));
      }
    }
  }
  await panel.evaluate("chrome.tabs.query=globalThis.__shotQuery;delete globalThis.__shotQuery");
  assert.equal(await panel.evaluate("globalThis.__permissionPrompts"), 0, "Developer inspection must not add site permission requests");
  console.log("Verified native 320/390/720 layouts, adjacent labeled switch, tab fit, and zero permission prompts.");

  if (process.env.STASHWELL_WEB_URL) {
    const web = await open(process.env.STASHWELL_WEB_URL);
    try {
      await until(() => web.evaluate("Boolean(document.querySelector('.stashwell-shell'))"), "Web library did not load");
      await web.evaluate(`localStorage.setItem('allhere.library.v1',${JSON.stringify(JSON.stringify([updated]))})`);
      await web.send("Page.reload");
      await until(() => web.evaluate("Boolean(document.querySelector('[data-resource-tab=images]'))"), "Web library did not render imported data");
      await click('[data-resource-tab="images"]', web);
      await setDevMode(true, web);
      for (const width of [390, 1440]) {
        await web.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        for (const tab of ["info", "colors"]) {
          await click(`[data-dev-tab="${tab}"]`, web);
          await web.evaluate("window.scrollTo(0,0);new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))");
          assert(await web.evaluate("document.documentElement.scrollWidth<=innerWidth"), `Web ${tab} inspection overflows at ${width}px`);
          assert.match(await web.evaluate("document.querySelector('[data-dev-panel]').textContent"), tab === "info" ? /Developer fixture public description/ : /#ab23cd/i);
          const png = await web.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          await writeFile(resolve(`.impeccable/review/dev-mode-web-${tab}-${width}.png`), Buffer.from(png.data, "base64"));
        }
      }
      console.log("Verified web-library 390/1440 developer inspection and restored snapshots.");
    } finally { web.close(); }
  }
  console.log("PASS: developer inspection, concise details, complete opaque palettes, no transparent colors, private-data exclusions, JSON/import validation, clipboard, source isolation, automatic CSS-only refresh, retained resource controls, responsive layouts, zero new permission prompts.");
} finally {
  try { await Promise.race([controller?.send("Browser.close"), delay(2000)]); } catch { /* Browser may already have closed. */ }
  panel?.close(); source?.close(); secondSource?.close(); controller?.close(); browser.kill();
  server.closeAllConnections(); await new Promise(done => server.close(done));
}
