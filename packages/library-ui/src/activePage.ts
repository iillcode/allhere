export type ActivePage = {
  tabId?: number;
  url?: string;
  title?: string;
  faviconUrl?: string;
  siteAccess?: boolean;
  loading: boolean;
  revision: number;
  accessEpoch: number;
};

type BrowserTab = { id?: number; url?: string; pendingUrl?: string; title?: string; favIconUrl?: string; status?: string; active?: boolean };
type BrowserEvent<T extends (...args: never[]) => void> = {
  addListener: (listener: T) => void;
  removeListener: (listener: T) => void;
};
export type ActivePageBrowser = {
  tabs?: {
    query: (query: { active: boolean; lastFocusedWindow?: boolean; currentWindow?: boolean }) => Promise<BrowserTab[]>;
    onActivated?: BrowserEvent<(info: { tabId: number; windowId: number }) => void>;
    onUpdated?: BrowserEvent<(tabId: number, change: { status?: string; url?: string; favIconUrl?: string; title?: string }, tab: BrowserTab) => void>;
    onRemoved?: BrowserEvent<(tabId: number) => void>;
  };
  permissions?: {
    contains?: (permissions: { origins: string[] }) => Promise<boolean>;
    onAdded?: BrowserEvent<() => void>;
    onRemoved?: BrowserEvent<() => void>;
  };
};

/** Tab metadata only: this observer never inspects page content or writes storage. */
export function createActivePageObserver(api: () => ActivePageBrowser | undefined) {
  const revisions = new Map<number, number>();
  const origins = new Map<number, string | undefined>();
  const accessEpochs = new Map<number, number>();
  const trackAccess = (tabId: number, url?: string) => {
    let origin: string | undefined;
    try { if (url && /^https?:\/\//i.test(url)) origin = new URL(url).origin; } catch { /* No readable website access. */ }
    if (origins.has(tabId) && origins.get(tabId) !== origin) accessEpochs.set(tabId, (accessEpochs.get(tabId) ?? 0) + 1);
    origins.set(tabId, origin);
  };

  const getActivePage = async (): Promise<ActivePage> => {
    const browser = api();
    const [tab] = await browser?.tabs?.query({ active: true, currentWindow: true }) ?? [];
    const url = tab?.pendingUrl ?? tab?.url;
    if (typeof tab?.id === "number" && !revisions.has(tab.id)) revisions.set(tab.id, 0);
    if (typeof tab?.id === "number") trackAccess(tab.id, url);
    let siteAccess = false;
    try {
      if (url && /^https?:\/\//i.test(url)) {
        const site = new URL(url);
        siteAccess = await browser?.permissions?.contains?.({ origins: [`${site.protocol}//${site.hostname}/*`] }) ?? false;
      }
    } catch { /* Browser and restricted pages do not have optional site access. */ }
    return {
      tabId: tab?.id, url, title: tab?.title, faviconUrl: tab?.favIconUrl, siteAccess,
      loading: tab?.status === "loading", revision: tab?.id === undefined ? 0 : revisions.get(tab.id) ?? 0,
      accessEpoch: tab?.id === undefined ? 0 : accessEpochs.get(tab.id) ?? 0,
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
        if (alive && request === sequence) listener({ loading: false, revision: 0, accessEpoch: 0 });
      });
    };
    const activated = () => refresh();
    const updated = (tabId: number, change: { status?: string; url?: string; favIconUrl?: string; title?: string }, tab: BrowserTab) => {
      if (revisions.has(tabId)) trackAccess(tabId, tab.pendingUrl ?? tab.url);
      // Keep revisions only for tabs the panel has displayed. Reloading a tab
      // must invalidate its scan even when the URL stays exactly the same.
      if (revisions.has(tabId) && (change.status === "loading" || change.url !== undefined)) {
        revisions.set(tabId, (revisions.get(tabId) ?? 0) + 1);
      }
      if (tabId === activeTabId || tab.active) refresh();
    };
    const removed = (tabId: number) => {
      revisions.delete(tabId);
      origins.delete(tabId);
      accessEpochs.delete(tabId);
      if (tabId === activeTabId) refresh();
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const revoked = () => {
      // Removing any optional site grant ends automatic-update consent. File
      // access must never silently keep a previously authorized session alive.
      for (const tabId of revisions.keys()) accessEpochs.set(tabId, (accessEpochs.get(tabId) ?? 0) + 1);
      refresh();
    };
    browser?.tabs?.onActivated?.addListener(activated);
    browser?.tabs?.onUpdated?.addListener(updated);
    browser?.tabs?.onRemoved?.addListener(removed);
    browser?.permissions?.onAdded?.addListener(refresh);
    browser?.permissions?.onRemoved?.addListener(revoked);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    refresh();
    return () => {
      alive = false;
      browser?.tabs?.onActivated?.removeListener(activated);
      browser?.tabs?.onUpdated?.removeListener(updated);
      browser?.tabs?.onRemoved?.removeListener(removed);
      browser?.permissions?.onAdded?.removeListener(refresh);
      browser?.permissions?.onRemoved?.removeListener(revoked);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  };
  return { getActivePage, subscribeActivePage, getRevision: (tabId: number) => revisions.get(tabId) ?? 0 };
}
