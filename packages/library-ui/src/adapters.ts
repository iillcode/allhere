import {
  LIBRARY_STORAGE_KEY,
  createId,
  dedupeResources,
  inspectResourceUrl,
  type CapturedResource,
  type PageCapture,
  type ResourceKind,
} from "@allhere/core";

export type CaptureChangeReason = "tab" | "page";

export type LibraryAdapter = {
  load: () => Promise<PageCapture[]>;
  save: (captures: PageCapture[]) => Promise<void>;
  subscribe: (listener: (captures: PageCapture[]) => void) => () => void;
  subscribeToActiveTabChanges?: (listener: (reason: CaptureChangeReason) => void) => () => void;
  captureCurrentPage?: () => Promise<PageCapture>;
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
};

type RawPageScan = {
  pageUrl: string;
  pageTitle: string;
  faviconUrl?: string;
  resources: RawResource[];
};

type StorageChange = { newValue?: unknown };

type ChromeLike = {
  runtime?: {
    onMessage?: {
      addListener: (listener: (message: { type?: string }, sender: { tab?: { id?: number } }) => void) => void;
      removeListener: (listener: (message: { type?: string }, sender: { tab?: { id?: number } }) => void) => void;
    };
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
  tabs?: {
    query: (query: { active: boolean; lastFocusedWindow: boolean }) => Promise<
      Array<{ id?: number }>
    >;
    onActivated?: {
      addListener: (listener: (activeInfo: { tabId: number }) => void) => void;
      removeListener: (listener: (activeInfo: { tabId: number }) => void) => void;
    };
    onUpdated?: {
      addListener: (
        listener: (tabId: number, changeInfo: { status?: string }) => void,
      ) => void;
      removeListener: (
        listener: (tabId: number, changeInfo: { status?: string }) => void,
      ) => void;
    };
  };
  scripting?: {
    executeScript: (options: {
      target: { tabId: number; allFrames?: boolean };
      func: () => Promise<RawPageScan>;
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

  return (value as PageCapture[]).map((capture) => {
    const resources: CapturedResource[] = capture.resources.filter((resource) => {
      try {
        if (browserOnlyProtocols.has(new URL(resource.url).protocol)) return false;
      } catch {
        // Retain legacy URLs that the details panel can still display safely.
      }
      return !/^data:embedded|\[inline payload omitted\]$/i.test(resource.url);
    });

    return { ...capture, resources: dedupeResources(resources) };
  });
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
    save: async (captures) => {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(captures));
        window.dispatchEvent(new CustomEvent("allhere-library-updated", { detail: captures }));
      }
    },
    subscribe: (listener) => {
      if (typeof window === "undefined") return () => undefined;
      const handler = (event: Event) => {
        listener((event as CustomEvent<PageCapture[]>).detail ?? []);
      };
      window.addEventListener("allhere-library-updated", handler);
      return () => window.removeEventListener("allhere-library-updated", handler);
    },
  };
}

export function createExtensionAdapter(): LibraryAdapter {
  const load = async () => {
    const api = chromeApi();
    if (api?.storage?.local) {
      const result = await api.storage.local.get(LIBRARY_STORAGE_KEY);
      return normalizeStored(result[LIBRARY_STORAGE_KEY]);
    }
    return createWebAdapter().load();
  };

  return {
    load,
    save: async (captures) => {
      const api = chromeApi();
      if (api?.storage?.local) {
        await api.storage.local.set({ [LIBRARY_STORAGE_KEY]: captures });
        return;
      }
      await createWebAdapter().save(captures);
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
    subscribeToActiveTabChanges: (listener) => {
      const tabs = chromeApi()?.tabs;
      const messages = chromeApi()?.runtime?.onMessage;
      if (!tabs?.onActivated) return () => undefined;

      let activeTabId: number | undefined;
      void tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        // A tab activation can arrive before this query resolves. Preserve the
        // event's newer ID so the completion listener watches the right tab.
        if (activeTabId === undefined) activeTabId = tab?.id;
      }).catch(() => undefined);

      const handleActivated = (activeInfo: { tabId: number }) => {
        activeTabId = activeInfo.tabId;
        listener("tab");
      };
      const handleUpdated = (tabId: number, changeInfo: { status?: string }) => {
        if (tabId === activeTabId && changeInfo.status === "complete") listener("tab");
      };
      const handlePageChanged = (message: { type?: string }, sender: { tab?: { id?: number } }) => {
        if (message.type === "allhere.page.changed" && sender.tab?.id === activeTabId) listener("page");
      };

      tabs.onActivated.addListener(handleActivated);
      tabs.onUpdated?.addListener(handleUpdated);
      messages?.addListener(handlePageChanged);
      return () => {
        tabs.onActivated?.removeListener(handleActivated);
        tabs.onUpdated?.removeListener(handleUpdated);
        messages?.removeListener(handlePageChanged);
      };
    },
    captureCurrentPage: async () => {
      const api = chromeApi();
      if (!api?.tabs || !api.scripting) {
        throw new Error("Capture is available from the installed Chrome side panel.");
      }

      const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
      if (typeof tab?.id !== "number") {
        throw new Error("No active webpage tab was found. Open a webpage and try again.");
      }

      let injected: Array<{ frameId?: number; result?: RawPageScan }>;
      try {
        injected = await api.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: collectPageResources,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/cannot access contents|permission|restricted|chrome:\/\//i.test(message)) {
          throw new Error("Chrome does not allow scanning this page. Open a regular webpage and try again.");
        }
        throw new Error(`Could not scan this page${message ? `: ${message}` : ". Try again."}`);
      }

      const scan = injected.find((frame) => frame.frameId === 0)?.result ?? injected[0]?.result;
      if (!scan || !/^https?:\/\//i.test(scan.pageUrl)) {
        throw new Error("This page cannot be scanned. Open a regular webpage and try again.");
      }

      const capturedAt = new Date().toISOString();
      let pageHostname = "";
      try {
        pageHostname = new URL(scan.pageUrl).hostname;
      } catch {
        // A normal HTTP(S) page URL is required above; retain a readable fallback.
      }

      const resources: CapturedResource[] = dedupeResources(injected.flatMap((frame) => frame.result?.resources ?? []).map((resource) => ({
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
        faviconUrl: scan.faviconUrl,
        capturedAt,
        resources,
      };
    },
  };
}

async function collectPageResources(): Promise<RawPageScan> {
  const resources: RawResource[] = [];
  const resourceIndexes = new Map<string, number>();
  const blobImages = new Map<string, { kind: "image" | "icon"; label: string; extras: Pick<RawResource, "alt" | "description" | "width" | "height" | "mimeType"> }>();
  const spriteIcons = new Map<string, { label: string; width: number; height: number }>();
  const pageUrl = window.location.href;
  const pageTitle = document.title || window.location.hostname;
  const queryAll = <T extends Element>(selector: string): T[] => {
    const found: T[] = [];
    const visit = (root: Document | ShadowRoot) => {
      found.push(...root.querySelectorAll<T>(selector));
      root.querySelectorAll<HTMLElement>("*").forEach((element) => {
        if (element.shadowRoot) visit(element.shadowRoot);
      });
    };
    visit(document);
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
  const resizeParameters = new Set([
    "dpr", "fm", "format", "h", "height", "imwidth", "q", "quality", "sz", "w", "width",
  ]);
  const trackingParameters = new Set([
    "fbclid", "gclid", "igshid", "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term",
  ]);
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

  const imageIdentity = (rawUrl: string, kind: ResourceKind) => {
    const url = new URL(rawUrl, pageUrl);
    if (kind !== "icon") url.hash = "";
    for (const parameter of resizeParameters) url.searchParams.delete(parameter);
    for (const parameter of trackingParameters) url.searchParams.delete(parameter);
    for (const parameter of Array.from(url.searchParams.keys())) {
      if (parameter.toLowerCase().startsWith("utm_")) url.searchParams.delete(parameter);
    }
    url.searchParams.sort();
    return url.href;
  };

  const add = (
    kind: ResourceKind,
    rawUrl: string | undefined,
    label: string,
    extras: Pick<RawResource, "alt" | "description" | "width" | "height" | "mimeType"> = {},
  ) => {
    if (!rawUrl) return;
    let url: string;
    try {
      const parsed = new URL(rawUrl, pageUrl);
      if (browserOnlyProtocols.has(parsed.protocol)) return;
      if ((kind === "image" || kind === "icon") && parsed.protocol === "blob:") {
        blobImages.set(parsed.href, { kind, label, extras });
        return;
      }
      if (kind === "image" && !["http:", "https:", "data:"].includes(parsed.protocol)) return;
      if (kind === "icon" && !["http:", "https:", "data:"].includes(parsed.protocol)) return;
      if (kind === "font" && !["http:", "https:"].includes(parsed.protocol)) return;
      if ((kind === "video" || kind === "audio") && !["http:", "https:"].includes(parsed.protocol)) return;
      if (["image", "video", "audio"].includes(kind)) parsed.hash = "";
      url = parsed.href;
    } catch {
      return;
    }

    const visualAsset = kind === "image" || kind === "icon";
    const dedupeKey = visualAsset ? `visual:${imageIdentity(url, kind)}` : `${kind}:${url}`;
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
        };
      }
      return;
    }
    resourceIndexes.set(dedupeKey, resources.length);
    resources.push(nextResource);
  };

  const iconName = /\b(icon|favicon|logo|brand)\b/i;
  const cleanDescription = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim().slice(0, 280) || undefined;
  const usefulDescription = (value: string | undefined) => value && !/^(?:image|photo|picture|graphic|thumbnail|icon)$/i.test(value);
  queryAll<HTMLLinkElement>(
    'link[rel~="icon"][href], link[rel~="apple-touch-icon"][href], link[rel~="mask-icon"][href]',
  ).forEach((link) => {
    add("icon", link.href, link.title || link.getAttribute("sizes") || "Page icon", {
      mimeType: link.type || undefined,
    });
  });

  queryAll<HTMLImageElement>("img").forEach((image) => {
    // Broken images are omitted, while pending and lazy images retain their URL
    // so a scan no longer depends on when the browser finished decoding them.
    if (image.complete && (!image.naturalWidth || !image.naturalHeight)) return;
    const identityText = [image.alt, image.title, image.getAttribute("aria-label"), image.src, image.className, image.id]
      .filter(Boolean)
      .join(" ");
    const isIcon = iconName.test(identityText) || (image.getAttribute("role") === "presentation" &&
      image.naturalWidth > 0 && image.naturalWidth <= 64 && image.naturalHeight <= 64);
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
    add(isIcon ? "icon" : "image", image.currentSrc || image.src, image.alt || image.title || (isIcon ? "Page icon" : "Image"), {
      alt: image.alt || undefined,
      description,
      width: image.naturalWidth,
      height: image.naturalHeight,
      mimeType: image.getAttribute("type") || undefined,
    });
  });

  queryAll<SVGSVGElement>("svg").forEach((svg) => {
    const bounds = svg.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const semantic = [svg.getAttribute("aria-label"), svg.getAttribute("role"), svg.id, svg.className.baseVal].filter(Boolean).join(" ");
    if (bounds.width > 512 || bounds.height > 512) {
      if (!iconName.test(semantic)) return;
    }

    const clone = svg.cloneNode(true) as SVGSVGElement;
    let unresolvedReference = false;
    clone.querySelectorAll<SVGElement>("use").forEach((use) => {
      const reference = use.getAttribute("href") || use.getAttribute("xlink:href");
      if (!reference) {
        unresolvedReference = true;
        return;
      }
      if (reference.startsWith("#")) {
        const symbol = (svg.getRootNode() as Document | ShadowRoot).getElementById(reference.slice(1));
        if (!symbol || symbol.localName !== "symbol") {
          unresolvedReference = true;
          return;
        }
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        Array.from(symbol.childNodes).forEach((node) => group.appendChild(node.cloneNode(true)));
        const viewBox = symbol.getAttribute("viewBox");
        if (viewBox && !clone.hasAttribute("viewBox")) clone.setAttribute("viewBox", viewBox);
        use.replaceWith(group);
      } else {
        try {
          spriteIcons.set(new URL(reference, pageUrl).href, {
            label: svg.getAttribute("aria-label") || "SVG sprite icon",
            width: Math.round(bounds.width), height: Math.round(bounds.height),
          });
        } catch { /* Ignore a malformed sprite address without dropping the scan. */ }
        unresolvedReference = true;
      }
    });
    let externalImage = false;
    clone.querySelectorAll<SVGImageElement>("image").forEach((image) => {
      const reference = image.getAttribute("href") || image.getAttribute("xlink:href") || "";
      if (/^https?:/i.test(reference) || reference.startsWith("/")) {
        const description = [svg.getAttribute("aria-label"), svg.querySelector("title")?.textContent]
          .map(cleanDescription).find(usefulDescription);
        add("image", reference, description || "SVG image layer", { description });
        externalImage = true;
      } else if (reference && !/^#|^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon);base64,/i.test(reference)) {
        externalImage = true;
      }
    });
    if (unresolvedReference || externalImage) return;
    clone.setAttribute("color", getComputedStyle(svg).color);
    const originalNodes = [svg, ...Array.from(svg.querySelectorAll<SVGElement>("*"))];
    const copiedNodes = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];
    originalNodes.forEach((original, index) => {
      const copied = copiedNodes[index];
      if (!copied || copied.localName !== original.localName) return;
      const style = getComputedStyle(original);
      for (const name of ["fill", "stroke", "stroke-width", "opacity"]) {
        if (!copied.hasAttribute(name) && style.getPropertyValue(name)) copied.setAttribute(name, style.getPropertyValue(name));
      }
    });
    clone.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((node) => node.remove());
    [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))].forEach((element) => {
      Array.from(element.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith("on") || ((name === "href" || name.endsWith(":href")) && value && !value.startsWith("#") &&
          !(element.localName === "image" && /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon);base64,/i.test(value)))) {
          element.removeAttribute(attribute.name);
        } else if (/url\s*\(|javascript:/i.test(value)) {
          element.removeAttribute(attribute.name);
        }
      });
    });
    clone.querySelectorAll("style").forEach((style) => style.remove());
    const markup = new XMLSerializer().serializeToString(clone);
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    const label = svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent?.trim() || svg.id || "Inline SVG icon";
    add("icon", dataUrl, label, {
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      mimeType: "image/svg+xml",
    });
  });

  const supportedSource = (media: HTMLMediaElement) =>
    Array.from(media.querySelectorAll<HTMLSourceElement>("source[src]"))
      .find((source) => !source.type || media.canPlayType(source.type) !== "")?.src;

  queryAll<HTMLVideoElement>("video").forEach((video) => {
    add("video", video.currentSrc || video.src || supportedSource(video), video.title || "Video", {
      width: video.videoWidth || video.width || undefined,
      height: video.videoHeight || video.height || undefined,
      mimeType: video.querySelector<HTMLSourceElement>("source[src]")?.type || undefined,
    });
  });

  queryAll<HTMLAudioElement>("audio").forEach((audio) => {
    add("audio", audio.currentSrc || audio.src || supportedSource(audio), audio.title || "Audio");
  });

  queryAll<HTMLSourceElement>("video source[src], audio source[src]").forEach((source) => {
    const media = source.parentElement as HTMLMediaElement | null;
    if (!media || supportedSource(media) !== source.src) return;
    const kind: ResourceKind = media.tagName.toLowerCase() === "video" ? "video" : "audio";
    add(kind, source.src, source.title || source.type || "Media source", {
      mimeType: source.type || undefined,
    });
  });

  queryAll<HTMLVideoElement>("video[poster]").forEach((video) => {
    const description = [video.getAttribute("title"), video.getAttribute("aria-label")]
      .map(cleanDescription).find(usefulDescription);
    add("image", video.poster, "Video poster image", { description });
  });

  queryAll<HTMLIFrameElement>("iframe[src]").forEach((frame) => {
    add("link", frame.src, frame.title || "Embedded page");
  });

  queryAll<HTMLLinkElement>('link[rel~="stylesheet"][href]').forEach((link) => {
    add("stylesheet", link.href, link.title || "Stylesheet", { mimeType: "text/css" });
  });

  queryAll<HTMLScriptElement>("script[src]").forEach((script) => {
    add("script", script.src, script.title || "Script", {
      mimeType: script.type || "text/javascript",
    });
  });

  queryAll<HTMLElement>("object[data], embed[src]").forEach((node) => {
    const url = node instanceof HTMLObjectElement ? node.data : (node as HTMLEmbedElement).src;
    add("document", url, node.getAttribute("title") || node.getAttribute("type") || "Embedded file", {
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
    const kind: ResourceKind = fontExtensions.has(extension)
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
                  : "link";
    add(kind, url, anchor.download || text || anchor.getAttribute("aria-label") || anchor.title || url, {
      mimeType: kind === "font"
        ? fontMimeTypes[extension]
        : kind === "icon"
          ? extension === "ico" ? "image/x-icon" : "image/svg+xml"
          : kind === "document" || kind === "video" || kind === "audio" || kind === "stylesheet" || kind === "script" ? extension : undefined,
    });
  });

  queryAll<HTMLElement>("*").forEach((element) => {
    for (const pseudo of [null, "::before", "::after"] as const) {
      const style = window.getComputedStyle(element, pseudo);
      const iconProperties = [style.maskImage, style.getPropertyValue("-webkit-mask-image")];
      const imageProperties = [style.backgroundImage, style.content, ...iconProperties];
      for (const imageProperty of imageProperties) {
        if (!imageProperty || imageProperty === "none") continue;
        const isMask = iconProperties.includes(imageProperty);
        for (const match of imageProperty.matchAll(/url\(\s*["']?(.*?)["']?\s*\)/g)) {
          if (!match[1]) continue;
          const identityText = [element.getAttribute("aria-label"), element.getAttribute("title"), element.className, element.id]
            .filter((value) => typeof value === "string").join(" ");
          const isIcon = isMask || iconName.test(identityText);
          const description = !isIcon ? [
            element.getAttribute("aria-description"), element.getAttribute("aria-label"),
            element.getAttribute("title"), element.getAttribute("data-description"), element.getAttribute("data-caption"),
          ].map(cleanDescription).find(usefulDescription) : undefined;
          add(isIcon ? "icon" : "image", match[1], isIcon ? "Background icon" : "Background image", { description });
        }
      }
    }
  });

  const stylesheets: CSSStyleSheet[] = [...Array.from(document.styleSheets), ...Array.from(document.adoptedStyleSheets)];
  queryAll<HTMLElement>("*").forEach((element) => {
    if (element.shadowRoot) stylesheets.push(...element.shadowRoot.styleSheets, ...element.shadowRoot.adoptedStyleSheets);
  });
  stylesheets.forEach((stylesheet) => {
    try {
      Array.from(stylesheet.cssRules).forEach((rule) => {
        if (rule.type !== CSSRule.FONT_FACE_RULE) return;
        const face = rule as CSSFontFaceRule;
        const family = face.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
        const weight = face.style.getPropertyValue("font-weight").trim();
        const style = face.style.getPropertyValue("font-style").trim();
        const label = [family, weight && weight !== "normal" ? weight : "", style && style !== "normal" ? style : ""]
          .filter(Boolean)
          .join(" · ") || "Web font";
        for (const match of face.style.getPropertyValue("src").matchAll(/url\((?:["']?)(.*?)(?:["']?)\)/gi)) {
          if (!match[1] || match[1].startsWith("data:")) continue;
          try {
            const sourceUrl = new URL(match[1], stylesheet.href || pageUrl).href;
            if (wasLoaded(sourceUrl)) fontFaceMetadata.set(sourceUrl, label);
          } catch {
            // Ignore invalid CSS source URLs.
          }
        }
      });
    } catch {
      // Cross-origin stylesheets do not expose their rules to page scripts.
    }
  });

  performance.getEntriesByType("resource").forEach((entry) => {
    const resource = entry as PerformanceResourceTiming & { responseStatus?: number };
    if (!resource.name || resource.responseEnd <= 0 || (resource.responseStatus !== undefined && resource.responseStatus >= 400)) return;
    try {
      const url = new URL(resource.name, pageUrl);
      const extension = url.pathname.split("/").pop()?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
      const label = fontFaceMetadata.get(url.href);
      if (!fontExtensions.has(extension) && !label) return;
      const filename = url.pathname.split("/").pop()?.replace(/\.[^.]+$/, "") || "Web font";
      add("font", url.href, label || filename, { mimeType: fontMimeTypes[extension] });
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
  for (const [reference, icon] of spriteIcons) {
    const fallback = () => add("icon", reference, icon.label, { width: icon.width, height: icon.height, mimeType: "image/svg+xml" });
    try {
      const spriteUrl = new URL(reference);
      const symbolId = decodeURIComponent(spriteUrl.hash.slice(1));
      if (!symbolId) { fallback(); continue; }
      spriteUrl.hash = "";
      let request = spriteDocuments.get(spriteUrl.href);
      if (!request) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 2_500);
        request = fetch(spriteUrl.href, { credentials: "omit", signal: controller.signal }).then(async (response) => {
          if (!response.ok) return undefined;
          return new DOMParser().parseFromString(await response.text(), "image/svg+xml");
        }).catch(() => undefined).finally(() => window.clearTimeout(timer));
        spriteDocuments.set(spriteUrl.href, request);
      }
      const document = await request;
      const symbol = [...(document?.querySelectorAll("symbol[id]") ?? [])].find((node) => node.id === symbolId);
      if (!document || !symbol || document.querySelector("parsererror")) { fallback(); continue; }
      const standalone = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      standalone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      standalone.setAttribute("viewBox", symbol.getAttribute("viewBox") || document.documentElement.getAttribute("viewBox") || `0 0 ${icon.width} ${icon.height}`);
      standalone.setAttribute("width", String(icon.width));
      standalone.setAttribute("height", String(icon.height));
      document.documentElement.querySelectorAll(":scope > defs").forEach((defs) => standalone.appendChild(defs.cloneNode(true)));
      symbol.childNodes.forEach((node) => standalone.appendChild(node.cloneNode(true)));
      standalone.querySelectorAll("script, foreignObject, iframe, object, embed, style").forEach((node) => node.remove());
      [standalone, ...standalone.querySelectorAll("*")].forEach((element) => {
        [...element.attributes].forEach((attribute) => {
          const name = attribute.name.toLowerCase();
          const value = attribute.value.trim();
          if (name.startsWith("on") || /javascript:|url\s*\(/i.test(value) ||
            ((name === "href" || name.endsWith(":href")) && value && !value.startsWith("#"))) element.removeAttribute(attribute.name);
        });
      });
      add("icon", `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(standalone))}`, icon.label, {
        width: icon.width, height: icon.height, mimeType: "image/svg+xml",
      });
    } catch { fallback(); }
  }

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

  return { pageUrl, pageTitle, faviconUrl, resources };
}
