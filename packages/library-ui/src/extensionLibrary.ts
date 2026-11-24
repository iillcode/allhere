import { LIBRARY_STORAGE_KEY, mergeCaptures, type PageCapture } from "@stashwell/core";
import { CAPTURE_EXCLUSIONS_KEY, normalizeCaptureExclusions, type CaptureExclusions } from "./libraryManagement";

export type LibraryStorage = {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
};
export type LegacyLibraryStorage = LibraryStorage & { remove: (keys: string[]) => Promise<void> };
export type LibrarySnapshot = { captures: PageCapture[]; exclusions: CaptureExclusions };
export type LibraryMutation<T extends LibrarySnapshot> = (captures: PageCapture[], exclusions: CaptureExclusions) => T | Promise<T>;

const DATABASE = "stashwell.library";
const STORES = ["pages", "resources", "settings"];
const CHUNK_SIZE = 200;
const PAGE_SEQUENCE = "page-sequence";

type PageRecord = Omit<PageCapture, "resources"> & { revision: string; resourceCount: number; order: number; chunkRevisions: string[] };
type ResourceChunk = PageCapture["resources"];
type CachedPage = { record: PageRecord; chunks: ResourceChunk[]; capture: PageCapture };
type StoredLibrary = LibrarySnapshot & { records: Map<string, CachedPage>; sequence: number };

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("The library transaction was interrupted."));
  });
}

function openDatabase() {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    database.createObjectStore("pages", { keyPath: "pageUrl" });
    database.createObjectStore("resources");
    database.createObjectStore("settings");
  };
  return requestResult(request);
}

function getExclusions(database: IDBDatabase): Promise<CaptureExclusions | undefined> {
  return requestResult(database.transaction("settings").objectStore("settings").get(CAPTURE_EXCLUSIONS_KEY));
}

function chunkCount(resourceCount: number) {
  return Math.ceil(resourceCount / CHUNK_SIZE);
}

function readPage(transaction: IDBTransaction, record: PageRecord, cached?: CachedPage): Promise<CachedPage> {
  const { revision: _revision, resourceCount, order: _order, chunkRevisions, ...page } = record;
  const store = transaction.objectStore("resources");
  const chunks = chunkRevisions.map((revision, index) => cached?.record.chunkRevisions[index] === revision
    ? cached.chunks[index]
    : requestResult<ResourceChunk>(store.get([page.pageUrl, index])));
  return Promise.all(chunks).then(parts => {
    const resources = parts.flat();
    if (resources.length !== resourceCount || parts.some(part => !part)) throw new Error("Some saved resources could not be loaded.");
    return { record, chunks: parts, capture: { ...page, resources } };
  });
}

async function writeChanges(database: IDBDatabase, previous: StoredLibrary, next: LibrarySnapshot, durability: IDBTransactionDurability = "default"): Promise<boolean> {
  if (previous.captures === next.captures && previous.exclusions === next.exclusions) return false;
  const remaining = new Set(next.captures.map(page => page.pageUrl));
  const removed = previous.captures.filter(page => !remaining.has(page.pageUrl));
  const changed = next.captures.filter(page => previous.records.get(page.pageUrl)?.capture !== page);
  if (!removed.length && !changed.length && previous.exclusions === next.exclusions) return false;

  const transaction = database.transaction(STORES, "readwrite", { durability });
  const finished = transactionDone(transaction);
  const pages = transaction.objectStore("pages");
  const resources = transaction.objectStore("resources");
  const settings = transaction.objectStore("settings");
  let sequence = previous.sequence;
  try {
    for (const page of removed) {
      pages.delete(page.pageUrl);
      resources.delete(IDBKeyRange.bound([page.pageUrl, 0], [page.pageUrl, chunkCount(page.resources.length)]));
    }
    for (const { resources: items, ...page } of changed) {
      const existing = previous.records.get(page.pageUrl);
      const previousItems = existing?.capture.resources ?? [];
      const count = chunkCount(items.length);
      const chunkRevisions: string[] = [];
      for (let index = 0; index < count; index++) {
        const start = index * CHUNK_SIZE;
        const chunk = items.slice(start, start + CHUNK_SIZE);
        const previousLength = Math.min(CHUNK_SIZE, Math.max(0, previousItems.length - start));
        const previousRevision = existing?.record.chunkRevisions[index];
        if (previousRevision && chunk.length === previousLength && chunk.every((item, offset) => item === previousItems[start + offset])) {
          chunkRevisions.push(previousRevision);
        } else {
          resources.put(chunk, [page.pageUrl, index]);
          chunkRevisions.push(crypto.randomUUID());
        }
      }
      pages.put({ ...page, revision: crypto.randomUUID(), resourceCount: items.length, order: existing?.record.order ?? sequence++, chunkRevisions } satisfies PageRecord);
      if (count < chunkCount(previousItems.length)) {
        resources.delete(IDBKeyRange.bound([page.pageUrl, count], [page.pageUrl, chunkCount(previousItems.length)]));
      }
    }
    if (previous.exclusions !== next.exclusions) {
      settings.put(next.exclusions, CAPTURE_EXCLUSIONS_KEY);
    }
    if (sequence !== previous.sequence) settings.put(sequence, PAGE_SEQUENCE);
  } catch (error) {
    transaction.abort();
    await finished.catch(() => {});
    throw error;
  }
  await finished;
  return true;
}

