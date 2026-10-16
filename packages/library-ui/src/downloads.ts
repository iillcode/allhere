import { useEffect, useState } from "react";
import { requestWebsiteAccess } from "./websiteAccess";

export type DownloadJob = {
  id: string;
  title: string;
  filename: string;
  state: "preparing" | "queued" | "downloading" | "processing" | "saving" | "complete" | "failed" | "cancelled";
  received: number;
  total: number;
  error?: string;
  browserId?: number;
  createdAt: number;
  kind?: string;
  url?: string;
  permissionOrigins?: string[];
};
export type DownloadInput = { url: string; title: string; filename: string; kind: string; sourcePage?: string };
type ChromeApi = {
  runtime: { sendMessage: (message: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string }> };
  storage: { local: { get: (key: string) => Promise<Record<string, unknown>> }; onChanged: {
    addListener: (listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => void;
    removeListener: (listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => void;
  } };
};
const api = () => (globalThis as typeof globalThis & { chrome?: ChromeApi }).chrome;
// Matches the original worker key so download history survives the rename.
const KEY = "allhere.downloads.v1";
export const downloading = (job: DownloadJob) => ["preparing", "queued", "downloading", "processing", "saving"].includes(job.state);

async function message(action: string, payload: Record<string, unknown> = {}) {
  const chrome = api();
  if (!chrome?.runtime) throw new Error("Downloads are available in the installed Stashwell extension.");
  const response = await chrome.runtime.sendMessage({ type: `stashwell.download.${action}`, ...payload });
  if (!response?.ok) throw new Error(response?.error || "The download could not start. Reload the extension and try again.");
  return response.result;
}

export function youtubeId(value: string) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return undefined;
    const host = url.hostname.toLowerCase();
    const id = host === "youtu.be" ? url.pathname.slice(1).split("/")[0]
      : ["youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com", "youtube-nocookie.com"].includes(host)
        ? url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/)?.[1] : undefined;
    return id && /^[\w-]{11}$/.test(id) ? id : undefined;
  } catch { return undefined; }
}

export function useDownloads(enabled: boolean) {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  useEffect(() => {
    const chrome = api();
    if (!enabled || !chrome?.storage) return;
    let alive = true;
    const update = (value: unknown) => { if (alive && Array.isArray(value)) setJobs(value as DownloadJob[]); };
    void chrome.storage.local.get(KEY).then(result => update(result[KEY])).catch(() => {});
    const change = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && changes[KEY]) update(changes[KEY].newValue);
    };
    chrome.storage.onChanged.addListener(change);
    void message("refresh").catch(() => {});
    return () => { alive = false; chrome.storage.onChanged.removeListener(change); };
  }, [enabled]);
  const hasActive = jobs.some(downloading);
  useEffect(() => {
    if (!enabled || !hasActive) return;
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void message("refresh").catch(() => {}).finally(() => { pending = false; });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [enabled, hasActive]);
  return {
    jobs,
    // Call directly from a click handler, before awaiting anything: Chrome requires a user gesture.
    allowAccess: (origins?: string[]) => origins?.length
      ? requestWebsiteAccess(origins)
      : Promise.reject(new Error("Choose the resource again to request access to its website.")),
    retry: async (job: DownloadJob) => {
      if (!job.url) throw new Error("Choose this resource again to retry the download.");
      const result = await message("start", { input: { url: job.url, title: job.title, filename: job.filename, kind: job.kind || "other" } });
      await message("dismiss", { id: job.id });
      return result;
    },
    start: async (input: DownloadInput) => {
      if (!input.url.startsWith("blob:")) return message("start", { input }) as Promise<DownloadJob>;
      const job = await message("register", { input }) as DownloadJob;
      const anchor = document.createElement("a");
      anchor.href = input.url;
      anchor.download = input.filename;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); }
      return job;
    },
    cancel: async (id: string) => { await message("cancel", { id }); },
    dismiss: async (id: string) => { await message("dismiss", { id }); },
    show: async (browserId: number) => { await message("show", { browserId }); },
  };
}
