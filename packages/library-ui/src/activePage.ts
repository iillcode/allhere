import { CAPTURE_ACCESS_KEY, websiteOrigin, websitePattern } from "./websiteAccess";

export type ActivePage = {
  tabId?: number;
  url?: string;
  title?: string;
  faviconUrl?: string;
  siteAccess?: boolean;
  automaticUpdates?: boolean;
  loading: boolean;
  revision: number;
};

export function isCapturablePage(url?: string): url is string {
  return Boolean(url && /^https?:\/\//i.test(url) && !/^https?:\/\/(?:chromewebstore\.google\.com(?:[/:?#]|$)|chrome\.google\.com\/webstore(?:[/?#]|$))/i.test(url));
}

export type BrowserTab = { id?: number; windowId?: number; url?: string; pendingUrl?: string; title?: string; favIconUrl?: string; status?: string; active?: boolean };
type BrowserEvent<T extends (...args: never[]) => void> = {
  addListener: (listener: T) => void;
  removeListener: (listener: T) => void;
};
type StorageChange = { newValue?: unknown };
export type ActivePageBrowser = {
  tabs?: {
    query: (query: { active?: boolean; lastFocusedWindow?: boolean; currentWindow?: boolean }) => Promise<BrowserTab[]>;
    onActivated?: BrowserEvent<(info: { tabId: number; windowId: number }) => void>;
    onUpdated?: BrowserEvent<(tabId: number, change: { status?: string; url?: string; favIconUrl?: string; title?: string }, tab: BrowserTab) => void>;
    onRemoved?: BrowserEvent<(tabId: number) => void>;
  };
  permissions?: {
    contains?: (permissions: { origins: string[] }) => Promise<boolean>;
    onAdded?: BrowserEvent<() => void>;
    onRemoved?: BrowserEvent<() => void>;
  };
  storage?: {
    session?: { get: (key: string) => Promise<Record<string, unknown>> };
    onChanged?: BrowserEvent<(changes: Record<string, StorageChange>, areaName: string) => void>;
  };
};

/** Tab metadata only: this observer never inspects page content or writes storage. */
export function createActivePageObserver(api: () => ActivePageBrowser | undefined) {
  const revisions = new Map<number, number>();
  const getActivePage = async (): Promise<ActivePage> => {
    const browser = api();
    const [tab] = await browser?.tabs?.query({ active: true, currentWindow: true }) ?? [];
    const url = tab?.pendingUrl ?? tab?.url;
    if (typeof tab?.id === "number" && !revisions.has(tab.id)) revisions.set(tab.id, 0);
    const origin = isCapturablePage(url) ? websiteOrigin(url) : undefined;
    const pattern = websitePattern(origin);
    const [siteAccess, stored] = await Promise.all([
      pattern ? browser?.permissions?.contains?.({ origins: [pattern] }).catch(() => false) : false,
      origin ? browser?.storage?.session?.get(CAPTURE_ACCESS_KEY).catch(() => undefined) : undefined,
    ]);
    const allowed = stored?.[CAPTURE_ACCESS_KEY] as Record<string, string> | undefined;
    return {
      tabId: tab?.id, url, title: tab?.title, faviconUrl: tab?.favIconUrl,
      siteAccess: Boolean(siteAccess),
      automaticUpdates: Boolean(siteAccess && tab?.id !== undefined && origin && allowed?.[tab.id] === origin),
      loading: tab?.status === "loading", revision: tab?.id === undefined ? 0 : revisions.get(tab.id) ?? 0,
    };
  };

  const subscribeActivePage = (listener: (page: ActivePage) => void) => {
    const browser = api();
    let alive = true;
    let sequence = 0;
    let activeTabId: number | undefined;
    const refresh = () => {
      const request = ++sequence;
      void getActivePage().then((page) => {
        if (!alive || request !== sequence) return;
        activeTabId = page.tabId;
        listener(page);
      }).catch(() => {
        if (alive && request === sequence) listener({ loading: false, revision: 0 });
      });
    };
    const activated = () => refresh();
    const updated = (tabId: number, change: { status?: string; url?: string; favIconUrl?: string; title?: string }, tab: BrowserTab) => {
      // Keep revisions only for tabs the panel has displayed. Reloading a tab
      // must invalidate its scan even when the URL stays exactly the same.
      if (revisions.has(tabId) && (change.status === "loading" || change.url !== undefined)) {
        revisions.set(tabId, (revisions.get(tabId) ?? 0) + 1);
      }
      if (tabId === activeTabId || tab.active) refresh();
    };
    const removed = (tabId: number) => {
      revisions.delete(tabId);
      if (tabId === activeTabId) refresh();
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const accessChanged = (changes: Record<string, StorageChange>, areaName: string) => {
      if (areaName === "session" && changes[CAPTURE_ACCESS_KEY]) refresh();
    };
    browser?.tabs?.onActivated?.addListener(activated);
    browser?.tabs?.onUpdated?.addListener(updated);
    browser?.tabs?.onRemoved?.addListener(removed);
    browser?.permissions?.onAdded?.addListener(refresh);
    browser?.permissions?.onRemoved?.addListener(refresh);
    browser?.storage?.onChanged?.addListener(accessChanged);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    refresh();
    return () => {
      alive = false;
      browser?.tabs?.onActivated?.removeListener(activated);
      browser?.tabs?.onUpdated?.removeListener(updated);
      browser?.tabs?.onRemoved?.removeListener(removed);
      browser?.permissions?.onAdded?.removeListener(refresh);
      browser?.permissions?.onRemoved?.removeListener(refresh);
      browser?.storage?.onChanged?.removeListener(accessChanged);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  };
  return { getActivePage, subscribeActivePage };
}
