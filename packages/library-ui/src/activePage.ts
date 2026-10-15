export type ActivePage = {
  tabId?: number;
  url?: string;
  title?: string;
  faviconUrl?: string;
  loading: boolean;
  revision: number;
};

type BrowserTab = { id?: number; url?: string; title?: string; favIconUrl?: string; status?: string };
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
  runtime?: {
    onMessage?: BrowserEvent<(message: { type?: string }) => void>;
  };
};

/** Tab metadata only: this observer never inspects page content or writes storage. */
export function createActivePageObserver(api: () => ActivePageBrowser | undefined) {
  const revisions = new Map<number, number>();

  const getActivePage = async (): Promise<ActivePage> => {
    const [tab] = await api()?.tabs?.query({ active: true, currentWindow: true }) ?? [];
    if (typeof tab?.id === "number" && !revisions.has(tab.id)) revisions.set(tab.id, 0);
    return {
      tabId: tab?.id, url: tab?.url, title: tab?.title, faviconUrl: tab?.favIconUrl,
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
    const updated = (tabId: number, change: { status?: string; url?: string; favIconUrl?: string; title?: string }) => {
      // Keep revisions only for tabs the panel has displayed. Reloading a tab
      // must invalidate its scan even when the URL stays exactly the same.
      if (revisions.has(tabId) && (change.status === "loading" || change.url !== undefined)) {
        revisions.set(tabId, (revisions.get(tabId) ?? 0) + 1);
      }
      if (tabId === activeTabId) refresh();
    };
    const removed = (tabId: number) => {
      revisions.delete(tabId);
      if (tabId === activeTabId) refresh();
    };
    const invoked = (message: { type?: string }) => {
      if (message?.type === "allhere.tab.invoked") refresh();
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    browser?.tabs?.onActivated?.addListener(activated);
    browser?.tabs?.onUpdated?.addListener(updated);
    browser?.tabs?.onRemoved?.addListener(removed);
    browser?.runtime?.onMessage?.addListener(invoked);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    refresh();
    return () => {
      alive = false;
      browser?.tabs?.onActivated?.removeListener(activated);
      browser?.tabs?.onUpdated?.removeListener(updated);
      browser?.tabs?.onRemoved?.removeListener(removed);
      browser?.runtime?.onMessage?.removeListener(invoked);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  };
  return { getActivePage, subscribeActivePage, getRevision: (tabId: number) => revisions.get(tabId) ?? 0 };
}
