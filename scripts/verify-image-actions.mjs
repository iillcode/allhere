// Black-box checks against the built extension, using isolated Brave storage and downloads.
// Run after building: node scripts/verify-image-actions.mjs [optional-image-url]
import assert from "node:assert/strict";
import { localFixtureExtension } from "./extension-fixture.mjs";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as portServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

const { unzipSync } = createRequire(new URL("../packages/library-ui/package.json", import.meta.url))("fflate");

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const menuOnly = process.argv[2] === "--menu-check";
const albumOnly = process.argv[2] === "--album-check";
const dragOnly = process.argv[2] === "--drag-check";
const scanOnly = process.argv[2] === "--scan-check";
const modalOnly = process.argv[2] === "--modal-check";
const downloadOnly = process.argv[2] === "--download-check";
const formatOnly = process.argv[2] === "--format-check";
async function until(check, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(message);
}
class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method) this.events.push(message);
      if (message.method) this.onEvent?.(message);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  async ready() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((done, reject) => {
      this.socket.addEventListener("open", done, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((done, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 35_000);
      this.pending.set(id, { resolve: done, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async evaluate(expression, userGesture = false, sessionId) {
    const result = await this.send("Runtime.evaluate", { expression, userGesture, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

const fixtures = new Map();
const server = createServer((request, response) => {
  const fixture = fixtures.get(new URL(request.url, "http://localhost").pathname);
  if (!fixture) { response.writeHead(404).end(); return; }
  if (fixture.slow) {
    const range=request.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),fixture.bytes.length-1):fixture.bytes.length-1;
    response.writeHead(range?206:200,{"Content-Type":fixture.type,"Content-Length":end-start+1,"Accept-Ranges":"bytes",...(range?{"Content-Range":`bytes ${start}-${end}/${fixture.bytes.length}`}:{})});
    let offset=start;
    const send=()=>{if(response.destroyed)return;const next=Math.min(offset+32768,end+1);response.write(fixture.bytes.subarray(offset,next));offset=next;if(offset>end)response.end();else setTimeout(send,fixture.slow);};
    send();return;
  }
  response.writeHead(fixture.status ?? 200, { "Content-Type": fixture.type, "Cross-Origin-Resource-Policy": "same-origin", ...(fixture.cors === false ? {} : { "Access-Control-Allow-Origin": "*" }), "Access-Control-Expose-Headers": "Content-Disposition", ...fixture.headers });
  response.end(fixture.bytes);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const debugPort = await new Promise((done) => {
  const server = portServer();
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => done(port)); });
});
const profile = await mkdtemp(join(tmpdir(), "stashwell-image-actions-"));
const downloads = join(profile, "test-downloads");
await mkdir(downloads);
const extension = await localFixtureExtension(profile);
const browser = spawn(process.env.STASHWELL_BROWSER_PATH ?? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, "--headless=new", "--no-first-run",
  "--no-default-browser-check", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
let browserCdp;
let page;
try {
  const version = await until(async () => {
    try { return await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { return null; }
  }, "Brave did not start");
  browserCdp = new Cdp(version.webSocketDebuggerUrl);
  await browserCdp.ready();
  const worker = await until(async () => {
    const { targetInfos } = await browserCdp.send("Target.getTargets");
    return targetInfos.find((target) => /^chrome-extension:/.test(target.url) && target.url.endsWith("service-worker.js"));
  }, "The built Stashwell extension did not load");
  // Node's URL origin is null for extension URLs, so preserve the scheme and host.
  const extensionUrl = `chrome-extension://${new URL(worker.url).hostname}/index.html`;
  const { targetId } = await browserCdp.send("Target.createTarget", { url: extensionUrl });
  const target = await until(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return targets.find((target) => target.id === targetId && target.webSocketDebuggerUrl);
  }, "The extension page did not open");
  page = new Cdp(target.webSocketDebuggerUrl);
  await page.ready();
  await until(() => page.evaluate("Boolean(globalThis.chrome?.tabs?.connect)"), "The extension API did not initialize");
  if (scanOnly) {
    // The fixture is an extension tab; model a continuously visible side panel.
    // Isolate manual capture and navigation races from watcher notifications.
    // verify-auto-updates.mjs exercises real ports and continuous collection.
    await page.evaluate("(()=>{const connect=chrome.tabs.connect.bind(chrome.tabs);chrome.tabs.connect=(tabId,options)=>options?.name==='stashwell.auto-updates'?{disconnect(){},onMessage:{addListener(){}},onDisconnect:{addListener(){}}}:connect(tabId,options);})()");
    await page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));");
  }
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
  await browserCdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
  await until(() => page.evaluate("Boolean(document.querySelector('.stashwell-shell'))"), "The library did not render");
  const samples = await page.evaluate(`(() => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext('2d'); context.fillStyle = '#0b57d0'; context.fillRect(0, 0, 16, 16);
    return Object.fromEntries(['png','jpeg','webp'].map(type => [type, canvas.toDataURL('image/' + type).split(',')[1]]));
  })()`);
  const png = Buffer.from(samples.png, "base64");
  const jpeg = Buffer.from(samples.jpeg, "base64");
  const webp = Buffer.from(samples.webp, "base64");
  const icoHeader = Buffer.alloc(22);
  icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(1, 4); icoHeader[6] = 16; icoHeader[7] = 16;
  icoHeader.writeUInt16LE(1, 10); icoHeader.writeUInt16LE(32, 12); icoHeader.writeUInt32LE(png.length, 14); icoHeader.writeUInt32LE(22, 18);
  const ico = Buffer.concat([icoHeader, png]);
  const inlineSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#0b57d0" d="M2 2h20v20H2z"/></svg>';
  const remoteSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert(1)"><style>.glyph{fill:#ff0000}</style><path class="glyph" d="M2 2h20v20H2z"/><script>alert(1)</script><foreignObject width="24" height="24"><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject></svg>';
  const entries = process.argv[2] && !menuOnly && !albumOnly && !dragOnly && !scanOnly && !modalOnly && !downloadOnly && !formatOnly ? [{ label: "Remote image", url: process.argv[2] }] : [
    { label: "Extensionless", path: "/extensionless", bytes: png, type: "application/octet-stream", extension: "png" },
    { label: "Negotiated", path: "/negotiated.jpg", bytes: webp, type: "image/jpeg", extension: "webp" },
    { label: "Original JPEG", path: "/ordinary.jpg", bytes: jpeg, type: "image/jpeg", extension: "jpg" },
    { label: "Damaged", path: "/broken.png", bytes: png.subarray(0, 16), type: "image/png", rejected: true },
    { label: "Login page", path: "/not-image.jpg", bytes: Buffer.from("<html><body>Please sign in</body></html>"), type: "image/jpeg", rejected: true },
    { label: "Expired", path: "/expired.jpg", bytes: Buffer.from("Expired"), type: "text/plain", status: 403, rejected: true },
    { label: "Inline icon", url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(inlineSvg)}`, kind: "icon", extension: "svg" },
    { label: "Vector icon", path: "/vector.svg", bytes: Buffer.from(remoteSvg), type: "image/svg+xml", kind: "icon", extension: "svg" },
    { label: "Raster icon", path: "/raster-icon", bytes: png, type: "image/png", kind: "icon", extension: "png" },
    { label: "Favicon", path: "/favicon.ico", bytes: ico, type: "image/x-icon", kind: "icon", extension: "ico" },
  ];
  if (dragOnly) {
    const { readdir } = await import("node:fs/promises");
    const fontName = (await readdir(join(extension, "assets"))).find(name => /roboto-latin-400.*\.woff2$/.test(name));
    const video = await page.evaluate(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width=16;canvas.height=16;
      canvas.getContext('2d').fillRect(0,0,16,16);
      const stream=canvas.captureStream(10); const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});
      const chunks=[]; recorder.ondataavailable=event=>chunks.push(event.data);
      const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();await new Promise(resolve=>setTimeout(resolve,200));recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
      return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(chunks));});
    })()`);
    const wav=Buffer.alloc(76);wav.write('RIFF');wav.writeUInt32LE(68,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32,40);
    entries.push(
      {label:'PDF document',path:'/paper.pdf',bytes:Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'),type:'application/pdf',kind:'document',extension:'pdf'},
      {label:'Font file',path:'/font',bytes:await readFile(join(extension,'assets',fontName)),type:'application/octet-stream',kind:'font',extension:'woff2'},
      {label:'Video file',path:'/video.webm',bytes:Buffer.from(video,'base64'),type:'video/webm',kind:'video',extension:'webm'},
      {label:'Audio file',path:'/audio.wav',bytes:wav,type:'audio/wav',kind:'audio',extension:'wav'},
      {label:'Stylesheet file',path:'/style.css',bytes:Buffer.from('body { color: blue; }'),type:'text/css',kind:'stylesheet',extension:'css'},
      {label:'Script file',path:'/script.js',bytes:Buffer.from('console.log("Stashwell");'),type:'application/javascript',kind:'script',extension:'js'},
      {label:'Chunked binary',path:'/binary.bin',bytes:Buffer.alloc(2*1024*1024+17,42),type:'application/octet-stream',kind:'other',extension:'bin'},
      {label:'URL resource',url:base+'/destination',kind:'link'}
    );
    fixtures.set('/destination',{type:'text/html',bytes:Buffer.from(`<!doctype html><title>Upload destination</title><style>input,#drop {display:block;margin:24px;padding:24px;border:2px dashed blue}#drop{height:100px}</style><input id="upload" type="file"><input id="reject" type="file" accept=".pdf"><input id="disabled" type="file" disabled><input id="url" type="text"><div id="drop">Drop files here</div><script>
      window.received=[];const report=async(file,via)=>window.received.push({via,name:file.name,type:file.type,size:file.size,bytes:await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(file);})});
      upload.addEventListener('change',()=>report(upload.files[0],'input'));
      reject.addEventListener('change',()=>report(reject.files[0],'reject'));
      drop.addEventListener('dragover',event=>{event.preventDefault();window.fileTypes=[...event.dataTransfer.types]});
      drop.addEventListener('drop',event=>{event.preventDefault();for(const file of event.dataTransfer.files)report(file,'dropzone')});
      url.addEventListener('dragover',event=>event.preventDefault());url.addEventListener('drop',event=>{event.preventDefault();url.value=event.dataTransfer.getData('text/plain')});
    </script>`)});
  }
  for (const entry of entries) if (entry.path) fixtures.set(entry.path, entry);
  if (scanOnly) {
    const lengthySvg = Array.from({length:420}, (_,index)=>`<path d="M${index%20} ${index%18}h4v4z"/>`).join('');
    const symbolFont = (await readdir(join(extension, 'assets'))).find(name => /roboto-latin-400.*\.woff2$/.test(name));
    fixtures.set('/symbol-font.woff2', { type: 'font/woff2', bytes: await readFile(join(extension, 'assets', symbolFont)) });
    fixtures.set('/scan-page',{type:'text/html',bytes:Buffer.from(`<!doctype html><title>Live gallery</title>
      <base href="/assets/"><link rel="icon" href="/favicon.ico"><style>.mask-icon{width:24px;height:24px;mask-image:url('/mask.svg');background:blue}.wall{width:30px;height:30px;background-image:url('/wall.png')} .pseudo::before{content:'';display:block;width:24px;height:24px;background-image:url('/pseudo.png')}</style>
      <style>@font-face{font-family:'Fixture Symbols';src:url('/symbol-font.woff2')} .font-glyph{display:inline-block;width:24px;height:24px;font:24px 'Fixture Symbols';color:white}.font-glyph::before{content:attr(data-glyph)}.missing-glyph{font-family:'Missing Icons'}.hidden-glyph{visibility:hidden}</style>
      <mat-icon class="font-glyph" data-mat-icon-type="font" data-glyph="A" aria-label="Pseudo font glyph"></mat-icon>
      <mat-icon class="font-glyph" data-mat-icon-type="font" data-glyph="A" aria-label="Duplicate font glyph"></mat-icon>
      <span class="font-glyph hidden-glyph" data-glyph="W" aria-label="Hover font glyph"></span>
      <span class="font-glyph missing-glyph" data-glyph="M" aria-label="Unavailable font glyph"></span>
      <span>Ordinary text should not be scraped as an icon</span>
      <a href="/scene.blend">3D scene</a><a href="/opaque-download" download="vector.custom">Custom attachment</a>
      <img id="first" src="/first.png" alt="First image"><img id="lazy" loading="lazy" src="/lazy.png" alt="Lazy image" style="position:absolute;top:20000px">
      <img src="data:image/png;base64,${png.toString('base64')}" alt="Inline raster image">
      <img src="/same.png?w=100" alt="Variant"><img src="/same.png?w=200" alt="Variant">
      <img src="/same.png?sig=a&w=100" alt="Signed A"><img src="/same.png?sig=b&w=100" alt="Signed B">
      <img data-src="deferred.png" alt="Data-only image"><img src="/missing.png" data-original="/original.png" alt="Broken placeholder">
      <img src="data:image/png;base64,${png.toString('base64')}" data-src="/lazy-one.png" alt="Distinct lazy one"><img src="data:image/png;base64,${png.toString('base64')}" data-src="/lazy-two.png" alt="Distinct lazy two">
      <img src="/responsive-original.png" srcset="/responsive-small.png 1x, /responsive-large.png 2x" alt="Responsive image">
      <img src="/images/M/title._V1_QL75_UY209_CR0,0,140,209_.jpg" srcset="/images/M/title._V1_QL75_UY209_CR0,0,140,209_.jpg 140w, /images/M/title._V1_QL75_UY418_CR0,0,280,418_.jpg 280w, /images/M/title._V1_QL75_UY627_CR0,0,420,627_.jpg 420w" sizes="140px" alt="IMDb poster">
      <picture><source media="(min-width:9999px)" srcset="/alternate.png 1x"><img src="/picture.png" data-srcset="/deferred-small.png 1x, /deferred-large.png 2x" alt="Picture image"></picture>
      <img src="/fragment.svg#red" alt="Red SVG view"><img src="/fragment.svg#blue" alt="Blue SVG view">
      <a href="/first.png" download>Same image as a download link</a>
      <div style="width:30px;height:30px;background-image:url('/background(1).png')"></div>
      <div style="width:30px;height:30px;background-image:image-set('/set-one.png' 1x, '/set-two.png' 2x)"></div>
      <div style="border:4px solid;border-image-source:url('/border.png')"></div>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-label="Gradient icon" class="first-copy"><title>First title</title><defs><linearGradient id="gradient-one"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path fill="url(#gradient-one)" d="M0 0h24v24H0z"/></svg>
      <svg class="second-copy" aria-label="Duplicate gradient icon" viewBox="0 0 24 24" height="48" width="48"><title>Second title</title><defs><linearGradient id="gradient-two"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path d="M0 0h24v24H0z" fill="url(#gradient-two)"/></svg>
      <svg style="display:none"><defs><g id="shared-shape"><path d="M0 0h6v6H0z" fill="red"/></g><clipPath id="shared-clip"><rect width="12" height="24"/></clipPath></defs></svg>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-label="Local group icon"><use href="#shared-shape" x="10" y="10"/></svg>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-label="Clipped icon"><rect width="24" height="24" fill="green" clip-path="url(#shared-clip)"/></svg>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-label="Hidden menu icon" style="display:none"><path fill="purple" d="M2 2h13v13H2z"/></svg>
      <svg width="640" height="540" viewBox="0 0 64 54" aria-label="Large illustration"><rect width="64" height="54" fill="orange"/></svg>
      <svg width="24" height="24" aria-label="Nested icon"><svg width="24" height="24"><path d="M4 4h12v12H4z" fill="teal"/></svg></svg>
      <style>.styled-vector path{fill:none;stroke:rgb(255,0,0);stroke-width:3px;stroke-linecap:round;stroke-linejoin:round}</style>
      <svg class="styled-vector" width="24" height="24" viewBox="0 0 24 24" aria-label="CSS styled icon"><path fill="blue" stroke="green" d="M4 12h16"/></svg>
      <svg width="24" height="24" aria-label="External gradient icon" style="color:rgb(255,0,0)"><use href="/sprites.svg#gradient"/></svg>
      <svg width="24" height="24" aria-label="External green icon" style="color:rgb(0,255,0)"><use href="/sprites.svg#gradient"/></svg>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-label="Combined sprite icon"><use href="/sprites.svg#one" fill="red"/><use href="/sprites.svg#two" x="12" y="12" fill="blue"/></svg>
      <video><source src="/video.webm" type="video/webm"><source src="/alternative.mp4" type="video/mp4"></video>
      <div class="wall"></div><div class="mask-icon" aria-label="Mask icon"></div><div class="pseudo"></div>
      <svg width="24" height="24" aria-label="Sprite one"><use href="/sprites.svg#one"></use></svg><svg width="24" height="24" aria-label="Sprite two"><use href="/sprites.svg#two"></use></svg>
      <svg aria-label="Large inline icon" width="24" height="24" viewBox="0 0 24 24">${lengthySvg}</svg>
      <div id="shadow-host"></div><div id="closed-host"></div><iframe title="Asset frame" src="/scan-frame"></iframe><iframe title="Ungrantable frame" src="${base.replace('127.0.0.1','localhost')}/foreign-frame"></iframe>
      <script>const root=document.querySelector('#shadow-host').attachShadow({mode:'open'});root.innerHTML='<img src="/shadow.png" alt="Shadow image"><svg aria-label="Shadow icon" width="24" height="24"><circle cx="12" cy="12" r="9"/></svg>';
      document.querySelector('#closed-host').attachShadow({mode:'closed'}).innerHTML='<img src="/closed.png" alt="Closed shadow image"><svg aria-label="Closed shadow icon" width="24" height="24"><path d="M1 1h7v19H1z" fill="orange"/></svg>';
      new Image().src='/detached.png';import('/dynamic-module.mjs');
      fetch('/negotiated.jpg').then(response=>response.blob()).then(blob=>{const photo=new Image();photo.alt='Blob image';photo.src=URL.createObjectURL(blob);document.body.append(photo)});</script>`)});
    fixtures.set('/frame-favicon.svg',{type:'image/svg+xml',bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#188038"/></svg>')});
    fixtures.set('/cdn-favicon.png',{type:'image/png',bytes:png,cors:false,headers:{'Cross-Origin-Resource-Policy':'cross-origin'}});
    fixtures.set('/scan-frame',{type:'text/html',bytes:Buffer.from('<!doctype html><title>Asset frame</title><link rel="icon" href="/frame-favicon.svg"><img src="/frame.png" alt="Frame image"><svg aria-label="Frame icon" width="24" height="24"><rect width="20" height="20"/></svg>')});
    fixtures.set('/foreign-frame',{type:'text/html',bytes:Buffer.from('<!doctype html><title>Unpermitted frame</title><img src="/closed.png" alt="Foreign private image">')});
    for(const path of ['/first.png','/lazy.png','/same.png','/wall.png','/pseudo.png','/shadow.png','/frame.png','/late.png','/late2.png',
      '/lazy-one.png','/lazy-two.png','/detached.png','/closed.png','/assets/deferred.png','/original.png','/responsive-original.png','/responsive-small.png','/responsive-large.png','/alternate.png','/picture.png','/deferred-small.png','/deferred-large.png','/background(1).png','/set-one.png','/set-two.png','/border.png'])fixtures.set(path,{type:'image/png',bytes:png});
    fixtures.set('/dynamic-module.mjs',{type:'text/javascript',bytes:Buffer.from('export const loaded = true;')});
    for(const path of ['/images/M/title._V1_QL75_UY209_CR0,0,140,209_.jpg','/images/M/title._V1_QL75_UY418_CR0,0,280,418_.jpg','/images/M/title._V1_QL75_UY627_CR0,0,420,627_.jpg'])fixtures.set(path,{type:'image/png',bytes:png});
    fixtures.set('/fragment.svg',{type:'image/svg+xml',bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><view id="red" viewBox="0 0 24 24"/><view id="blue" viewBox="24 0 24 24"/><rect width="24" height="24" fill="red"/><rect x="24" width="24" height="24" fill="blue"/></svg>')});
    fixtures.set('/mask.svg',{type:'image/svg+xml',bytes:Buffer.from(inlineSvg)});
    fixtures.set('/sprites.svg',{type:'image/svg+xml',bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="external-gradient"><stop stop-color="currentColor"/><stop offset="1" stop-color="blue"/></linearGradient></defs><symbol id="gradient" viewBox="0 0 24 24"><rect width="24" height="24" fill="url(#external-gradient)"/></symbol><symbol id="one"><path d="M0 0h12v12H0z"/></symbol><symbol id="two"><circle r="6" cx="6" cy="6"/></symbol></svg>')});
  }
  const capturedAt = new Date().toISOString();
  const capture = { id: "image-actions-probe", pageUrl: `${base}/source`, pageTitle: "Image actions check", hostname: "127.0.0.1", capturedAt,
    resources: entries.map((entry, index) => ({ id: `probe-${index}`, kind: entry.kind ?? "image", label: entry.label,
      url: entry.url ?? base + entry.path, pageUrl: `${base}/source`, pageTitle: "Image actions check", capturedAt,
      security: { transport: "http", relation: "same-host", hostname: "127.0.0.1", signals: [], checkedAt: capturedAt, method: "local-heuristics" } })),
  };
  if (albumOnly) {
    capture.resources = capture.resources.filter((resource) => !entries.find(entry => entry.label === resource.label)?.rejected);
    for (let index = 3; index < 12; index++) capture.resources.push({ ...capture.resources[0], id:`extra-image-${index}`, label:`Gallery image ${index + 1}`, url:`${base}/extensionless?gallery=${index}` });
    for (const [index, kind] of ["video", "audio", "link", "link", "font", "document", "stylesheet", "script", "other"].entries()) {
      capture.resources.push({ ...capture.resources[0], id:`type-${index}`, kind, label:`Example ${kind} ${index + 1}`, url:`${base}/example-${index}` });
    }
  }
  if (downloadOnly) {
    const wav=Buffer.alloc(4*1024*1024+44,128);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
    fixtures.set('/long.wav',{type:'audio/wav',bytes:wav,slow:75});
    fixtures.set('/no-media.mp4',{type:'text/html',bytes:Buffer.from('<html>Please sign in</html>')});
    fixtures.set('/stream.m3u8',{type:'application/vnd.apple.mpegurl',bytes:Buffer.from('#EXTM3U\n#EXT-X-VERSION:3')});
    const arbitrary = Buffer.from([0, 255, 1, 34, 128, 0, 90, 13, 10]);
    fixtures.set('/scene.blend',{type:'application/octet-stream',bytes:arbitrary});
    fixtures.set('/download',{type:'application/octet-stream',bytes:arbitrary,headers:{'Content-Disposition':"attachment; filename*=UTF-8''scene%20one.blend"}});
    fixtures.set('/sound.flac',{type:'audio/flac',bytes:Buffer.concat([Buffer.from('fLaC'),arbitrary])});
    fixtures.set('/direct-video.mp4',{type:'video/mp4',bytes:Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0])});
    fixtures.set('/media-links',{type:'text/html',bytes:Buffer.from('<!doctype html><title>Media links fixture</title><a href="https://www.youtube.com/watch?v=stashwell0001">YouTube watch link</a><a href="https://www.youtube.com/shorts/stashwell0002">YouTube Shorts link</a><a href="/direct-video.mp4">Direct MP4</a>')});
    capture.resources.push({...capture.resources[0],id:'download-audio',kind:'audio',label:'Downloadable audio',url:base+'/long.wav'});
    capture.resources.push({...capture.resources[0],id:'download-flac',kind:'audio',label:'FLAC audio',url:base+'/sound.flac'});
    capture.resources.push({...capture.resources[0],id:'download-arbitrary',kind:'other',label:'Scene.blend',url:base+'/scene.blend'});
    capture.resources.push({...capture.resources[0],id:'download-named',kind:'other',label:'Named attachment',url:base+'/download'});
  }
  if (modalOnly) {
    capture.resources = capture.resources.filter(resource => !entries.find(entry => entry.label === resource.label)?.rejected);
    const font = (await readdir(join(extension, 'assets'))).find(name => /roboto-latin-400.*\.woff2$/.test(name));
    fixtures.set('/preview.woff2', { type:'font/woff2', bytes:await readFile(join(extension, 'assets', font)) });
    const encodedFrames = await page.evaluate(`(async()=>{const rgba=new Uint8Array(64*64*4);for(let i=0;i<rgba.length;i+=4)rgba.set([11,87,208,255],i);const frames=[];const encoder=new VideoEncoder({output:chunk=>{const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);frames.push({bytes:Array.from(bytes),time:chunk.timestamp/1000,key:chunk.type==='key'})},error:error=>{throw error}});encoder.configure({codec:'vp8',width:64,height:64,bitrate:100000,framerate:5});for(let i=0;i<6;i++){const frame=new VideoFrame(rgba,{format:'RGBA',codedWidth:64,codedHeight:64,timestamp:i*200000,duration:200000});encoder.encode(frame,{keyFrame:i===0});frame.close();}await encoder.flush();encoder.close();return frames;})()`);
    // Wrap the actual encoded VP8 frame in a minimal WebM container. This avoids
    // canvas captureStream's background-tab frame scheduling in headless Brave.
    const ebml=(id,bytes)=>{const length=bytes.length;const size=length<127?Buffer.from([0x80|length]):Buffer.from([0x40|(length>>8),length&255]);return Buffer.concat([Buffer.from(id,'hex'),size,bytes]);};
    const number=(id,n)=>ebml(id,Buffer.from([n]));
    const header=ebml('1a45dfa3',Buffer.concat([number('4286',1),number('42f7',1),number('42f2',4),number('42f3',8),ebml('4282',Buffer.from('webm')),number('4287',2),number('4285',2)]));
    const duration=Buffer.alloc(8);duration.writeDoubleBE(1200);
    const info=ebml('1549a966',Buffer.concat([ebml('2ad7b1',Buffer.from([15,66,64])),ebml('4489',duration),ebml('4d80',Buffer.from('Stashwell')),ebml('5741',Buffer.from('Stashwell'))]));
    const tracks=ebml('1654ae6b',ebml('ae',Buffer.concat([number('d7',1),number('73c5',1),number('83',1),ebml('86',Buffer.from('V_VP8')),ebml('e0',Buffer.concat([number('b0',64),number('ba',64)]))])));
    const cluster=ebml('1f43b675',Buffer.concat([number('e7',0),...encodedFrames.map(frame=>ebml('a3',Buffer.concat([Buffer.from([0x81,frame.time>>8,frame.time&255,frame.key?0x80:0]),Buffer.from(frame.bytes)])))]));
    fixtures.set('/preview.webm', { type:'video/webm', bytes:Buffer.concat([header,ebml('18538067',Buffer.concat([info,tracks,cluster]))]) });
    const wav=Buffer.alloc(8044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(8000,40);wav.fill(128,44);
    fixtures.set('/preview.wav', { type:'audio/wav', bytes:wav });
    for (const [kind,path] of [['font','/preview.woff2'],['video','/preview.webm'],['audio','/preview.wav'],['document','/file.txt'],['link','/source']]) {
      capture.resources.push({...capture.resources[0],id:`preview-${kind}`,kind,label:`Preview ${kind}`,url:base+path});
    }
    fixtures.set('/file.txt',{type:'text/plain',bytes:Buffer.from('Preview file fixture')});
  }
  const otherCapture = { ...capture, id: "another-page", pageUrl: `${base}/other`, pageTitle: "Another webpage",
    resources: [{ ...capture.resources[0], id: "other-resource", label: "Another page image", pageUrl: `${base}/other` }] };
  const emptyCapture = { ...capture, id: "empty-page", pageUrl: `${base}/empty`, pageTitle: "Page without images", resources: [] };
  if (formatOnly) {
    fixtures.get('/ordinary.jpg').headers={'Cross-Origin-Resource-Policy':'cross-origin'};
    fixtures.set('/format-file.blend',{type:'application/octet-stream',bytes:Buffer.from([0,255,42,13,10])});
    capture.resources.push({...capture.resources[0],id:'format-file',kind:'other',label:'Binary file',url:base+'/format-file.blend'});
  }
  const storedCaptures = albumOnly ? [capture, otherCapture, emptyCapture] : [capture];
  await page.evaluate(`chrome.storage.local.set({"allhere.library.v1":${JSON.stringify(storedCaptures)}})`);
  if (!scanOnly) {
    await selectSource(capture.pageTitle);
    await until(() => page.evaluate("Boolean(document.querySelector('.resource-album'))"), "Resource sections did not appear in the library");
  }
  async function selectCategory(name) {
    await page.evaluate(`[...document.querySelectorAll('.category-pill')].find(button => button.textContent.startsWith(${JSON.stringify(name)})).click()`, true);
  }
  async function selectSource(name) {
    await page.evaluate("document.querySelector('.page-scope__trigger').click()", true);
    await page.evaluate(`[...document.querySelectorAll('.page-scope__option')].find(button => button.textContent.includes(${JSON.stringify(name)})).click()`, true);
    await until(() => page.evaluate(`document.querySelector('.page-scope__selection strong').textContent.includes(${JSON.stringify(name)})`), "Source page did not change");
  }
  if (albumOnly) {
    await selectSource(capture.pageTitle);
    for (const width of [320, 390, 720]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      const overview = await page.evaluate(`(() => {
        const images = document.querySelector('[data-album-category=images]');
        const cells = [...images.querySelectorAll('.resource-album__preview')].map(cell => cell.getBoundingClientRect());
        const rows = [...new Set(cells.map(rect => Math.round(rect.top)))];
        return { sections:document.querySelectorAll('.resource-album').length,
        resources:document.querySelectorAll('.resource-card').length, table:!!document.querySelector('.resource-table'),
        layoutControls:!!document.querySelector('.sort-button, .view-switch'),
        fits:document.documentElement.scrollWidth <= innerWidth,
        source:document.querySelector('.page-scope__selection strong').textContent,
        count:document.querySelector('.collection-meta').textContent.trim(),
        columns:getComputedStyle(images.querySelector('.resource-album__grid')).gridTemplateColumns.split(' ').length,
        previewCount:cells.length, rows:rows.length,
        rowCounts:rows.map(top => cells.filter(rect => Math.round(rect.top) === top).length),
        square:cells.every(rect => Math.abs(rect.width - rect.height) < 1),
        bounded:[...document.querySelectorAll('.resource-album__grid')].every(grid => grid.children.length <= 10) };
      })()`);
      assert.deepEqual(overview, { sections:6, resources:0, table:false, layoutControls:false, fits:true,
        source:capture.pageTitle, count:`${capture.resources.length} resources`, columns:5, previewCount:10,
        rows:2, rowCounts:[5,5], square:true, bounded:true });
      await page.evaluate("document.querySelector('.notice .icon-button')?.click()", true);
      await delay(400);
      const screenshot = await page.send("Page.captureScreenshot", { format:"png" });
      const screenshotPath = join(tmpdir(), `${basename(profile)}-albums-${width}.png`);
      await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
      console.log(`PASS ${width}px album overview: ${screenshotPath}`);
    }
    await page.send("Emulation.setDeviceMetricsOverride", { width:390, height:800, deviceScaleFactor:1, mobile:false });
  }
  if (!albumOnly && !modalOnly && !downloadOnly && !scanOnly) {
    await selectCategory("Images");
    await until(() => page.evaluate(`document.querySelectorAll('.resource-card').length === ${capture.resources.filter(resource => resource.kind === "image").length}`), "Images did not appear in the library");
  }
  // Inspect the clipboard payload without reading or overwriting the user's OS clipboard.
  await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    write: async items => { window.__copiedSvg = await (await items[0].getType('text/plain')).text(); },
    writeText: async text => { window.__copiedSvg = text; }
  } })`);
  const formatRoot = (scope, label) => `[...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('.download-format')].find(root=>root.querySelector('label').textContent===${JSON.stringify(label)})`;
  async function openFormat(client, scope, label) {
    await client.evaluate(`(()=>{const trigger=(${formatRoot(scope,label)}).querySelector('[role=combobox]');trigger.scrollIntoView({block:${JSON.stringify(scope==='.resource-modal'?'center':'nearest')}});trigger.focus();if(trigger.getAttribute('aria-expanded')!=='true')trigger.click();})()`,true);
    await until(()=>client.evaluate(`(${formatRoot(scope,label)}).querySelector('[role=listbox]').matches(':popover-open')`),'Custom format dropdown did not open');
    assert.equal(await client.evaluate(`Boolean(document.querySelector(${JSON.stringify(scope)}).querySelector('select'))`),false,'Format dropdown still uses a native select');
  }
  async function chooseFormat(client, scope, label, value) {
    await openFormat(client,scope,label);
    await client.evaluate(`(${formatRoot(scope,label)}).querySelector('[data-format="${value}"]').click()`,true);
    await until(()=>client.evaluate(`!(${formatRoot(scope,label)}).querySelector('[role=listbox]').matches(':popover-open')`),'Custom format dropdown did not close after choosing');
  }
  async function captureFormat(client, scope, label, filename) {
    await openFormat(client,scope,label);
    const bounds=await client.evaluate(`(()=>{const root=(${formatRoot(scope,label)});const r=root.querySelector('[role=listbox]').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth};})()`);
    assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height&&bounds.scrollWidth<=bounds.width,`Custom format dropdown overflow: ${JSON.stringify(bounds)}`);
    const shot=await client.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(filename),Buffer.from(shot.data,'base64'));
    await client.evaluate(`(${formatRoot(scope,label)}).querySelector('[role=combobox]').click()`,true);
    await until(()=>client.evaluate(`!(${formatRoot(scope,label)}).querySelector('[role=listbox]').matches(':popover-open')`),'Custom format dropdown did not close');
  }
  async function action(label, name, format) {
    await selectCategory(entries.find(entry => entry.label === label)?.kind === "icon" ? "Icons" : "Images");
    await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('.resource-card')].find(card => card.getAttribute('aria-label') === ${JSON.stringify(label)});
      card.closest('.resource-card-frame').scrollIntoView({block:'center'});
      card.closest('.resource-card-frame').querySelector('.resource-actions__trigger').click();
    })()`, true);
    await until(() => page.evaluate("Boolean(document.querySelector('.resource-actions__menu'))"), "Menu did not open");
    if (formatOnly) assert.equal(await page.evaluate("Boolean(document.querySelector('.image-scale,.image-preview-tools,[data-image-scale]'))"),false,'Image actions must not offer image enlargement');
    if (format) await chooseFormat(page,'.resource-actions__menu','Download format',format);
    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('.resource-actions__item')].find(button => button.textContent.trim() === ${JSON.stringify(name)});
      if (!button || button.disabled) throw new Error('Requested action is unavailable');
      button.click();
    })()`, true);
    await delay(100);
    await until(() => page.evaluate("!document.querySelector('.resource-actions__trigger .spin')"), "Image action did not finish");
  }
  if (formatOnly) {
    await mkdir(resolve('.impeccable/review'),{recursive:true});
    const jobs=()=>page.evaluate("chrome.storage.local.get('allhere.downloads.v1').then(data=>data['allhere.downloads.v1']||[])");
    const decode=async(bytes)=>page.evaluate(`(async()=>{const image=new Image();image.src='data:image/'+${JSON.stringify(bytes[0]===0xff?'jpeg':bytes[0]===0x89?'png':'webp')}+';base64,'+${JSON.stringify(bytes.toString('base64'))};await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,pixel:Array.from(ctx.getImageData(0,0,1,1).data)};})()`);
    for(const [label,format,extension] of [['Inline icon','svg','svg'],['Raster icon','svg','svg'],['Inline icon','png','png'],['Inline icon','jpeg','jpg'],['Inline icon','webp','webp'],['Original JPEG','png','png'],['Original JPEG','jpeg','jpg'],['Original JPEG','webp','webp']]){
      const previous=new Set((await jobs()).map(job=>job.id));
      await action(label,'Download',format);
      const job=await until(async()=> (await jobs()).find(job=>!previous.has(job.id)&&job.state==='complete'),`${label} ${format} did not complete`);
      assert.ok(job.filename.endsWith('.'+extension),'Converted download has the wrong extension');
      const bytes=await readFile(join(downloads,job.filename));
      if(format==='svg'){
        assert.match(bytes.toString(),/<svg/);assert.doesNotMatch(bytes.toString(),/<script|onload=/);
        if(label==='Raster icon') assert.match(bytes.toString(),/<image[^>]+href="data:image\/png;base64,/);
        else assert.match(bytes.toString(),/<path/);
      } else {
        if(format==='png') assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
        if(format==='jpeg') assert.deepEqual([...bytes.subarray(0,3)],[255,216,255]);
        if(format==='webp') assert.equal(bytes.toString('ascii',8,12),'WEBP');
        const decoded=await decode(bytes);assert.equal(decoded.width,label==='Original JPEG'?16:24);assert.equal(decoded.height,decoded.width);
        if(format==='jpeg'&&label==='Inline icon') assert.ok(decoded.pixel.slice(0,3).every(channel=>channel>=240)&&decoded.pixel[3]===255,'JPEG transparency should be white, allowing for lossy compression');
        if(label==='Inline icon'&&format!=='jpeg') assert.equal(decoded.pixel[3],0,'PNG and WebP should retain transparency');
      }
    }
    const beforeFailure=(await jobs()).length;
    await action('Damaged','Download','png');
    assert.equal((await jobs()).length,beforeFailure,'Damaged images must not start a converted download');
    await selectCategory('Icons');
    await page.evaluate("(()=>{const card=[...document.querySelectorAll('.resource-card')].find(card=>card.getAttribute('aria-label')==='Inline icon');card.closest('.resource-card-frame').querySelector('.resource-actions__trigger').click();})()",true);
    await until(()=>page.evaluate("Boolean(document.querySelector('.resource-actions__menu [role=combobox]'))"),'Icon format choices did not open');
    await chooseFormat(page,'.resource-actions__menu','Download format','svg');
    const key=async(key,code,virtualKey)=>{await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtualKey});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtualKey});};
    const activeFormat=()=>page.evaluate("(()=>{const trigger=document.querySelector('.resource-actions__menu [role=combobox]');return document.getElementById(trigger.getAttribute('aria-activedescendant'))?.getAttribute('data-format');})()");
    await openFormat(page,'.resource-actions__menu','Download format');
    await key('End','End',35);assert.equal(await activeFormat(),'webp');
    await key('Home','Home',36);assert.equal(await activeFormat(),'original');
    await key('ArrowDown','ArrowDown',40);assert.equal(await activeFormat(),'svg');
    await key('Enter','Enter',13);
    await until(()=>page.evaluate("document.querySelector('.resource-actions__menu [role=combobox]')?.getAttribute('aria-expanded')==='false'"),'Keyboard choice did not close the dropdown');
    assert.equal(await page.evaluate("document.activeElement===document.querySelector('.resource-actions__menu [role=combobox]')"),true,'Keyboard selection lost focus');
    await key('j','KeyJ',74);await until(async()=>await activeFormat()==='jpeg','Format typeahead did not select JPEG');
    await key('Escape','Escape',27);
    assert.equal(await page.evaluate("Boolean(document.querySelector('.resource-actions__menu'))"),true,'Escape closed the parent resource menu');
    await openFormat(page,'.resource-actions__menu','Download format');await key('Tab','Tab',9);
    assert.equal(await page.evaluate("document.querySelector('.resource-actions__menu [role=combobox]').getAttribute('aria-expanded')"),'false','Tab did not dismiss format choices');
    assert.equal(await page.evaluate("document.activeElement===document.querySelector('.resource-actions__menu [role=combobox]')"),false,'Tab did not move focus onward');
    await openFormat(page,'.resource-actions__menu','Download format');
    await page.evaluate("document.querySelector('.resource-actions__menu').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
    await until(()=>page.evaluate("document.querySelector('.resource-actions__menu [role=combobox]')?.getAttribute('aria-expanded')==='false'"),'Clicking outside the format dropdown did not close it');
    console.log('PASS custom format dropdown: keyboard arrows/Home/End/Enter, typeahead, Escape isolation, Tab navigation, outside click, and focus retention.');
    for(const width of [320,390,720]){
      await page.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
      await page.evaluate("document.querySelector('.resource-actions__menu').scrollIntoView({block:'center'})");
      await captureFormat(page,'.resource-actions__menu','Download format',`.impeccable/review/formats-single-${width}.png`);
      const bounds=await page.evaluate("(()=>{const r=document.querySelector('.resource-actions__menu').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth};})()");
      if(bounds.scrollWidth>bounds.width) console.log('Overflow elements',await page.evaluate("[...document.querySelectorAll('*')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>innerWidth}).slice(0,12).map(el=>({class:el.className,tag:el.tagName,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width}))"));
      assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height&&bounds.scrollWidth<=bounds.width,`Format menu overflow at ${width}px: ${JSON.stringify(bounds)}`);
    }
    await page.evaluate("document.querySelector('.resource-actions__trigger[aria-expanded=true]').click()",true);
    for(const [category,label] of [['Icons','Inline icon'],['Images','Original JPEG'],['Files','Binary file']]){
      await selectCategory(category);await page.evaluate(`document.querySelector(${JSON.stringify(`[aria-label="Select ${label}"]`)}).click()`,true);
    }
    await page.evaluate("document.querySelector('.bulk-selection__menu-trigger').click()",true);
    await chooseFormat(page,'.bulk-selection__menu-panel','Icon format','svg');
    await chooseFormat(page,'.bulk-selection__menu-panel','Image format','jpeg');
    for(const width of [320,390,720]){
      await page.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
      assert.ok(await page.evaluate("(()=>{const r=document.querySelector('.bulk-selection__menu-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()"),`Bulk format menu overflow at ${width}px`);
      await captureFormat(page,'.bulk-selection__menu-panel','Image format',`.impeccable/review/formats-bulk-${width}.png`);
    }
    await page.evaluate("[...document.querySelectorAll('.bulk-selection__menu-panel button')].find(button=>button.textContent.includes('Download as ZIP')).click()",true);
    const zip=await until(async()=> (await jobs()).find(job=>job.filename.endsWith('.zip')&&job.state==='complete'),'Converted ZIP did not complete');
    const contents=unzipSync(await readFile(join(downloads,zip.filename)));
    assert.match(Buffer.from(contents['Inline icon.svg']).toString(),/<path/);
    assert.deepEqual([...contents['Original JPEG.jpg'].subarray(0,3)],[255,216,255]);
    assert.deepEqual(Buffer.from(contents['Binary file.blend']),fixtures.get('/format-file.blend').bytes,'Nonimage files changed in a converted ZIP');
    await selectCategory('Icons');await page.evaluate("document.querySelector('.resource-card[aria-label=\"Inline icon\"]').click()",true);
    await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:1,mobile:false});
    await chooseFormat(page,'.resource-modal','Download format','jpeg');
    await captureFormat(page,'.resource-modal','Download format','.impeccable/review/formats-preview-390.png');
    await openFormat(page,'.resource-modal','Download format');await key('Escape','Escape',27);
    assert.equal(await page.evaluate("document.querySelector('.resource-modal').open"),true,'Escape in the format dropdown dismissed the preview');
    const previousPreviewIds=new Set((await jobs()).map(job=>job.id));
    await page.evaluate("document.querySelector('.resource-modal .details-open').click()",true);
    const previewDownload=await until(async()=> (await jobs()).find(job=>!previousPreviewIds.has(job.id)&&job.state==='complete'),'Preview format download did not complete');
    assert.deepEqual([...(await readFile(join(downloads,previewDownload.filename))).subarray(0,3)],[255,216,255]);
    if(process.env.STASHWELL_WEB_URL){
      const {targetId:webId}=await browserCdp.send('Target.createTarget',{url:process.env.STASHWELL_WEB_URL});
      const webInfo=await until(async()=> (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(target=>target.id===webId&&target.webSocketDebuggerUrl),'Web format library did not open');
      const web=new Cdp(webInfo.webSocketDebuggerUrl);await web.ready();
      try{
        await until(()=>web.evaluate("Boolean(document.querySelector('.stashwell-shell--web'))"),'Web library did not render');
        await web.evaluate(`localStorage.setItem('allhere.library.v1',${JSON.stringify(JSON.stringify([capture]))})`);
        await web.send('Page.reload');await until(()=>web.evaluate("Boolean(document.querySelector('.resource-album'))"),'Web fixture did not load');
        const category=async name=>web.evaluate(`[...document.querySelectorAll('.category-pill')].find(button=>button.textContent.startsWith(${JSON.stringify(name)})).click()`,true);
        await category('Icons');
        await web.evaluate("document.querySelector('.resource-card[aria-label=\"Inline icon\"]').closest('.resource-card-frame').querySelector('.resource-actions__trigger').click()",true);
        await until(()=>web.evaluate("Boolean(document.querySelector('.resource-actions__menu [role=combobox]'))"),'Web format selector did not open');
        await chooseFormat(web,'.resource-actions__menu','Download format','svg');
        for(const width of [1440,390]){
          await web.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
          await web.evaluate("document.querySelector('.resource-actions__menu').scrollIntoView({block:'center'})");
          await captureFormat(web,'.resource-actions__menu','Download format',`.impeccable/review/formats-web-single-${width}.png`);
          assert.ok(await web.evaluate("(()=>{const r=document.querySelector('.resource-actions__menu').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth;})()"),`Web format menu overflow at ${width}px`);
        }
        await web.evaluate("document.querySelector('.resource-actions__trigger[aria-expanded=true]').click()",true);
        for(const [name,label] of [['Icons','Inline icon'],['Images','Original JPEG'],['Files','Binary file']]){await category(name);await web.evaluate(`document.querySelector(${JSON.stringify(`[aria-label="Select ${label}"]`)}).click()`,true);}
        await web.evaluate("document.querySelector('.bulk-selection__menu-trigger').click()",true);
        await until(()=>web.evaluate("Boolean(document.querySelector('.bulk-selection__menu-panel [role=combobox]'))"),'Web bulk formats did not open');
        await chooseFormat(web,'.bulk-selection__menu-panel','Image format','png');
        for(const width of [1440,390]){
          await web.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
          await captureFormat(web,'.bulk-selection__menu-panel','Image format',`.impeccable/review/formats-web-bulk-${width}.png`);
          assert.ok(await web.evaluate("(()=>{const r=document.querySelector('.bulk-selection__menu-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()"),`Web bulk formats overflow at ${width}px`);
        }
        const priorFiles=new Set(await readdir(downloads));
        await web.evaluate("[...document.querySelectorAll('.bulk-selection__menu-panel button')].find(button=>button.textContent.includes('Download as ZIP')).click()",true);
        const webZip=await until(async()=>{const filename=(await readdir(downloads)).find(name=>name.endsWith('.zip')&&!priorFiles.has(name));if(!filename)return;try{return unzipSync(await readFile(join(downloads,filename)));}catch{return;}},'Web converted ZIP did not download');
        assert.match(Buffer.from(webZip['Inline icon.svg']).toString(),/<path/);assert.deepEqual([...webZip['Original JPEG.png'].subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.deepEqual(Buffer.from(webZip['Binary file.blend']),fixtures.get('/format-file.blend').bytes);
        await web.evaluate("document.querySelector('.bulk-selection__controls button:last-child').click()",true);
        await category('Images');
        await web.evaluate("document.querySelector('.resource-card[aria-label=\"Original JPEG\"]').click()",true);
        await until(()=>web.evaluate("document.querySelector('.details-panel .resource-art__image')?.naturalWidth===16"),'Web image preview must keep its source pixels');
        assert.equal(await web.evaluate("Boolean(document.querySelector('.image-scale,.image-preview-tools,[data-image-scale]'))"),false,'Web preview must not offer image enlargement');
        for(const width of [1440,390]){
          await web.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
          assert.ok(await web.evaluate("document.documentElement.scrollWidth<=innerWidth"),'Web original image preview overflowed');
          const shot=await web.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(`.impeccable/review/source-web-preview-${width}.png`),Buffer.from(shot.data,'base64'));
        }
        console.log('PASS actual web format controls, source-size image previews at 1440/390px, and mixed converted ZIP bytes.');
      }finally{web.close();await browserCdp.send('Target.closeTarget',{targetId:webId});}
    }
    await page.evaluate("document.querySelector('[aria-label=\"Close preview\"]')?.click();document.querySelector('.bulk-selection__controls button:last-child')?.click()",true);
    await selectCategory('Images');
    const originalIds=new Set((await jobs()).map(job=>job.id));
    await action('Original JPEG','Download','original');
    const originalJob=await until(async()=>(await jobs()).find(job=>!originalIds.has(job.id)&&job.state==='complete'),'Original image download did not complete');
    assert.deepEqual(await readFile(join(downloads,originalJob.filename)),fixtures.get('/ordinary.jpg').bytes,'Original download must preserve source bytes');
    await page.evaluate("document.querySelector('.resource-card[aria-label=\"Original JPEG\"]').click()",true);
    await until(()=>page.evaluate("document.querySelector('.resource-modal .resource-art__image')?.naturalWidth===16"),'Native image preview must keep its source pixels');
    assert.equal(await page.evaluate("Boolean(document.querySelector('.image-scale,.image-preview-tools,[data-image-scale]'))"),false,'Native preview must not offer image enlargement');
    for(const width of [320,390,720]){
      await page.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
      assert.ok(await page.evaluate("document.documentElement.scrollWidth<=innerWidth"),'Native source-size preview overflowed');
      if(width!==390){const shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(`.impeccable/review/source-preview-${width}.png`),Buffer.from(shot.data,'base64'));}
    }
    const previewIds=new Set((await jobs()).map(job=>job.id));
    await page.evaluate("document.querySelector('.resource-modal .details-open').click()",true);
    const imagePreviewJob=await until(async()=>(await jobs()).find(job=>!previewIds.has(job.id)&&job.state==='complete'),'Source-size preview download did not complete');
    assert.deepEqual(await readFile(join(downloads,imagePreviewJob.filename)),fixtures.get('/ordinary.jpg').bytes,'Preview download must preserve original bytes');
    await page.evaluate("document.querySelector('[aria-label=\"Close preview\"]').click()",true);
    for(const [category,label] of [['Icons','Inline icon'],['Images','Original JPEG'],['Files','Binary file']]){
      await selectCategory(category);await page.evaluate(`document.querySelector(${JSON.stringify(`[aria-label="Select ${label}"]`)}).click()`,true);
    }
    await page.evaluate("document.querySelector('.bulk-selection__menu-trigger').click()",true);
    assert.equal(await page.evaluate("Boolean(document.querySelector('.image-scale,.image-preview-tools,[data-image-scale]'))"),false,'Bulk downloads must not offer image enlargement');
    await chooseFormat(page,'.bulk-selection__menu-panel','Image format','original');
    const originalZipIds=new Set((await jobs()).map(job=>job.id));
    await page.evaluate("[...document.querySelectorAll('.bulk-selection__menu-panel button')].find(button=>button.textContent.includes('Download as ZIP')).click()",true);
    const originalZip=await until(async()=>(await jobs()).find(job=>!originalZipIds.has(job.id)&&job.state==='complete'),'Original mixed ZIP did not complete');
    const originalContents=unzipSync(await readFile(join(downloads,originalZip.filename)));
    assert.deepEqual(Buffer.from(originalContents['Original JPEG.jpg']),fixtures.get('/ordinary.jpg').bytes,'Original ZIP images must preserve source bytes');
    assert.equal((await decode(Buffer.from(originalContents['Original JPEG.jpg']))).width,16,'ZIP images must keep source dimensions');
    assert.deepEqual(Buffer.from(originalContents['Binary file.blend']),fixtures.get('/format-file.blend').bytes,'Original mixed ZIP must preserve other files');
    console.log('PASS format choices and removal of image sizing: SVG/PNG/JPEG/WebP, source dimensions, transparency, custom dropdown keyboard behavior, original single/preview/ZIP bytes, source-size previews, and responsive controls at 320/390/720px.');
  } else if (downloadOnly) {
    await mkdir(resolve('.impeccable/review'),{recursive:true});
    const jobs=()=>page.evaluate("chrome.storage.local.get('allhere.downloads.v1').then(data=>data['allhere.downloads.v1']||[])");
    const submit=async(url)=>page.evaluate(`chrome.runtime.sendMessage({type:'stashwell.download.start',input:{url:${JSON.stringify(url)},title:${JSON.stringify(new URL(url).pathname.slice(1))},filename:${JSON.stringify(new URL(url).pathname.slice(1))},kind:'audio'}})`);
    await selectCategory('Video & audio');
    await page.evaluate("document.querySelector('.resource-actions__trigger').click()",true);
    await page.evaluate("[...document.querySelectorAll('.resource-actions__item')].find(button=>button.textContent.trim()==='Download').click()",true);
    let first;
    try { first=await until(async()=>{const list=await jobs();return list.find(job=>job.state==='downloading'&&job.received>0&&job.total>0);},'Direct media progress never advanced'); }
    catch(error){console.error(await jobs());console.error(await page.evaluate("document.querySelector('.notice')?.textContent"));throw error;}
    for(const width of [320,390,720]){
      await page.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
      assert.ok(await page.evaluate("(()=>{const r=document.querySelector('.download-tray').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth;})()"),`Download bar overflow at ${width}px`);
      const shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(`.impeccable/review/download-active-${width}.png`),Buffer.from(shot.data,'base64'));
    }
    await page.send('Page.reload');
    await until(()=>page.evaluate("Boolean(document.querySelector('.download-tray'))"),'Download progress did not restore after reload');
    const complete=await until(async()=>{const list=await jobs();return list.find(job=>job.id===first.id&&job.state==='complete');},'Direct media download did not complete',20000);
    const received=await readFile(join(downloads,complete.filename));assert.deepEqual(received,fixtures.get('/long.wav').bytes,'Downloaded audio bytes differ');
    await selectCategory('Video & audio');
    await submit(base+'/long.wav');
    const next=await until(async()=>{const list=await jobs();return list.find(job=>job.id!==first.id&&job.state==='downloading');},'Second download did not start');
    await page.evaluate(`chrome.runtime.sendMessage({type:'stashwell.download.cancel',id:${JSON.stringify(next.id)}})`);
    await until(async()=> (await jobs()).find(job=>job.id===next.id)?.state==='cancelled','Cancellation did not persist');
    await submit(base+'/no-media.mp4');
    await until(async()=> (await jobs()).find(job=>job.state==='failed'&&job.url.endsWith('/no-media.mp4')),'HTML response was saved as media');
    await submit(base+'/stream.m3u8');
    await until(async()=> (await jobs()).find(job=>job.state==='failed'&&job.url.endsWith('/stream.m3u8')),'Playlist was saved as complete media');
    await submit(base+'/sound.flac');
    const flac=await until(async()=> (await jobs()).find(job=>job.url.endsWith('/sound.flac')&&job.state==='complete'),'FLAC audio did not download');
    assert.deepEqual(await readFile(join(downloads,flac.filename)),fixtures.get('/sound.flac').bytes);
    assert.ok(flac.filename.endsWith('.flac'));
    await selectCategory('Files');
    for(const [label,path] of [['Scene.blend','/scene.blend'],['Named attachment','/download']]){
      await page.evaluate(`(()=>{const card=[...document.querySelectorAll('.resource-card')].find(card=>card.getAttribute('aria-label')===${JSON.stringify(label)});card.closest('.resource-card-frame').querySelector('.resource-actions__trigger').click();})()`,true);
      await page.evaluate("[...document.querySelectorAll('.resource-actions__item')].find(button=>button.textContent.trim()==='Download').click()",true);
      const job=await until(async()=> (await jobs()).find(job=>job.url===base+path&&job.state==='complete'),`${label} did not download`);
      assert.deepEqual(await readFile(join(downloads,job.filename)),fixtures.get(path).bytes);
      assert.ok(job.filename.endsWith('.blend'),`${label} lost its file extension`);
      if(path==='/download') assert.equal(job.filename,'scene one.blend','Content-Disposition filename was not preserved');
    }
    for(const label of ['Scene.blend','Named attachment']) await page.evaluate(`document.querySelector(${JSON.stringify(`[aria-label="Select ${label}"]`)}).click()`,true);
    await page.evaluate("document.querySelector('.bulk-selection__menu-trigger').click()",true);
    await page.evaluate("[...document.querySelectorAll('.bulk-selection__menu-panel button')].find(button=>button.textContent.includes('Download as ZIP')).click()",true);
    const zip=await until(async()=> (await jobs()).find(job=>job.filename.endsWith('.zip')&&job.state==='complete'),'Bulk ZIP did not download');
    assert.ok(zip.filename.startsWith('stashwell-'),'The ZIP lost its generated filename');
    const contents=unzipSync(await readFile(join(downloads,zip.filename)));
    assert.deepEqual(Buffer.from(contents['Scene.blend']),fixtures.get('/scene.blend').bytes);
    assert.deepEqual(Buffer.from(contents['scene one.blend']),fixtures.get('/download').bytes);
    console.log('PASS arbitrary file formats: FLAC, .blend, server attachment filename, and exact bytes in single downloads and ZIP.');
    await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:1,mobile:false});
    const shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve('.impeccable/review/download-error-390.png'),Buffer.from(shot.data,'base64'));
    await page.evaluate("document.querySelector('.resource-card')?.click()",true);
    await until(()=>page.evaluate("Boolean(document.querySelector('.resource-modal .download-tray'))"),'Modal hides the download bar');
    const modalShot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve('.impeccable/review/download-modal-390.png'),Buffer.from(modalShot.data,'base64'));
    console.log('PASS Brave downloads: actual bytes/progress, reload persistence, cancellation, HTML/playlist rejection, modal visibility, 320/390/720px.');
    await page.evaluate("document.querySelector('[aria-label=\"Close preview\"]').click()",true);
    // Exercise file-host consent through the download tray, never through the
    // removed scanning menu. Missing access and denial are simulated here;
    // the successful retry calls Chrome's native API for the pre-granted host.
    const workerInfo=await until(async()=> (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(target=>target.type==='service_worker'),'Permission test worker is missing');
    const permissionWorker=new Cdp(workerInfo.webSocketDebuggerUrl);await permissionWorker.ready();
    const permissionOrigin='http://127.0.0.1/*';
    await permissionWorker.evaluate(`(()=>{globalThis.__stashwellContains=chrome.permissions.contains.bind(chrome.permissions);globalThis.__stashwellMissing=true;chrome.permissions.contains=p=>globalThis.__stashwellMissing&&p.origins?.includes('${permissionOrigin}')?Promise.resolve(false):globalThis.__stashwellContains(p);})()`);
    const blocked=await submit(base+'/long.wav');assert.ok(blocked.ok);
    assert.equal(blocked.result.state,'failed');assert.deepEqual(blocked.result.permissionOrigins,[permissionOrigin]);
    await until(()=>page.evaluate("Boolean(document.querySelector('.download-tray__access'))"),'Missing site access has no grant button');
    await page.evaluate("(()=>{window.__requestAccess=chrome.permissions.request.bind(chrome.permissions);window.__denyAccess=true;chrome.permissions.request=p=>{window.__requested={...p,gesture:navigator.userActivation.isActive};return Promise.resolve(!window.__denyAccess);};})()");
    await page.evaluate("document.querySelector('.download-tray__access').click()",true);
    await until(()=>page.evaluate("document.querySelector('.download-tray__job').textContent.includes('Access was not granted')"),'Denied permission has no recovery message');
    assert.deepEqual(await page.evaluate("window.__requested"),{origins:[permissionOrigin],gesture:true});
    assert.ok(await page.evaluate("(()=>{const b=document.querySelector('.download-tray__access'),r=b.getBoundingClientRect();return r.width>100&&r.height>=32&&r.height<60&&r.right<=innerWidth;})()"),'Permission button is not readable within the sidebar');
    const permissionShot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve('.impeccable/review/download-permission-390.png'),Buffer.from(permissionShot.data,'base64'));
    await permissionWorker.evaluate("globalThis.__stashwellMissing=false");
    await page.evaluate("chrome.permissions.request=p=>{window.__requested={...p,gesture:navigator.userActivation.isActive};return window.__requestAccess(p);}");
    await page.evaluate("document.querySelector('.download-tray__access').click()",true);
    const retried=await until(async()=>{const list=await jobs();return list.find(job=>job.id!==first.id&&job.id!==blocked.result.id&&job.url===base+'/long.wav'&&job.state==='complete');},'Granting access did not retry the download',20000);
    assert.deepEqual(await page.evaluate("window.__requested"),{origins:[permissionOrigin],gesture:true},'Native retry must request only the file host with a user gesture');
    assert.deepEqual(await readFile(join(downloads,retried.filename)),fixtures.get('/long.wav').bytes);
    await page.evaluate("chrome.permissions.request=window.__requestAccess;delete window.__requestAccess;delete window.__denyAccess;delete window.__requested");
    await permissionWorker.evaluate("chrome.permissions.contains=globalThis.__stashwellContains;delete globalThis.__stashwellContains;delete globalThis.__stashwellMissing");permissionWorker.close();
    console.log('PASS native website access request and simulated missing-host/deny/grant/retry states, with exact downloaded bytes.');
    const {targetId:linksTarget}=await browserCdp.send('Target.createTarget',{url:base+'/media-links'});
    const linksInfo=await until(async()=> (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(target=>target.id===linksTarget),'Media links tab did not open');
    const links=new Cdp(linksInfo.webSocketDebuggerUrl);await links.ready();
    await links.send('Page.bringToFront');
    await until(()=>links.evaluate("document.readyState==='complete'"),'Media links page did not finish loading');
    await page.evaluate("document.querySelector('.button--scan').click()",true);
    const scanned=await until(()=>page.evaluate(`chrome.storage.local.get('allhere.library.v1').then(data=>data['allhere.library.v1']?.find(capture=>capture.pageUrl===${JSON.stringify(base+'/media-links')}))`),'Media links page was not scanned');
    const videos=scanned.resources.filter(resource=>resource.kind==='video');
    assert.deepEqual(videos.map(resource=>resource.url),[base+'/direct-video.mp4'],'Only the direct video file should be captured as video');
    assert.ok(scanned.resources.some(resource=>resource.kind==='link'&&resource.url==='https://www.youtube.com/watch?v=stashwell0001'),'YouTube watch URL should remain an ordinary link');
    assert.ok(scanned.resources.some(resource=>resource.kind==='link'&&resource.url==='https://www.youtube.com/shorts/stashwell0002'),'YouTube Shorts URL should remain an ordinary link');
    await page.send('Page.bringToFront');await selectSource('Media links fixture');await selectCategory('Video & audio');
    await until(()=>page.evaluate("document.querySelectorAll('.resource-card').length===1"),'Direct video file did not appear in the media library');
    await selectCategory('Links');
    await until(()=>page.evaluate("[...document.querySelectorAll('.resource-table--links tbody tr')].some(row=>row.textContent.includes('YouTube watch link'))"),'YouTube link did not appear in Links');
    await page.evaluate("[...document.querySelectorAll('.resource-table--links tbody tr')].find(row=>row.textContent.includes('YouTube watch link')).querySelector('.resource-actions__trigger').click()",true);
    await until(()=>page.evaluate("Boolean(document.querySelector('.resource-actions__menu'))"),'YouTube link actions did not open');
    assert.equal(await page.evaluate("[...document.querySelectorAll('.resource-actions__item')].some(button=>button.textContent.trim()==='Copy URL')"),true,'YouTube link should offer Copy URL');
    assert.equal(await page.evaluate("[...document.querySelectorAll('.resource-actions__item')].some(button=>button.textContent.trim()==='Download')"),false,'YouTube link should not offer video downloading');
    links.close();await browserCdp.send('Target.closeTarget',{targetId:linksTarget});
    console.log('PASS direct video files appear in Video & audio; YouTube watch and Shorts URLs remain links without download actions.');
  } else if (modalOnly) {
    await mkdir(resolve('.impeccable/review'), {recursive:true});
    const targetCount=(await browserCdp.send('Target.getTargets')).targetInfos.length;
    const close=async()=>{await page.evaluate("document.querySelector('[aria-label=\"Close preview\"]').click()",true);await until(()=>page.evaluate("!document.querySelector('.resource-modal')"),'Close did not dismiss preview');};
    const open=async(selector)=>{await page.evaluate(`(()=>{const trigger=document.querySelector(${JSON.stringify(selector)});trigger.focus();trigger.click();})()`,true);await until(()=>page.evaluate("document.querySelector('.resource-modal')?.open"),'Modal did not open');};
    const screenshot=async(name)=>{await delay(150);const shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(`.impeccable/review/${name}.png`),Buffer.from(shot.data,'base64'));};
    for (const width of [320,390,720]) {
      await page.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
      await open('[data-album-category=images] .resource-album__tile');
      await until(()=>page.evaluate("document.querySelector('.resource-modal img.resource-art__image')?.naturalWidth > 0"),'Modal image did not load');
      assert.ok(await page.evaluate("(()=>{const d=document.querySelector('.resource-modal'),r=d.getBoundingClientRect();return d.matches(':modal')&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth;})()"),`Modal overflow at ${width}px`);
      assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.resource-modal img')).objectFit"),'contain');
      assert.equal(await page.evaluate("document.activeElement?.getAttribute('aria-label')"),'Close preview');
      await screenshot(`modal-image-${width}`);
      await close();
      assert.ok(await page.evaluate("document.activeElement?.classList.contains('resource-album__tile')"),'Closing did not restore focus to the thumbnail');
      assert.equal(await page.evaluate("document.body.style.overflow"),'');
    }
    await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:1,mobile:false});
    for (const [tab,kind] of [['Icons','icon'],['Fonts','font'],['Video & audio','video'],['Video & audio','audio'],['Files','document'],['Links','link']]) {
      await selectCategory(tab);
      const selector=kind==='link'?'.table-name':kind==='icon'?'.resource-card':`.resource-card[aria-label="Preview ${kind}"]`;
      await open(selector);
      assert.equal(await page.evaluate("document.querySelector('.resource-modal a[target=\"_blank\"]') !== null"),false,'Preview contained a new-page action');
      if (kind==='font') await until(()=>page.evaluate("Boolean(document.querySelector('.resource-modal .resource-art__font-sample--loaded'))"),'Modal font did not load');
      if (kind==='video'||kind==='audio') {
        try { await until(()=>page.evaluate(`document.querySelector('.resource-modal ${kind}')?.readyState>=2`),`${kind} did not decode in modal`); }
        catch(error) { console.error(await page.evaluate("document.querySelector('.resource-modal')?.innerText")); await screenshot(`modal-${kind}-failed-390`); throw error; }
        assert.ok(await page.evaluate(`document.querySelector('.resource-modal ${kind}').controls`),`${kind} needs playback controls`);
        if(kind==='video')assert.equal(await page.evaluate("document.querySelector('.resource-modal video').muted"),false);
        await page.evaluate(`document.querySelector('.resource-modal ${kind}').play()`,true);
        await until(()=>page.evaluate(`document.querySelector('.resource-modal ${kind}').currentTime > 0`),`${kind} playback did not advance`,5000);
        await page.evaluate(`document.querySelector('.resource-modal ${kind}').pause()`);
        await page.evaluate(`void(window.__modalPlayer = document.querySelector('.resource-modal ${kind}'))`);
      }
      if(kind==='document'||kind==='link')assert.ok(await page.evaluate("Boolean(document.querySelector('.resource-modal__unsupported'))"),'Unsupported resource needs inline recovery');
      await screenshot(`modal-${kind}-390`);
      for(let index=0;index<8;index++) {await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});}
      assert.ok(await page.evaluate("document.querySelector('.resource-modal').contains(document.activeElement)"),'Keyboard focus escaped the modal');
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await until(()=>page.evaluate("!document.querySelector('.resource-modal')"),'Escape did not dismiss preview');
      if(kind==='video'||kind==='audio')assert.ok(await page.evaluate("window.__modalPlayer.paused && !window.__modalPlayer.hasAttribute('src')"),'Closing must stop and release media playback');
    }
    await selectCategory('Images');
    await open('.resource-card');await close();
    await page.evaluate("document.querySelector('.sort-button').click()",true);
    await open('.table-name');
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1});
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1});
    await until(()=>page.evaluate("!document.querySelector('.resource-modal')"),'Backdrop did not close preview');
    assert.equal((await browserCdp.send('Target.getTargets')).targetInfos.length,targetCount,'Media clicks opened new browser pages');
    const broken={...capture.resources[0],id:'failed-preview',label:'Failed preview',url:base+'/broken.png'};
    await page.evaluate(`chrome.storage.local.set({'allhere.library.v1':${JSON.stringify([{...capture,resources:[...capture.resources,broken]}])}})`);
    await until(()=>page.evaluate("[...document.querySelectorAll('.table-name')].some(button=>button.textContent.includes('Failed preview'))"),'Failure fixture did not render');
    await page.evaluate("[...document.querySelectorAll('.table-name')].find(button=>button.textContent.includes('Failed preview')).click()",true);
    await until(()=>page.evaluate("Boolean(document.querySelector('.resource-modal .resource-art__preview-message'))"),'Failed image preview needs a visible recovery message');
    await close();
    console.log('PASS Brave modal previews: album, grid and list clicks; image/icon/font/video/audio/files/links; playback and font loading; focus trap/return; Close/Escape/backdrop; no new pages; 320/390/720px.');
  } else if (scanOnly) {
    const {targetId:liveId}=await browserCdp.send('Target.createTarget',{url:base+'/scan-page'});
    const liveInfo=await until(async()=> (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(target=>target.id===liveId),'Live gallery tab did not open');
    const live=new Cdp(liveInfo.webSocketDebuggerUrl);await live.ready();
    try {
      await live.send('Page.bringToFront');
      const read=()=>page.evaluate(`(async()=>{const data=await chrome.storage.local.get('allhere.library.v1');return data['allhere.library.v1'].find(c=>c.pageUrl===${JSON.stringify(base+'/scan-page')});})()`);
      const scanState=()=>page.evaluate("document.querySelector('.button--scan')?.dataset.scanState");
      const expectScanState=(state)=>until(async()=>await scanState()===state,`The scan button must show ${state}`);
      const expectFavicon=async(path)=>{
        const expected=path.startsWith('http')?path:base+path;
        try { return await until(()=>page.evaluate(`(()=>{const image=document.querySelector('.scan-favicon img');return image?.dataset.faviconUrl===${JSON.stringify(expected)}&&image.complete&&image.naturalWidth>0;})()`),`The scan button did not display ${path}`); }
        catch(error){ console.log(await page.evaluate("chrome.tabs.query({active:true,currentWindow:true}).then(tabs=>({tabs,icon:document.querySelector('.scan-favicon')?.outerHTML}))"));throw error; }
      };
      const recordScanState=async(state)=>{
        await expectScanState(state);
        await mkdir(resolve('.impeccable/review'),{recursive:true});
        // A real side panel never becomes the active browser tab. The headless
        // fixture uses an extension tab, so retain source metadata only while
        // foregrounding that tab for compositor screenshots. Behavior checks
        // before and after this block use Chrome's actual active tab.
        await page.evaluate("(async()=>{window.__shotTabsQuery=chrome.tabs.query.bind(chrome.tabs);const tabs=await window.__shotTabsQuery({active:true,currentWindow:true});chrome.tabs.query=options=>options.currentWindow?Promise.resolve(tabs):window.__shotTabsQuery(options);})()");
        try {
          await page.send('Page.bringToFront');
          for(const width of [320,390,720]){
            await page.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
            await page.evaluate('window.scrollTo(0,0)');
            const layout=await page.evaluate("(()=>{const menu=document.querySelector('.library-menu__trigger').getBoundingClientRect();return {fits:document.documentElement.scrollWidth<=innerWidth,menuRight:menu.right,width:document.querySelector('.topbar').getBoundingClientRect().right}})()");
            assert.ok(layout.fits&&Math.abs(layout.menuRight-layout.width)<=1,`Header must fit and keep the menu at the outer edge: ${JSON.stringify(layout)}`);
            const shot=await page.send('Page.captureScreenshot',{format:'png'});
            await writeFile(resolve(`.impeccable/review/scan-${state}-${width}.png`),Buffer.from(shot.data,'base64'));
          }
        } finally {
          await live.send('Page.bringToFront');
          await page.evaluate('chrome.tabs.query=window.__shotTabsQuery;delete window.__shotTabsQuery');
          await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:800,deviceScaleFactor:1,mobile:false});
        }
      };
      await delay(1200);
      await expectScanState('needed');
      await expectFavicon('/favicon.ico');
      await recordScanState('needed');
      assert.equal(await read(),undefined,'Opening a webpage must wait for Scan page');
      assert.equal(await live.evaluate('Boolean(globalThis.__stashwellFileDropInstalled)'),false,'Unscanned pages must not receive a page helper');
      const manifest=await page.evaluate('chrome.runtime.getManifest()');
      assert.ok(manifest.permissions.includes('activeTab')&&manifest.permissions.includes('tabs'),'The panel must keep active-tab metadata when switching tabs');
      const productionManifest=JSON.parse(await readFile(resolve('apps/extension/out/manifest.json'),'utf8'));
      assert.equal(productionManifest.host_permissions,undefined,'Production must not require any website access');
      assert.equal(await page.evaluate("document.querySelector('.empty-state h2')?.textContent"),'Scan this page to see its resources','An unscanned URL must show its first-scan view instead of another saved page');
      await page.evaluate(`(()=>{window.__scanRequests=[];window.__siteRequest=chrome.permissions.request.bind(chrome.permissions);chrome.permissions.request=options=>{window.__scanRequests.push({...options,gesture:navigator.userActivation.isActive});return window.__siteRequest(options);};})()`);
      const legacyResponsive = {...capture,id:'legacy-responsive',pageUrl:base+'/scan-page',pageTitle:'Live gallery',resources:
        ['/responsive-original.png','/responsive-small.png','/responsive-large.png'].map((path,index)=>({...capture.resources[0],id:`legacy-responsive-${index}`,pageUrl:base+'/scan-page',pageTitle:'Live gallery',url:base+path,label:'Responsive image',alt:'Responsive image',saved:index===1||undefined,width:10,height:10}))};
      await page.evaluate(`chrome.storage.local.get('allhere.library.v1').then(data=>chrome.storage.local.set({'allhere.library.v1':[...data['allhere.library.v1'],${JSON.stringify(legacyResponsive)}]}))`);
      await page.evaluate("document.querySelector('.button--scan').click()",true);
      const initial=await until(async()=>{const value=await read();const notice=await page.evaluate("document.querySelector('.notice')?.textContent");if(notice?.includes('Could not scan'))throw Error(notice);return value?.resources.some(item=>item.label==='Shadow image')&&value.resources.some(item=>item.label==='Frame image')?value:null},'Initial image, shadow DOM, or frame scan did not complete').catch(async error=>{console.log(await page.evaluate("({notice:document.querySelector('.notice')?.textContent,busy:document.querySelector('.button--scan')?.disabled})"));console.log((await read())?.resources.map(({label,url})=>({label,url:url.startsWith('data:')?url.slice(0,60):url})));throw error;});
      assert.equal(await page.evaluate("Boolean(document.querySelector('.auto-updates,.auto-updates__toggle'))"),false,'Manual scanning must not add an automatic-update control row');
      await expectScanState('ready');
      assert.equal(await page.evaluate("document.querySelector('.button--scan span:last-child').textContent"),'Scan again','Successful scans need a text indication as well as color');
      await recordScanState('ready');
      const cdnIcon=base.replace('127.0.0.1','localhost')+'/cdn-favicon.png';
      await live.evaluate(`document.querySelector('link[rel=icon]').href=${JSON.stringify(cdnIcon)}`);
      await expectFavicon(cdnIcon);
      await expectScanState('ready');
      assert.equal(await page.evaluate(`chrome.permissions.contains({origins:[${JSON.stringify(base.replace('127.0.0.1','localhost')+'/*')}]})`),false,'A CDN favicon must not add host access');
      await live.evaluate("document.querySelector('link[rel=icon]').href='/favicon.ico'");
      await expectFavicon('/favicon.ico');
      const asset=(snapshot,path)=>snapshot.resources.filter(item=>item.url.includes(path)||item.variantUrls?.some(url=>url.includes(path)));
      assert.ok(asset(initial,'/first.png').length===1 && asset(initial,'/lazy.png').length===1,'Loaded and lazy images should both be kept');
      assert.ok(asset(initial,'/shadow.png').length===1 && asset(initial,'/frame.png').length===1,'Shadow DOM and frame images should be kept');
      assert.ok(asset(initial,'/closed.png').length===1&&initial.resources.some(item=>item.label==='Closed shadow icon'),'Closed author shadow roots must contribute images and icons');
      assert.ok(!initial.resources.some(item=>item.label==='Foreign private image'),'Scanning must respect inaccessible cross-origin frames');
      assert.equal(asset(initial,'/detached.png').length,1,'Images loaded outside the DOM must be recovered from resource timings');
      assert.equal(asset(initial,'/dynamic-module.mjs')[0]?.kind,'script','Dynamic JavaScript modules must be collected');
      assert.ok(initial.resources.some(item=>item.label==='Inline raster image'&&item.url.startsWith('data:image/png')),'Inline raster image should remain visible');
      assert.ok(asset(initial,'/mask.svg').length===1 && asset(initial,'/pseudo.png').length===1,'CSS icons and pseudo images should be kept');
      assert.equal(asset(initial,'/scene.blend')[0]?.kind,'other','Uncommon file extensions should be downloadable resources');
      assert.equal(asset(initial,'/opaque-download')[0]?.kind,'other','Download attributes should mark extensionless file URLs as resources');
      for(const path of ['/assets/deferred.png','/original.png','/responsive-small.png','/responsive-large.png','/alternate.png','/picture.png','/deferred-small.png','/deferred-large.png','/background(1).png','/set-one.png','/set-two.png','/border.png']) {
        assert.equal(asset(initial,path).length,1,`Lazy, responsive, and CSS capture missed ${path}`);
      }
      assert.equal(initial.resources.filter(item=>item.alt==='Responsive image').length,1,'One responsive image must render once, rather than once per src/srcset URL');
      const responsive=initial.resources.find(item=>item.alt==='Responsive image');
      assert.equal(responsive.id,'legacy-responsive-0','Cleaning legacy copies must retain the earliest ID');
      assert.equal(responsive.saved,true,'A bookmark on any older duplicate must survive cleanup');
      assert.equal(responsive.variantUrls.filter(url=>url.includes('/responsive-')).length,3,'Keep all responsive source URLs inside the single item');
      assert.equal(initial.resources.filter(item=>item.alt?.startsWith('Distinct lazy')).length,2,'A shared lazy placeholder must never merge distinct photos');
      const posters=initial.resources.filter(item=>item.alt==='IMDb poster');
      assert.equal(posters.length,1,'IMDb-style poster resize paths with comma-separated crop coordinates must share one card');
      assert.equal(posters[0].variantUrls.length,3,'All three poster resolutions must remain available as source aliases');
      assert.equal(asset(initial,'/missing.png').length,0,'A broken placeholder must not hide the real lazy source');
      assert.equal(asset(initial,'/fragment.svg').length,2,`Distinct SVG fragment views must survive: ${JSON.stringify(asset(initial,'/fragment.svg').map(({url,identityUrl,variantUrls})=>({url,identityUrl,variantUrls})))} DOM: ${JSON.stringify(await live.evaluate("[...document.querySelectorAll('img')].filter(image=>image.src.includes('/fragment.svg')).map(image=>({src:image.src,currentSrc:image.currentSrc}))"))}`);
      assert.equal(asset(initial,'/first.png').length,1,'A downloaded image and its img element must share one entry');
      assert.equal(asset(initial,'/alternative.mp4')[0]?.kind,'video','Alternate direct media sources must be kept');
      const vector = label => initial.resources.find(item=>item.label===label || (label==='Gradient icon'&&item.label==='Duplicate gradient icon'));
      assert.ok(vector('Hidden menu icon'),'Hidden menu icons with intrinsic dimensions must be retained');
      assert.equal(vector('Large illustration')?.kind,'image','Large SVG illustrations must be collected');
      assert.equal(initial.resources.filter(item=>/gradient icon/i.test(item.label)&&!item.label.startsWith('External')).length,1,'Different titles, classes, IDs, attribute order and rendered sizes must not duplicate SVG icons');
      assert.ok(vector('Nested icon'),'Nested SVG content must be retained');
      const pixels = async label => {
        const item=vector(label);assert.ok(item,`Missing ${label}`);
        return page.evaluate(`(async()=>{const image=new Image();image.src=${JSON.stringify(item.url)};await image.decode();const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,24,24);const pixel=(x,y)=>[...ctx.getImageData(x,y,1,1).data];return {left:pixel(3,12),right:pixel(20,12),middle:pixel(12,12),corner:pixel(2,2)};})()`);
      };
      for(const label of ['Gradient icon','External gradient icon']) {
        const color=await pixels(label);
        assert.ok(color.left[0]>color.left[2]&&color.right[2]>color.right[0]&&color.left[3]>0,`${label} lost its gradient or currentColor`);
      }
      const clip=await pixels('Clipped icon');assert.ok(clip.left[3]>0&&clip.right[3]===0,'External local clip definitions must stay intact');
      const green=await pixels('External green icon');assert.ok(green.left[1]>green.left[0]&&green.left[1]>green.left[2],'Differently colored instances of the same sprite must remain distinct');
      const combined=await pixels('Combined sprite icon');assert.ok(combined.corner[0]>200&&combined.middle[3]===0,'Multiple external uses must preserve their placement in a combined icon');
      const group=await pixels('Local group icon');assert.ok(group.middle[0]>200&&group.corner[3]===0,'Local use references must retain x/y placement and group definitions');
      const styled=await pixels('CSS styled icon');assert.ok(styled.middle[0]>200&&styled.middle[1]<30&&styled.middle[2]<30,'CSS must override presentation attributes in captured icons');
      const fontIcons = initial.resources.filter(item => item.description?.endsWith('font icon'));
      assert.equal(fontIcons.length, 2, 'Pseudo and hover glyphs should be captured once each; missing fonts and ordinary text must be ignored');
      assert.ok(fontIcons.some(item => item.label === 'Pseudo font glyph') && fontIcons.some(item => item.label === 'Hover font glyph'), 'Font glyph descriptions should survive capture');
      assert.ok(fontIcons.every(item => item.kind === 'icon' && item.mimeType === 'image/png' && item.url.startsWith('data:image/png;base64,')), 'Font icons need durable, previewable image bytes');
      const sprites=initial.resources.filter(item=>item.label==='Sprite one'||item.label==='Sprite two');
      assert.equal(sprites.length,2,'Distinct sprite fragments must remain separate icons');
      assert.ok(sprites.every(item=>item.url.startsWith('data:image/svg+xml')),'Sprite symbols should become standalone icons');
      assert.notEqual(sprites[0].url,sprites[1].url,'Different sprite symbols need different SVG markup');
      assert.equal(asset(initial,'/same.png').length,3,'Resize variants collapse, but distinct signed resources remain');
      const inline=initial.resources.find(item=>item.label==='Large inline icon');
      assert.ok(inline?.url.length>8000,'Long inline SVG must not be trimmed or omitted');
      assert.ok(initial.resources.some(item=>item.label==='Shadow icon')&&initial.resources.some(item=>item.label==='Frame icon'));
      await until(()=>page.evaluate("document.querySelector('.page-scope__selection strong')?.textContent==='Live gallery'"),'Active tab did not select its source page');
      await page.evaluate("document.querySelector('[data-resource-tab=images]').click()",true);
      await until(()=>page.evaluate("Boolean(document.querySelector('[aria-label=\"List view\"]'))"),'Image view controls did not appear');
      await page.evaluate("document.querySelector('[aria-label=\"List view\"]').click();window.scrollTo(0,260)",true);
      assert.equal(await page.evaluate("document.querySelectorAll('.resource-table img[alt=\"Responsive image\"]').length"),1,'The extension list must show one row for the responsive image');
      const beforeUpdate=await page.evaluate("({source:document.querySelector('.page-scope__selection strong')?.textContent,section:document.querySelector('[aria-selected=true][data-resource-tab]')?.getAttribute('data-resource-tab'),list:document.querySelector('[aria-label=\"List view\"]')?.getAttribute('aria-pressed'),scroll:window.scrollY,images:Number(document.querySelector('[data-resource-tab=images] span')?.textContent),notice:document.querySelector('.notice')?.textContent})");
      assert.ok(beforeUpdate.scroll>0,'The sidebar fixture must be scrollable for the position check');
      const first=asset(initial,'/first.png')[0];
      await page.evaluate(`(async()=>{const data=await chrome.storage.local.get('allhere.library.v1');const captures=data['allhere.library.v1'];const found=captures.find(c=>c.pageUrl===${JSON.stringify(base+'/scan-page')});found.resources.find(r=>r.url.includes('/first.png')).saved=true;await chrome.storage.local.set({'allhere.library.v1':captures});})()`);
      await live.evaluate("document.querySelector('#first').remove();const later=new Image();later.src='/late.png';later.alt='Later image';document.body.append(later)");
      await delay(2200);
      assert.ok(!(await read()).resources.some(item=>item.url.includes('/late.png')),'Page changes must wait for another Scan page click');
      const afterUpdate=await page.evaluate("({source:document.querySelector('.page-scope__selection strong')?.textContent,section:document.querySelector('[aria-selected=true][data-resource-tab]')?.getAttribute('data-resource-tab'),list:document.querySelector('[aria-label=\"List view\"]')?.getAttribute('aria-pressed'),scroll:window.scrollY,images:Number(document.querySelector('[data-resource-tab=images] span')?.textContent),notice:document.querySelector('.notice')?.textContent})");
      assert.equal(afterUpdate.source,beforeUpdate.source,'Background scan changed the selected source page');
      assert.equal(afterUpdate.section,beforeUpdate.section,'Background scan returned to All resources');
      assert.equal(afterUpdate.list,beforeUpdate.list,'Background scan changed the layout');
      assert.equal(afterUpdate.scroll,beforeUpdate.scroll,'Background scan reset the scroll position');
      assert.equal(afterUpdate.notice,beforeUpdate.notice,'Background scan replaced the sidebar message');
      assert.equal(afterUpdate.images,beforeUpdate.images,'Page changes must not add images to the library');
      await page.evaluate("document.querySelector('.button--scan').click()",true);
      const updated=await until(async()=>{const value=await read();return value?.resources.some(item=>item.url.includes('/late.png'))?value:null},'Manual rescan did not collect the new image');
      assert.ok(updated.resources.some(item=>item.label==='Blob image'&&item.url.startsWith('data:image/webp;base64,')),'Blob image must be stored with durable bytes and actual type');
      assert.ok(asset(updated,'/first.png').length===1 && asset(updated,'/first.png')[0].saved,'Earlier saved image and bookmark must survive');
      assert.equal(asset(updated,'/first.png')[0].id,first.id,'Stable image ID must survive rescans');
      const count=updated.resources.length;
      await page.evaluate("document.querySelector('.page-scope__trigger').click()",true);
      await until(()=>page.evaluate("Boolean(document.querySelector('.page-scope__option[title*=\"Image actions check\"]'))"),'Saved source option did not open');
      await page.evaluate("document.querySelector('.page-scope__option[title*=\"Image actions check\"]').click()",true);
      await page.evaluate("document.querySelector('[data-resource-tab=images]').click()",true);
      await until(()=>page.evaluate("document.querySelector('.page-scope__selection strong')?.textContent==='Image actions check'"),'Saved source page could not be selected');
      await live.evaluate("const extra=new Image();extra.src='/late2.png';extra.alt='Another later image';document.body.append(extra)");
      await delay(1800);
      assert.ok(!(await read()).resources.some(item=>item.url.includes('/late2.png')),'A second page update must wait for Scan page');
      assert.equal(await page.evaluate("document.querySelector('.page-scope__selection strong')?.textContent"),'Image actions check','Background scan hijacked a manually selected source');
      assert.equal(await page.evaluate("document.querySelector('[aria-selected=true][data-resource-tab]')?.getAttribute('data-resource-tab')"),'images','Background scan changed the section on another source');
      await page.evaluate("document.querySelector('.button--scan').click()",true);
      await until(()=>page.evaluate("!document.querySelector('.button--scan').disabled"),'Manual rescan did not finish');
      const repeated=await read();assert.equal(repeated.resources.length,count+1,'Repeated scans must not create or lose resources');
      assert.deepEqual(repeated.resources.filter(item=>item.description?.endsWith('font icon')).map(item=>item.url).sort(), fontIcons.map(item=>item.url).sort(), 'Repeated font captures must retain identical bytes');
      assert.equal(new Set(repeated.resources.map(resource=>resource.kind+':'+resource.url)).size,repeated.resources.length,'No exact duplicates');
      await live.evaluate("const glyph=document.createElement('mat-icon');glyph.className='font-glyph';glyph.setAttribute('data-mat-icon-type','font');glyph.setAttribute('aria-label','Dynamic font glyph');glyph.textContent='M';document.body.append(glyph)");
      await page.evaluate("document.querySelector('.button--scan').click()",true);
      const withGlyph=await until(async()=>{const value=await read();return value?.resources.some(item=>item.label==='Dynamic font glyph')?value:null},'Manual scan did not collect a dynamic font glyph');
      const originalGlyph=withGlyph.resources.find(item=>item.label==='Dynamic font glyph').url;
      // Storage is updated before the scan finishes its metadata/session checks.
      // A real user must wait for the disabled Scan button before clicking again.
      await until(()=>page.evaluate("document.querySelector('.button--scan').disabled===false"),'The dynamic font-glyph scan remained busy');
      await live.evaluate("document.querySelector('[aria-label=\"Dynamic font glyph\"]').firstChild.data='N'");
      await page.evaluate("document.querySelector('.button--scan').click()",true);
      await until(async()=>{const value=await read();return value?.resources.some(item=>item.label==='Dynamic font glyph'&&item.url!==originalGlyph)},'Manual scan did not collect a changed font icon');
      const beforePendingScan=await page.evaluate("chrome.storage.local.get('allhere.library.v1')");
      await page.evaluate("window.__pendingScript=chrome.scripting.executeScript.bind(chrome.scripting);window.__pendingHeld=false;chrome.scripting.executeScript=async options=>{const result=await window.__pendingScript(options);if(options.func&&!window.__pendingHeld){window.__pendingHeld=true;return new Promise(resolve=>{window.__resolveScanTab=()=>resolve(result);});}return result;}");
      await page.evaluate("document.querySelector('.button--scan').click()",true);
      await until(()=>page.evaluate("typeof window.__resolveScanTab==='function'"),'The pending scan did not reach the tab-switch checkpoint');
      const {targetId:otherId}=await browserCdp.send('Target.createTarget',{url:base+'/scan-frame'});
      const otherInfo=await until(async()=> (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(target=>target.id===otherId),'Second tab did not open');
      const other=new Cdp(otherInfo.webSocketDebuggerUrl);await other.ready();
      try {
        await other.send('Page.bringToFront');
        await page.evaluate("window.__resolveScanTab();chrome.scripting.executeScript=window.__pendingScript;delete window.__resolveScanTab");
        await until(()=>page.evaluate("/page changed while scanning|active page changed/i.test(document.querySelector('.notice')?.textContent||'')"),'Switching tabs during a pending scan must require a new Scan page click');
        await expectScanState('needed');
        await expectFavicon('/frame-favicon.svg');
        await until(()=>page.evaluate("document.querySelector('.empty-state h2')?.textContent==='Scan this page to see its resources'"),'A new tab must show its own first-scan view');
        assert.equal(await page.evaluate("document.querySelectorAll('.resource-card,.resource-album').length"),0,'A new tab must not display the previous page’s resources');
        await live.send('Page.bringToFront');
        await expectScanState('ready');
        await expectFavicon('/favicon.ico');
        await until(()=>page.evaluate("document.querySelector('.page-scope__selection strong')?.textContent==='Live gallery'"),'Returning to a saved URL must show its scan');
        await other.send('Page.bringToFront');
        await expectScanState('needed');
        assert.deepEqual(await page.evaluate("chrome.storage.local.get('allhere.library.v1')"),beforePendingScan,'A pending scan must not capture the newly active tab');
        const requestCount=await page.evaluate('window.__scanRequests.length');
        await delay(1800);
        assert.equal(await page.evaluate("document.querySelector('.empty-state h2')?.textContent"),'Scan this page to see its resources','An unscanned tab must not retain the prior source');
        assert.equal(await page.evaluate('window.__scanRequests.length'),requestCount,'Tab switches must not request site access');
        assert.equal(await page.evaluate(`chrome.storage.local.get('allhere.library.v1').then(data=>data['allhere.library.v1'].some(c=>c.pageUrl===${JSON.stringify(base+'/scan-frame')}))`),false,'A new tab must wait for Scan page');
        await page.evaluate("document.querySelector('.button--scan').click()",true);
        await until(()=>page.evaluate("document.querySelector('.page-scope__selection strong')?.textContent==='Asset frame'"),'Scan page did not collect the newly active tab');
        await expectScanState('ready');
        const beforeReload=await page.evaluate("chrome.storage.local.get('allhere.library.v1')");
        await other.send('Page.reload');
        await until(()=>other.evaluate("document.readyState==='complete'"),'Reload did not finish');
        await expectScanState('needed');
        assert.deepEqual(await page.evaluate("chrome.storage.local.get('allhere.library.v1')"),beforeReload,'Reloading must only change the scan indicator');
        await page.evaluate("document.querySelector('.button--scan').click()",true);
        await expectScanState('ready');
        assert.equal(await page.evaluate("document.querySelector('[aria-selected=true][data-resource-tab]')?.getAttribute('data-resource-tab')"),'all','A new tab should open its own resource overview');
        const snapshot=await page.evaluate("chrome.storage.local.get('allhere.library.v1')");
        await other.send('Page.navigate',{url:base+'/scan-frame?next=1'});
        await delay(1800);
        await expectScanState('needed');
        assert.deepEqual(await page.evaluate("chrome.storage.local.get('allhere.library.v1')"),snapshot,'Navigation must not change library storage');
        await page.evaluate("document.querySelector('.button--scan').click()",true);
        await until(()=>page.evaluate(`chrome.storage.local.get('allhere.library.v1').then(data=>data['allhere.library.v1'].some(c=>c.pageUrl===${JSON.stringify(base+'/scan-frame?next=1')}))`),'Scan page did not collect a navigated page');
        assert.deepEqual(await page.evaluate('window.__scanRequests'),[],'Successful scans must never open a site-access prompt');
        await page.evaluate("document.querySelector('.library-menu__trigger').click()");
        assert.equal(await page.evaluate("document.querySelector('.library-menu__panel').textContent.includes('Allow access to this site')"),false,'The menu must not grant persistent scanning access');
        await page.evaluate("document.querySelector('.library-menu__trigger').click()");
        const beforeReloadDuringScan=await page.evaluate("chrome.storage.local.get('allhere.library.v1')");
        await page.evaluate("window.__reloadScript=chrome.scripting.executeScript.bind(chrome.scripting);chrome.scripting.executeScript=async options=>{const result=await window.__reloadScript(options);if(options.func){return new Promise(resolve=>{window.__returnBeforeReload=()=>resolve(result);});}return result;}");
        await page.evaluate("document.querySelector('.button--scan').click()",true);
        await until(()=>page.evaluate("typeof window.__returnBeforeReload==='function'"),'The scan did not reach the reload checkpoint');
        await other.send('Page.reload');
        await until(()=>other.evaluate("document.readyState==='complete'"),'The same-URL reload did not finish');
        await page.evaluate("window.__returnBeforeReload();chrome.scripting.executeScript=window.__reloadScript;delete window.__returnBeforeReload");
        await until(()=>page.evaluate("document.querySelector('.notice')?.textContent.includes('page changed while scanning')"),'Reloading during a scan must discard the old document');
        await expectScanState('needed');
        assert.deepEqual(await page.evaluate("chrome.storage.local.get('allhere.library.v1')"),beforeReloadDuringScan,'Reloading during a scan must not save stale content');
        const beforeMissingAccess=await page.evaluate("chrome.storage.local.get('allhere.library.v1')");
        const ungrantedUrl=base.replace('127.0.0.1','localhost')+'/scan-page';
        await page.evaluate("window.__siteContains=chrome.permissions.contains.bind(chrome.permissions);chrome.permissions.contains=options=>options.origins?.includes('http://localhost/*')?Promise.resolve(false):window.__siteContains(options)");
        await other.send('Page.navigate',{url:ungrantedUrl});
        await until(()=>other.evaluate("document.title==='Live gallery'"),'The ungranted host did not load');
        await until(()=>page.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>tab?.url===${JSON.stringify(ungrantedUrl)})`),'The panel must read the new tab URL without site access');
        await expectScanState('needed');
        await until(()=>page.evaluate("document.querySelector('.empty-state h2')?.textContent==='Scan this page to see its resources'"),'An ungranted URL must still show its first-scan view');
        await until(()=>page.evaluate("document.querySelector('.button--scan')?.disabled===false"),'The new tab did not finish loading');
        await page.evaluate("chrome.permissions.request=options=>{window.__scanRequests.push({...options,gesture:navigator.userActivation.isActive});return Promise.resolve(false);}");
        await page.evaluate("document.querySelector('.button--scan').click()",true);
        await until(()=>page.evaluate("document.querySelector('.notice')?.textContent.includes('Allow access to this website')"),'A denied scan needs website-access guidance').catch(async error=>{
          console.log(await page.evaluate("({notice:document.querySelector('.notice')?.textContent,requests:window.__scanRequests,tab:document.querySelector('.page-scope__selection')?.textContent,button:document.querySelector('.button--scan')?.outerHTML})"));
          throw error;
        });
        assert.deepEqual(await page.evaluate("chrome.storage.local.get('allhere.library.v1')"),beforeMissingAccess,'A native inaccessible tab must not create a capture');
        assert.equal(await page.evaluate("window.__scanRequests.at(-1)?.gesture"),true,'A site grant must be requested from the Scan button gesture');
        assert.deepEqual(await page.evaluate("window.__scanRequests.at(-1)?.origins"),['http://localhost/*'],'Only the active website should be requested');
        await page.evaluate('chrome.permissions.request=window.__siteRequest');
        await page.evaluate('chrome.permissions.contains=window.__siteContains');
        const requestedAfterDenial=await page.evaluate('window.__scanRequests.length');
        const pendingUrl=base+'/scan-frame?pending=1';
        await other.send('Page.navigate',{url:pendingUrl});
        await until(()=>page.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>tab?.url===${JSON.stringify(pendingUrl)})`),'The accessible tab did not return');
        await until(()=>other.evaluate(`document.readyState==='complete'&&location.href===${JSON.stringify(pendingUrl)}`),'The accessible document did not finish loading');
        await page.evaluate("window.__scanScript=chrome.scripting.executeScript.bind(chrome.scripting);window.__scanPaused=false;chrome.scripting.executeScript=async options=>{const result=await window.__scanScript(options);if(options.func&&!window.__scanPaused){window.__scanPaused=true;return new Promise(resolve=>{window.__returnScan=()=>resolve(result);});}return result;}");
        await page.evaluate("document.querySelector('.button--scan').click()",true);
        await until(()=>page.evaluate("typeof window.__returnScan==='function'"),'The pending capture did not reach its completion check');
        await other.send('Page.navigate',{url:ungrantedUrl});
        await until(()=>page.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>tab?.url===${JSON.stringify(ungrantedUrl)})`),'Cross-site navigation must expose the new URL without granting content access');
        await page.evaluate("window.__returnScan();chrome.scripting.executeScript=window.__scanScript;delete window.__returnScan");
        await until(()=>page.evaluate("document.querySelector('.notice')?.textContent.includes('page changed while scanning')"),'Lost access during capture must discard the scan');
        assert.deepEqual(await page.evaluate("chrome.storage.local.get('allhere.library.v1')"),beforeMissingAccess,'A stale capture must not be saved after cross-site navigation hides its URL');
        assert.equal(await page.evaluate('window.__scanRequests.length'),requestedAfterDenial,'A stale scan must not request access to the new site');
        await page.send('Page.reload');
        await until(()=>page.evaluate("Boolean(document.querySelector('.stashwell-shell'))"),'Panel did not reopen');
        const reopened=await page.evaluate("chrome.storage.local.get('allhere.library.v1')");
        await delay(1600);
        assert.deepEqual(await page.evaluate("chrome.storage.local.get('allhere.library.v1')"),reopened,'Reopening the panel must not scan');
      } finally {other.close();}
      console.log(`PASS manual scans: ${repeated.resources.length} stable resources; current-tab favicons and globe fallback; first-scan views, saved-page restores, denied site access, and stale-scan protection across tab switches and navigation; 320/390/720px header fits. This manual-capture fixture holds watcher notifications and pre-grants only its original host; the automatic suite tests real updates.`);
    } finally {live.close();}
  } else if (dragOnly) {
    const {targetId:destinationId}=await browserCdp.send('Target.createTarget',{url:base+'/destination'});
    const destInfo=await until(async()=> (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(target=>target.id===destinationId),'No destination tab');
    const dest=new Cdp(destInfo.webSocketDebuggerUrl);await dest.ready();
    try {
      await until(()=>dest.evaluate("!!document.querySelector('#drop')"),'Upload fixture did not load');
      await dest.send('Page.bringToFront');
      await page.evaluate("document.querySelector('.button--scan').click()",true);
      await until(()=>page.evaluate(`chrome.storage.local.get('allhere.library.v1').then(data=>data['allhere.library.v1'].some(c=>c.pageUrl===${JSON.stringify(base+'/destination')}))`),'Manual scan did not finish on the destination page');
      await page.evaluate(`chrome.storage.local.set({"allhere.library.v1":${JSON.stringify([capture])}})`);
      // Return to the fixture library after the user-requested destination scan.
      await selectSource(capture.pageTitle);
      async function dragPayload(entry, selector='.resource-card') {
        const category=entry.kind==='icon'?'Icons':entry.kind==='font'?'Fonts':['video','audio'].includes(entry.kind)?'Video & audio':['document','stylesheet','script','other'].includes(entry.kind)?'Files':entry.kind==='link'?'Links':'Images';
        await selectCategory(category);
        const label=entry.label;
        await page.evaluate(`(() => {const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.includes(${JSON.stringify(label)}));el.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));})()`);
        if(entry.kind!=='link') await until(()=>page.evaluate(`(() => {const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.includes(${JSON.stringify(label)}));return el?.title==='Drag file to an upload field';})()`),label+' was not prepared');
        return await page.evaluate(`(() => {const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.includes(${JSON.stringify(label)}));const data=new DataTransfer();el.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));return {items:[...data.items].filter(item=>item.kind==='string').map(item=>({mimeType:item.type,data:data.getData(item.type)})),file:data.files[0]?{name:data.files[0].name,size:data.files[0].size,type:data.files[0].type}:null};})()`);
      }
      async function deliver(payload,id) {
        await dest.send('Page.bringToFront');
        const rect=await dest.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(id)});el.scrollIntoView();const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
        const data={items:payload.items,dragOperationsMask:1};
        for(const type of ['dragEnter','dragOver','drop']) await dest.send('Input.dispatchDragEvent',{type,...rect,data});
      }
      for(const entry of entries.filter(entry=>!entry.rejected&&entry.kind!=='link')) {
        const payload=await dragPayload(entry);
        assert.ok(payload.file?.name.endsWith('.'+entry.extension),entry.label+': correct filename');
        for(const [selector,via] of [['#upload','input'],['#drop','dropzone']]) {
          const count=await dest.evaluate('received.length');await deliver(payload,selector);
          const received=await until(()=>dest.evaluate(`received[${count}]`),entry.label+': drop not received');
          assert.equal(received.via,via);assert.equal(received.name,payload.file.name);assert.equal(received.type,payload.file.type);
          const bytes=Buffer.from(received.bytes,'base64');assert.equal(bytes.length,payload.file.size);
          if(entry.bytes&&entry.extension!=='svg')assert.deepEqual(bytes,entry.bytes);
          if(entry.extension==='svg')assert.doesNotMatch(bytes.toString(),/<script|foreignObject|onload=/i);
        }
        console.log('PASS file input + dropzone: '+entry.label);
      }
      const pngEntry=entries[0],payload=await dragPayload(pngEntry),before=await dest.evaluate('received.length');
      await deliver(payload,'#reject');await delay(250);assert.equal(await dest.evaluate('received.length'),before);
      await deliver(payload,'#disabled');await delay(250);assert.equal(await dest.evaluate('received.length'),before);
      const urlEntry=entries.find(entry=>entry.kind==='link');const urlPayload=await dragPayload(urlEntry,'.table-name');
      await deliver(urlPayload,'#url');assert.equal(await dest.evaluate('document.querySelector("#url").value'),urlEntry.url);
      await selectCategory('Images');await page.evaluate("document.querySelector('.sort-button').click()",true);
      const listPayload=await dragPayload(pngEntry,'.table-name');assert.equal(listPayload.file.type,'image/png');
      await selectCategory('All resources');
      assert.equal(await page.evaluate("[...document.querySelectorAll('.resource-album__tile')].every(el=>el.draggable)"),true);
      // Exercise a real browser dragstart (not just constructed DOM events).
      await selectCategory('Images');
      await page.evaluate("document.querySelector('.sort-button').click()",true);
      await page.send('Page.bringToFront');
      const sourcePoint=await page.evaluate("(()=>{const el=document.querySelector('.resource-card');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+30}})()");
      await page.send('Input.setInterceptDrags',{enabled:true});
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...sourcePoint});
      await delay(100);
      const start=page.events.length;
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...sourcePoint,button:'left',clickCount:1});
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:sourcePoint.x+40,y:sourcePoint.y+35,button:'left',buttons:1});
      const native=await until(()=>page.events.slice(start).find(event=>event.method==='Input.dragIntercepted')?.params.data,'Native dragstart did not fire');
      assert.ok(native.items.some(item=>item.mimeType.startsWith('application/x-stashwell-file-')),'Native drag must retain the cross-page capability');
      await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:sourcePoint.x+40,y:sourcePoint.y+35,button:'left',clickCount:1});
      await page.send('Input.setInterceptDrags',{enabled:false});
      const nativeBefore=await dest.evaluate('received.length');await deliver(native,'#drop');
      const nativeReceived=await until(()=>dest.evaluate(`received[${nativeBefore}]`),'Native drag did not deliver file bytes');
      assert.equal(nativeReceived.type,'image/png');assert.deepEqual(Buffer.from(nativeReceived.bytes,'base64'),png);
      console.log('PASS native Brave mouse dragstart and native destination drop preserve file bytes.');
      console.log('PASS URL drops, list + album draggability, input type restrictions, disabled inputs, and chunked bytes in Brave.');
    } finally {dest.close();}
  } else if (albumOnly) {
    for (const [id, count] of [["images",12],["icons",4],["media",2],["links",2],["fonts",1],["files",4]]) {
      await selectCategory("All resources");
      await page.evaluate(`document.querySelector('[data-album-category=${id}] .resource-album__open').click()`, true);
      await until(() => page.evaluate(`document.querySelector('[data-resource-tab=${id}]')?.getAttribute('aria-selected') === 'true'`), `${id}: matching tab did not open`);
      assert.equal(await page.evaluate("document.querySelector('.page-scope__selection strong').textContent"), capture.pageTitle);
      if (id === "links") {
        assert.equal(await page.evaluate("document.querySelectorAll('.resource-table--links tbody tr').length"), count);
        assert.equal(await page.evaluate("document.querySelectorAll('.resource-card').length"), 0);
      } else {
        assert.equal(await page.evaluate("document.querySelectorAll('.resource-card').length"), count);
      }
      assert.equal(await page.evaluate("document.querySelectorAll('.resource-album').length"), 0);
      assert.ok(await page.evaluate("![...document.querySelectorAll('.resource-card')].some(card => card.textContent.includes('Another page image'))"));
      console.log(`PASS ${id} section opens its own tab (${count} items)`);
    }
    await selectCategory("All resources");
    await page.send("Page.bringToFront");
    await page.evaluate("document.querySelector('[data-album-category=icons] .resource-album__open').focus()");
    await page.send("Input.dispatchKeyEvent", { type:"keyDown", key:"Enter", code:"Enter", text:"\r", windowsVirtualKeyCode:13 });
    await page.send("Input.dispatchKeyEvent", { type:"keyUp", key:"Enter", code:"Enter", windowsVirtualKeyCode:13 });
    await until(() => page.evaluate("document.activeElement?.dataset.resourceTab === 'icons'"), "Keyboard navigation must focus the matching tab");
    await selectSource(otherCapture.pageTitle);
    assert.equal(await page.evaluate("document.querySelectorAll('.resource-album').length"), 1);
    await page.evaluate("document.querySelector('.resource-album__open').click()", true);
    await until(() => page.evaluate("document.querySelectorAll('.resource-card').length === 1"), "Second page gallery must stay isolated");
    assert.equal(await page.evaluate("document.querySelector('.resource-card').textContent.includes('Another page image')"), true);
    await selectSource(emptyCapture.pageTitle);
    assert.equal(await page.evaluate("Boolean(document.querySelector('.empty-state'))"), true);
    assert.equal(await page.evaluate("document.querySelectorAll('.resource-album').length"), 0);
    await selectSource("All pages");
    assert.equal(await page.evaluate("document.querySelectorAll('.page-albums').length"), 2);
    await page.evaluate("document.querySelector('[data-album-page=another-page] .resource-album__open').click()", true);
    await until(() => page.evaluate("document.querySelectorAll('.resource-card').length === 1"), "All pages overview must route to the clicked section's page");
    assert.equal(await page.evaluate("document.querySelector('.page-scope__selection strong').textContent"), otherCapture.pageTitle);
    await selectSource(capture.pageTitle);
    const updatedCapture = { ...capture, resources:[...capture.resources,{ ...capture.resources[0],id:"new-image",label:"Newly scanned image",url:`${base}/extensionless?gallery=new` }] };
    await page.evaluate(`chrome.storage.local.set({"allhere.library.v1":${JSON.stringify([updatedCapture,otherCapture,emptyCapture])}})`);
    await until(() => page.evaluate("document.querySelector('[data-album-category=images] .resource-album__title > span').textContent === '13'"), "Overview must update when captures change");
    assert.equal(await page.evaluate("document.querySelectorAll('[data-album-category=images] .resource-album__preview').length"), 10);
    console.log("PASS keyboard navigation, per-page isolation, grouped All pages, empty state, and live updates in Brave.");
  } else if (menuOnly) {
    await page.evaluate("[...document.querySelectorAll('.category-pill')].find(button => button.textContent.startsWith('Icons')).click()", true);
    await until(() => page.evaluate("document.querySelectorAll('.resource-card').length === 4"), "Icons did not appear");
    for (const width of [390, 320]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      if (width === 320) {
        await page.evaluate("document.querySelector('.sort-button').click()", true);
        await until(() => page.evaluate("Boolean(document.querySelector('.resource-table'))"), "List view did not open");
      }
      await page.evaluate(`(() => {
        const row = [...document.querySelectorAll(${JSON.stringify(width === 390 ? ".resource-card-frame" : "tbody tr")})].find(row => row.textContent.includes('Vector icon'));
        row.scrollIntoView({block:'center'}); row.querySelector('.resource-actions__trigger').click();
      })()`, true);
      await until(() => page.evaluate("Boolean(document.querySelector('.resource-actions__menu'))"), "Icon menu did not open");
      const bounds = await page.evaluate(`(() => {
        const menu = document.querySelector('.resource-actions__menu'); menu.scrollIntoView({block:'nearest'});
        const rect = menu.getBoundingClientRect();
        let unobstructed = true;
        for (let x = rect.left + 10; x < rect.right - 10; x += 12) {
          for (let y = rect.top + 10; y < rect.bottom - 10; y += 12) {
            if (!menu.contains(document.elementFromPoint(x, y))) unobstructed = false;
          }
        }
        return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:innerWidth,height:innerHeight,copySvg:menu.textContent.includes('Copy SVG'),unobstructed};
      })()`);
      assert.ok(bounds.copySvg && bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height, "Icon menu must fit the sidebar");
      assert.ok(bounds.unobstructed, "Nearby controls must not cover the icon menu");
      const screenshot = await page.send("Page.captureScreenshot", { format: "png" });
      const screenshotPath = join(tmpdir(), `${basename(profile)}-${width}.png`);
      await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
      console.log(`PASS ${width}px icon menu: ${screenshotPath}`);
      await page.evaluate("document.querySelector('.resource-actions__trigger[aria-expanded=true]').click()", true);
      await delay(50);
    }
  } else {
  for (const entry of entries) {
    const previousIds = await page.evaluate("chrome.storage.local.get('allhere.downloads.v1').then(data=>(data['allhere.downloads.v1']||[]).map(job=>job.id))");
    await action(entry.label, "Download");
    if (entry.rejected) {
      const newJobs = await page.evaluate(`chrome.storage.local.get('allhere.downloads.v1').then(data=>(data['allhere.downloads.v1']||[]).filter(job=>!${JSON.stringify(previousIds)}.includes(job.id)))`);
      assert.equal(newJobs.length, 0, `${entry.label}: invalid data must not be saved`);
      const notice = await page.evaluate("document.querySelector('.notice')?.textContent ?? ''");
      assert.match(notice, /damaged|valid SVG|expired|unavailable|unsupported/i);
      console.log(`PASS rejected ${entry.label}`);
      continue;
    }
    const download = await until(() => page.evaluate(`chrome.storage.local.get('allhere.downloads.v1').then(data=>(data['allhere.downloads.v1']||[]).find(job=>!${JSON.stringify(previousIds)}.includes(job.id)&&job.state==='complete'))`), `${entry.label}: download did not complete`);
    assert.ok(entry.extension ? download.filename.endsWith(`.${entry.extension}`) : /\.(png|jpg|gif|webp|avif|ico|cur|bmp|svg)$/.test(download.filename), `${entry.label}: wrong extension ${download.filename}`);
    assert.ok(download.filename.startsWith(entry.label),`${entry.label}: prepared download lost its filename`);
    const saved = await readFile(join(downloads, download.filename));
    if (entry.bytes && entry.extension !== "svg") assert.deepEqual(saved, entry.bytes, `${entry.label}: original bytes must be preserved`);
    else if (entry.extension === "svg") assert.match(saved.toString(), /<svg[\s>]/);
    assert.ok(saved.length > 0, `${entry.label}: the saved file must not be empty`);
    if (!entry.extension) {
      const reopened = await page.evaluate(`(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(saved.toString("base64"))}), character => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes])); const image = new Image();
        try { return await new Promise(resolve => {
          image.onload = () => resolve({loaded:true,width:image.naturalWidth,height:image.naturalHeight});
          image.onerror = () => resolve({loaded:false}); image.src = url;
        }); } finally { URL.revokeObjectURL(url); }
      })()`);
      assert.equal(reopened.loaded, true, "The downloaded remote image must reopen from disk");
      console.log(`PASS reopened downloaded image (${reopened.width}×${reopened.height})`);
    }
    console.log(`PASS downloaded ${download.filename}`);
  }
  for (const entry of entries.filter(entry => entry.kind === "icon")) {
    await page.evaluate("window.__copiedSvg = null");
    await action(entry.label, "Copy SVG");
    const copied = await until(() => page.evaluate("window.__copiedSvg"), `${entry.label}: SVG was not copied`);
    assert.doesNotMatch(copied, /<script|foreignObject|onload=|<style/i);
    if (entry.extension === "svg") assert.match(copied, /<path/);
    else assert.match(copied, /<image[^>]+href="data:image\//);
    const decoded = await page.evaluate(`(async () => {
      const blob = new Blob([${JSON.stringify(copied)}], {type:'image/svg+xml'});
      const url = URL.createObjectURL(blob);
      const image = new Image();
      try { return await new Promise(resolve => {
        image.onload = () => resolve({loaded:true,width:image.naturalWidth,height:image.naturalHeight});
        image.onerror = () => resolve({loaded:false}); image.src = url;
      }); } finally { URL.revokeObjectURL(url); }
    })()`);
    assert.equal(decoded.loaded, true, `${entry.label}: copied SVG must render`);
    console.log(`PASS copied ${entry.label} as SVG (${decoded.width}×${decoded.height})`);
  }
  console.log("All image download and SVG copy checks passed in Brave.");
  }
} finally {
  page?.close();
  if (browserCdp) { try { await browserCdp.send("Browser.close"); } catch { /* Closed already. */ } browserCdp.close(); }
  browser.kill();
  server.close();
  const target = resolve(profile);
  if (target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith("stashwell-image-actions-")) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await rm(target, { recursive: true, force: true }); break; } catch { await delay(500); }
    }
  }
}
