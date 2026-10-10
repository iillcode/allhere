// Black-box checks against the built extension, using isolated Brave storage and downloads.
// Run after building: node scripts/verify-image-actions.mjs [optional-image-url]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as portServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const menuOnly = process.argv[2] === "--menu-check";
const albumOnly = process.argv[2] === "--album-check";
const dragOnly = process.argv[2] === "--drag-check";
const scanOnly = process.argv[2] === "--scan-check";
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
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((done, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 35_000);
      this.pending.set(id, { resolve: done, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, userGesture = false) {
    const result = await this.send("Runtime.evaluate", { expression, userGesture, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

const fixtures = new Map();
const server = createServer((request, response) => {
  const fixture = fixtures.get(new URL(request.url, "http://localhost").pathname);
  if (!fixture) { response.writeHead(404).end(); return; }
  response.writeHead(fixture.status ?? 200, { "Content-Type": fixture.type, "Cross-Origin-Resource-Policy": "same-origin" });
  response.end(fixture.bytes);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const debugPort = await new Promise((done) => {
  const server = portServer();
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => done(port)); });
});
const profile = await mkdtemp(join(tmpdir(), "allhere-image-actions-"));
const downloads = join(profile, "test-downloads");
await mkdir(downloads);
const extension = fileURLToPath(new URL("../apps/extension/out", import.meta.url));
const browser = spawn(process.env.ALLHERE_BROWSER_PATH ?? "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", [
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
  }, "The built Allhere extension did not load");
  // Node's URL origin is null for extension URLs, so preserve the scheme and host.
  const extensionUrl = `chrome-extension://${new URL(worker.url).hostname}/index.html`;
  const { targetId } = await browserCdp.send("Target.createTarget", { url: extensionUrl });
  const target = await until(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return targets.find((target) => target.id === targetId && target.webSocketDebuggerUrl);
  }, "The extension page did not open");
  page = new Cdp(target.webSocketDebuggerUrl);
  await page.ready();
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
  await browserCdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
  await until(() => page.evaluate("Boolean(document.querySelector('.allhere-shell'))"), "The library did not render");
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
  const entries = process.argv[2] && !menuOnly && !albumOnly && !dragOnly && !scanOnly ? [{ label: "Remote image", url: process.argv[2] }] : [
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
      {label:'Script file',path:'/script.js',bytes:Buffer.from('console.log("Allhere");'),type:'application/javascript',kind:'script',extension:'js'},
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
    fixtures.set('/scan-page',{type:'text/html',bytes:Buffer.from(`<!doctype html><title>Live gallery</title>
      <link rel="icon" href="/favicon.ico"><style>.mask-icon{width:24px;height:24px;mask-image:url('/mask.svg');background:blue}.wall{width:30px;height:30px;background-image:url('/wall.png')} .pseudo::before{content:'';display:block;width:24px;height:24px;background-image:url('/pseudo.png')}</style>
      <img id="first" src="/first.png" alt="First image"><img id="lazy" loading="lazy" src="/lazy.png" alt="Lazy image" style="position:absolute;top:20000px">
      <img src="data:image/png;base64,${png.toString('base64')}" alt="Inline raster image">
      <img src="/same.png?w=100" alt="Variant"><img src="/same.png?w=200" alt="Variant">
      <img src="/same.png?sig=a&w=100" alt="Signed A"><img src="/same.png?sig=b&w=100" alt="Signed B">
      <div class="wall"></div><div class="mask-icon" aria-label="Mask icon"></div><div class="pseudo"></div>
      <svg width="24" height="24" aria-label="Sprite one"><use href="/sprites.svg#one"></use></svg><svg width="24" height="24" aria-label="Sprite two"><use href="/sprites.svg#two"></use></svg>
      <svg aria-label="Large inline icon" width="24" height="24" viewBox="0 0 24 24">${lengthySvg}</svg>
      <div id="shadow-host"></div><iframe title="Asset frame" src="/scan-frame"></iframe>
      <script>const root=document.querySelector('#shadow-host').attachShadow({mode:'open'});root.innerHTML='<img src="/shadow.png" alt="Shadow image"><svg aria-label="Shadow icon" width="24" height="24"><circle cx="12" cy="12" r="9"/></svg>';
      fetch('/negotiated.jpg').then(response=>response.blob()).then(blob=>{const photo=new Image();photo.alt='Blob image';photo.src=URL.createObjectURL(blob);document.body.append(photo)});</script>`)});
    fixtures.set('/scan-frame',{type:'text/html',bytes:Buffer.from('<!doctype html><title>Asset frame</title><img src="/frame.png" alt="Frame image"><svg aria-label="Frame icon" width="24" height="24"><rect width="20" height="20"/></svg>')});
    for(const path of ['/first.png','/lazy.png','/same.png','/wall.png','/pseudo.png','/shadow.png','/frame.png','/late.png','/late2.png'])fixtures.set(path,{type:'image/png',bytes:png});
    fixtures.set('/mask.svg',{type:'image/svg+xml',bytes:Buffer.from(inlineSvg)});
    fixtures.set('/sprites.svg',{type:'image/svg+xml',bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><symbol id="one"><path d="M0 0h12v12H0z"/></symbol><symbol id="two"><circle r="6" cx="6" cy="6"/></symbol></svg>')});
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
  const otherCapture = { ...capture, id: "another-page", pageUrl: `${base}/other`, pageTitle: "Another webpage",
    resources: [{ ...capture.resources[0], id: "other-resource", label: "Another page image", pageUrl: `${base}/other` }] };
  const emptyCapture = { ...capture, id: "empty-page", pageUrl: `${base}/empty`, pageTitle: "Page without images", resources: [] };
  const storedCaptures = albumOnly ? [capture, otherCapture, emptyCapture] : [capture];
  await page.evaluate(`chrome.storage.local.set({"allhere.library.v1":${JSON.stringify(storedCaptures)}})`);
  await until(() => page.evaluate("Boolean(document.querySelector('.resource-album'))"), "Resource sections did not appear in the library");
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
  if (!albumOnly) {
    await selectCategory("Images");
    await until(() => page.evaluate(`document.querySelectorAll('.resource-card').length === ${capture.resources.filter(resource => resource.kind === "image").length}`), "Images did not appear in the library");
  }
  // Inspect the clipboard payload without reading or overwriting the user's OS clipboard.
  await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    write: async items => { window.__copiedSvg = await (await items[0].getType('text/plain')).text(); },
    writeText: async text => { window.__copiedSvg = text; }
  } })`);
  async function action(label, name) {
    await selectCategory(entries.find(entry => entry.label === label)?.kind === "icon" ? "Icons" : "Images");
    await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('.resource-card')].find(card => card.getAttribute('aria-label') === ${JSON.stringify(label)});
      card.closest('.resource-card-frame').scrollIntoView({block:'center'});
      card.closest('.resource-card-frame').querySelector('.resource-actions__trigger').click();
    })()`, true);
    await until(() => page.evaluate("Boolean(document.querySelector('.resource-actions__menu'))"), "Menu did not open");
    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('.resource-actions__item')].find(button => button.textContent.trim() === ${JSON.stringify(name)});
      if (!button || button.disabled) throw new Error('Requested action is unavailable');
      button.click();
    })()`, true);
    await delay(100);
    await until(() => page.evaluate("!document.querySelector('.resource-actions__trigger .spin')"), "Image action did not finish");
  }
  if (scanOnly) {
    const {targetId:liveId}=await browserCdp.send('Target.createTarget',{url:base+'/scan-page'});
    const liveInfo=await until(async()=> (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(target=>target.id===liveId),'Live gallery tab did not open');
    const live=new Cdp(liveInfo.webSocketDebuggerUrl);await live.ready();
    try {
      await live.send('Page.bringToFront');
      const read=()=>page.evaluate(`(async()=>{const data=await chrome.storage.local.get('allhere.library.v1');return data['allhere.library.v1'].find(c=>c.pageUrl===${JSON.stringify(base+'/scan-page')});})()`);
      const initial=await until(async()=>{const value=await read();return value?.resources.some(item=>item.label==='Shadow image')&&value.resources.some(item=>item.label==='Frame image')?value:null},'Initial image, shadow DOM, or frame scan did not complete');
      const asset=(snapshot,path)=>snapshot.resources.filter(item=>item.url.includes(path));
      assert.ok(asset(initial,'/first.png').length===1 && asset(initial,'/lazy.png').length===1,'Loaded and lazy images should both be kept');
      assert.ok(asset(initial,'/shadow.png').length===1 && asset(initial,'/frame.png').length===1,'Shadow DOM and frame images should be kept');
      assert.ok(initial.resources.some(item=>item.label==='Inline raster image'&&item.url.startsWith('data:image/png')),'Inline raster image should remain visible');
      assert.ok(asset(initial,'/mask.svg').length===1 && asset(initial,'/pseudo.png').length===1,'CSS icons and pseudo images should be kept');
      const sprites=initial.resources.filter(item=>item.label==='Sprite one'||item.label==='Sprite two');
      assert.equal(sprites.length,2,'Distinct sprite fragments must remain separate icons');
      assert.ok(sprites.every(item=>item.url.startsWith('data:image/svg+xml')),'Sprite symbols should become standalone icons');
      assert.notEqual(sprites[0].url,sprites[1].url,'Different sprite symbols need different SVG markup');
      assert.equal(asset(initial,'/same.png').length,3,'Resize variants collapse, but distinct signed resources remain');
      const inline=initial.resources.find(item=>item.label==='Large inline icon');
      assert.ok(inline?.url.length>8000,'Long inline SVG must not be trimmed or omitted');
      assert.ok(initial.resources.some(item=>item.label==='Shadow icon')&&initial.resources.some(item=>item.label==='Frame icon'));
      await until(()=>page.evaluate("document.querySelector('.page-scope__selection strong')?.textContent==='Live gallery'"),'Active tab did not select its source page');
      await page.evaluate("document.querySelector('[data-resource-tab=images]').click();document.querySelector('[aria-label=\"List view\"]').click();window.scrollTo(0,260)",true);
      const beforeUpdate=await page.evaluate("({source:document.querySelector('.page-scope__selection strong')?.textContent,section:document.querySelector('[aria-selected=true][data-resource-tab]')?.getAttribute('data-resource-tab'),list:document.querySelector('[aria-label=\"List view\"]')?.getAttribute('aria-pressed'),scroll:window.scrollY,images:Number(document.querySelector('[data-resource-tab=images] span')?.textContent),notice:document.querySelector('.notice')?.textContent})");
      assert.ok(beforeUpdate.scroll>0,'The sidebar fixture must be scrollable for the position check');
      const first=asset(initial,'/first.png')[0];
      await page.evaluate(`(async()=>{const data=await chrome.storage.local.get('allhere.library.v1');const captures=data['allhere.library.v1'];const found=captures.find(c=>c.pageUrl===${JSON.stringify(base+'/scan-page')});found.resources.find(r=>r.url.includes('/first.png')).saved=true;await chrome.storage.local.set({'allhere.library.v1':captures});})()`);
      await live.evaluate("document.querySelector('#first').remove();const later=new Image();later.src='/late.png';later.alt='Later image';document.body.append(later)");
      const updated=await until(async()=>{const value=await read();return value?.resources.some(item=>item.url.includes('/late.png'))?value:null},'Dynamic image was not automatically added',15000);
      const afterUpdate=await until(async()=>{const state=await page.evaluate("({source:document.querySelector('.page-scope__selection strong')?.textContent,section:document.querySelector('[aria-selected=true][data-resource-tab]')?.getAttribute('data-resource-tab'),list:document.querySelector('[aria-label=\"List view\"]')?.getAttribute('aria-pressed'),scroll:window.scrollY,images:Number(document.querySelector('[data-resource-tab=images] span')?.textContent),notice:document.querySelector('.notice')?.textContent})");return state.images>beforeUpdate.images?state:null},'New image did not appear in the current sidebar section');
      assert.equal(afterUpdate.source,beforeUpdate.source,'Background scan changed the selected source page');
      assert.equal(afterUpdate.section,beforeUpdate.section,'Background scan returned to All resources');
      assert.equal(afterUpdate.list,beforeUpdate.list,'Background scan changed the layout');
      assert.equal(afterUpdate.scroll,beforeUpdate.scroll,'Background scan reset the scroll position');
      assert.equal(afterUpdate.notice,beforeUpdate.notice,'Background scan replaced the sidebar message');
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
      await until(async()=>{const value=await read();return value?.resources.some(item=>item.url.includes('/late2.png'))?value:null},'Second dynamic image was not added',15000);
      assert.equal(await page.evaluate("document.querySelector('.page-scope__selection strong')?.textContent"),'Image actions check','Background scan hijacked a manually selected source');
      assert.equal(await page.evaluate("document.querySelector('[aria-selected=true][data-resource-tab]')?.getAttribute('data-resource-tab')"),'images','Background scan changed the section on another source');
      await page.evaluate("document.querySelector('.button--scan').click()",true);
      await until(()=>page.evaluate("!document.querySelector('.button--scan').disabled"),'Manual rescan did not finish');
      const repeated=await read();assert.equal(repeated.resources.length,count+1,'Repeated scans must not create or lose resources');
      assert.equal(new Set(repeated.resources.map(resource=>resource.kind+':'+resource.url)).size,repeated.resources.length,'No exact duplicates');
      const {targetId:otherId}=await browserCdp.send('Target.createTarget',{url:base+'/scan-frame'});
      const otherInfo=await until(async()=> (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(target=>target.id===otherId),'Second tab did not open');
      const other=new Cdp(otherInfo.webSocketDebuggerUrl);await other.ready();
      try {
        await other.send('Page.bringToFront');
        await until(()=>page.evaluate("document.querySelector('.page-scope__selection strong')?.textContent==='Asset frame'"),'Tab switch did not select and scan the new page');
        assert.equal(await page.evaluate("document.querySelector('[aria-selected=true][data-resource-tab]')?.getAttribute('data-resource-tab')"),'images','Tab switch reset the selected section');
      } finally {other.close();}
      console.log(`PASS live gallery: ${repeated.resources.length} stable resources; background updates preserve sidebar position and selection, and tab switches scan the new page.`);
    } finally {live.close();}
  } else if (dragOnly) {
    const {targetId:destinationId}=await browserCdp.send('Target.createTarget',{url:base+'/destination'});
    const destInfo=await until(async()=> (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(target=>target.id===destinationId),'No destination tab');
    const dest=new Cdp(destInfo.webSocketDebuggerUrl);await dest.ready();
    try {
      await until(()=>dest.evaluate("!!document.querySelector('#drop')"),'Upload fixture did not load');
      await dest.send('Page.bringToFront');
      await delay(1600);
      await page.evaluate(`chrome.storage.local.set({"allhere.library.v1":${JSON.stringify([capture])}})`);
      // Lock the source selection so automatic active-tab scans do not replace it.
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
      assert.equal(await page.evaluate("[...document.querySelectorAll('.resource-album__preview')].every(el=>el.draggable)"),true);
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
      assert.ok(native.items.some(item=>item.mimeType.startsWith('application/x-allhere-file-')),'Native drag must retain the cross-page capability');
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
    const before = browserCdp.events.filter(event => event.method === "Browser.downloadWillBegin").length;
    await action(entry.label, "Download");
    if (entry.rejected) {
      assert.equal(browserCdp.events.filter(event => event.method === "Browser.downloadWillBegin").length, before, `${entry.label}: invalid data must not be saved`);
      const notice = await page.evaluate("document.querySelector('.notice')?.textContent ?? ''");
      assert.match(notice, /damaged|valid SVG|expired|unavailable|unsupported/i);
      console.log(`PASS rejected ${entry.label}`);
      continue;
    }
    const download = await until(() => browserCdp.events.filter(event => event.method === "Browser.downloadWillBegin")[before]?.params, `${entry.label}: no download started`);
    assert.ok(entry.extension ? download.suggestedFilename.endsWith(`.${entry.extension}`) : /\.(png|jpg|gif|webp|avif|ico|cur|bmp|svg)$/.test(download.suggestedFilename), `${entry.label}: wrong extension ${download.suggestedFilename}`);
    await until(() => browserCdp.events.some(event => event.method === "Browser.downloadProgress" && event.params.guid === download.guid && event.params.state === "completed"), "Download did not complete");
    const saved = await readFile(join(downloads, download.suggestedFilename));
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
    console.log(`PASS downloaded ${download.suggestedFilename}`);
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
  if (target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith("allhere-image-actions-")) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await rm(target, { recursive: true, force: true }); break; } catch { await delay(500); }
    }
  }
}
