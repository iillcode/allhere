import {
  LIBRARY_STORAGE_KEY,
  createId,
  dedupeResources,
  inspectResourceUrl,
  mergeCaptures,
  type CapturedResource,
  type PageCapture,
  type ResourceKind,
} from "@stashwell/core";
import { CAPTURE_EXCLUSIONS_KEY, normalizeCaptureExclusions, type CaptureExclusions } from "./libraryManagement";
import { createActivePageObserver, type ActivePage, type ActivePageBrowser } from "./activePage";

export type LibraryAdapter = {
  load: () => Promise<PageCapture[]>;
  save: (captures: PageCapture[], exclusions?: CaptureExclusions) => Promise<void>;
  subscribe: (listener: (captures: PageCapture[]) => void) => () => void;
  loadExclusions?: () => Promise<CaptureExclusions>;
  subscribeExclusions?: (listener: (exclusions: CaptureExclusions) => void) => () => void;
  captureCurrentPage?: (requestedPage?: ActivePage) => Promise<PageCapture>;
  getActivePage?: () => Promise<ActivePage>;
  subscribeActivePage?: (listener: (page: ActivePage) => void) => () => void;
  watchPage?: (page: ActivePage, onChange: () => void) => Promise<() => void>;
};

type RawResource = {
  kind: ResourceKind;
  url: string;
  label: string;
  alt?: string;
  description?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  identityUrl?: string;
  variantUrls?: string[];
  position?: [top: number, left: number, documentIndex: number];
};

type RawPageScan = {
  pageUrl: string;
  pageTitle: string;
  faviconUrl?: string;
  resources: RawResource[];
  framePath?: number[];
  frames?: Array<{ index: number; position?: RawResource["position"] }>;
};

function orderedPageResources(scans: RawPageScan[]): RawResource[] {
  const byPath = new Map(scans.filter(scan => scan.framePath).map(scan => [scan.framePath!.join("/"), scan]));
  const visited = new Set<RawPageScan>();
  const resources: RawResource[] = [];
  const visit = (scan: RawPageScan) => {
    if (visited.has(scan)) return;
    visited.add(scan);
    const entries: Array<{ position?: RawResource["position"]; resource?: RawResource; frame?: RawPageScan }> = [
      ...scan.resources.map(resource => ({ position: resource.position, resource })),
      ...(scan.frames ?? []).flatMap(frame => {
        const child = byPath.get([...(scan.framePath ?? []), frame.index].join("/"));
        return child ? [{ position: frame.position, frame: child }] : [];
      }),
    ];
    entries.sort((left, right) => {
      for (let index = 0; index < 3; index++) {
        const difference = (left.position?.[index] ?? Number.MAX_SAFE_INTEGER) - (right.position?.[index] ?? Number.MAX_SAFE_INTEGER);
        if (difference) return difference;
      }
      return 0;
    });
    for (const entry of entries) {
      if (entry.resource) resources.push(entry.resource);
      else if (entry.frame) visit(entry.frame);
    }
  };
  const root = scans.find(scan => scan.framePath?.length === 0) ?? scans[0];
  if (root) visit(root);
  // Keep detached frames' available resources when their parent has changed.
  scans.forEach(visit);
  return resources;
}

type StorageChange = { newValue?: unknown };
type PageWatchPort = {
  disconnect: () => void;
  onMessage: { addListener: (listener: (message: { type?: string }) => void) => void };
  onDisconnect: { addListener: (listener: () => void) => void };
};

type ChromeLike = ActivePageBrowser & {
  tabs?: ActivePageBrowser["tabs"] & {
    connect: (tabId: number, options: { frameId: number; name: string }) => PageWatchPort;
  };
  storage?: {
    local?: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (values: Record<string, unknown>) => Promise<void>;
    };
    onChanged?: {
      addListener: (
        listener: (changes: Record<string, StorageChange>, areaName: string) => void,
      ) => void;
      removeListener: (
        listener: (changes: Record<string, StorageChange>, areaName: string) => void,
      ) => void;
    };
  };
  scripting?: {
    executeScript: (options: {
      target: { tabId: number; allFrames?: boolean };
      func?: () => Promise<RawPageScan>;
      files?: string[];
    }) => Promise<Array<{ frameId?: number; result?: RawPageScan }>>;
  };
};

function chromeApi(): ChromeLike | undefined {
  return (globalThis as typeof globalThis & { chrome?: ChromeLike }).chrome;
}

