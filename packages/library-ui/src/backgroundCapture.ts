import { createId, dedupeResources, inspectResourceUrl, resourceName, upsertPageCapture, type PageCapture } from "@stashwell/core";
import { isCapturablePage } from "./activePage";
import { createExtensionLibrary, type LegacyLibraryStorage, type LibraryStorage } from "./extensionLibrary";
import { filterExcludedCapture, restorePageCapture } from "./libraryManagement";
import { collectPageResources, orderedPageResources, type RawPageScan } from "./pageResources";
import { CAPTURE_ACCESS_KEY, websiteOrigin, websitePattern } from "./websiteAccess";

export type CaptureSummary = Pick<PageCapture, "id" | "pageUrl" | "hostname"> & { resourceCount: number };

type Tab = { id?: number; windowId: number; active: boolean; url?: string; pendingUrl?: string; status?: string; favIconUrl?: string };
type BrowserEvent<Listener> = { addListener: (listener: Listener) => void };
type AccessRecords = Record<string, string>;
type Browser = {
  tabs: {
    get: (id: number) => Promise<Tab>;
    sendMessage: (id: number, message: unknown) => Promise<unknown>;
    onActivated: BrowserEvent<(info: { tabId: number; windowId: number }) => void>;
    onUpdated: BrowserEvent<(id: number, change: { url?: string; status?: string; favIconUrl?: string; title?: string }, tab: Tab) => void>;
    onRemoved: BrowserEvent<(id: number) => void>;
    onReplaced: BrowserEvent<(addedId: number, removedId: number) => void>;
  };
  windows: { onRemoved: BrowserEvent<(id: number) => void> };
  runtime: {
    id: string;
    onInstalled: BrowserEvent<(details: { reason: string; previousVersion?: string }) => void>;
    onMessage: BrowserEvent<(message: { type?: string; tabId?: number; url?: string }, sender: { id?: string; url?: string; tab?: Tab }, reply: (result: { capture?: CaptureSummary; error?: string; watching?: boolean; prepared?: boolean }) => void) => true | undefined>;
  };
  permissions: {
    contains: (permissions: { origins: string[] }) => Promise<boolean>;
    remove: (permissions: { origins: string[] }) => Promise<boolean>;
    onRemoved: BrowserEvent<(permissions: { origins?: string[] }) => void>;
  };
  scripting: {
    executeScript: (options: { target: { tabId: number; allFrames?: boolean }; func?: typeof collectPageResources; args?: [string]; files?: string[] }) => Promise<Array<{ frameId: number; result?: RawPageScan }>>;
  };
  storage: { local: LegacyLibraryStorage; session: LibraryStorage };
};

type CaptureQueue = { revision: number; queue: Promise<unknown>; timer?: ReturnType<typeof setTimeout>; queuedRevision?: number; lastScan: number };

const resourceFields = ["id", "kind", "url", "label", "alt", "description", "width", "height", "mimeType", "posterUrl", "saved", "identityUrl"] as const;

function sameCapture(previous: PageCapture, next: PageCapture) {
  return previous.pageTitle === next.pageTitle && previous.faviconUrl === next.faviconUrl && previous.resources.length === next.resources.length &&
    next.resources.every((resource, index) => {
      const old = previous.resources[index];
      const variants = resource.variantUrls ?? [];
      return resourceFields.every(field => old[field] === resource[field]) &&
        (old.variantUrls?.length ?? 0) === variants.length && variants.every((url, index) => url === old.variantUrls?.[index]);
    });
}

