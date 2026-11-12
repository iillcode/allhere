// Exercise the actual installed extension, computed text styles, and reusable font sources.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { localFixtureExtension } from "./extension-fixture.mjs";
import { createArchive, parseArchive, mergeCaptures, normalizeTypography } from "../packages/core/src/index.ts";

async function until(check, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(done => setTimeout(done, 100)); }
  throw new Error(message);
}
class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url); this.pending = new Map(); this.id = 0;
    this.socket.addEventListener("message", event => { const result = JSON.parse(event.data); const pending = this.pending.get(result.id); if (!pending) return; this.pending.delete(result.id); result.error ? pending.reject(Error(result.error.message)) : pending.resolve(result.result); });
  }
  async ready() { if (this.socket.readyState !== WebSocket.OPEN) await new Promise((done, reject) => { this.socket.addEventListener("open", done, { once: true }); this.socket.addEventListener("error", reject, { once: true }); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression, userGesture = false) { const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
  close() { this.socket.close(); }
}
const require = createRequire(resolve("apps/extension/package.json"));
const font = await readFile(require.resolve("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"));
const server = createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  if (request.url === "/sample.woff2") { response.writeHead(200, { "Content-Type": "font/woff2" }).end(font); return; }
  if (request.url === "/cdn.css") { response.writeHead(200, { "Content-Type": "text/css" }).end('@font-face{font-family:FixtureCdn;src:url("/sample.woff2") format("woff2");font-weight:400;font-style:normal}.cdn{font-family:FixtureCdn,sans-serif}'); return; }
  if (request.url === "/styles.css") { response.writeHead(200, { "Content-Type": "text/css" }).end('@font-face{font-family:FixtureSans;src:url("/sample.woff2") format("woff2");font-weight:100 900;font-style:normal;unicode-range:U+0000-00FF}html{font-size:20px}body{font-family:FixtureSans,Arial,sans-serif}h1{font-size:36px;font-weight:700;line-height:44px;letter-spacing:.5px}h2{font-size:24px;font-weight:600;line-height:32px;letter-spacing:normal}p{font-size:16px;font-weight:400;line-height:24px}'); return; }
  response.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>Typography fixture</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="http://localhost:${server.address().port}/cdn.css"><h1>Private heading text is never saved</h1><h2>First subheading</h2><h2>Second subheading</h2><p>First body paragraph</p><p>Second body paragraph</p><p style="font-family:Georgia,serif">System font</p><p class="cdn">Font from a CORS-readable CDN</p><h2 hidden>Hidden heading</h2><h2 aria-hidden="true">Hidden to assistive technology</h2><p contenteditable="true">Editable private input</p><textarea>Private textarea</textarea>`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "stashwell-typography-"));
const extension = await localFixtureExtension(profile, [base]);
const browser = spawn(process.env.STASHWELL_BROWSER_PATH ?? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--headless=new", "--no-first-run", "--no-default-browser-check", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let controller, panel, source;
try {
  const port = await until(async () => { try { return Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch { return null; } }, "Browser did not start");
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  controller = new Cdp(version.webSocketDebuggerUrl); await controller.ready();
  const open = async url => {
    const { targetId } = await controller.send("Target.createTarget", { url });
    const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(target => target.id === targetId && target.webSocketDebuggerUrl), "Page did not open");
    const page = new Cdp(target.webSocketDebuggerUrl); await page.ready(); await page.send("Page.enable"); return page;
  };
  const worker = await until(async () => (await controller.send("Target.getTargets")).targetInfos.find(target => target.url.startsWith("chrome-extension:") && target.url.endsWith("service-worker.js")), "Extension did not load");
  panel = await open(`chrome-extension://${new URL(worker.url).hostname}/index.html`);
  await panel.send("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});" });
  await panel.send("Page.reload");
  await panel.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
  await until(() => panel.evaluate("Boolean(document.querySelector('.button--scan'))"), "Panel did not render");
  await panel.evaluate("globalThis.__prompts=0;chrome.permissions.request=async()=>{globalThis.__prompts++;return false};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{globalThis.__copied=value}}});");
  source = await open(base);
  await source.send("Page.bringToFront");
  await until(() => source.evaluate("document.readyState==='complete' && document.fonts.status==='loaded'"), "Fixture did not load");
  await until(() => panel.evaluate("document.querySelector('.button--scan')?.disabled === false"), "Scan did not become available");
  await panel.evaluate("document.querySelector('.button--scan').click()", true);
  const saved = await until(() => panel.evaluate("chrome.storage.local.get('allhere.library.v1').then(value=>value['allhere.library.v1']?.find(page=>page.typography?.length))"), "Typography was not captured");
  console.log("Captured typography from the real source page.");
  const heading = saved.typography.find(style => style.label === "Heading 1");
  assert(heading); assert.equal(heading.fontSize, "36px"); assert.equal(heading.fontSizeRem, "1.8rem"); assert.equal(heading.fontWeight, "700"); assert.equal(heading.lineHeight, "44px"); assert.equal(heading.letterSpacing, "0.5px");
  assert.equal(saved.typography.find(style => style.label === "Heading 2").instances, 2);
  assert.equal(saved.typography.filter(style => style.label === "Paragraph" && style.fontFamily.includes("FixtureSans"))[0].instances, 2);
  assert(heading.sources.some(source => source.url === `${base}/sample.woff2` && source.stylesheetUrl === `${base}/styles.css`));
  const cdnStyle = saved.typography.find(style => style.fontFamily.includes("FixtureCdn"));
  assert(cdnStyle.sources.some(source => source.url === `http://localhost:${server.address().port}/sample.woff2` && source.stylesheetUrl.endsWith('/cdn.css')), "CORS-readable CDN sources must resolve relative font URLs correctly");
  assert(!JSON.stringify(saved.typography).includes("Private"), "Actual page text must never be stored in typography");
  assert.deepEqual(parseArchive(createArchive([saved])).captures[0].typography, saved.typography, "Typography must survive JSON backup/import");
  assert.deepEqual(mergeCaptures([saved], [{ ...saved, typography: undefined }])[0].typography, saved.typography, "Legacy captures must not remove typography");
  assert.equal(normalizeTypography([{ ...heading, sources: [{ ...heading.sources[0], url: "javascript:alert(1)" }] }])[0].sources.length, 0);
  assert.equal(normalizeTypography([{ ...heading, fontFamily: "Arial; background:red" }]).length, 0);
  console.log("Verified measurements, counts, CDN sources, and archive compatibility.");
  await panel.evaluate("document.querySelector('[data-resource-tab=fonts]').click()");
  await until(() => panel.evaluate("Boolean(document.querySelector('.typography-card__sample--loaded'))"), "Real web font preview did not load");
  assert.equal(await panel.evaluate("document.querySelector('.typography-card__sample').textContent"), "AaBbCcDdEeFfGgHh");
  await panel.evaluate("document.querySelector('.typography-card summary').click()");
  assert(await panel.evaluate("document.querySelector('.typography-card details').open"));
  await panel.evaluate("(async()=>{const query=chrome.tabs.query.bind(chrome.tabs);const tabs=await query({active:true,currentWindow:true});chrome.tabs.query=options=>options.active?Promise.resolve(tabs):query(options)})()");
  await panel.send("Page.bringToFront");
  await panel.evaluate("document.querySelector('.typography-card summary').focus()");
  await panel.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await panel.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  assert.equal(await panel.evaluate("document.querySelector('.typography-card details').open"), false, "Details must work from the keyboard");
  await panel.evaluate("document.querySelector('.typography-card summary').click()");
  await panel.evaluate("document.querySelector('.typography-card__actions button').click()", true);
  await until(() => panel.evaluate("globalThis.__copied?.includes('@font-face')"), "Copy CSS did not work");
  assert((await panel.evaluate("globalThis.__copied")).includes(`${base}/sample.woff2`));
  assert.equal(await panel.evaluate("(()=>{const sheet=new CSSStyleSheet();sheet.replaceSync(globalThis.__copied);return sheet.cssRules.length})()"), 2, "Copied CSS must be ready to use");
  await panel.evaluate("document.querySelector('.typography-source button').click()", true);
  assert.equal(await panel.evaluate("globalThis.__copied"), `${base}/sample.woff2`);
  await panel.evaluate("[...document.querySelector('.typography-card').querySelectorAll('button')].find(button=>button.textContent.includes('Copy stylesheet URL')).click()", true);
  assert.equal(await panel.evaluate("globalThis.__copied"), `${base}/styles.css`);
  const fallback = await panel.evaluate("[...document.querySelectorAll('.typography-card')].find(card=>card.textContent.includes('Georgia'))?.textContent");
  assert(fallback.includes("No reusable font URL"));
  console.log("Verified rendered fonts, source links, and clipboard actions.");
  await source.send("Page.bringToFront");
  await source.evaluate("document.querySelector('h1').style.fontSize='40px'");
  await until(() => panel.evaluate("chrome.storage.local.get('allhere.library.v1').then(value=>value['allhere.library.v1']?.[0]?.typography?.some(style=>style.label==='Heading 1' && style.fontSize==='40px'))"), "Automatic updates lost typography-only changes");
  // Keep the source tab metadata while foregrounding the extension for capture.
  await panel.send("Page.bringToFront");
  await panel.evaluate("document.querySelector('.notice [aria-label=\"Dismiss message\"]')?.click()");
  await panel.evaluate("document.querySelector('.typography-card details').open=true");
  await mkdir(resolve(".impeccable/review"), { recursive: true });
  for (const width of [320, 390, 720]) {
    await panel.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await panel.evaluate("window.scrollTo(0,0)");
    await until(() => panel.evaluate("[...document.querySelectorAll('.typography-card__sample')].every(sample=>sample.scrollWidth <= sample.parentElement.clientWidth + 2)"), "Samples must fit the sidebar without losing their text");
    assert(await panel.evaluate("document.documentElement.scrollWidth<=innerWidth"), `Typography overflows at ${width}px`);
    if (process.env.STASHWELL_SKIP_EXTENSION_SHOTS !== "1") {
      const png = await panel.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(resolve(`.impeccable/review/typography-${width}.png`), Buffer.from(png.data, "base64"));
    }
  }
  const webUrl = process.env.STASHWELL_WEB_URL;
  if (webUrl) {
    const web = await open(webUrl);
    try {
      await until(() => web.evaluate("Boolean(document.querySelector('.stashwell-shell'))"), "Web library did not load");
      await web.evaluate(`localStorage.setItem('allhere.library.v1',${JSON.stringify(JSON.stringify([saved]))})`);
      await web.send("Page.reload");
      await until(() => web.evaluate("Boolean(document.querySelector('[data-resource-tab=fonts]'))"), "Web text tab did not load");
      await web.evaluate("document.querySelector('[data-resource-tab=fonts]').click()");
      await until(() => web.evaluate("Boolean(document.querySelector('.typography-card'))"), "Web typography did not render");
      await web.evaluate("document.querySelector('.typography-card summary').click()");
      for (const width of [390,1440]) {
        await web.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        assert(await web.evaluate("document.documentElement.scrollWidth<=innerWidth"), `Web typography overflows at ${width}px`);
        const png = await web.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(resolve(`.impeccable/review/typography-web-${width}.png`), Buffer.from(png.data,"base64"));
      }
    } finally { web.close(); }
  }
  assert.equal(await panel.evaluate("globalThis.__prompts"), 0, "Text previews must not request site permissions");
  console.log("PASS: computed styles, instance counts, real font previews, CSS/URL copy, system fallback, archive validation, typography-only automatic updates, responsive layouts, zero permission prompts.");
} catch (error) { console.error(error); throw error; }
finally {
  try { await Promise.race([controller?.send("Browser.close"), new Promise(done => setTimeout(done, 2000))]); } catch { /* Already closed. */ }
  panel?.close(); source?.close(); controller?.close(); browser.kill(); server.closeAllConnections(); await new Promise(done => server.close(done));
}
