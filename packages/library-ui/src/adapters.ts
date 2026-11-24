import { LIBRARY_STORAGE_KEY, type PageCapture } from "@stashwell/core";
import { CAPTURE_EXCLUSIONS_KEY, normalizeCaptureExclusions, type CaptureExclusions } from "./libraryManagement";
import { createActivePageObserver, isCapturablePage, type ActivePage, type ActivePageBrowser, type BrowserTab } from "./activePage";
import { createExtensionLibrary, normalizeStored, type LegacyLibraryStorage, type LibraryMutation, type LibrarySnapshot } from "./extensionLibrary";
import type { CaptureSummary } from "./backgroundCapture";
import { requestWebsiteAccess, websiteOrigin } from "./websiteAccess";

export type LibraryAdapter = {
  load: () => Promise<PageCapture[]>;
  save: (captures: PageCapture[], exclusions?: CaptureExclusions) => Promise<void>;
  updateLibrary?: <T extends LibrarySnapshot>(mutate: LibraryMutation<T>) => Promise<T>;
  subscribe: (listener: (captures: PageCapture[]) => void) => () => void;
  loadExclusions?: () => Promise<CaptureExclusions>;
  subscribeExclusions?: (listener: (exclusions: CaptureExclusions) => void) => () => void;
  captureCurrentPage?: (page: ActivePage) => Promise<CaptureSummary>;
  requestCaptureAccess?: (page: ActivePage) => Promise<boolean>;
  getActivePage?: () => Promise<ActivePage>;
  subscribeActivePage?: (listener: (page: ActivePage) => void) => () => void;
  goToSourceTab?: (pageUrl: string) => Promise<void>;
};

type StorageChange = { newValue?: unknown };
type ChromeLike = ActivePageBrowser & {
  tabs?: ActivePageBrowser["tabs"] & {
    create: (properties: { url: string; active: true }) => Promise<BrowserTab>;
    update: (id: number, properties: { active: true }) => Promise<BrowserTab | undefined>;
  };
  windows?: {
    update: (id: number, properties: { focused: true }) => Promise<unknown>;
  };
  runtime?: {
    sendMessage: (message: unknown) => Promise<{ capture?: CaptureSummary; prepared?: boolean; error?: string }>;
  };
  storage?: {
    local?: LegacyLibraryStorage;
    onChanged?: {
      addListener: (listener: (changes: Record<string, StorageChange>, areaName: string) => void) => void;
      removeListener: (listener: (changes: Record<string, StorageChange>, areaName: string) => void) => void;
    };
  };
};

function chromeApi(): ChromeLike | undefined {
  return (globalThis as typeof globalThis & { chrome?: ChromeLike }).chrome;
}

export function createWebAdapter(): LibraryAdapter {
  const load = async () => {
    if (typeof window === "undefined") return [];
    try {
      return normalizeStored(JSON.parse(window.localStorage.getItem(LIBRARY_STORAGE_KEY) ?? "[]"));
    } catch {
      return [];
    }
  };

  return {
    load,
    loadExclusions: async () => {
      if (typeof window === "undefined") return normalizeCaptureExclusions(null);
      try { return normalizeCaptureExclusions(JSON.parse(window.localStorage.getItem(CAPTURE_EXCLUSIONS_KEY) ?? "null")); }
      catch { return normalizeCaptureExclusions(null); }
    },
    save: async (captures, exclusions) => {
      if (typeof window !== "undefined") {
        if (exclusions) window.localStorage.setItem(CAPTURE_EXCLUSIONS_KEY, JSON.stringify(exclusions));
        window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(captures));
        window.dispatchEvent(new CustomEvent("stashwell-library-updated", { detail: captures }));
        if (exclusions) window.dispatchEvent(new CustomEvent("stashwell-exclusions-updated", { detail: exclusions }));
      }
    },
    subscribeExclusions: (listener) => {
      if (typeof window === "undefined") return () => undefined;
      const handler = (event: Event) => listener((event as CustomEvent<CaptureExclusions>).detail);
      window.addEventListener("stashwell-exclusions-updated", handler);
      return () => window.removeEventListener("stashwell-exclusions-updated", handler);
    },
    subscribe: (listener) => {
      if (typeof window === "undefined") return () => undefined;
      const handler = (event: Event) => {
        listener((event as CustomEvent<PageCapture[]>).detail ?? []);
      };
      window.addEventListener("stashwell-library-updated", handler);
      return () => window.removeEventListener("stashwell-library-updated", handler);
    },
  };
}

export function createExtensionAdapter(): LibraryAdapter {
  const activePages = createActivePageObserver(chromeApi);
  const web = createWebAdapter();
  const browser = chromeApi();
  const tabs = browser?.tabs;
  const storage = browser?.storage?.local;
  const library = storage && createExtensionLibrary(storage, async () => {
    const result = await browser?.runtime?.sendMessage({ type: "stashwell.library.prepare" });
    if (!result?.prepared) throw new Error("The saved library could not be upgraded.");
  });

  return {
    getActivePage: activePages.getActivePage,
    subscribeActivePage: activePages.subscribeActivePage,
    goToSourceTab: tabs?.create && tabs.update ? async pageUrl => {
      if (!websiteOrigin(pageUrl)) throw new Error("This source does not have a web address.");
      const url = new URL(pageUrl).href;
      const matches = (tab: BrowserTab) => (tab.pendingUrl ?? tab.url) === url;
      const current = (await tabs.query({ currentWindow: true })).filter(matches);
      const candidates = current.length ? current : (await tabs.query({})).filter(matches);
      const existing = candidates.find(tab => tab.active) ?? candidates[0];
      if (existing?.id !== undefined) {
        const activated = await tabs.update(existing.id, { active: true }).catch(() => undefined);
        if (activated && matches(activated)) {
          if (activated.windowId !== undefined) await browser?.windows?.update(activated.windowId, { focused: true });
          return;
        }
      }
      await tabs.create({ url, active: true });
    } : undefined,
    requestCaptureAccess: page => page.siteAccess ? Promise.resolve(true) : requestWebsiteAccess([page.url]),
    updateLibrary: library ? (mutate) => library.update(mutate) : undefined,
    load: library ? async () => (await library.load()).captures : web.load,
    loadExclusions: library ? library.loadExclusions : web.loadExclusions,
    subscribeExclusions: library ? listener => library.subscribe(snapshot => listener(snapshot.exclusions)) : web.subscribeExclusions,
    save: async (captures, exclusions) => {
      if (library) await library.update((_, current) => ({ captures, exclusions: exclusions ?? current }));
      else await web.save(captures, exclusions);
    },
    subscribe: library ? listener => library.subscribe(snapshot => listener(snapshot.captures)) : web.subscribe,
    captureCurrentPage: async (page) => {
      if (page.tabId === undefined || !isCapturablePage(page.url)) {
        throw new Error("Open a regular webpage to scan its resources.");
      }
      const runtime = chromeApi()?.runtime;
      if (!runtime) throw new Error("Capture is available from the installed Chrome side panel.");
      const current = await activePages.getActivePage();
      if (current.tabId !== page.tabId || current.url !== page.url || current.revision !== page.revision || current.loading) {
        throw new Error("The active page changed. Try again on the current tab.");
      }
      const result = await runtime.sendMessage({ type: "stashwell.capture.refresh", tabId: page.tabId, url: page.url });
      if (!result?.capture) throw new Error(result?.error || "The page could not be scanned. Try again.");
      return result.capture;
    },
  };
}
