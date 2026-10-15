import { useEffect, useRef, useState } from "react";
import type { LibraryAdapter } from "./adapters";
import type { ActivePage } from "./activePage";

const pageKey = (page: ActivePage) => `${page.tabId}:${page.revision}:${page.accessEpoch}:${page.url ?? ""}`;

export function useActivePage(adapter: LibraryAdapter) {
  const [page, setPage] = useState<ActivePage>({ loading: false, revision: 0, accessEpoch: 0 });
  const [scanned, setScanned] = useState<Map<number, string>>(() => new Map());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setScanned(new Map());
    const unsubscribe = adapter.subscribeActivePage?.(setPage);
    const hidden = () => { if (document.visibilityState === "hidden") setScanned(new Map()); };
    document.addEventListener("visibilitychange", hidden);
    return () => { alive.current = false; unsubscribe?.(); document.removeEventListener("visibilitychange", hidden); };
  }, [adapter]);

  const beginScan = () => adapter.getActivePage?.();
  const finishScan = async (started: ActivePage | undefined, capturedUrl: string, isCurrent: () => boolean) => {
    if (!started || started.tabId === undefined || !isCurrent()) return;
    const current = await adapter.getActivePage?.().catch(() => undefined);
    if (!alive.current || !isCurrent() || !current || pageKey(started) !== pageKey(current) || current.url !== capturedUrl) return;
    setPage(current);
    setScanned((previous) => new Map(previous).set(current.tabId!, pageKey(current)));
  };

  return {
    page, beginScan, finishScan,
    needsScan: page.tabId === undefined || page.loading || scanned.get(page.tabId) !== pageKey(page),
  };
}
