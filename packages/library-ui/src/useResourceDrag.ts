import { useEffect, useRef, useState, type DragEvent, type HTMLAttributes } from "react";
import type { ResourceKind } from "@allhere/core";
import { loadResourceFile } from "./resourceFiles";

type Item = { id: string; url: string; kind: ResourceKind | "page" };
type Entry = { file?: File; pending?: Promise<File>; touched: number; error?: string };
type Ticket = { file: File; expires: number };
const prefix = "application/x-allhere-file-";
const chunkBytes = 1024 * 1024;
type Sender = { id?: string; url?: string; tab?: { id?: number } };
type Runtime = { id: string; onMessage: {
  addListener: (listener: (message: Record<string, unknown>, sender: Sender, reply: (data: unknown) => void) => boolean | undefined) => void;
  removeListener: (listener: (message: Record<string, unknown>, sender: Sender, reply: (data: unknown) => void) => boolean | undefined) => void;
} };

export function useResourceDrag<T extends Item>(filename: (item: T, extension?: string) => string, notify: (message: string) => void) {
  const cache = useRef(new Map<string, Entry>());
  const tickets = useRef(new Map<string, Ticket>());
  const controllers = useRef(new Set<AbortController>());
  const [statuses, setStatuses] = useState<Record<string, "loading" | "ready" | "error">>({});
  const mounted = useRef(true);
  const keyFor = (item: T) => `${item.kind}\u0000${item.url}`;
  const update = (key: string, status: "loading" | "ready" | "error") => { if (mounted.current) setStatuses(previous => ({ ...previous, [key]: status })); };

  useEffect(() => {
    mounted.current = true;
    const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: Runtime } }).chrome?.runtime;
    // Only a page that receives this random drag capability can request its bytes.
    const listener = (message: Record<string, unknown>, sender: Sender, reply: (data: unknown) => void) => {
      if (!runtime || sender.id !== runtime.id || !sender.tab || !/^https?:\/\//.test(sender.url || "")) return;
      if (message.type !== "allhere.drag.read") return;
      const ticket = tickets.current.get(String(message.token));
      if (!ticket || ticket.expires < Date.now()) { reply({ error: "This drag expired. Drag the file from Allhere again." }); return; }
      const file = ticket.file;
      if (message.offset === undefined) { reply({ name: file.name, mime: file.type, size: file.size, chunkBytes }); return; }
      const offset = message.offset;
      if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset >= file.size || offset % chunkBytes !== 0) { reply({ error: "Invalid file chunk." }); return; }
      const reader = new FileReader();
      reader.onload = () => reply({ bytes: String(reader.result).split(",")[1] });
      reader.onerror = () => reply({ error: "The file could not be read. Drag it again." });
      reader.readAsDataURL(file.slice(offset, offset + chunkBytes));
      return true;
    };
    runtime?.onMessage.addListener(listener);
    const cleanup = window.setInterval(() => {
      for (const [token, ticket] of tickets.current) if (ticket.expires < Date.now()) tickets.current.delete(token);
    }, 15_000);
    return () => {
      mounted.current = false;
      runtime?.onMessage.removeListener(listener);
      window.clearInterval(cleanup);
      controllers.current.forEach(controller => controller.abort());
      cache.current.clear(); tickets.current.clear();
    };
  }, []);

  const prepare = async (item: T, announce = false): Promise<File | undefined> => {
    if (item.kind === "link" || item.kind === "page") return;
    const key = keyFor(item);
    let entry = cache.current.get(key);
    if (entry?.file) { entry.touched = Date.now(); if (announce) notify(`${entry.file.name} is ready. Drag it into an upload field.`); return entry.file; }
    if (entry?.error && !announce) return;
    if (announce) notify("Preparing the file for dragging…");
    if (!entry?.pending) {
      // Bound retained data and speculative requests; large libraries stay inexpensive.
      if (!announce && controllers.current.size >= 2) return;
      entry = { touched: Date.now() };
      cache.current.set(key, entry);
      const current = entry;
      const controller = new AbortController();
      controllers.current.add(controller);
      update(key, "loading");
      current.pending = loadResourceFile(item.url, item.kind, controller.signal).then(({ blob, extension }) => {
        if (!mounted.current || controller.signal.aborted) throw new Error("File preparation was cancelled.");
        const file = new File([blob], filename(item, extension), { type: blob.type, lastModified: Date.now() });
        current.file = file; current.pending = undefined;
        let retained = [...cache.current.values()].reduce((sum, cached) => sum + (cached.file?.size || 0), 0);
        for (const [oldKey, old] of [...cache.current.entries()].sort((a, b) => a[1].touched - b[1].touched)) {
          if (old === current || old.pending) continue;
          if (retained <= 96 * 1024 * 1024 && cache.current.size <= 12) break;
          retained -= old.file?.size || 0; cache.current.delete(oldKey);
          if (mounted.current) setStatuses(previous => { const next = { ...previous }; delete next[oldKey]; return next; });
        }
        update(key, "ready"); return file;
      }).catch(error => {
        current.pending = undefined; current.error = error instanceof Error ? error.message : "This file could not be prepared.";
        update(key, "error"); throw error;
      }).finally(() => controllers.current.delete(controller));
    }
    try { const file = await entry.pending; if (announce && file) notify(`${file.name} is ready. Drag it into an upload field.`); return file; }
    catch (error) { if (announce) notify(error instanceof Error ? error.message : "This file could not be prepared."); return; }
  };

  const props = (item: T): HTMLAttributes<HTMLElement> => {
    const status = statuses[keyFor(item)];
    const isUrl = item.kind === "link" || item.kind === "page";
    return {
      draggable: true,
      "aria-description": isUrl ? "Drag to insert this URL" : status === "ready" ? "Ready to drag into an upload field" : "Hover to prepare this file, then drag into an upload field",
      title: isUrl ? "Drag URL" : status === "ready" ? "Drag file to an upload field" : status === "loading" ? "Preparing file…" : "Hover to prepare, then drag file",
      onPointerEnter: () => { void prepare(item); },
      onFocus: () => { void prepare(item); },
      onPointerDown: () => { void prepare(item); },
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (isUrl) {
          if (!/^https?:\/\//i.test(item.url)) { event.preventDefault(); notify("This address cannot be dragged. Use Copy URL instead."); return; }
          event.dataTransfer.clearData();
          event.dataTransfer.setData("text/uri-list", item.url);
          event.dataTransfer.setData("text/plain", item.url);
          event.dataTransfer.effectAllowed = "copyLink"; return;
        }
        const file = cache.current.get(keyFor(item))?.file;
        if (!file) { event.preventDefault(); void prepare(item, true); return; }
        const token = crypto.randomUUID();
        // Keep only a few recent drag capabilities, and never expose source URLs to pages.
        if (tickets.current.size >= 4) tickets.current.delete(tickets.current.keys().next().value!);
        tickets.current.set(token, { file, expires: Date.now() + 120_000 });
        event.dataTransfer.clearData();
        event.dataTransfer.items.add(file);
        if (window.location.protocol === "chrome-extension:") event.dataTransfer.setData(prefix + token, token);
        event.dataTransfer.effectAllowed = "copy";
        event.currentTarget.dataset.dragging = "true";
      },
      onDragEnd: event => { delete event.currentTarget.dataset.dragging; },
    };
  };
  return { props, prepare, status: (item: T) => statuses[keyFor(item)] };
}
