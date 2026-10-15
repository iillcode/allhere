import { useEffect, useRef, useState } from "react";
import type { LibraryAdapter } from "./adapters";
import type { ActivePage } from "./activePage";

type Session = { origin: string; accessEpoch: number };
export type AutoCaptureRequest = { page: ActivePage; isCurrent: () => boolean; followTab: boolean };
const originOf = (page?: ActivePage) => {
  try { if (page?.url && /^https?:\/\//i.test(page.url)) return new URL(page.url).origin; } catch { /* No website access. */ }
};

export function useAutoUpdates({ adapter, page, suspended, onCapture, onError }: {
  adapter: LibraryAdapter; page: ActivePage; suspended: boolean;
  onCapture: (request: AutoCaptureRequest) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [sessions, setSessions] = useState<Map<number, Session>>(() => new Map());
  const sessionsRef = useRef(sessions);
  const [visible, setVisible] = useState(() => typeof document !== "undefined" && document.visibilityState === "visible");
  const visibleRef = useRef(visible);
  const generation = useRef(0);
  const panelSession = useRef(0);
  const callbacks = useRef({ onCapture, onError });
  callbacks.current = { onCapture, onError };
  const previousContext = useRef("");
  const changeSessions = (change: (current: Map<number, Session>) => Map<number, Session>) => {
    const next = change(sessionsRef.current);
    sessionsRef.current = next;
    setSessions(next);
  };
  const session = page.tabId === undefined ? undefined : sessions.get(page.tabId);
  const authorized = Boolean(session && session.origin === originOf(page) && session.accessEpoch === page.accessEpoch);
  const eligible = authorized && visible && !suspended && !page.loading;
  const scope = authorized ? `${page.tabId}:${session!.origin}:${session!.accessEpoch}` : "";

  useEffect(() => {
    const visibility = () => {
      const next = document.visibilityState === "visible";
      if (next === visibleRef.current) return;
      visibleRef.current = next;
      // Invalidate in-flight results synchronously, before React re-renders.
      generation.current += 1;
      if (!next) {
        // Chrome can retain a closed panel's document. Clear consent on hide
        // as well as unmount so reopening never silently restarts collection.
        sessionsRef.current = new Map();
        setSessions(new Map());
        panelSession.current += 1;
        previousContext.current = "";
      }
      setVisible(next);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => { generation.current += 1; panelSession.current += 1; document.removeEventListener("visibilitychange", visibility); };
  }, []);

  useEffect(() => {
    generation.current += 1;
    panelSession.current += 1;
    sessionsRef.current = new Map();
    setSessions(new Map());
    return () => { generation.current += 1; panelSession.current += 1; };
  }, [adapter]);

  useEffect(() => {
    const token = ++generation.current;
    let alive = true, timer: number | undefined, stopWatching: (() => void) | undefined;
    let running = false, pending = false, lastRun = 0;
    if (!eligible || !adapter.watchPage || page.tabId === undefined) return;
    const context = `${page.tabId}:${page.url}`;
    let followTab = previousContext.current !== context;
    previousContext.current = context;
    const isCurrent = () => alive && token === generation.current && document.visibilityState === "visible";
    const fail = (error: unknown) => {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : String(error);
      if (/page changed|active page|scan is already in progress/i.test(message)) { schedule(); return; }
      const tabId = page.tabId!;
      generation.current += 1;
      changeSessions(current => {
        const next = new Map(current);
        next.delete(tabId);
        return next;
      });
      callbacks.current.onError(/permission|access|toolbar|blocked|restricted/i.test(message)
        ? "Automatic updates stopped. Click Allhere's toolbar icon on this tab, then choose Scan page."
        : "Automatic updates stopped because this page could not be refreshed. Choose Scan page to restart them.");
    };
    const run = async () => {
      timer = undefined;
      if (!isCurrent()) return;
      if (running) { pending = true; return; }
      pending = false; running = true; lastRun = Date.now();
      try {
        const current = await adapter.getActivePage?.();
        if (!current || !isCurrent() || current.loading || current.tabId !== page.tabId || originOf(current) !== session!.origin || current.accessEpoch !== session!.accessEpoch) return;
        await callbacks.current.onCapture({ page: current, isCurrent, followTab });
        followTab = false;
      } catch (error) { fail(error); }
      finally {
        running = false;
        if (isCurrent() && pending) schedule();
      }
    };
    function schedule() {
      if (!isCurrent()) return;
      pending = true;
      if (timer !== undefined) return;
      timer = window.setTimeout(() => void run(), Math.max(250, 2_500 - (Date.now() - lastRun)));
    }
    void adapter.watchPage(page, schedule).then(stop => {
      if (isCurrent()) stopWatching = stop;
      else stop();
    }).catch(fail);
    return () => {
      alive = false;
      generation.current += 1;
      window.clearTimeout(timer);
      stopWatching?.();
    };
  }, [adapter, eligible, scope, page.tabId, page.url, page.revision, page.accessEpoch]);

  const beginAuthorization = () => {
    const session = panelSession.current;
    return () => session === panelSession.current && visibleRef.current && document.visibilityState === "visible";
  };
  const authorize = async (started: ActivePage | undefined, isSessionCurrent: () => boolean) => {
    if (!started || started.tabId === undefined || !isSessionCurrent()) return;
    const current = await adapter.getActivePage?.().catch(() => undefined);
    const origin = originOf(started);
    if (!isSessionCurrent() || !current || !origin || current.tabId !== started.tabId || originOf(current) !== origin || current.accessEpoch !== started.accessEpoch) return;
    changeSessions(previous => {
      const next = new Map(previous);
      next.set(started.tabId!, { origin, accessEpoch: current.accessEpoch });
      return next;
    });
  };
  return { authorized, beginAuthorization, authorize };
}