export function startBackgroundCapture(browser: Browser) {
  const library = createExtensionLibrary(browser.storage.local);
  const queues = new Map<number, CaptureQueue>();
  const activeTabs = new Map<number, number>();
  let access = browser.storage.session.get(CAPTURE_ACCESS_KEY)
    .then(stored => (stored[CAPTURE_ACCESS_KEY] as AccessRecords | undefined) ?? {})
    .catch(() => ({} as AccessRecords));
  let removeLegacyGrant = Promise.resolve();

  // Keep first-scan decisions through worker suspension, scoped to a tab and
  // origin for the browser session. Serialize writes from concurrent tab events.
  function changeAccess(change: (records: AccessRecords) => AccessRecords) {
    const update = access.then(async records => {
      const next = change(records);
      if (next !== records) await browser.storage.session.set({ [CAPTURE_ACCESS_KEY]: next });
      return next;
    });
    access = update.catch(() => ({}));
    return update;
  }

  function clearAccess(tabId: number, currentOrigin?: string) {
    return changeAccess(records => {
      if (!records[tabId] || records[tabId] === currentOrigin) return records;
      const next = { ...records };
      delete next[tabId];
      return next;
    });
  }

  async function approved(tabId: number, url?: string) {
    const origin = websiteOrigin(url);
    return Boolean(origin && (await access)[tabId] === origin);
  }

  async function hasSiteAccess(url: string) {
    await removeLegacyGrant;
    const pattern = websitePattern(url);
    return Boolean(pattern && await browser.permissions.contains({ origins: [pattern] }));
  }

  function stateFor(tabId: number) {
    let state = queues.get(tabId);
    if (!state) {
      state = { revision: 0, queue: Promise.resolve(), lastScan: 0 };
      queues.set(tabId, state);
    }
    return state;
  }

  function invalidate(tabId: number) {
    const state = queues.get(tabId);
    if (!state) return;
    state.revision += 1;
    clearTimeout(state.timer);
    state.timer = undefined;
  }

  async function scan(tabId: number, state: CaptureQueue, revision: number, manualUrl?: string): Promise<CaptureSummary | undefined> {
    const matches = (tab?: Tab) => queues.get(tabId) === state && state.revision === revision && tab?.active &&
      tab.status === "complete" && !tab.pendingUrl && isCapturablePage(tab.url);
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (!tab || !matches(tab) || (manualUrl && manualUrl !== tab.url)) return;
    const url = tab.url!;
    const origin = websiteOrigin(url);
    if (!origin || (!manualUrl && !await approved(tabId, url))) return;
    if (!await hasSiteAccess(url)) {
      if (manualUrl) throw new Error("Choose Scan page and allow access to this website to continue.");
      return;
    }
    activeTabs.set(tab.windowId, tabId);
    const isCurrent = async () => {
      const current = await browser.tabs.get(tabId).catch(() => undefined);
      return matches(current) && current?.url === url;
    };

    if (!manualUrl) {
      if ((await library.loadExclusions()).pages.includes(url) || !await isCurrent()) return;
      await attachHelpers(tabId);
    }
    if (!await isCurrent()) return;
    state.lastScan = Date.now();
    const target = { tabId, allFrames: true };
    const collector = { func: collectPageResources, args: [url] as [string] };
    const injected = await browser.scripting.executeScript({ target, ...collector })
      .catch(() => browser.scripting.executeScript({ target: { tabId }, ...collector }));
    const root = injected.find(frame => frame.frameId === 0)?.result;
    if (!root || root.pageUrl !== url || !await isCurrent()) return;

    const capturedAt = new Date().toISOString();
    const hostname = new URL(url).hostname;
    const scans = injected.sort((left, right) => left.frameId - right.frameId).flatMap(frame => frame.result ? [frame.result] : []);
    const capture: PageCapture = {
      id: createId("capture"), pageUrl: url, pageTitle: root.pageTitle || hostname, hostname,
      faviconUrl: root.faviconUrl || tab.favIconUrl, capturedAt,
      resources: dedupeResources(orderedPageResources(scans).map(({ position: _position, ...resource }) => ({
        ...resource, id: createId("resource"), pageUrl: url, pageTitle: root.pageTitle, capturedAt,
        security: inspectResourceUrl(resource.url, url, capturedAt),
      }))).map(resource => ({ ...resource, label: resourceName(resource) })),
    };
    const result = await library.update(async (captures, exclusions) => {
      if (!await hasSiteAccess(url) || (!manualUrl && !await approved(tabId, url)) || !await isCurrent()) return { captures, exclusions };
      const nextExclusions = manualUrl ? restorePageCapture(exclusions, url) : exclusions;
      const allowed = filterExcludedCapture(capture, nextExclusions);
      if (!allowed) return { captures, exclusions };
      const next = upsertPageCapture(captures, allowed);
      const saved = next.find(page => page.pageUrl === url)!;
      const previous = captures.find(page => page.pageUrl === url);
      return {
        captures: !manualUrl && previous && sameCapture(previous, saved) ? captures : next,
        exclusions: nextExclusions,
        capture: { id: saved.id, pageUrl: saved.pageUrl, hostname: saved.hostname, resourceCount: saved.resources.length },
      };
    }, url);
    if (manualUrl && result.capture && await hasSiteAccess(url) && await isCurrent()) {
      await changeAccess(records => state.revision === revision && records[tabId] !== origin
        ? { ...records, [tabId]: origin } : records);
      if (await isCurrent()) await attachHelpers(tabId);
    }
    return result.capture;
  }

  function enqueue(tabId: number, manualUrl?: string) {
    const state = stateFor(tabId);
    const revision = state.revision;
    if (manualUrl) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    const task = state.queue.then(() => {
      if (!manualUrl && state.queuedRevision === revision) state.queuedRevision = undefined;
      return scan(tabId, state, revision, manualUrl);
    });
    state.queue = task.catch(() => undefined);
    return task;
  }

  function schedule(tabId: number) {
    const state = stateFor(tabId);
    if (state.timer !== undefined || state.queuedRevision === state.revision) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      state.queuedRevision = state.revision;
      void enqueue(tabId).catch(() => { /* A protected page or a tab that has changed can reject injection. */ });
    }, Math.max(250, 2_500 - (Date.now() - state.lastScan)));
  }

  // Reinjecting is safe. The helpers guard against duplicates and new
  // accessible frames can appear between two captures of the same document.
  async function attachHelpers(tabId: number) {
    const files = ["auto-updates.js", "file-drop.js"];
    await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files })
      .catch(() => browser.scripting.executeScript({ target: { tabId }, files }))
      .catch(() => {});
  }

  browser.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
    if (reason !== "update" || !previousVersion || !/^0\.1\.(19|20|21)$/.test(previousVersion)) return;
    // These builds declared broad required access. Drop it if Chrome retained
    // it as an optional grant when loading the new manifest.
    removeLegacyGrant = browser.permissions.remove({ origins: ["http://*/*", "https://*/*"] }).then(() => {}, () => {});
  });

  browser.permissions.onRemoved.addListener(({ origins }) => {
    if (!origins?.length) return;
    void changeAccess(records => {
      const affected = Object.entries(records).filter(([, origin]) => {
        const scheme = new URL(origin).protocol;
        return origins.includes(websitePattern(origin) ?? "") || origins.includes(`${scheme}//*/*`) || origins.includes("<all_urls>");
      });
      if (!affected.length) return records;
      const next = { ...records };
      for (const [id] of affected) {
        const tabId = Number(id);
        invalidate(tabId);
        delete next[id];
        void browser.tabs.sendMessage(tabId, { type: "stashwell.capture.stop" }).catch(() => {});
      }
      return next;
    }).catch(() => {});
  });

  browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
    const previous = activeTabs.get(windowId);
    if (previous !== undefined && previous !== tabId) invalidate(previous);
    activeTabs.set(windowId, tabId);
    void browser.tabs.get(tabId).then(async tab => {
      if (!tab.active || !isCapturablePage(tab.url) || tab.status !== "complete" || tab.pendingUrl) return;
      if (await approved(tabId, tab.url)) schedule(tabId);
    }).catch(() => {});
  });
  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status === "loading" || change.url !== undefined) {
      invalidate(tabId);
      const destination = change.url ?? tab.pendingUrl ?? tab.url;
      if (destination) void clearAccess(tabId, websiteOrigin(destination)).catch(() => {});
    }
    if (tab.active && tab.status === "complete" && isCapturablePage(tab.url) &&
      (change.url !== undefined || change.status === "complete" || change.favIconUrl !== undefined || change.title !== undefined)) {
      void approved(tabId, tab.url).then(allowed => { if (allowed) schedule(tabId); }).catch(() => {});
    }
  });
  const forgetTab = (tabId: number) => {
    invalidate(tabId);
    queues.delete(tabId);
    void clearAccess(tabId).catch(() => {});
  };
  browser.tabs.onRemoved.addListener(forgetTab);
  browser.tabs.onReplaced.addListener((_, removedId) => forgetTab(removedId));
  browser.windows.onRemoved.addListener(windowId => activeTabs.delete(windowId));
  browser.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== browser.runtime.id) return;
    if (message?.type === "stashwell.capture.changed" && sender.tab?.id !== undefined) {
      const { id, url, active } = sender.tab;
      void approved(id, url).then(watching => {
        if (watching && active) schedule(id);
        reply({ watching });
      }, () => reply({ watching: false }));
      return true;
    }
    if (sender.url !== `chrome-extension://${browser.runtime.id}/index.html`) return;
    if (message?.type === "stashwell.library.prepare") {
      void library.prepare().then(() => reply({ prepared: true }), () => reply({ prepared: false }));
      return true;
    }
    if (message?.type !== "stashwell.capture.refresh") return;
    if (typeof message.tabId !== "number" || !isCapturablePage(message.url)) return;
    void enqueue(message.tabId, message.url).then(
      capture => reply(capture ? { capture } : { error: "The page changed or is still loading. Try again on the current tab." }),
      error => reply({ error: /access|permission|restricted/i.test(String(error))
        ? "Allow website access to scan this tab. Check Stashwell’s site access in Chrome if the page remains blocked." : "The page could not be scanned. Try again." }),
    );
    return true;
  });
}

startBackgroundCapture((globalThis as typeof globalThis & { chrome: Browser }).chrome);