export function createExtensionLibrary(legacyStorage: LegacyLibraryStorage, prepareInWorker?: () => Promise<void>) {
  let ready: Promise<IDBDatabase> | undefined;
  let cached = new Map<string, CachedPage>();

  async function migrate(database: IDBDatabase) {
    // The migration marker and the library commit together. A failed write
    // leaves the previous version available for the next attempt.
    await navigator.locks.request(LIBRARY_STORAGE_KEY, async () => {
      if (await getExclusions(database)) return;
      const keys = [LIBRARY_STORAGE_KEY, CAPTURE_EXCLUSIONS_KEY];
      const stored = await legacyStorage.get(keys);
      await writeChanges(database, { records: new Map(), captures: [], exclusions: normalizeCaptureExclusions(null), sequence: 0 }, {
        captures: normalizeStored(stored[LIBRARY_STORAGE_KEY]),
        exclusions: normalizeCaptureExclusions(stored[CAPTURE_EXCLUSIONS_KEY]),
      }, "strict");
      await legacyStorage.remove(keys).catch(() => {});
    });
  }

  function prepare() {
    ready ??= openDatabase().then(async database => {
      database.onversionchange = () => { database.close(); ready = undefined; };
      try {
        if (!await getExclusions(database)) {
          if (prepareInWorker) await prepareInWorker();
          else await migrate(database);
        }
        return database;
      } catch (error) {
        database.close();
        throw error;
      }
    }).catch(error => { ready = undefined; throw error; });
    return ready;
  }

  async function readSnapshot(database: IDBDatabase, pageUrl?: string): Promise<StoredLibrary> {
    const transaction = database.transaction(STORES);
    const pages = transaction.objectStore("pages");
    const settings = transaction.objectStore("settings");
    const exclusions = requestResult<CaptureExclusions>(settings.get(CAPTURE_EXCLUSIONS_KEY));
    const sequence = requestResult<number | undefined>(settings.get(PAGE_SEQUENCE));
    const loadPages = pageUrl === undefined
      ? requestResult<PageRecord[]>(pages.getAll())
      : requestResult<PageRecord | undefined>(pages.get(pageUrl)).then(record => record ? [record] : []);
    const [ordered, storedExclusions, nextSequence] = await Promise.all([
      loadPages.then(entries => Promise.all(entries.map(entry => {
        const previous = cached.get(entry.pageUrl);
        return previous?.record.revision === entry.revision ? previous : readPage(transaction, entry, previous);
      }))),
      exclusions,
      sequence,
    ]);
    ordered.sort((left, right) => Date.parse(right.capture.capturedAt) - Date.parse(left.capture.capturedAt) || left.record.order - right.record.order);
    const records = new Map(ordered.map(page => [page.capture.pageUrl, page]));
    if (pageUrl === undefined) cached = records;
    return { records, captures: ordered.map(page => page.capture), exclusions: storedExclusions, sequence: nextSequence ?? 0 };
  }

  const load = async () => readSnapshot(await prepare());
  const listeners = new Set<(snapshot: LibrarySnapshot) => void>();
  let channel: BroadcastChannel | undefined;
  let refresh = 0;

  function subscribe(listener: (snapshot: LibrarySnapshot) => void) {
    listeners.add(listener);
    if (!channel) {
      channel = new BroadcastChannel(DATABASE);
      channel.onmessage = () => {
        const request = ++refresh;
        void load().then(snapshot => {
          if (request === refresh) listeners.forEach(notify => notify(snapshot));
        }).catch(() => {});
      };
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size) { refresh++; channel?.close(); channel = undefined; }
    };
  }

  async function update<T extends LibrarySnapshot>(mutate: LibraryMutation<T>, pageUrl?: string): Promise<T> {
    const database = await prepare();
    // One lock covers panel edits and background captures. Workers read just
    // the current page, while panels can reuse unchanged pages by revision.
    return navigator.locks.request(LIBRARY_STORAGE_KEY, async () => {
      const before = await readSnapshot(database, pageUrl);
      const next = await mutate(before.captures, before.exclusions);
      if (await writeChanges(database, before, next)) {
        const notification = new BroadcastChannel(DATABASE);
        notification.postMessage(null);
        notification.close();
      }
      return next;
    });
  }

  return { prepare, load, subscribe, update, loadExclusions: async () => await getExclusions(await prepare()) ?? normalizeCaptureExclusions(null) };
}

export function normalizeStored(value: unknown): PageCapture[] {
  if (!Array.isArray(value)) return [];
  const browserOnlyProtocols = new Set([
    "brave:", "chrome:", "chrome-extension:", "chrome-untrusted:", "moz-extension:",
  ]);

  return mergeCaptures((value as PageCapture[]).filter(capture => capture && typeof capture.pageUrl === "string" && Array.isArray(capture.resources)).map((capture) => {
    const resources = capture.resources.filter((resource) => {
      if (!resource || typeof resource.url !== "string" || typeof resource.label !== "string") return false;
      if (!/^data:/i.test(resource.url)) try {
        if (browserOnlyProtocols.has(new URL(resource.url).protocol)) return false;
      } catch {
        // Retain legacy URLs that the details panel can still display safely.
      }
      return !/^data:embedded|\[inline payload omitted\]$/i.test(resource.url);
    });

    return { ...capture, resources };
  }), []);
}