function normalizeStored(value: unknown): PageCapture[] {
  if (!Array.isArray(value)) return [];
  const browserOnlyProtocols = new Set([
    "brave:", "chrome:", "chrome-extension:", "chrome-untrusted:", "moz-extension:",
  ]);

  return mergeCaptures((value as PageCapture[]).filter(capture => capture && typeof capture.pageUrl === "string" && Array.isArray(capture.resources)).map((capture) => {
    const resources: CapturedResource[] = capture.resources.filter((resource) => {
      if (!resource || typeof resource.url !== "string" || typeof resource.label !== "string") return false;
      try {
        if (browserOnlyProtocols.has(new URL(resource.url).protocol)) return false;
      } catch {
        // Retain legacy URLs that the details panel can still display safely.
      }
      return !/^data:embedded|\[inline payload omitted\]$/i.test(resource.url);
    });

    return { ...capture, resources: dedupeResources(resources) };
  }), []);
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
  const activePage = async () => {
    const api = chromeApi();
    if (!api?.tabs || !api.scripting) throw new Error("Capture is available from the installed Chrome side panel.");
    const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    if (typeof tab?.id !== "number" || !tab.url) {
      throw new Error("Click Stashwell's toolbar icon on this tab, then choose Scan page.");
    }
    if (!/^https?:\/\//i.test(tab.url) || /^https?:\/\/(?:chromewebstore\.google\.com\/|chrome\.google\.com\/webstore(?:\/|$))/i.test(tab.url)) {
      throw new Error("Chrome blocks scanning browser and Store pages. Open a regular webpage, click Stashwell's toolbar icon, then choose Scan page.");
    }
    // The toolbar action grants temporary activeTab access. Scan page uses
    // that access (or a host grant already allowed for a file action), without
    // requesting a persistent site permission or opening a consent prompt.
    return { api, tab: { ...tab, id: tab.id, url: tab.url } };
  };

  const load = async () => {
    const api = chromeApi();
    if (api?.storage?.local) {
      const result = await api.storage.local.get(LIBRARY_STORAGE_KEY);
      return normalizeStored(result[LIBRARY_STORAGE_KEY]);
    }
    return createWebAdapter().load();
  };

  return {
    getActivePage: activePages.getActivePage,
    subscribeActivePage: activePages.subscribeActivePage,
    watchPage: async (page, onChange) => {
      const api = chromeApi();
      if (!api?.tabs?.connect || !api.scripting || page.tabId === undefined) throw new Error("Automatic updates require the installed extension.");
      const tabs = api.tabs;
      const tabId = page.tabId;
      const matches = async () => {
        const current = await activePages.getActivePage();
        return current.tabId === page.tabId && current.url === page.url && current.revision === page.revision && current.accessEpoch === page.accessEpoch;
      };
      if (!await matches()) throw new Error("The active page changed.");
      let stopped = false;
      let connecting = false;
      const ports = new Map<number, PageWatchPort>();
      const connectFrames = async () => {
        if (stopped || connecting) return;
        connecting = true;
        try {
          if (!await matches()) throw new Error("The active page changed.");
          let frames;
          try { frames = await api.scripting!.executeScript({ target: { tabId: page.tabId!, allFrames: true }, files: ["auto-updates.js"] }); }
          catch { frames = await api.scripting!.executeScript({ target: { tabId: page.tabId! }, files: ["auto-updates.js"] }); }
          if (stopped) return;
          if (!await matches()) throw new Error("The active page changed.");
          for (const frameId of new Set(frames.map(frame => frame.frameId ?? 0))) {
            if (ports.has(frameId)) continue;
            const port = tabs.connect(tabId, { name: "stashwell.auto-updates", frameId });
            port.onMessage.addListener(message => {
              if (stopped) return;
              if (message?.type === "frames") void connectFrames().catch(() => onChange());
              if (message?.type === "changed") onChange();
            });
            port.onDisconnect.addListener(() => {
              // Read lastError to consume Chrome's missing-frame diagnostic.
              void (globalThis as typeof globalThis & { chrome?: { runtime?: { lastError?: unknown } } }).chrome?.runtime?.lastError;
              if (ports.get(frameId) === port) ports.delete(frameId);
              if (!stopped) onChange();
            });
            ports.set(frameId, port);
          }
        } finally { connecting = false; }
      };
      try { await connectFrames(); }
      catch (error) {
        stopped = true;
        ports.forEach(port => port.disconnect());
        throw error;
      }
      return () => { stopped = true; ports.forEach(port => port.disconnect()); };
    },
    load,
    loadExclusions: async () => {
      const storage = chromeApi()?.storage?.local;
      if (!storage) return createWebAdapter().loadExclusions!();
      const result = await storage.get(CAPTURE_EXCLUSIONS_KEY);
      return normalizeCaptureExclusions(result[CAPTURE_EXCLUSIONS_KEY]);
    },
    subscribeExclusions: (listener) => {
      const changes = chromeApi()?.storage?.onChanged;
      if (!changes) return createWebAdapter().subscribeExclusions!(listener);
      const handler = (entries: Record<string, StorageChange>, areaName: string) => {
        if (areaName === "local" && entries[CAPTURE_EXCLUSIONS_KEY]) listener(normalizeCaptureExclusions(entries[CAPTURE_EXCLUSIONS_KEY].newValue));
      };
      changes.addListener(handler);
      return () => changes.removeListener(handler);
    },
    save: async (captures, exclusions) => {
      const api = chromeApi();
      if (api?.storage?.local) {
        await api.storage.local.set({ [LIBRARY_STORAGE_KEY]: captures, ...(exclusions ? { [CAPTURE_EXCLUSIONS_KEY]: exclusions } : {}) });
        return;
      }
      await createWebAdapter().save(captures, exclusions);
    },
    subscribe: (listener) => {
      const changes = chromeApi()?.storage?.onChanged;
      if (!changes) return createWebAdapter().subscribe(listener);
      const handler = (entries: Record<string, StorageChange>, areaName: string) => {
        if (areaName === "local" && entries[LIBRARY_STORAGE_KEY]) {
          listener(normalizeStored(entries[LIBRARY_STORAGE_KEY].newValue));
        }
      };
      changes.addListener(handler);
      return () => changes.removeListener(handler);
    },
    captureCurrentPage: async (requestedPage) => {
      const { api, tab } = await activePage();
      const revision = activePages.getRevision(tab.id);
      if (requestedPage && (requestedPage.tabId !== tab.id || requestedPage.url !== tab.url || requestedPage.revision !== revision)) {
        throw new Error("The active page changed. Click Stashwell's toolbar icon on the page you want to collect, then choose Scan page.");
      }
      const [requestedTab] = await api.tabs!.query({ active: true, lastFocusedWindow: true });
      if (requestedTab?.id !== tab.id || requestedTab.url !== tab.url || activePages.getRevision(tab.id) !== revision) {
        throw new Error("The active page changed. Click Stashwell's toolbar icon on the page you want to collect, then choose Scan page.");
      }

      let injected: Array<{ frameId?: number; result?: RawPageScan }>;
      try {
        try {
          injected = await api.scripting!.executeScript({ target: { tabId: tab.id, allFrames: true }, func: collectPageResources });
        } catch {
          // Cross-origin frames may have separate, ungranted site access.
          // Keep the requested page available without requesting those sites.
          injected = await api.scripting!.executeScript({ target: { tabId: tab.id }, func: collectPageResources });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/cannot access contents|permission|restricted|chrome:\/\//i.test(message)) {
          throw new Error("Click Stashwell's toolbar icon on this tab, then choose Scan page. Chrome blocks access to some protected pages.");
        }
        throw new Error(`Could not scan this page${message ? `: ${message}` : ". Try again."}`);
      }

      const scan = injected.find((frame) => frame.frameId === 0)?.result ?? injected[0]?.result;
      if (!scan || !/^https?:\/\//i.test(scan.pageUrl)) {
        throw new Error("This page cannot be scanned. Open a regular webpage and try again.");
      }
      // The page helper is needed only for pages the open panel scans. Avoid
      // installing an always-on content script across every browsing tab.
      try {
        try {
          await api.scripting!.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["file-drop.js"] });
        } catch {
          await api.scripting!.executeScript({ target: { tabId: tab.id }, files: ["file-drop.js"] });
        }
      } catch {
        // Keep the snapshot when a page or frame changes before the optional
        // drag helper can be installed.
      }
      const [currentTab] = await api.tabs!.query({ active: true, lastFocusedWindow: true });
      if (currentTab?.id !== tab.id || currentTab.url !== scan.pageUrl || activePages.getRevision(tab.id) !== revision) {
        throw new Error("The page changed while scanning. Click Stashwell's toolbar icon on the current tab, then choose Scan page.");
      }

      const capturedAt = new Date().toISOString();
      let pageHostname = "";
      try {
        pageHostname = new URL(scan.pageUrl).hostname;
      } catch {
        // A normal HTTP(S) page URL is required above; retain a readable fallback.
      }

      const scans = [...injected].sort((left, right) => (left.frameId ?? 0) - (right.frameId ?? 0))
        .flatMap(frame => frame.result ? [frame.result] : []);
      const resources: CapturedResource[] = dedupeResources(orderedPageResources(scans).map(({ position: _position, ...resource }) => ({
        ...resource,
        id: createId("resource"),
        pageUrl: scan.pageUrl,
        pageTitle: scan.pageTitle,
        capturedAt,
        security: inspectResourceUrl(resource.url, scan.pageUrl, capturedAt),
      })));

      return {
        id: createId("capture"),
        pageUrl: scan.pageUrl,
        pageTitle: scan.pageTitle || pageHostname,
        hostname: pageHostname,
        faviconUrl: scan.faviconUrl || tab.favIconUrl,
        capturedAt,
        resources,
      };
    },
  };
}

