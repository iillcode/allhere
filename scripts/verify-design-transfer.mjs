// Black-box tests of the built extension. No personal browser profile or clipboard.
// --live also fetches public Lucide/Pillow assets and imports the output in Photopea.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as portServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { localFixtureExtension } from "./extension-fixture.mjs";

const { unzipSync } = createRequire(new URL("../packages/library-ui/package.json", import.meta.url))("fflate");
const live = process.argv.includes("--live");
const screenshots = !process.argv.includes("--no-screenshots");
const delay = ms => new Promise(done => setTimeout(done, ms));
async function until(check, message, timeout = 25_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await check(); if (result) return result; await delay(100); }
  throw Error(message);
}
class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url); this.next = 0; this.pending = new Map(); this.events = [];
    this.socket.addEventListener("message", event => {
      const result = JSON.parse(event.data);
      if (result.method) this.events.push(result);
      const pending = this.pending.get(result.id); if (!pending) return;
      this.pending.delete(result.id); clearTimeout(pending.timeout);
      result.error ? pending.reject(Error(result.error.message)) : pending.done(result.result);
    });
  }
  async ready() { if (this.socket.readyState !== WebSocket.OPEN) await new Promise(done => this.socket.addEventListener("open", done, { once: true })); }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((done, reject) => {
      this.pending.set(id, { done, reject, timeout: setTimeout(() => { this.pending.delete(id); reject(Error(`${method} timed out`)); }, 35_000) });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, userGesture = true) {
    const result = await this.send("Runtime.evaluate", { expression, userGesture, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { for (const pending of this.pending.values()) clearTimeout(pending.timeout); this.socket.close(); }
}

const fixtures = new Map();
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const fixture = fixtures.get(path);
  if (!fixture) { response.writeHead(404).end(); return; }
  response.writeHead(fixture.status ?? 200, { "Content-Type": fixture.type, "Access-Control-Allow-Origin": "*" });
  if (fixture.slow) setTimeout(() => { if (!response.destroyed) response.end(fixture.bytes); }, fixture.slow).unref();
  else response.end(fixture.bytes);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "stashwell-design-transfer-"));
const downloads = join(profile, "downloads"); await mkdir(downloads);
const extension = await localFixtureExtension(profile, [base, ...(live ? ["https://raw.githubusercontent.com/"] : [])]);
const port = await new Promise(done => { const socket = portServer(); socket.listen(0, "127.0.0.1", () => { const port = socket.address().port; socket.close(() => done(port)); }); });
const browser = spawn(process.env.STASHWELL_BROWSER_PATH ?? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--headless=new", "--no-first-run", "--no-default-browser-check",
  `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
const clients = [];
let controller, panel;
const evidence = { checkedAt: new Date().toISOString(), applications: [], live: [] };
try {
  const version = await until(async () => { try { return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { return null; } }, "Brave did not start");
  controller = new Cdp(version.webSocketDebuggerUrl); await controller.ready();
  const open = async url => {
    const { targetId } = await controller.send("Target.createTarget", { url });
    const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.id === targetId && item.webSocketDebuggerUrl), "Test tab did not open");
    const client = new Cdp(target.webSocketDebuggerUrl); await client.ready(); clients.push(client);
    return { client, targetId };
  };
  const worker = await until(async () => (await controller.send("Target.getTargets")).targetInfos.find(item => item.type === "service_worker" && item.url.endsWith("service-worker.js")), "Extension did not load");
  const extensionId = new URL(worker.url).hostname;
  panel = (await open(`chrome-extension://${extensionId}/index.html`)).client;
  await controller.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
  await panel.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 840, deviceScaleFactor: 1, mobile: false });
  await until(() => panel.evaluate("Boolean(document.querySelector('.stashwell-shell'))"), "Library did not render");
  const samples = await panel.evaluate(`(()=>{const canvas=document.createElement('canvas');canvas.width=40;canvas.height=20;const c=canvas.getContext('2d');c.fillStyle='#0b57d0';c.fillRect(10,5,20,10);return {png:canvas.toDataURL('image/png').split(',')[1],webp:canvas.toDataURL('image/webp').split(',')[1]};})()`);
  const svg = content => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${content}</svg>`;
  const gradient = color => svg(`<defs><linearGradient id="paint"><stop stop-color="${color}"/><stop offset="1" stop-color="${color}"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" fill="url(#paint)"/>`);
  fixtures.set("/red.svg", { type: "image/svg+xml", bytes: gradient("#ff0000") });
  fixtures.set("/blue.svg", { type: "image/svg+xml", bytes: gradient("#0000ff") });
  fixtures.set("/white.svg", { type: "image/svg+xml", bytes: svg('<path fill="#fff" d="M4 4h16v16H4z"/>') });
  fixtures.set("/raster", { type: "application/octet-stream", bytes: Buffer.from(samples.webp, "base64") });
  fixtures.set("/duplicate.png", { type: "image/png", bytes: Buffer.from(samples.webp, "base64") });
  fixtures.set("/embedded.svg", { type: "image/svg+xml", bytes: svg(`<image width="24" height="24" href="data:image/webp;base64,${samples.webp}"/>`) });
  fixtures.set("/view.svg", { type: "image/svg+xml", bytes: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><view id="blue" viewBox="24 0 24 24"/><rect width="24" height="24" fill="red"/><rect x="24" width="24" height="24" fill="blue"/></svg>' });
  fixtures.set("/sprite.svg", { type: "image/svg+xml", bytes: '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sprite-paint"><stop stop-color="lime"/><stop offset="1" stop-color="lime"/></linearGradient></defs><symbol id="chosen" viewBox="0 0 32 16"><path id="glyph" fill="url(#sprite-paint)" d="M0 0h32v16H0z"/></symbol><symbol id="unrelated"><use href="unavailable.svg#other"/></symbol></svg>' });
  fixtures.set("/expired.png", { type: "text/plain", bytes: "Expired", status: 403 });
  fixtures.set("/damaged.png", { type: "image/png", bytes: Buffer.from(samples.png, "base64").subarray(0, 20) });
  fixtures.set("/external.svg", { type: "image/svg+xml", bytes: svg('<use href="https://example.com/sprite.svg#icon"/>') });
  fixtures.set("/slow.png", { type: "image/png", bytes: Buffer.from(samples.png, "base64"), slow: 5000 });
  fixtures.set("/drop", { type: "text/html", bytes: '<!doctype html><title>Asset destination fixture</title><input id="upload" type="file" accept="image/*"><script>upload.addEventListener("change",async()=>{const f=upload.files[0];window.received={name:f.name,type:f.type,size:f.size,bytes:Array.from(new Uint8Array(await f.arrayBuffer()))};});</script>' });
  fixtures.set("/photopea", { type: "text/html", bytes: '<!doctype html><title>Live import test</title><script>window.messages=[];addEventListener("message",e=>{if(e.origin==="https://www.photopea.com"){if(e.data instanceof ArrayBuffer)window.exported=Array.from(new Uint8Array(e.data));else window.messages.push(e.data);}});</script><iframe id="editor" src="https://www.photopea.com/#%7B%7D" style="width:100%;height:750px;border:0"></iframe>' });

  const entries = [
    { label: "Red vector", kind: "icon", path: "/red.svg" }, { label: "Blue vector", kind: "icon", path: "/blue.svg" },
    { label: "White vector", kind: "icon", path: "/white.svg" }, { label: "Raster picture", kind: "image", path: "/raster" },
    { label: "Same picture again", kind: "image", path: "/duplicate.png" }, { label: "Embedded picture", kind: "icon", path: "/embedded.svg" },
    { label: "Selected blue view", kind: "icon", path: "/view.svg#blue" }, { label: "Selected sprite", kind: "icon", path: "/sprite.svg#chosen" },
    { label: "Saved link", kind: "link", path: "/source" },
  ];
  async function seed(items) {
    const capturedAt = new Date().toISOString();
    const capture = { id: "design-transfer-fixture", pageUrl: base + "/source", pageTitle: "Design assets", hostname: "127.0.0.1", capturedAt,
      resources: items.map((item, index) => ({ id: `asset-${index}`, kind: item.kind, label: item.label, url: item.url || base + item.path,
        pageUrl: base + "/source", pageTitle: "Design assets", capturedAt,
        security: { transport: "http", relation: "same-host", hostname: "127.0.0.1", signals: [], checkedAt: capturedAt, method: "local-heuristics" } })),
    };
    await panel.evaluate(`chrome.storage.local.set({'allhere.library.v1':${JSON.stringify([capture])}})`);
    await panel.send("Page.reload");
    await until(() => panel.evaluate("Boolean(document.querySelector('.resource-album,.resource-card'))"), "Seeded resources did not render");
    await panel.evaluate(`window.__clipboard=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async items=>{const type=items[0].types[0];const blob=await items[0].getType(type);window.__clipboard={type,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))};}}});window.__permissionRequests=[];const request=chrome.permissions.request.bind(chrome.permissions);chrome.permissions.request=p=>{window.__permissionRequests.push(p);return request(p);};`);
  }
  async function category(id) {
    await panel.evaluate(`document.querySelector('[data-resource-tab="${id}"]').click()`);
    await until(() => panel.evaluate(`document.querySelector('[data-resource-tab="${id}"]').getAttribute('aria-selected')==='true'`), "Resource category did not change");
  }
  async function select(items) {
    for (const item of items) {
      const id = item.kind === "icon" ? "icons" : item.kind === "link" ? "links" : ["document", "other"].includes(item.kind) ? "files" : "images";
      await category(id);
      const selector = `[aria-label="Select ${item.label}"]`;
      await until(() => panel.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), `${item.label} was missing`);
      await panel.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    }
  }
  async function click(text, scope = ".design-transfer") {
    await panel.evaluate(`(()=>{const b=[...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Unavailable action: '+${JSON.stringify(text)});b.click();})()`);
  }
  async function field(label, value) {
    if (label === "Application") {
      await panel.evaluate("document.querySelector('.application-select__trigger').click()");
      await until(() => panel.evaluate("document.querySelector('.application-select__options').matches(':popover-open')"), "Application selector did not open");
      await panel.evaluate(`document.querySelector('[data-application="${value}"]').click()`);
      await until(() => panel.evaluate("!document.querySelector('.application-select__options').matches(':popover-open')"), "Application selector did not close");
      return;
    }
    await panel.evaluate(`(()=>{const l=[...document.querySelector('.design-transfer').querySelectorAll('label')].find(l=>l.firstChild.textContent.trim()===${JSON.stringify(label)});const s=l.querySelector('select');s.value=${JSON.stringify(String(value))};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  }
  async function launch() {
    await panel.evaluate("document.querySelector('.design-transfer-launch').focus();document.querySelector('.design-transfer-launch').click()");
    await until(() => panel.evaluate("document.querySelector('.design-transfer')?.open"), "Asset transfer dialog did not open");
  }
  async function prepare(text = "Prepare set") {
    await click(text);
    await until(() => panel.evaluate("!document.querySelector('.design-transfer__progress') && Boolean(document.querySelector('.design-transfer__prepared,.design-transfer__error'))"), "Asset preparation did not finish", 45_000);
  }
  const jobs = () => panel.evaluate("chrome.storage.local.get('allhere.downloads.v1').then(data=>data['allhere.downloads.v1']||[])");
  async function zip() {
    const before = new Set((await jobs()).map(job => job.id));
    await click("Download set");
    const job = await until(async () => (await jobs()).find(job => !before.has(job.id) && job.state === "complete"), "Prepared set did not download");
    return unzipSync(await readFile(join(downloads, job.filename)));
  }
  async function decode(bytes, mime = "image/png") {
    return panel.evaluate(`(async()=>{const u=URL.createObjectURL(new Blob([new Uint8Array(${JSON.stringify([...bytes])})],{type:${JSON.stringify(mime)}}));const i=new Image();try{i.src=u;await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);const p=x.getImageData(0,0,c.width,c.height).data;let visible=0;for(let n=3;n<p.length;n+=4)if(p[n])visible++;return {width:c.width,height:c.height,visible,corner:[...x.getImageData(0,0,1,1).data],center:[...x.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data]};}finally{URL.revokeObjectURL(u);}})()`);
  }
  async function capture(name, width) {
    if (!screenshots) return;
    if (process.argv.includes("--error-screenshots-only") && name !== "errors") return;
    await panel.send("Emulation.setDeviceMetricsOverride", { width, height: 840, deviceScaleFactor: 1, mobile: false });
    await panel.evaluate("document.querySelector('.design-transfer__body')?.scrollTo(0,0)");
    await delay(80);
    const layout = await panel.evaluate("(()=>{const d=document.querySelector('.design-transfer');const r=d.getBoundingClientRect();return {left:r.left,right:r.right,scroll:d.scrollWidth,width:d.clientWidth,screen:innerWidth,body:document.documentElement.scrollWidth};})()");
    assert.ok(layout.left >= 0 && layout.right <= layout.screen && layout.scroll <= layout.width && layout.body <= layout.screen, `Transfer overflow at ${width}px: ${JSON.stringify(layout)}`);
    if (["copied", "denied", "errors"].includes(name)) {
      assert.ok(await panel.evaluate(`(()=>{const elements=${JSON.stringify(name)}==='errors'?[...document.querySelectorAll('.design-transfer__footer button')]:[document.querySelector('.design-transfer__footer .design-transfer__feedback p')];return elements.length>0&&elements.every(e=>{if(!e)return false;const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;});})()`),`${name} recovery/feedback was outside the viewport at ${width}px`);
    }
    const shot = await panel.send("Page.captureScreenshot", { format: "png" });
    await writeFile(resolve(`.impeccable/review/design-transfer-${name}-${width}.png`), Buffer.from(shot.data, "base64"));
  }
  await mkdir(resolve(".impeccable/review"), { recursive: true });
  if (process.argv.includes("--modal-layout-check")) {
    await seed(entries); await select(entries); await launch();
    const key = async (key, code = key, windowsVirtualKeyCode) => {
      await panel.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
      await panel.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
    };
    async function modalCapture(name, width, height = 840, enlarge = false) {
      await panel.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await panel.evaluate(`document.documentElement.style.fontSize=${JSON.stringify(enlarge ? "20px" : "16px")}`);
      if(name.endsWith("bottom")) await panel.evaluate("document.querySelector('.design-transfer__body,.resource-modal .details-panel').scrollTo(0,99999)");
      await delay(100);
      const geometry = await panel.evaluate(`(()=>{
        const dialog=document.querySelector('dialog[open]'),transfer=dialog.matches('.design-transfer');
        const scroller=dialog.querySelector(transfer?'.design-transfer__body':'.details-panel');
        const r=dialog.getBoundingClientRect(),s=scroller.getBoundingClientRect(),css=getComputedStyle(dialog);
        const footer=dialog.querySelector('.design-transfer__footer')?.getBoundingClientRect();
        const panel=document.querySelector('.application-select__options:popover-open')?.getBoundingClientRect();
        const corners=[css.borderTopLeftRadius,css.borderTopRightRadius,css.borderBottomLeftRadius,css.borderBottomRightRadius];
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:dialog.scrollWidth,width:dialog.clientWidth,frameOverflow:css.overflowY,
          body:document.documentElement.scrollWidth,corners,scroller:{left:s.left,right:s.right,top:s.top,bottom:s.bottom,scroll:scroller.scrollWidth,width:scroller.clientWidth},
          footer:footer?{top:footer.top,bottom:footer.bottom}:null,panel:panel?{left:panel.left,right:panel.right,top:panel.top,bottom:panel.bottom}:null};
      })()`);
      assert.ok(geometry.left>=0 && geometry.right<=width && geometry.top>=0 && geometry.bottom<=height && geometry.body<=width, `Modal escaped ${width}x${height}: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.scroll<=geometry.width && geometry.scroller.scroll<=geometry.scroller.width, "Modal has horizontal overflow");
      assert.equal(geometry.frameOverflow,"hidden","Modal frame must clip scrollbar and corner paint");
      assert.deepEqual(geometry.corners,["16px","16px","16px","16px"]);
      assert.ok(geometry.scroller.right<=geometry.right-4 && geometry.scroller.bottom<=geometry.bottom-4,"Scrollbar touches an outer corner");
      if(geometry.footer) assert.ok(geometry.footer.top>=geometry.scroller.bottom && geometry.footer.bottom<=geometry.bottom,"Transfer footer overlaps scrolling content");
      if(geometry.panel) assert.ok(geometry.panel.left>=0 && geometry.panel.right<=width && geometry.panel.top>=0 && geometry.panel.bottom<=height,"App options escape the viewport");
      if(screenshots){const shot=await panel.send("Page.captureScreenshot",{format:"png"});await writeFile(resolve(`.impeccable/review/app-modal-${name}-${width}.png`),Buffer.from(shot.data,"base64"));}
      return geometry;
    }
    await panel.evaluate("document.querySelector('.application-select__trigger').focus();document.querySelector('.application-select__trigger').click()");
    await until(()=>panel.evaluate("document.querySelector('.application-select__options').matches(':popover-open')"),"Custom application list is hidden");
    assert.equal(await panel.evaluate("document.querySelectorAll('.application-select__options [role=option]').length"),10);
    assert.equal(await panel.evaluate("document.querySelectorAll('.application-select__options img').length"),9);
    await until(()=>panel.evaluate("[...document.querySelectorAll('.application-select img')].every(i=>i.complete&&i.naturalWidth>0)"),"An official application logo failed to decode");
    assert.ok(await panel.evaluate("[...document.querySelectorAll('.application-select img')].every(i=>i.src.startsWith('data:')||i.src.startsWith(location.origin+'/'))"),"App logos depend on third-party requests");
    for(const width of [320,390,458,720]) await modalCapture("selector",width);
    await modalCapture("selector-short",390,480);
    await modalCapture("selector-large-text",320,840,true);
    await key("End","End",35);
    assert.match(await panel.evaluate("document.getElementById(document.querySelector('.application-select__trigger').getAttribute('aria-activedescendant')).textContent"),/Other applications/);
    await key("Enter","Enter",13);
    assert.match(await panel.evaluate("document.querySelector('.application-select__trigger').textContent"),/Other applications/);
    assert.ok(await panel.evaluate("document.activeElement.matches('.application-select__trigger')"),"Choosing an app lost focus");
    await key("ArrowDown","ArrowDown",40); await key("Home","Home",36); await key("ArrowDown","ArrowDown",40); await key("ArrowUp","ArrowUp",38);
    await key("p","KeyP",80);
    assert.match(await panel.evaluate("document.getElementById(document.querySelector('.application-select__trigger').getAttribute('aria-activedescendant')).textContent"),/Penpot/);
    await key("Escape","Escape",27);
    assert.ok(await panel.evaluate("document.querySelector('.design-transfer').open && !document.querySelector('.application-select__options').matches(':popover-open')"),"Escape dismissed the modal instead of just the selector");
    await panel.evaluate("document.querySelector('.application-select__trigger').click()");
    const closeBounds=await panel.evaluate("(()=>{const r=document.querySelector('.design-transfer__header h2').getBoundingClientRect();return {x:r.x+3,y:r.y+3}})()");
    await panel.send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...closeBounds});
    await panel.send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...closeBounds});
    await until(()=>panel.evaluate("!document.querySelector('.application-select__options').matches(':popover-open')"),"Outside click did not dismiss selector");
    for(const id of ["canva","photoshop","illustrator","sketch","affinity","photopea","inkscape","penpot","other","figma"]) await field("Application",id);
    await panel.evaluate("document.documentElement.style.fontSize='16px'");
    await panel.send("Emulation.setDeviceMetricsOverride", { width:390,height:840,deviceScaleFactor:1,mobile:false });
    await prepare();
    assert.ok(await panel.evaluate("getComputedStyle(document.querySelector('.design-transfer__assets')).overflowY==='visible'"),"Prepared assets retained a nested scrollbar");
    for(const width of [320,390,458,720]){
      await panel.evaluate("document.querySelector('.design-transfer__body').scrollTo(0,0)");
      await modalCapture("ready",width);
    }
    await panel.evaluate("document.querySelector('.design-transfer__body').scrollTo(0,99999)");
    const footerBefore=await modalCapture("ready-bottom",390);
    await panel.evaluate("document.querySelector('.application-select__trigger').focus()");
    await key(" ","Space",32); await key("Tab","Tab",9);
    assert.ok(await panel.evaluate("!document.querySelector('.application-select__options').matches(':popover-open') && document.querySelector('.design-transfer').contains(document.activeElement)"),"Tab did not close selector inside modal");
    await panel.evaluate("document.querySelector('.design-transfer__body').scrollTo(0,99999)");
    assert.equal(await panel.evaluate("document.querySelector('.design-transfer__footer').getBoundingClientRect().bottom"),footerBefore.footer.bottom,"Footer moved with the body");
    await panel.evaluate("document.querySelector('[aria-label=\"Close asset transfer\"]').click()");
    await until(()=>panel.evaluate("!document.querySelector('.design-transfer')"),"Transfer did not close");
    await category("icons");
    await panel.evaluate("document.querySelector('.resource-card').click()");
    await until(()=>panel.evaluate("document.querySelector('.resource-modal')?.open"),"Resource preview did not open");
    assert.equal(await panel.evaluate("document.activeElement?.getAttribute('aria-label')"),"Close preview","Preview should focus Close instead of the whole scroll container");
    for(const width of [320,390,458,720]){
      await panel.evaluate("document.querySelector('.resource-modal .details-panel').scrollTo(0,0)");
      await modalCapture("preview",width);
    }
    await modalCapture("preview-short",390,480);
    await panel.evaluate("document.querySelector('.resource-modal .details-panel').scrollTo(0,99999)");
    await modalCapture("preview-bottom",390);
    await key("Escape","Escape",27);
    await until(()=>panel.evaluate("!document.querySelector('.resource-modal')"),"Escape did not close preview");
    console.log("PASS custom app selector and modal layout: all 10 destinations, 9 offline logos, keyboard/typeahead/focus/outside dismissal, 320/390/458/720px, short viewport, enlarged text, single body scroll, fixed actions, inset scrollbars and symmetric corners on transfer and preview.");
  } else if (process.argv.includes("--selection-bar-check")) {
    const icons = Array.from({ length: 54 }, (_, index) => ({ label: `Collected icon ${index + 1}`, kind: "icon", path: `${index % 3 ? "/blue.svg" : "/white.svg"}?selection=${index}` }));
    await seed(icons); await category("icons");
    await panel.evaluate("document.querySelector('.resource-select').click()");
    await panel.evaluate("document.querySelector('.bulk-selection__controls button').click()");
    await until(() => panel.evaluate("document.querySelector('.bulk-selection__count strong')?.textContent==='54'"), "Select all did not select all 54 icons");
    async function barCapture(name, width, enlarge = false) {
      await panel.send("Emulation.setDeviceMetricsOverride", { width, height: 840, deviceScaleFactor: 1, mobile: false });
      await panel.evaluate(`document.documentElement.style.fontSize=${JSON.stringify(enlarge ? "20px" : "16px")}`);
      await delay(100);
      const bounds = await panel.evaluate(`(()=>{const bar=document.querySelector('.bulk-selection'),send=bar.querySelector('.design-transfer-launch'),more=bar.querySelector('.bulk-selection__menu-trigger');const r=bar.getBoundingClientRect(),s=send.getBoundingClientRect(),m=more.getBoundingClientRect();const buttons=[...bar.querySelectorAll('button')].filter(b=>!b.closest('.bulk-selection__menu-panel'));return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,send:{x:s.x,right:s.right,top:s.top,height:s.height},more:{x:m.x,top:m.top,height:m.height},fit:buttons.every(b=>{const t=b.getBoundingClientRect();return t.left>=r.left&&t.right<=r.right&&t.top>=r.top&&t.bottom<=r.bottom}),clearance:parseFloat(getComputedStyle(document.querySelector('.main-content')).paddingBottom),screen:innerWidth,scroll:document.documentElement.scrollWidth};})()`);
      assert.ok(bounds.fit && bounds.left>=0 && bounds.right<=width && bounds.bottom<=840 && bounds.scroll<=width, `Selection controls overflow at ${width}px: ${JSON.stringify(bounds)}`);
      assert.equal(bounds.send.top,bounds.more.top,"Primary and More actions are not aligned");
      assert.equal(bounds.send.height,bounds.more.height,"Primary and More actions have different heights");
      assert.ok(bounds.send.right < bounds.more.x,"Selection actions overlap");
      assert.ok(bounds.clearance >= bounds.height + 24,"Last resources can hide behind the selection bar");
      if (screenshots) {
        const full=await panel.send("Page.captureScreenshot",{format:"png"});
        await writeFile(resolve(`.impeccable/review/selection-bar-${name}-${width}.png`),Buffer.from(full.data,"base64"));
        const crop=await panel.send("Page.captureScreenshot",{format:"png",clip:{x:Math.max(0,bounds.left-8),y:bounds.top-8,width:Math.min(width,bounds.width+16),height:Math.min(840-bounds.top+8,bounds.height+16),scale:1}});
        await writeFile(resolve(`.impeccable/review/selection-bar-${name}-${width}-detail.png`),Buffer.from(crop.data,"base64"));
      }
      return bounds;
    }
    for(const width of [320,390,477,720]) await barCapture("selected",width);
    await panel.evaluate("document.querySelector('.bulk-selection__controls button:last-child').focus()");
    for(const [expected,selector] of [["Send to app",".design-transfer-launch"],["More actions",".bulk-selection__menu-trigger"]]){
      await panel.send("Input.dispatchKeyEvent",{type:"keyDown",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});
      await panel.send("Input.dispatchKeyEvent",{type:"keyUp",key:"Tab",code:"Tab",windowsVirtualKeyCode:9});
      assert.ok(await panel.evaluate(`document.activeElement.matches(${JSON.stringify(selector)})`),`Keyboard order did not follow the visual order to ${expected}`);
    }
    await panel.evaluate("document.querySelector('.bulk-selection__menu-trigger').click()");
    for(const width of [320,477]) {
      const bar=await barCapture("menu",width);
      const menu=await panel.evaluate("(()=>{const r=document.querySelector('.bulk-selection__menu-panel').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})()");
      assert.ok(menu.left>=0 && menu.right<=width && menu.top>=0 && menu.bottom<bar.top,"More actions cover the toolbar or escape the screen");
    }
    await panel.send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    await panel.send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    await until(()=>panel.evaluate("!document.querySelector('.bulk-selection__menu-panel')"),"Escape did not dismiss the More menu");
    await barCapture("large-text",320,true);
    await panel.evaluate("document.documentElement.style.fontSize='16px';document.querySelector('.bulk-selection__controls button:last-child').click()");
    await until(()=>panel.evaluate("!document.querySelector('.bulk-selection')"),"Unselect all did not clear the selection");
    await panel.evaluate("document.querySelector('.resource-select').click()");
    await barCapture("single",390);
    await launch();
    assert.match(await panel.evaluate("document.querySelector('#design-transfer-description').textContent"),/1 asset selected/);
    console.log("PASS selection bar: 54/single selection, aligned primary/More actions, 320/390/477/720px, enlarged text wrapping, content clearance, menu anchoring, keyboard order, clearing, and real transfer launch.");
  } else {
  await seed(entries); await select(entries); await launch();
  for (const width of [320, 390, 720]) await capture("prepare", width);
  await prepare();
  assert.equal(await panel.evaluate("document.querySelectorAll('.design-asset').length"), 7, "One byte-identical raster duplicate must be removed; every distinct asset must remain");
  assert.equal(await panel.evaluate("document.querySelectorAll('.design-transfer__failures li').length"), 0, "Self-contained sprites and selected SVG views must prepare");
  assert.match(await panel.evaluate("document.querySelector('.design-transfer__body').innerText"), /1 duplicate removed/);
  await until(() => panel.evaluate("Boolean(document.querySelector('.design-asset__preview--dark'))"), "White icons were invisible in the prepared preview");
  const pack = await zip();
  const metadata = JSON.parse(Buffer.from(pack["sources.json"]).toString());
  assert.equal(metadata.assets.length, 7); assert.equal(metadata.duplicateCount, 1); assert.equal(metadata.otherResourceCount, 1);
  for (const asset of metadata.assets) {
    const bytes = pack[asset.filename]; assert.ok(bytes?.length, `${asset.filename} was omitted`);
    if (asset.vector) {
      const content = Buffer.from(bytes).toString();
      assert.doesNotMatch(content, /<script|onload=|<foreignObject|href="https?:/i);
      if (asset.filename.includes("Embedded")) { assert.match(content, /data:image\/png;base64/); assert.doesNotMatch(content, /data:image\/webp/); }
      const image = await decode(bytes, "image/svg+xml");
      if (asset.filename.includes("Selected blue")) assert.deepEqual(image.center, [0, 0, 255, 255], "SVG view fragment was lost");
      if (asset.filename.includes("Selected sprite")) { assert.equal(image.width, 32); assert.equal(image.height, 16); assert.deepEqual(image.center, [0, 255, 0, 255]); }
    } else {
      assert.deepEqual([...bytes.subarray(0,8)], [137,80,78,71,13,10,26,10]);
      const image = await decode(bytes); assert.equal(image.width, 40); assert.equal(image.height, 20); assert.equal(image.corner[3], 0);
      assert.equal(asset.sources.length, 2, "Both deduplicated source references must be preserved");
    }
  }
  await click("Copy SVG set");
  const copied = await until(() => panel.evaluate("window.__clipboard"), "SVG clipboard set was not prepared");
  assert.equal(copied.type, "text/plain");
  const copiedSvg = Buffer.from(copied.bytes).toString();
  assert.match(copiedSvg, /<path/); assert.match(copiedSvg, /data:image\/png;base64/);
  const board = await panel.evaluate(`(()=>{const d=new DOMParser().parseFromString(${JSON.stringify(copiedSvg)},'image/svg+xml');const ids=[...d.querySelectorAll('[id]')].map(e=>e.id);const references=[...d.querySelectorAll('*')].flatMap(e=>[...e.attributes].flatMap(a=>[...a.value.matchAll(/url\(#([^)]*)\)/g)].map(m=>m[1])));return {error:!!d.querySelector('parsererror'),ids,references,groups:d.documentElement.querySelectorAll(':scope > g').length};})()`);
  assert.equal(board.error, false); assert.equal(board.groups, 7); assert.equal(new Set(board.ids).size, board.ids.length);
  assert.ok(board.references.every(id => board.ids.includes(id)), "Clipboard gradients must reference the correct namespaced definitions");
  assert.ok((await decode(copied.bytes, "image/svg+xml")).width > 0);
  await until(()=>panel.evaluate("document.querySelector('.design-transfer__status')?.textContent.includes('SVG set copied')"),"Copy confirmation did not appear");
  for (const width of [320,390,720]) await capture("copied", width);
  await panel.evaluate("window.__clipboard=null"); await click("Copy image");
  const copiedPng = await until(() => panel.evaluate("window.__clipboard"), "PNG clipboard set did not finish");
  assert.equal(copiedPng.type, "image/png"); assert.equal((await decode(copiedPng.bytes)).corner[3], 0);
  for (const width of [320, 390, 720]) await capture("ready", width);
  console.log("PASS mixed SVG/raster set: paths, embedded PNGs, gradients, selected SVG views/sprites, transparency, byte deduplication, source manifest, ZIP and both clipboard payloads.");

  // Cross-process drops receive the prepared bytes, not the original URL/file.
  const { client: destination, targetId: destinationId } = await open(base + "/drop");
  const tabId = await until(() => panel.evaluate(`chrome.tabs.query({}).then(t=>t.find(t=>t.url===${JSON.stringify(base + "/drop")})?.id)`), "The destination tab metadata did not become available");
  await panel.evaluate(`chrome.scripting.executeScript({target:{tabId:${tabId}},files:['file-drop.js']})`);
  const drag = await panel.evaluate(`(()=>{const e=[...document.querySelectorAll('.design-asset')].find(e=>e.textContent.includes('Raster picture'));const dt=new DataTransfer();e.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));return {name:dt.files[0].name,size:dt.files[0].size,items:[...dt.types].filter(t=>t!=='Files').map(t=>({mimeType:t,data:dt.getData(t)}))};})()`);
  assert.equal(drag.name, "Raster picture.png"); assert.ok(drag.size > 0);
  const point = await destination.evaluate("(()=>{const r=document.querySelector('#upload').getBoundingClientRect();return {x:r.x+10,y:r.y+10};})()");
  for (const type of ["dragEnter", "dragOver", "drop"]) await destination.send("Input.dispatchDragEvent", { type, ...point, data: { items: drag.items, dragOperationsMask: 1 } });
  const received = await until(() => destination.evaluate("window.received"), "Prepared drag did not reach the destination input");
  assert.deepEqual(received.bytes, [...pack["assets/Raster picture.png"]]);
  await controller.send("Target.closeTarget", { targetId: destinationId });
  console.log("PASS prepared-file drag: exact converted PNG bytes transferred through the extension's cross-process drop helper.");

  // App presets change format defaults; each produces complete importable files.
  await panel.send("Page.bringToFront");
  const apps = await panel.evaluate("[...document.querySelectorAll('.application-select__option')].map(o=>({id:o.dataset.application,name:o.textContent.trim()}))");
  for (const app of apps) {
    await field("Application", app.id);
    if (!await panel.evaluate("Boolean(document.querySelector('.design-transfer__prepared'))")) await prepare();
    const files = await zip(); const info = JSON.parse(Buffer.from(files["sources.json"]).toString());
    assert.equal(info.destination, app.name); assert.ok(info.assets.length >= 6);
    assert.equal(info.excluded.length, 0); assert.equal(Object.keys(files).filter(name=>name.startsWith("assets/")).length, info.assets.length);
    if (["canva", "photoshop"].includes(app.id)) assert.ok(info.assets.every(asset=>asset.filename.endsWith(".png") && !asset.vector));
    evidence.applications.push({ name: app.name, assets: info.assets.length, formats: [...new Set(info.assets.map(a=>a.vector?"svg":"png"))] });
  }
  await field("Application", "figma");
  if (await panel.evaluate("Boolean(document.querySelector('.design-transfer__settings-summary'))")) await click("Edit preparation");
  await field("Longest edge", 64); await field("Padding", 8); await field("Background", "white"); await prepare();
  const resized = await zip(); const resizedInfo = JSON.parse(Buffer.from(resized["sources.json"]).toString());
  for (const asset of resizedInfo.assets) {
    const image = await decode(resized[asset.filename], asset.vector ? "image/svg+xml" : "image/png");
    assert.equal(Math.max(image.width, image.height), 80); assert.deepEqual(image.corner, [255,255,255,255]);
    if (asset.filename.includes("Raster picture")) { assert.equal(image.width, 80); assert.equal(image.height, 48); }
  }
  await panel.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:()=>Promise.reject(new DOMException('Denied','NotAllowedError'))}})");
  await click("Copy SVG set");
  await until(() => panel.evaluate("document.querySelector('.design-transfer__error')?.textContent.includes('Clipboard access was blocked')"), "Clipboard failure did not explain the download fallback");
  for (const width of [320,390,720]) await capture("denied",width);
  await zip();
  await until(() => panel.evaluate("document.querySelector('.design-transfer__footer button:last-child')?.disabled===false"), "Transfer actions stayed disabled after downloading");
  await panel.evaluate("document.querySelector('.design-transfer__footer button:last-child').focus()");
  await panel.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await panel.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.ok(await panel.evaluate("document.querySelector('.design-transfer').contains(document.activeElement)"), "Keyboard focus escaped the modal");
  // Native modal handles keyboard trapping and restores the launch control.
  await panel.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await panel.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until(() => panel.evaluate("!document.querySelector('.design-transfer')"), "Escape did not close asset transfer");
  assert.ok(await panel.evaluate("document.activeElement.matches('.design-transfer-launch')"));
  console.log("PASS all 10 application presets, PNG defaults for Canva/Photoshop, aspect-preserving sizing/padding/backgrounds, denied clipboard fallback, and Escape/focus restoration.");

  const errors = [entries[0], { label: "Expired asset", kind: "image", path: "/expired.png" }, { label: "Damaged asset", kind: "image", path: "/damaged.png" }, { label: "External artwork", kind: "icon", path: "/external.svg" }];
  await seed(errors); await select(errors); await launch();
  await panel.evaluate("window.__originalRequest=chrome.permissions.request;chrome.permissions.request=async p=>{window.__permissionRequests.push(p);return false;}");
  await prepare();
  assert.match(await panel.evaluate("document.querySelector('.design-transfer__error').textContent"), /Website access was not granted/);
  assert.equal(await panel.evaluate("document.querySelectorAll('.design-asset').length"), 0);
  const requests = await panel.evaluate("window.__permissionRequests"); assert.deepEqual(requests.at(-1).origins, ["http://127.0.0.1/*"]);
  await panel.evaluate("chrome.permissions.request=window.__originalRequest"); await prepare();
  assert.equal(await panel.evaluate("document.querySelectorAll('.design-transfer__failures li').length"), 3);
  assert.equal(await panel.evaluate("Boolean([...document.querySelectorAll('.design-transfer__footer button')].find(b=>b.textContent==='Copy SVG set'))"), false, "Failed assets were silently excluded");
  for (const width of [320,390,720]) await capture("errors",width);
  await click("Use 1 ready asset"); const partial = await zip();
  assert.equal(JSON.parse(Buffer.from(partial["sources.json"]).toString()).excluded.length,3);
  // Retrying reuses successful sources and recovers genuinely changed hosts.
  fixtures.set("/expired.png", { type:"image/png", bytes: Buffer.from(samples.png,"base64") });
  await panel.evaluate("document.querySelector('[aria-label=\"Close asset transfer\"]').click()");
  await launch(); await prepare();
  assert.equal(await panel.evaluate("document.querySelectorAll('.design-transfer__failures li').length"),2);
  await panel.evaluate("document.querySelector('[aria-label=\"Close asset transfer\"]').click()");
  const slow = [{ label:"Slow source",kind:"image",path:"/slow.png" }];
  await seed(slow); await select(slow); await launch(); await click("Prepare set");
  await until(()=>panel.evaluate("Boolean(document.querySelector('.design-transfer__progress'))"),"Preparation progress did not appear");
  await click("Cancel preparation"); await delay(200);
  assert.match(await panel.evaluate("document.querySelector('.design-transfer__status').textContent"),/cancelled/);
  assert.equal(await panel.evaluate("document.querySelectorAll('.design-asset').length"),0);
  await panel.evaluate("document.querySelector('[aria-label=\"Close asset transfer\"]').click()");
  const many = Array.from({length:101},(_,i)=>({label:`Asset ${i}`,kind:"image",path:`/red.svg?item=${i}`}));
  await seed(many); await category("images");
  await panel.evaluate("document.querySelector('.resource-select').click();document.querySelector('.bulk-selection__controls button').click()");
  await launch(); await prepare();
  assert.match(await panel.evaluate("document.querySelector('.design-transfer__error').textContent"),/up to 100/);
  assert.equal(await panel.evaluate("window.__permissionRequests.length"),0,"Oversize selections must fail before asking for any site permission");
  console.log("PASS denied host access, expired/corrupt/external assets, explicit partial-set consent and manifest, recovery, cancellation, and the 100-asset limit.");

  if (live) {
    const real = [
      {label:"Lucide image",kind:"icon",url:"https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/image.svg"},
      {label:"Pillow photograph",kind:"image",url:"https://raw.githubusercontent.com/python-pillow/Pillow/main/Tests/images/hopper.png"},
    ];
    await seed(real); await select(real); await launch(); await prepare();
    assert.equal(await panel.evaluate("document.querySelectorAll('.design-transfer__failures li').length"),0);
    const files=await zip();const info=JSON.parse(Buffer.from(files['sources.json']).toString()); assert.equal(info.assets.length,2);
    evidence.live.push({sources:real.map(r=>r.url),exported:info.assets.map(a=>({filename:a.filename,width:a.width,height:a.height}))});
    console.log("PASS live public Lucide SVG and Pillow PNG URLs prepared and downloaded without omissions.");
    const {client:oe}=await open(base+"/photopea");
    await until(()=>oe.evaluate("window.messages?.includes('done')"),"Photopea did not become ready for the real import test",60_000);
    for(const asset of info.assets){
      await oe.evaluate(`window.messages=[];window.exported=null;document.querySelector('#editor').contentWindow.postMessage(new Uint8Array(${JSON.stringify([...files[asset.filename]])}).buffer,'https://www.photopea.com')`);
      await until(()=>oe.evaluate("window.messages.includes('done')"),`Photopea did not import ${asset.filename}`,45_000);
      await oe.evaluate("window.messages=[];document.querySelector('#editor').contentWindow.postMessage('app.echoToOE(JSON.stringify({width:app.activeDocument.width,height:app.activeDocument.height,layers:app.activeDocument.layers.length}));app.activeDocument.saveToOE(\"png\");','https://www.photopea.com')");
      const exported=await until(()=>oe.evaluate("window.exported"),`Photopea could not render ${asset.filename}`,45_000);
      const image=await decode(exported);assert.equal(image.width,asset.width);assert.equal(image.height,asset.height);assert.ok(image.visible>0,"The real editor imported an empty asset");
      evidence.live.push({importedIn:"Photopea",file:asset.filename,width:image.width,height:image.height});
    }
    console.log("PASS real Photopea import and rendered output for the extension's SVG and PNG files (no account or fixture importer).");
  }
  await writeFile(resolve(`.impeccable/review/design-transfer-${live ? "live-" : ""}results.json`),JSON.stringify(evidence,null,2));
  console.log("All design transfer checks passed.");
  }
} finally {
  for(const client of clients)client.close();
  if(controller){try{await controller.send("Browser.close");}catch{}controller.close();}
  browser.kill();server.closeAllConnections();server.close();
  const target=resolve(profile);
  if(target.startsWith(resolve(tmpdir())+sep)&&basename(target).startsWith("stashwell-design-transfer-")){
    for(let i=0;i<10;i++){try{await rm(target,{recursive:true,force:true});break;}catch{await delay(300);}}
  }
}
