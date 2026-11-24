import { cp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const delay = ms => new Promise(done => setTimeout(done, ms));
export async function until(check, message, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await check(); if (result) return result; await delay(100); }
  throw new Error(message);
}
export class Cdp {
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
      this.pending.set(id, { done, reject, timer: setTimeout(() => reject(Error(`${method} timed out`)), 25_000) });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, userGesture = false) {
    const value = await this.send("Runtime.evaluate", { expression, userGesture, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
    return value.result.value;
  }
  close() { for (const entry of this.pending.values()) clearTimeout(entry.timer); this.socket.close(); }
}

// Tests inspect persisted state and can seed fixtures without exporting data
// through the UI. The helper is installed only in the test extension copy.
function fixtureHistory() {
  const databaseName = "stashwell.library";
  const libraryKey = "allhere.library.v1";
  const exclusionsKey = "allhere.capture-exclusions.v1";
  const stores = ["pages", "resources", "settings"];
  const chunkSize = 200;
  const result = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function open() {
    const request = indexedDB.open(databaseName);
    let missing = false;
    request.onupgradeneeded = () => { missing = true; request.transaction.abort(); };
    return result(request).catch(error => { if (!missing) throw error; });
  }
  async function read() {
    const database = await open();
    if (!database) return { [libraryKey]: [] };
    try {
      const transaction = database.transaction(stores);
      const keys = result(transaction.objectStore("pages").getAll());
      const exclusions = result(transaction.objectStore("settings").get(exclusionsKey));
      const resourceStore = transaction.objectStore("resources");
      const captures = await keys.then(pages => Promise.all(pages.sort((left, right) =>
        Date.parse(right.capturedAt) - Date.parse(left.capturedAt) || left.order - right.order,
      ).map(async ({ resourceCount, revision: _revision, order: _order, chunkRevisions: _chunks, ...page }) => {
        const chunks = await Promise.all(Array.from({ length: Math.ceil(resourceCount / chunkSize) }, (_, index) =>
          result(resourceStore.get([page.pageUrl, index]))));
        return { ...page, resources: chunks.flat() };
      })));
      return { [libraryKey]: captures, [exclusionsKey]: await exclusions };
    } finally { database.close(); }
  }
  async function write(data) {
    const prepared = await chrome.runtime.sendMessage({ type: "stashwell.library.prepare" });
    if (!prepared?.prepared) throw new Error("Fixture library initialization failed.");
    return navigator.locks.request(libraryKey, async () => {
      const database = await open();
      if (!database) throw new Error("Fixture library is unavailable.");
      try {
        const transaction = database.transaction(stores, "readwrite");
        const done = new Promise((resolve, reject) => {
          transaction.oncomplete = resolve;
          transaction.onabort = () => reject(transaction.error);
        });
        if (data[libraryKey]) {
          const pages = transaction.objectStore("pages");
          const resources = transaction.objectStore("resources");
          pages.clear();
          resources.clear();
          let order = 0;
          for (const { resources: items, ...page } of data[libraryKey]) {
            const chunkRevisions = [];
            for (let start = 0; start < items.length; start += chunkSize) {
              resources.put(items.slice(start, start + chunkSize), [page.pageUrl, start / chunkSize]);
              chunkRevisions.push(crypto.randomUUID());
            }
            pages.put({ ...page, resourceCount: items.length, revision: crypto.randomUUID(), order: order++, chunkRevisions });
          }
          transaction.objectStore("settings").put(order, "page-sequence");
        }
        if (data[exclusionsKey]) transaction.objectStore("settings").put(data[exclusionsKey], exclusionsKey);
        await done;
        const notification = new BroadcastChannel(databaseName);
        notification.postMessage(null);
        notification.close();
      } finally { database.close(); }
    });
  }
  globalThis.fixtureHistory = { read, write };
}

// Headless tests cannot click Chrome's host grant dialog. Pre-grant only
// named fixture sites while preserving the production optional host patterns.
export async function localFixtureExtension(profile, urls = ["http://127.0.0.1", "http://localhost"]) {
  const destination = join(profile, "fixture-extension");
  await cp(resolve("apps/extension/out"), destination, { recursive: true });
  if (urls.length) {
    const path = join(destination, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.host_permissions = [...new Set(urls.map(value => {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.hostname.includes("*")) throw new Error("Fixture access must name a specific website.");
      return `${url.protocol}//${url.hostname}/*`;
    }))];
    await writeFile(path, JSON.stringify(manifest));
  }
  const panel = join(destination, "index.html");
  const worker = join(destination, "service-worker.js");
  await writeFile(join(destination, "history-fixture.js"), `(${fixtureHistory.toString()})();`);
  await writeFile(panel, (await readFile(panel, "utf8")).replace("</head>", '<script src="./history-fixture.js"></script></head>'));
  await writeFile(worker, `import "./history-fixture.js";\n${await readFile(worker, "utf8")}`);
  return destination;
}