async function collectPageResources(): Promise<RawPageScan> {
  const resources: RawResource[] = [];
  const resourceIndexes = new Map<string, number>();
  const blobImages = new Map<string, { kind: "image" | "icon"; label: string; extras: Pick<RawResource, "alt" | "description" | "width" | "height" | "mimeType" | "position" | "identityUrl" | "variantUrls"> }>();
  const spriteIcons: Array<{ clone: SVGSVGElement; kind: "icon" | "image"; label: string; width: number; height: number; position?: RawResource["position"] }> = [];
  const fontIcons = new Map<string, { glyph: string; label: string; family: string; font: string; color: string; direction: CanvasDirection; size: number; position?: RawResource["position"] }>();
  const pageUrl = window.location.href;
  const pageTitle = document.title || window.location.hostname;
  const shadowRootFor = (element: Element): ShadowRoot | null => {
    if (element.shadowRoot) return element.shadowRoot;
    // The extension API also exposes author-created closed roots. Exclude native
    // form/media controls, whose browser internals are not page assets.
    if (!(element instanceof HTMLElement) || /^(?:input|textarea|select|video|audio|img)$/.test(element.localName)) return null;
    try {
      return (globalThis as typeof globalThis & { chrome?: { dom?: { openOrClosedShadowRoot: (element: HTMLElement) => ShadowRoot | null } } })
        .chrome?.dom?.openOrClosedShadowRoot(element) ?? null;
    } catch { return null; }
  };
  let pageElements: Element[] | undefined;
  const queryAll = <T extends Element>(selector: string): T[] => {
    if (pageElements) return pageElements.filter(element => element.matches(selector)) as T[];
    const found: T[] = [];
    const pending = [...document.children].reverse();
    while (pending.length) {
      const element = pending.pop()!;
      if (element.matches(selector)) found.push(element as T);
      const children = [...(shadowRootFor(element)?.children ?? []), ...element.children];
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
    }
    return found;
  };
  const faviconUrl = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href;
  const pendingImages = queryAll<HTMLImageElement>("img").filter((image) =>
    !image.complete && image.loading !== "lazy" && !!(image.currentSrc || image.src),
  );
  if (pendingImages.length) {
    await Promise.race([
      Promise.all(pendingImages.map((image) => new Promise<void>((resolve) => {
        if (image.complete) { resolve(); return; }
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      }))),
      new Promise<void>((resolve) => window.setTimeout(resolve, 1_200)),
    ]);
  }
  const loadedRequests = new Set<string>();
  pageElements = queryAll<Element>("*");
  const documentIndexes = new Map(pageElements.map((element, index) => [element, index]));
  const positions = new WeakMap<Element, NonNullable<RawResource["position"]>>();
  const positionFor = (element: Element): NonNullable<RawResource["position"]> => {
    const previous = positions.get(element);
    if (previous) return previous;
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const rendered = bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && style.visibility !== "collapse";
    const position: NonNullable<RawResource["position"]> = [
      rendered ? Math.round(bounds.top + window.scrollY) : Number.MAX_SAFE_INTEGER,
      rendered ? Math.round(bounds.left + window.scrollX) : Number.MAX_SAFE_INTEGER,
      documentIndexes.get(element) ?? Number.MAX_SAFE_INTEGER,
    ];
    positions.set(element, position);
    return position;
  };
  const firstPosition = (left?: RawResource["position"], right?: RawResource["position"]) => {
    if (!left) return right;
    if (!right) return left;
    for (let index = 0; index < 3; index++) {
      if (left[index] !== right[index]) return left[index] < right[index] ? left : right;
    }
    return left;
  };
  // Frame indices are readable across origins without a new site grant.
  // Each parent supplies the iframe's position among its own resources.
  const framePath: number[] = [];
  try {
    let current: Window = window;
    while (current !== current.top) {
      const parent = current.parent;
      let index = 0;
      while (index < parent.length && parent.frames[index] !== current) index++;
      if (index === parent.length) break;
      framePath.unshift(index);
      current = parent;
    }
  } catch { /* A detached frame can still contribute its available resources. */ }
  const frames = queryAll<HTMLIFrameElement | HTMLFrameElement>("iframe, frame").flatMap(frame => {
    for (let index = 0; index < window.length; index++) {
      if (window.frames[index] === frame.contentWindow) return [{ index, position: positionFor(frame) }];
    }
    return [];
  });
  const baseUrl = document.baseURI || pageUrl;
  const browserOnlyProtocols = new Set(["brave:", "chrome:", "chrome-extension:", "chrome-untrusted:", "moz-extension:"]);
  const iconExtensions = new Set(["ico"]);
  const videoExtensions = new Set(["m3u8", "m4v", "mkv", "mov", "mp4", "mpd", "ogv", "webm"]);
  const audioExtensions = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "wav"]);
  const fontExtensions = new Set(["eot", "otf", "ttf", "woff", "woff2"]);
  const stylesheetExtensions = new Set(["css", "less", "sass", "scss"]);
  const scriptExtensions = new Set(["bat", "c", "cjs", "cpp", "go", "h", "java", "js", "jsx", "mjs", "ps1", "py", "rb", "rs", "sh", "sql", "ts", "tsx", "wasm"]);
  const fontMimeTypes: Record<string, string> = {
    eot: "application/vnd.ms-fontobject",
    otf: "font/otf",
    ttf: "font/ttf",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  const fontFaceMetadata = new Map<string, string>();
  const fileExtensions = new Set([
    "7z", "ai", "apk", "avif", "bmp", "bz2", "csv", "deb", "doc", "docx", "dmg", "epub", "exe", "fig", "gif", "gz", "ico",
    "jpeg", "jpg", "json", "jsonl", "key", "map", "markdown", "md", "msi", "numbers", "odp", "ods", "odt",
    "pages", "pdf", "png", "ppt", "pptx", "psd", "rar", "rpm", "rtf", "sketch", "svg", "tar", "tgz", "tiff", "tsv",
    "txt", "webp", "xls", "xlsx", "xz", "yaml", "yml", "zip",
  ]);

  performance.getEntriesByType("resource").forEach((entry) => {
    const resource = entry as PerformanceResourceTiming & { responseStatus?: number };
    const status = resource.responseStatus;
    if (!resource.name || resource.responseEnd <= 0 || (status !== undefined && status >= 400)) return;
    try {
      const url = new URL(resource.name, pageUrl);
      url.hash = "";
      loadedRequests.add(url.href);
    } catch {
      // Ignore performance entries that are not valid URLs.
    }
  });

  const wasLoaded = (rawUrl: string) => {
    try {
      const url = new URL(rawUrl, pageUrl);
      url.hash = "";
      return loadedRequests.has(url.href);
    } catch {
      return false;
    }
  };

  const add = (
    kind: ResourceKind,
    rawUrl: string | undefined,
    label: string,
    extras: Pick<RawResource, "alt" | "description" | "width" | "height" | "mimeType" | "position" | "identityUrl" | "variantUrls"> = {},
  ) => {
    if (!rawUrl?.trim()) return;
    let url: string;
    try {
      const parsed = new URL(rawUrl, baseUrl);
      if (browserOnlyProtocols.has(parsed.protocol)) return;
      if ((kind === "image" || kind === "icon") && parsed.protocol === "blob:") {
        const previous = blobImages.get(parsed.href);
        blobImages.set(parsed.href, { kind, label, extras: { ...extras, position: firstPosition(previous?.extras.position, extras.position) } });
        return;
      }
      if (kind === "image" && !["http:", "https:", "data:"].includes(parsed.protocol)) return;
      if (kind === "icon" && !["http:", "https:", "data:"].includes(parsed.protocol)) return;
      if (kind === "font" && !["http:", "https:"].includes(parsed.protocol) &&
        !(parsed.protocol === "data:" && /^data:(?:font\/|application\/(?:font-|x-font-|vnd\.ms-fontobject|octet-stream))/i.test(rawUrl))) return;
      if ((kind === "video" || kind === "audio") && !["http:", "https:"].includes(parsed.protocol)) return;
      if (["video", "audio"].includes(kind)) parsed.hash = "";
      if (parsed.protocol === "data:" && (kind === "image" || kind === "icon") && !/^data:image\//i.test(rawUrl)) return;
      url = parsed.href;
    } catch {
      return;
    }

    const visualAsset = kind === "image" || kind === "icon";
    // Collapse exact discoveries here. Shared core identity handles resize
    // variants after frames have been combined, so both paths use one policy.
    const dedupeKey = visualAsset ? `visual:${url}` : `${kind}:${url}`;
    const existingIndex = resourceIndexes.get(dedupeKey);
    const nextResource = { kind, url, label: label.trim() || url, ...extras };
    if (existingIndex !== undefined) {
      const existing = resources[existingIndex];
      const currentArea = (existing.width ?? 0) * (existing.height ?? 0);
      const nextArea = (nextResource.width ?? 0) * (nextResource.height ?? 0);
      if (kind === "font" && existing.kind === "font") {
        const familyLabel = fontFaceMetadata.get(url);
        if (familyLabel) {
          resources[existingIndex] = {
            ...existing,
            label: familyLabel,
            mimeType: extras.mimeType || existing.mimeType,
          };
        }
      } else if (kind === "icon" && existing.kind !== "icon") {
        resources[existingIndex] = nextResource;
      } else if (existing.kind === "icon" && kind === "image" && nextArea > currentArea) {
        resources[existingIndex] = { ...nextResource, kind: "icon" };
      } else if (visualAsset && kind === existing.kind && nextArea > currentArea) {
        resources[existingIndex] = nextResource;
      }
      if (visualAsset) {
        const winner = resources[existingIndex];
        const descriptive = (value: string) => !/^(?:image|icon|page icon|inline svg icon|background image|background icon)$/i.test(value);
        resources[existingIndex] = {
          ...winner,
          label: descriptive(winner.label) ? winner.label : descriptive(nextResource.label) ? nextResource.label : descriptive(existing.label) ? existing.label : winner.label,
          alt: winner.alt || nextResource.alt || existing.alt,
          description: winner.description || nextResource.description || existing.description,
          position: firstPosition(existing.position, nextResource.position),
          identityUrl: existing.identityUrl || nextResource.identityUrl,
          variantUrls: existing.variantUrls || nextResource.variantUrls
            ? [...new Set([...(existing.variantUrls ?? []), ...(nextResource.variantUrls ?? [])])]
            : undefined,
        };
      }
      return;
    }
    resourceIndexes.set(dedupeKey, resources.length);
    resources.push(nextResource);
  };

  const iconName = /(?:^|[\W_])(icons?|favicon|logo|brand)(?:$|[\W_])/i;
  const cleanDescription = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim().slice(0, 280) || undefined;
  const usefulDescription = (value: string | undefined) => value && !/^(?:image|photo|picture|graphic|thumbnail|icon)$/i.test(value);
  queryAll<HTMLLinkElement>(
    'link[rel~="icon"][href], link[rel~="apple-touch-icon"][href], link[rel~="apple-touch-icon-precomposed"][href], link[rel~="mask-icon"][href]',
  ).forEach((link) => {
    add("icon", link.href, link.title || link.getAttribute("sizes") || "Page icon", {
      position: positionFor(link),
      mimeType: link.type || undefined,
    });
  });

  // Follow the srcset token boundaries, including commas inside data URLs.
  const srcsetUrls = (value: string | null): string[] => {
    const urls: string[] = [];
    let rest = value?.trim() || "";
    while (rest) {
      rest = rest.replace(/^[\s,]+/, "");
      const match = rest.match(/^\S+/);
      if (!match) break;
      const token = match[0];
      urls.push(token.replace(/,+$/, ""));
      rest = rest.slice(token.length);
      if (!token.endsWith(",")) rest = rest.replace(/^[^,]*(?:,|$)/, "");
    }
    return urls;
  };
  const lazySources = (element: Element) => ["data-src", "data-original", "data-lazy-src", "data-lazy", "data-url"]
    .map(name => element.getAttribute(name)).filter((value): value is string => !!value?.trim());
  queryAll<HTMLImageElement>("img").forEach((image) => {
    // Broken images are omitted, while pending and lazy images retain their URL
    // so a scan no longer depends on when the browser finished decoding them.
    const broken = image.complete && (!image.naturalWidth || !image.naturalHeight);
    const identityText = [image.alt, image.title, image.getAttribute("aria-label"), image.src, image.className, image.id]
      .filter(Boolean)
      .join(" ");
    const small = (image.naturalWidth || image.width) > 0 && (image.naturalWidth || image.width) <= 96 &&
      (image.naturalHeight || image.height) > 0 && (image.naturalHeight || image.height) <= 96;
    const vectorSource = /^(?:data:image\/svg\+xml)|\.svg(?:[?#]|$)/i.test(image.currentSrc || image.src || lazySources(image)[0] || "");
    const isIcon = iconName.test(identityText) || (small && (vectorSource || image.getAttribute("role") === "presentation" ||
      !!image.closest('button, [role="button"], [role="toolbar"]')));
    const root = image.getRootNode();
    const describedBy = image.getAttribute("aria-describedby")?.split(/\s+/).map((id) =>
      (root instanceof ShadowRoot ? root : image.ownerDocument).getElementById(id)?.textContent?.trim(),
    ).filter(Boolean).join(" ");
    const description = [
      image.getAttribute("alt"),
      image.getAttribute("aria-description"),
      describedBy,
      image.closest("figure")?.querySelector("figcaption")?.textContent,
      image.getAttribute("data-description"),
      image.getAttribute("data-caption"),
      image.getAttribute("title"),
      image.getAttribute("aria-label"),
    ].map(cleanDescription).find(usefulDescription);
    const extras = {
      position: positionFor(image),
      alt: image.alt || undefined,
      description,
      width: image.naturalWidth || image.width || undefined,
      height: image.naturalHeight || image.height || undefined,
      mimeType: image.getAttribute("type") || undefined,
    };
    const deferred = [...lazySources(image), ...srcsetUrls(image.getAttribute("data-srcset")), ...srcsetUrls(image.getAttribute("data-lazy-srcset"))];
    const responsive = srcsetUrls(image.getAttribute("srcset"));
    const candidates = new Set([
      ...deferred,
      ...(!deferred.length && !broken ? [image.getAttribute("src") || image.currentSrc,
        ...(responsive.length || image.parentElement?.localName === "picture" ? [image.currentSrc] : [])] : []),
      ...responsive,
    ]);
    if (image.parentElement?.localName === "picture") for (const source of image.parentElement.querySelectorAll("source")) {
      for (const url of [...srcsetUrls(source.getAttribute("srcset")), ...srcsetUrls(source.getAttribute("data-srcset")), ...lazySources(source)]) candidates.add(url);
    }
    const variantUrls = [...new Set([...candidates].flatMap(url => {
      if (!url?.trim()) return [];
      // Do not re-add the failed active URL from its srcset, but keep alternatives.
      try {
        const parsed = new URL(url, baseUrl);
        if (broken && parsed.href === (image.currentSrc || image.src)) return [];
        if (!["http:", "https:", "blob:", "data:"].includes(parsed.protocol)) return [];
        if (parsed.protocol === "data:" && !/^data:image\//i.test(url)) return [];
        return [parsed.href];
      } catch { return []; }
    }))];
    // src, srcset, and picture sources describe one logical image. Keep all
    // addresses for future matching without adding a card for each alternative.
    // A lazy placeholder is deliberately excluded: many different images use it.
    const active = image.currentSrc || image.src;
    if (active && variantUrls.includes(active)) {
      variantUrls.splice(variantUrls.indexOf(active), 1);
      variantUrls.unshift(active);
    }
    for (const url of variantUrls) {
      add(isIcon ? "icon" : "image", url, image.alt || image.title || (isIcon ? "Page icon" : "Image"), {
        ...extras, identityUrl: variantUrls[0], variantUrls,
      });
    }
  });

  const svgNamespace = "http://www.w3.org/2000/svg";
  const svgProperties = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "color", "stop-color",
    "stop-opacity", "clip-path", "clip-rule", "mask", "filter", "paint-order", "vector-effect", "font-family",
    "font-size", "font-weight", "text-anchor", "dominant-baseline"];
  const styledClone = (source: SVGElement) => {
    const clone = source.cloneNode(true) as SVGElement;
    const originals = [source, ...source.querySelectorAll<SVGElement>("*")];
    const copies = [clone, ...clone.querySelectorAll<SVGElement>("*")];
    originals.forEach((original, index) => {
      const style = getComputedStyle(original);
      for (const name of svgProperties) {
        const value = style.getPropertyValue(name);
        if (value) copies[index].setAttribute(name, value);
      }
      // CSS transforms on child shapes affect their geometry. The root's CSS
      // transform positions the entire icon on the page and is not intrinsic.
      if (index && style.transform !== "none") copies[index].setAttribute("transform", style.transform);
    });
    return clone as SVGSVGElement;
  };
  const fragment = (reference: string): string | undefined => {
    try {
      if (reference.startsWith("#")) return decodeURIComponent(reference.slice(1));
      const url = new URL(reference, baseUrl);
      const current = new URL(pageUrl); current.hash = "";
      const hash = url.hash; url.hash = "";
      if (url.href === current.href && hash) return decodeURIComponent(hash.slice(1));
    } catch { /* Invalid references cannot identify a local definition. */ }
    return undefined;
  };
  const referenceIds = (root: Element) => {
    const ids = new Set<string>();
    for (const element of [root, ...root.querySelectorAll("*")]) for (const attribute of [...element.attributes]) {
      if (attribute.name === "href" || attribute.name.endsWith(":href")) {
        const id = fragment(attribute.value); if (id) ids.add(id);
      }
      for (const match of attribute.value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
        const id = fragment(match[1]); if (id) ids.add(id);
      }
    }
    return ids;
  };
  const embedDefinitions = (clone: SVGSVGElement, source: Document | ShadowRoot) => {
    const visited = new Set<string>();
    const defs = document.createElementNS(svgNamespace, "defs");
    clone.prepend(defs);
    while (true) {
      const pending = [...referenceIds(clone)].filter(id => !visited.has(id));
      if (!pending.length) break;
      for (const id of pending) {
        visited.add(id);
        if ([...clone.querySelectorAll("[id]")].some(element => element.id === id)) continue;
        const original = source.getElementById(id);
        if (original && original.namespaceURI === svgNamespace) defs.append(original.cloneNode(true));
      }
    }
    if (!defs.children.length) defs.remove();
  };
  const serializeSvg = (clone: SVGSVGElement, width: number, height: number) => {
    clone.setAttribute("xmlns", svgNamespace);
    if (!clone.hasAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const viewBox = clone.getAttribute("viewBox")!.trim().split(/[\s,]+/).map(Number);
    clone.setAttribute("width", String(viewBox[2] > 0 ? viewBox[2] : width));
    clone.setAttribute("height", String(viewBox[3] > 0 ? viewBox[3] : height));
    clone.querySelectorAll("script, foreignObject, iframe, object, embed, style, animate, animateTransform, set, title, desc").forEach(node => node.remove());
    const referenced = referenceIds(clone);
    const ids = new Map<string, string>();
    for (const element of [clone, ...clone.querySelectorAll("*")]) if (element.id && referenced.has(element.id)) ids.set(element.id, `asset-${ids.size}`);
    const hasText = !!clone.querySelector("text, tspan, textPath");
    const usesCurrentColor = [clone, ...clone.querySelectorAll("*")].some(element => [...element.attributes].some(attribute => /currentcolor/i.test(attribute.value)));
    const defaults: Record<string, string> = {
      fill: "rgb(0, 0, 0)", "fill-opacity": "1", "fill-rule": "nonzero", stroke: "none", "stroke-width": "1px",
      "stroke-opacity": "1", "stroke-linecap": "butt", "stroke-linejoin": "miter", "stroke-miterlimit": "4",
      "stroke-dasharray": "none", "stroke-dashoffset": "0px", opacity: "1", "stop-color": "rgb(0, 0, 0)",
      "stop-opacity": "1", "clip-path": "none", "clip-rule": "nonzero", mask: "none", filter: "none",
      "paint-order": "normal", "vector-effect": "none",
    };
    const nonInherited = new Set(["opacity", "clip-path", "mask", "filter", "vector-effect", "stop-color", "stop-opacity"]);
    const presentation = new WeakMap<Element, Record<string, string>>();
    for (const element of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        let value = attribute.value.trim();
        if (name.startsWith("on") || /^(?:class|style|role|tabindex|focusable|xml:base)$/.test(name) || /^(?:aria-|data-)/.test(name)) {
          element.removeAttribute(attribute.name); continue;
        }
        if (name === "id") {
          if (ids.has(value)) element.setAttribute("id", ids.get(value)!); else element.removeAttribute("id");
          continue;
        }
        if (name === "href" || name.endsWith(":href")) {
          const id = fragment(value);
          if (id && ids.has(id)) value = `#${ids.get(id)}`;
          else if (!(element.localName === "image" && /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon);base64,[a-z\d+/=\s]+$/i.test(value))) {
            element.removeAttribute(attribute.name); continue;
          }
        } else if (/url\s*\(/i.test(value)) {
          let invalid = false;
          value = value.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (_, reference: string) => {
            const id = fragment(reference);
            if (id && ids.has(id)) return `url(#${ids.get(id)})`;
            invalid = true; return "";
          });
          if (invalid) { element.removeAttribute(attribute.name); continue; }
        }
        if (/javascript:|expression\s*\(/i.test(value)) { element.removeAttribute(attribute.name); continue; }
        element.setAttribute(attribute.name, value);
      }
      const inherited = element.parentElement ? presentation.get(element.parentElement) ?? defaults : defaults;
      const values = { ...inherited };
      for (const name of svgProperties) {
        const value = element.getAttribute(name);
        if (value === null) continue;
        if (!nonInherited.has(name)) values[name] = value;
        if ((!hasText && /^(?:font-|text-anchor|dominant-baseline)/.test(name)) || (!usesCurrentColor && name === "color") ||
          value === (nonInherited.has(name) ? defaults[name] : inherited[name])) element.removeAttribute(name);
      }
      presentation.set(element, values);
      // Deterministic markup deduplicates icons with different React IDs,
      // accessibility labels, CSS classes, attribute order, and rendered sizes.
      const attributes = [...element.attributes].sort((a, b) => a.name.localeCompare(b.name));
      attributes.forEach(attribute => element.removeAttributeNode(attribute));
      attributes.forEach(attribute => attribute.namespaceURI
        ? element.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
        : element.setAttribute(attribute.name, attribute.value));
      for (const child of [...element.childNodes]) if (child.nodeType === Node.COMMENT_NODE ||
        (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim() && !["text", "tspan", "textPath"].includes(element.localName))) child.remove();
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  };
  queryAll<SVGSVGElement>("svg").forEach((svg) => {
    try {
      if (svg.parentElement?.closest("svg") || !svg.querySelector("path, rect, circle, ellipse, line, polyline, polygon, use, image, text")) return;
      const bounds = svg.getBoundingClientRect();
      const width = bounds.width || svg.viewBox.baseVal.width || parseFloat(svg.getAttribute("width") || "0");
      const height = bounds.height || svg.viewBox.baseVal.height || parseFloat(svg.getAttribute("height") || "0");
      if (!(width > 0 && height > 0)) return;
      // A hidden sprite bank only defines symbols; its individual uses are captured.
      if (![...svg.children].some(child => !["defs", "symbol", "style", "title", "desc"].includes(child.localName))) return;
      const semantic = [svg.getAttribute("aria-label"), svg.getAttribute("role"), svg.id, svg.className.baseVal].filter(Boolean).join(" ");
      const clone = styledClone(svg);
      let unresolvedReference = false;
      let externalReference = false;
      clone.querySelectorAll<SVGElement>("use").forEach((use) => {
        const reference = use.getAttribute("href") || use.getAttribute("xlink:href");
        if (!reference) {
          unresolvedReference = true;
          return;
        }
        const localId = fragment(reference);
        if (localId) {
          const symbol = (svg.getRootNode() as Document | ShadowRoot).getElementById(localId);
          if (!symbol) {
            unresolvedReference = true;
            return;
          }
          const viewBox = symbol.getAttribute("viewBox");
          if (viewBox && !clone.hasAttribute("viewBox")) clone.setAttribute("viewBox", viewBox);
          use.setAttribute("href", `#${localId}`);
        } else {
          try {
            use.setAttribute("href", new URL(reference, baseUrl).href);
            use.removeAttribute("xlink:href");
            externalReference = true;
          } catch { unresolvedReference = true; }
        }
      });
      let externalImage = false;
      clone.querySelectorAll<SVGImageElement>("image").forEach((image) => {
        const reference = image.getAttribute("href") || image.getAttribute("xlink:href") || "";
        if (reference && !reference.startsWith("#") && !reference.startsWith("data:")) {
          const description = [svg.getAttribute("aria-label"), svg.querySelector("title")?.textContent]
            .map(cleanDescription).find(usefulDescription);
          add("image", reference, description || "SVG image layer", { description, position: positionFor(svg) });
          externalImage = true;
        } else if (reference && !/^#|^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon);base64,/i.test(reference)) {
          externalImage = true;
        }
      });
      if (unresolvedReference || externalImage) return;
      embedDefinitions(clone, svg.getRootNode() as Document | ShadowRoot);
      const label = svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent?.trim() || svg.id || "Inline SVG icon";
      const kind = (width > 512 || height > 512) && !iconName.test(semantic) ? "image" : "icon";
      if (externalReference) {
        spriteIcons.push({ clone, kind, label, width: Math.round(width), height: Math.round(height), position: positionFor(svg) });
        return;
      }
      add(kind, serializeSvg(clone, width, height), label, {
        position: positionFor(svg),
        width: Math.round(width),
        height: Math.round(height),
        mimeType: "image/svg+xml",
      });
    } catch { /* One malformed SVG must not discard other assets on the page. */ }
  });

  const supportedSource = (media: HTMLMediaElement) =>
    Array.from(media.querySelectorAll<HTMLSourceElement>("source[src]"))
      .find((source) => !source.type || media.canPlayType(source.type) !== "")?.src;

  queryAll<HTMLVideoElement>("video").forEach((video) => {
    add("video", video.currentSrc || video.src || supportedSource(video), video.title || "Video", {
      position: positionFor(video),
      width: video.videoWidth || video.width || undefined,
      height: video.videoHeight || video.height || undefined,
      mimeType: video.querySelector<HTMLSourceElement>("source[src]")?.type || undefined,
    });
  });

  queryAll<HTMLAudioElement>("audio").forEach((audio) => {
    add("audio", audio.currentSrc || audio.src || supportedSource(audio), audio.title || "Audio", { position: positionFor(audio) });
  });

  queryAll<HTMLSourceElement>("video source[src], audio source[src]").forEach((source) => {
    const media = source.parentElement as HTMLMediaElement | null;
    if (!media) return;
    const kind: ResourceKind = media.tagName.toLowerCase() === "video" ? "video" : "audio";
    add(kind, source.src, source.title || source.type || "Media source", {
      position: positionFor(media),
      mimeType: source.type || undefined,
    });
  });

  queryAll<HTMLVideoElement>("video[poster]").forEach((video) => {
    const description = [video.getAttribute("title"), video.getAttribute("aria-label")]
      .map(cleanDescription).find(usefulDescription);
    add("image", video.poster, "Video poster image", { description, position: positionFor(video) });
  });

  queryAll<HTMLIFrameElement>("iframe[src]").forEach((frame) => {
    add("link", frame.src, frame.title || "Embedded page", { position: positionFor(frame) });
  });

  queryAll<HTMLLinkElement>('link[rel~="stylesheet"][href]').forEach((link) => {
    add("stylesheet", link.href, link.title || "Stylesheet", { mimeType: "text/css", position: positionFor(link) });
  });

  queryAll<HTMLScriptElement>("script[src]").forEach((script) => {
    add("script", script.src, script.title || "Script", {
      position: positionFor(script),
      mimeType: script.type || "text/javascript",
    });
  });

  queryAll<HTMLElement>("object[data], embed[src]").forEach((node) => {
    const url = node instanceof HTMLObjectElement ? node.data : (node as HTMLEmbedElement).src;
    add("document", url, node.getAttribute("title") || node.getAttribute("type") || "Embedded file", {
      position: positionFor(node),
      mimeType: node.getAttribute("type") || undefined,
    });
  });

  queryAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    const url = anchor.href;
    const text = anchor.innerText?.replace(/\s+/g, " ").trim();
    let extension = "";
    try {
      const urlExtension = new URL(url).pathname.split("/").pop()?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
      const downloadExtension = anchor.download.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
      extension = downloadExtension || urlExtension;
    } catch {
      // Keep unusual but valid links as links.
    }
    const isIconLink = iconExtensions.has(extension) || (extension === "svg" && iconName.test([
      url, text, anchor.getAttribute("aria-label"), anchor.title,
    ].filter(Boolean).join(" ")));
    const kind: ResourceKind = /^(?:avif|bmp|gif|jpeg|jpg|png|svg|tiff|webp)$/.test(extension) && !isIconLink
      ? "image" : fontExtensions.has(extension)
      ? "font"
      : isIconLink
        ? "icon"
        : videoExtensions.has(extension)
          ? "video"
          : audioExtensions.has(extension)
            ? "audio"
            : stylesheetExtensions.has(extension)
              ? "stylesheet"
              : scriptExtensions.has(extension)
                ? "script"
                : fileExtensions.has(extension)
                  ? "document"
                  : anchor.hasAttribute("download") || (/^[a-z0-9]{1,12}$/.test(extension) && !["htm", "html", "php", "asp", "aspx", "jsp", "cfm"].includes(extension))
                    ? "other"
                    : "link";
    add(kind, url, anchor.download || text || anchor.getAttribute("aria-label") || anchor.title || url, {
      position: positionFor(anchor),
      mimeType: kind === "font"
        ? fontMimeTypes[extension]
        : kind === "icon"
          ? extension === "ico" ? "image/x-icon" : "image/svg+xml"
          : anchor.type || (kind === "document" || kind === "other" || kind === "video" || kind === "audio" || kind === "stylesheet" || kind === "script" ? extension : undefined),
    });
  });

  queryAll<HTMLElement>("*").forEach((element) => {
    for (const pseudo of [null, "::before", "::after"] as const) {
      const style = window.getComputedStyle(element, pseudo);
      // Material/Google Symbols and CSS icon fonts render glyphs, not image URLs.
      // Read the pseudo-element's font as it can differ from its parent (e.g. Font Awesome).
      const fontFamily = style.fontFamily;
      const isFontIcon = /(?:symbols|icons|font\s*awesome|icomoon|glyphicons|ionicons|remixicon)/i.test(fontFamily) ||
        element.matches('mat-icon[data-mat-icon-type="font"], .material-icons, .material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp');
      if (isFontIcon && !element.querySelector("svg") && style.display !== "none") {
        const bounds = element.getBoundingClientRect();
        const content = pseudo ? style.content.match(/^(["'])([\s\S]*)\1$/)?.[2] : undefined;
        const glyph = (pseudo ? content?.replace(/\\([\da-f]{1,6})\s?|\\([\s\S])/gi, (_, hex: string, character: string) =>
          hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : character)
          : element.children.length ? undefined : element.textContent?.trim() ||
            element.getAttribute("fonticon") || element.getAttribute("data-mat-icon-name"))?.trim();
        const size = parseFloat(style.fontSize);
        if (glyph && glyph.length <= 100 && bounds.width > 0 && bounds.height > 0 && Number.isFinite(size) && size > 0) {
          const font = `${style.fontStyle} ${style.fontWeight} ${size}px ${fontFamily}`;
          const key = JSON.stringify([glyph, font, style.color, style.direction]);
          if (!fontIcons.has(key)) fontIcons.set(key, {
            position: positionFor(element),
            glyph, family: fontFamily, font, color: style.color,
            direction: style.direction === "rtl" ? "rtl" : "ltr", size,
            label: element.getAttribute("aria-label") || element.getAttribute("title") ||
              element.getAttribute("data-mat-icon-name") || element.getAttribute("fonticon") ||
              element.closest("button, a")?.getAttribute("aria-label") ||
              (/^[\w -]+$/.test(glyph) ? glyph.replace(/_/g, " ") : "Font icon"),
          });
        }
      }
      const iconProperties = [style.maskImage, style.getPropertyValue("-webkit-mask-image")];
      const imageProperties = [style.backgroundImage, style.content, style.borderImageSource, style.listStyleImage, ...iconProperties];
      for (const imageProperty of imageProperties) {
        if (!imageProperty || imageProperty === "none") continue;
        const isMask = iconProperties.includes(imageProperty);
        // Quoted URLs can contain parentheses; image-set also accepts strings.
        const urls = [...imageProperty.matchAll(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*?))\s*\)/gi)]
          .map(match => match[1] ?? match[2] ?? match[3]);
        if (/image-set\(/i.test(imageProperty)) for (const match of imageProperty.matchAll(/(?:image-set\(|,)\s*["']([^"']+)["']/gi)) urls.push(match[1]);
        for (const rawUrl of urls) {
          const url = rawUrl.replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_, hex: string, character: string) => hex ? String.fromCodePoint(parseInt(hex, 16) || 0xfffd) : character);
          if (!url || url.startsWith("#")) continue;
          const identityText = [element.getAttribute("aria-label"), element.getAttribute("title"), element.className, element.id]
            .filter((value) => typeof value === "string").join(" ");
          const smallVector = /^(?:data:image\/svg\+xml)|\.svg(?:[?#]|$)/i.test(url) && parseFloat(style.width) <= 96 && parseFloat(style.height) <= 96;
          const isIcon = isMask || iconName.test(identityText) || smallVector;
          const description = !isIcon ? [
            element.getAttribute("aria-description"), element.getAttribute("aria-label"),
            element.getAttribute("title"), element.getAttribute("data-description"), element.getAttribute("data-caption"),
          ].map(cleanDescription).find(usefulDescription) : undefined;
          add(isIcon ? "icon" : "image", url, isIcon ? "Background icon" : "Background image", { description, position: positionFor(element) });
        }
      }
    }
  });

  // Wait for each required face before drawing. A missing/blocked face must not
  // become a fallback-font name or a tofu square in the saved library.
  const loadedFonts = new Map<string, boolean>();
  await Promise.all([...fontIcons.values()].map(async (icon) => {
    const key = `${icon.font}:${icon.glyph}`;
    if (loadedFonts.has(key)) return;
    loadedFonts.set(key, false);
    try {
      const faces = await Promise.race([
        document.fonts.load(icon.font, icon.glyph),
        new Promise<FontFace[]>((resolve) => window.setTimeout(() => resolve([]), 1_200)),
      ]);
      loadedFonts.set(key, faces.length > 0 && faces.every((face) => face.status === "loaded"));
    } catch { /* Skip unavailable fonts without failing the rest of the scan. */ }
  }));
  for (const icon of fontIcons.values()) {
    if (!loadedFonts.get(`${icon.font}:${icon.glyph}`)) continue;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) continue;
      context.font = icon.font;
      context.direction = icon.direction;
      const metrics = context.measureText(icon.glyph);
      // A ligature name rendered as ordinary text indicates an unsupported glyph.
      if (/^[a-z][\w_]+$/i.test(icon.glyph) && metrics.width > icon.size * 2.5) continue;
      const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
      const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      if (!(width > 0 && height > 0)) continue;
      const scale = 112 / Math.max(width, height);
      context.scale(scale, scale);
      context.fillStyle = icon.color;
      context.fillText(icon.glyph, (128 / scale - width) / 2 + metrics.actualBoundingBoxLeft,
        (128 / scale - height) / 2 + metrics.actualBoundingBoxAscent);
      if (!context.getImageData(0, 0, 128, 128).data.some((value, index) => index % 4 === 3 && value > 0)) continue;
      add("icon", canvas.toDataURL("image/png"), icon.label, {
        position: icon.position,
        width: 128, height: 128, mimeType: "image/png",
        description: `${icon.label} · ${icon.family.replace(/["']/g, "")} font icon`,
      });
    } catch { /* An individual font icon cannot prevent capturing other resources. */ }
  }

  const stylesheets: CSSStyleSheet[] = [...Array.from(document.styleSheets), ...Array.from(document.adoptedStyleSheets)];
  queryAll<HTMLElement>("*").forEach((element) => {
    const root = shadowRootFor(element);
    if (root) stylesheets.push(...root.styleSheets, ...root.adoptedStyleSheets);
  });
  const visitedStylesheets = new Set<CSSStyleSheet>();
  const readStylesheet = (stylesheet: CSSStyleSheet) => {
    if (visitedStylesheets.has(stylesheet)) return;
    visitedStylesheets.add(stylesheet);
    const readRules = (rules: CSSRuleList) => {
      Array.from(rules).forEach((rule) => {
        if (rule instanceof CSSImportRule) { if (rule.styleSheet) readStylesheet(rule.styleSheet); return; }
        if ("cssRules" in rule) { readRules((rule as CSSGroupingRule).cssRules); return; }
        if (rule.type !== CSSRule.FONT_FACE_RULE) return;
        const face = rule as CSSFontFaceRule;
        const family = face.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
        const weight = face.style.getPropertyValue("font-weight").trim();
        const style = face.style.getPropertyValue("font-style").trim();
        const label = [family, weight && weight !== "normal" ? weight : "", style && style !== "normal" ? style : ""]
          .filter(Boolean)
          .join(" · ") || "Web font";
        for (const match of face.style.getPropertyValue("src").matchAll(/url\((?:["']?)(.*?)(?:["']?)\)/gi)) {
          if (!match[1]) continue;
          try {
            const sourceUrl = new URL(match[1], stylesheet.href || baseUrl).href;
            if (wasLoaded(sourceUrl) || document.fonts.check(`16px "${family.replaceAll('"', '\\"')}"`)) {
              fontFaceMetadata.set(sourceUrl, label);
              add("font", sourceUrl, label, { mimeType: fontMimeTypes[new URL(sourceUrl).pathname.split(".").pop() || ""] });
            }
          } catch {
            // Ignore invalid CSS source URLs.
          }
        }
      });
    };
    try { readRules(stylesheet.cssRules); } catch {
      // Cross-origin stylesheets do not expose their rules to page scripts.
    }
  };
  stylesheets.forEach(readStylesheet);

  performance.getEntriesByType("resource").forEach((entry) => {
    const resource = entry as PerformanceResourceTiming & { responseStatus?: number };
    if (!resource.name || resource.responseEnd <= 0 || (resource.responseStatus !== undefined && resource.responseStatus >= 400)) return;
    try {
      const url = new URL(resource.name, pageUrl);
      const extension = url.pathname.split("/").pop()?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
      const label = fontFaceMetadata.get(url.href);
      const filename = url.pathname.split("/").pop()?.replace(/\.[^.]+$/, "") || "Web font";
      if (fontExtensions.has(extension) || label) add("font", url.href, label || filename, { mimeType: fontMimeTypes[extension] });
      else if (resource.initiatorType === "img" || ("image,css,link".split(",").includes(resource.initiatorType) && /^(?:avif|bmp|gif|ico|jpeg|jpg|png|svg|webp)$/.test(extension))) {
        add(extension === "ico" || iconName.test(filename) ? "icon" : "image", url.href, "Image");
      } else if (["js", "mjs", "cjs", "wasm"].includes(extension)) add("script", url.href, filename);
      else if (extension === "css") add("stylesheet", url.href, filename, { mimeType: "text/css" });
      else if (videoExtensions.has(extension)) add("video", url.href, filename);
      else if (audioExtensions.has(extension)) add("audio", url.href, filename);
    } catch {
      // Ignore invalid resource timing URLs.
    }
  });

  // Capture HLS/DASH manifests observed in the page even when a player hides
  // its MediaSource behind a non-persistent blob: URL. Never save blob: URLs.
  performance.getEntriesByType("resource").forEach((entry) => {
    const url = entry.name;
    if (/\.(m3u8|mpd)(?:$|[?#])/i.test(url)) {
      add("video", url, "Video stream manifest", {
        mimeType: url.toLowerCase().includes(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : "application/dash+xml",
      });
    }
  });

  const spriteDocuments = new Map<string, Promise<Document | undefined>>();
  const captureSprite = async (icon: typeof spriteIcons[number]) => {
    const externalUses = [...icon.clone.querySelectorAll<SVGElement>("use")].filter(use => !(use.getAttribute("href") || use.getAttribute("xlink:href") || "").startsWith("#"));
    const fallback = () => externalUses.forEach(use => add("icon", use.getAttribute("href") || use.getAttribute("xlink:href") || undefined, icon.label,
      { width: icon.width, height: icon.height, mimeType: "image/svg+xml", position: icon.position }));
    try {
      const imported = new Map<string, string>();
      for (const use of externalUses) {
        const reference = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
        const existing = imported.get(reference);
        if (existing) { use.setAttribute("href", existing); continue; }
        const spriteUrl = new URL(reference);
        const symbolId = decodeURIComponent(spriteUrl.hash.slice(1));
        if (!symbolId) { fallback(); return; }
        spriteUrl.hash = "";
        let request = spriteDocuments.get(spriteUrl.href);
        if (!request) {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 2_500);
          request = fetch(spriteUrl.href, { credentials: "same-origin", signal: controller.signal }).then(async (response) => {
            if (!response.ok) return undefined;
            const parsed = new DOMParser().parseFromString(await response.text(), "image/svg+xml");
            // Resolve styles before walking dependencies: a class rule can be the
            // only reference to a gradient or a clip definition elsewhere in the file.
            for (const style of parsed.querySelectorAll("style")) try {
              const sheet = new CSSStyleSheet(); sheet.replaceSync(style.textContent || "");
              for (const rule of [...sheet.cssRules]) if (rule instanceof CSSStyleRule) {
                for (const target of parsed.querySelectorAll<SVGElement>(rule.selectorText)) for (const name of [...rule.style]) {
                  if (svgProperties.includes(name) && !target.style?.getPropertyValue(name)) target.setAttribute(name, rule.style.getPropertyValue(name));
                }
              }
            } catch { /* Invalid rules cannot prevent other symbols being captured. */ }
            for (const target of parsed.querySelectorAll<SVGElement>("[style]")) for (const name of [...target.style]) {
              if (svgProperties.includes(name)) target.setAttribute(name, target.style.getPropertyValue(name));
            }
            return parsed;
          }).catch(() => undefined).finally(() => window.clearTimeout(timer));
          spriteDocuments.set(spriteUrl.href, request);
        }
        const document = await request;
        const symbol = document?.getElementById(symbolId);
        if (!document || !symbol || document.querySelector("parsererror")) { fallback(); return; }
        const standalone = document.createElementNS(svgNamespace, "svg") as SVGSVGElement;
        if (!icon.clone.hasAttribute("viewBox")) icon.clone.setAttribute("viewBox", symbol.getAttribute("viewBox") || document.documentElement.getAttribute("viewBox") || `0 0 ${icon.width} ${icon.height}`);
        const placeholder = document.createElementNS(svgNamespace, "use");
        placeholder.setAttribute("href", `#${symbolId}`); standalone.append(placeholder);
        embedDefinitions(standalone, document);
        // Prefix each imported definition graph, preserving multiple symbols,
        // currentColor, per-use transforms and differently colored instances.
        const names = new Map([...standalone.querySelectorAll("[id]")].map((element, index) => [element.id, `remote-${imported.size}-${index}`]));
        for (const element of standalone.querySelectorAll("*")) for (const attribute of [...element.attributes]) {
          const value = attribute.value.replace(/url\(\s*["']?#([^"')]+)["']?\s*\)/gi, (_, id: string) => `url(#${names.get(id) ?? id})`);
          if (attribute.name === "id") element.setAttribute("id", names.get(attribute.value)!);
          else if (attribute.name === "href" || attribute.name.endsWith(":href")) element.setAttribute(attribute.name, attribute.value.startsWith("#") ? `#${names.get(attribute.value.slice(1)) ?? attribute.value.slice(1)}` : attribute.value);
          else element.setAttribute(attribute.name, value);
        }
        const localReference = `#${names.get(symbolId)}`;
        imported.set(reference, localReference);
        use.setAttribute("href", localReference); use.removeAttribute("xlink:href");
        placeholder.remove();
        for (const defs of [...standalone.children]) icon.clone.prepend(defs);
      }
      add(icon.kind, serializeSvg(icon.clone, icon.width, icon.height), icon.label, {
        position: icon.position,
        width: icon.width, height: icon.height, mimeType: "image/svg+xml",
      });
    } catch { fallback(); }
  };
  const sprites = spriteIcons;
  let spriteIndex = 0;
  await Promise.all(Array.from({ length: Math.min(6, sprites.length) }, async () => {
    while (spriteIndex < sprites.length) await captureSprite(sprites[spriteIndex++]);
  }));

  // blob: addresses expire with the page. Persist their bytes as data URLs so
  // the library keeps actual images instead of dead references after a reload.
  for (const [url, image] of blobImages) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const original = await response.blob();
      if (!original.size || original.size > 64 * 1024 * 1024) continue;
      const header = new Uint8Array(await original.slice(0, 512).arrayBuffer());
      const text = new TextDecoder().decode(header);
      let mime = original.type;
      if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) mime = "image/png";
      else if (header[0] === 0xff && header[1] === 0xd8) mime = "image/jpeg";
      else if (/^GIF8[79]a/.test(text)) mime = "image/gif";
      else if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") mime = "image/webp";
      else if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) mime = "image/svg+xml";
      if (!/^image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(mime)) continue;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([original], { type: mime }));
      });
      add(image.kind, dataUrl, image.label, { ...image.extras, mimeType: mime });
    } catch {
      // Revoked or inaccessible blob URLs cannot be saved as persistent files.
    }
  }

  return { pageUrl, pageTitle, faviconUrl, resources, framePath, frames };
}
