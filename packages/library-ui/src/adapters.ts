import {
  LIBRARY_STORAGE_KEY,
  createId,
  inspectResourceUrl,
  type CapturedResource,
  type PageCapture,
  type ResourceKind,
} from "@allhere/core";

export type LibraryAdapter = {
  load: () => Promise<PageCapture[]>;
  save: (captures: PageCapture[]) => Promise<void>;
  subscribe: (listener: (captures: PageCapture[]) => void) => () => void;
  subscribeToActiveTabChanges?: (listener: () => void) => () => void;
  captureCurrentPage?: () => Promise<PageCapture>;
};

type RawResource = {
  kind: ResourceKind;
  url: string;
  label: string;
  alt?: string;
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
      target: { tabId: number };
      func: () => RawPageScan;
    }) => Promise<Array<{ result?: RawPageScan }>>;
  };
};

function chromeApi(): ChromeLike | undefined {
  return (globalThis as typeof globalThis & { chrome?: ChromeLike }).chrome;
}

function normalizeStored(value: unknown): PageCapture[] {
  if (!Array.isArray(value)) return [];

  const resizeParameters = new Set([
    "dpr", "fm", "format", "h", "height", "imwidth", "q", "quality", "size", "sz", "w", "width",
  ]);
  const trackingParameters = new Set([
    "fbclid", "gclid", "igshid", "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term",
  ]);
  const browserOnlyProtocols = new Set([
    "brave:", "chrome:", "chrome-extension:", "chrome-untrusted:", "moz-extension:",
  ]);

  return (value as PageCapture[]).map((capture) => {
    const resources: CapturedResource[] = [];
    const imageIndexes = new Map<string, number>();

    capture.resources.forEach((resource) => {
      try {
        if (browserOnlyProtocols.has(new URL(resource.url).protocol)) return;
      } catch {
        // Retain legacy URLs that the details panel can still display safely.
      }

      if (resource.kind !== "image" && resource.kind !== "icon") {
        resources.push(resource);
        return;
      }
      if (/^data:embedded|\[inline payload omitted\]$/i.test(resource.url)) return;

      let identity: string;
      try {
        const url = new URL(resource.url);
        url.hash = "";
        for (const parameter of resizeParameters) url.searchParams.delete(parameter);
        for (const parameter of trackingParameters) url.searchParams.delete(parameter);
        for (const parameter of Array.from(url.searchParams.keys())) {
          if (parameter.toLowerCase().startsWith("utm_")) url.searchParams.delete(parameter);
        }
        url.searchParams.sort();
        identity = url.href;
      } catch {
        resources.push(resource);
        return;
      }

      const existingIndex = imageIndexes.get(identity);
      if (existingIndex === undefined) {
        imageIndexes.set(identity, resources.length);
        resources.push(resource);
        return;
      }

      const existing = resources[existingIndex];
      const existingArea = (existing.width ?? 0) * (existing.height ?? 0);
      const nextArea = (resource.width ?? 0) * (resource.height ?? 0);
      if (resource.kind === "icon" && existing.kind !== "icon") {
        resources[existingIndex] = resource;
      } else if (existing.kind === "icon" && resource.kind === "image" && nextArea > existingArea) {
        resources[existingIndex] = { ...resource, kind: "icon" };
      } else if (nextArea > existingArea) {
        resources[existingIndex] = resource;
      }
    });

    return { ...capture, resources };
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
      if (!tabs?.onActivated) return () => undefined;

      let activeTabId: number | undefined;
      void tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        // A tab activation can arrive before this query resolves. Preserve the
        // event's newer ID so the completion listener watches the right tab.
        if (activeTabId === undefined) activeTabId = tab?.id;
      }).catch(() => undefined);

      const handleActivated = (activeInfo: { tabId: number }) => {
        activeTabId = activeInfo.tabId;
        listener();
      };
      const handleUpdated = (tabId: number, changeInfo: { status?: string }) => {
        if (tabId === activeTabId && changeInfo.status === "complete") listener();
      };

      tabs.onActivated.addListener(handleActivated);
      tabs.onUpdated?.addListener(handleUpdated);
      return () => {
        tabs.onActivated?.removeListener(handleActivated);
        tabs.onUpdated?.removeListener(handleUpdated);
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

      let injected: Array<{ result?: RawPageScan }>;
      try {
        injected = await api.scripting.executeScript({
          target: { tabId: tab.id },
          func: collectPageResources,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/cannot access contents|permission|restricted|chrome:\/\//i.test(message)) {
          throw new Error("Chrome does not allow scanning this page. Open a regular webpage and try again.");
        }
        throw new Error(`Could not scan this page${message ? `: ${message}` : ". Try again."}`);
      }

      const scan = injected[0]?.result;
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

      const resources: CapturedResource[] = scan.resources.map((resource) => ({
        ...resource,
        id: createId("resource"),
        pageUrl: scan.pageUrl,
        pageTitle: scan.pageTitle,
        capturedAt,
        security: inspectResourceUrl(resource.url, scan.pageUrl, capturedAt),
      }));

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

function collectPageResources(): RawPageScan {
  const resources: RawResource[] = [];
  const resourceIndexes = new Map<string, number>();
  const pageUrl = window.location.href;
  const pageTitle = document.title || window.location.hostname;
  const faviconUrl = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href;
  const loadedRequests = new Set<string>();
  const resizeParameters = new Set([
    "dpr", "fm", "format", "h", "height", "imwidth", "q", "quality", "size", "sz", "w", "width",
  ]);
  const trackingParameters = new Set([
    "fbclid", "gclid", "igshid", "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term",
  ]);
  const browserOnlyProtocols = new Set(["brave:", "chrome:", "chrome-extension:", "chrome-untrusted:", "moz-extension:"]);
  const iconExtensions = new Set(["ico"]);
  const videoExtensions = new Set(["m3u8", "m4v", "mkv", "mov", "mp4", "mpd", "ogv", "webm"]);
  const audioExtensions = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "wav"]);
  const fontExtensions = new Set(["eot", "otf", "ttf", "woff", "woff2"]);
  const fontMimeTypes: Record<string, string> = {
    eot: "application/vnd.ms-fontobject",
    otf: "font/otf",
    ttf: "font/ttf",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  const fontFaceMetadata = new Map<string, string>();
  const fileExtensions = new Set([
    "7z", "csv", "doc", "docx", "dmg", "epub", "exe", "gz", "jpeg", "jpg", "json", "pdf", "png",
    "ppt", "pptx", "psd", "rar", "svg", "tar", "txt", "webp", "xls", "xlsx", "zip",
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

  const imageIdentity = (rawUrl: string) => {
    const url = new URL(rawUrl, pageUrl);
    url.hash = "";
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
    extras: Pick<RawResource, "alt" | "width" | "height" | "mimeType"> = {},
  ) => {
    if (!rawUrl || rawUrl.length > 8_000) return;
    let url: string;
    try {
      const parsed = new URL(rawUrl, pageUrl);
      if (browserOnlyProtocols.has(parsed.protocol)) return;
      if (kind === "image" && !["http:", "https:", "data:"].includes(parsed.protocol)) return;
      if (kind === "icon" && !["http:", "https:", "data:"].includes(parsed.protocol)) return;
      if (kind === "font" && !["http:", "https:"].includes(parsed.protocol)) return;
      if ((kind === "video" || kind === "audio") && !["http:", "https:"].includes(parsed.protocol)) return;
      if (parsed.protocol === "data:" && parsed.href.length > 8_000) return;
      if (["image", "video", "audio"].includes(kind)) parsed.hash = "";
      url = parsed.href;
    } catch {
      return;
    }

    const visualAsset = kind === "image" || kind === "icon";
    const dedupeKey = visualAsset ? `visual:${imageIdentity(url)}` : `${kind}:${url}`;
    const existingIndex = resourceIndexes.get(dedupeKey);
    const nextResource = { kind, url, label: label.trim().slice(0, 180) || url, ...extras };
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
      return;
    }
    resourceIndexes.set(dedupeKey, resources.length);
    resources.push(nextResource);
  };

  const iconName = /\b(icon|favicon|logo|brand)\b/i;
  document.querySelectorAll<HTMLLinkElement>(
    'link[rel~="icon"][href], link[rel~="apple-touch-icon"][href], link[rel~="mask-icon"][href]',
  ).forEach((link) => {
    if (wasLoaded(link.href)) {
      add("icon", link.href, link.title || link.getAttribute("sizes") || "Page icon", {
        mimeType: link.type || undefined,
      });
    }
  });

  document.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    // Record the browser-selected image only after it has decoded successfully.
    // This avoids srcset variant duplicates and broken or still-loading entries.
    if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
    const identityText = [image.alt, image.title, image.getAttribute("aria-label"), image.src, image.className, image.id]
      .filter(Boolean)
      .join(" ");
    const isIcon = iconName.test(identityText) || (
      image.naturalWidth >= 12 && image.naturalHeight >= 12 && image.naturalWidth <= 64 && image.naturalHeight <= 64
    );
    add(isIcon ? "icon" : "image", image.currentSrc || image.src, image.alt || image.title || (isIcon ? "Page icon" : "Image"), {
      alt: image.alt || undefined,
      width: image.naturalWidth,
      height: image.naturalHeight,
      mimeType: image.getAttribute("type") || undefined,
    });
  });

  document.querySelectorAll<SVGSVGElement>("svg").forEach((svg) => {
    const bounds = svg.getBoundingClientRect();
    if (bounds.width < 12 || bounds.height < 12 || bounds.width > 128 || bounds.height > 128) return;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    let unresolvedReference = false;
    clone.querySelectorAll<SVGElement>("use").forEach((use) => {
      const reference = use.getAttribute("href") || use.getAttribute("xlink:href");
      if (!reference) {
        unresolvedReference = true;
        return;
      }
      if (reference.startsWith("#")) {
        const symbol = document.getElementById(reference.slice(1));
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
        if (wasLoaded(reference)) {
          add("icon", reference, svg.getAttribute("aria-label") || "SVG sprite icon", {
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
            mimeType: "image/svg+xml",
          });
        }
        unresolvedReference = true;
      }
    });
    if (unresolvedReference || clone.querySelector("image")) return;
    clone.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((node) => node.remove());
    [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))].forEach((element) => {
      Array.from(element.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith("on") || ((name === "href" || name.endsWith(":href")) && value && !value.startsWith("#"))) {
          element.removeAttribute(attribute.name);
        } else if (/url\s*\(|javascript:/i.test(value)) {
          element.removeAttribute(attribute.name);
        }
      });
    });
    clone.querySelectorAll("style").forEach((style) => style.remove());
    const markup = new XMLSerializer().serializeToString(clone);
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    if (dataUrl.length > 8_000) return;
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

  document.querySelectorAll<HTMLVideoElement>("video").forEach((video) => {
    add("video", video.currentSrc || video.src || supportedSource(video), video.title || "Video", {
      width: video.videoWidth || video.width || undefined,
      height: video.videoHeight || video.height || undefined,
      mimeType: video.querySelector<HTMLSourceElement>("source[src]")?.type || undefined,
    });
  });

  document.querySelectorAll<HTMLAudioElement>("audio").forEach((audio) => {
    add("audio", audio.currentSrc || audio.src || supportedSource(audio), audio.title || "Audio");
  });

  document.querySelectorAll<HTMLSourceElement>("video source[src], audio source[src]").forEach((source) => {
    const media = source.parentElement as HTMLMediaElement | null;
    if (!media || supportedSource(media) !== source.src) return;
    const kind: ResourceKind = media.tagName.toLowerCase() === "video" ? "video" : "audio";
    add(kind, source.src, source.title || source.type || "Media source", {
      mimeType: source.type || undefined,
    });
  });

  document.querySelectorAll<HTMLVideoElement>("video[poster]").forEach((video) => {
    if (wasLoaded(video.poster)) add("image", video.poster, "Video poster image");
  });

  document.querySelectorAll<HTMLIFrameElement>("iframe[src]").forEach((frame) => {
    add("link", frame.src, frame.title || "Embedded page");
  });

  document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]').forEach((link) => {
    add("stylesheet", link.href, link.title || "Stylesheet", { mimeType: "text/css" });
  });

  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((script) => {
    add("script", script.src, script.title || "Script", {
      mimeType: script.type || "text/javascript",
    });
  });

  document.querySelectorAll<HTMLElement>("object[data], embed[src]").forEach((node) => {
    const url = node instanceof HTMLObjectElement ? node.data : (node as HTMLEmbedElement).src;
    add("document", url, node.getAttribute("title") || node.getAttribute("type") || "Embedded file", {
      mimeType: node.getAttribute("type") || undefined,
    });
  });

  document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    const url = anchor.href;
    const text = anchor.innerText?.replace(/\s+/g, " ").trim();
    let extension = "";
    try {
      extension = new URL(url).pathname.split("/").pop()?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
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
            : fileExtensions.has(extension)
              ? "document"
              : "link";
    add(kind, url, text || anchor.getAttribute("aria-label") || anchor.title || url, {
      mimeType: kind === "font"
        ? fontMimeTypes[extension]
        : kind === "icon"
          ? extension === "ico" ? "image/x-icon" : "image/svg+xml"
          : kind === "document" || kind === "video" || kind === "audio" ? extension : undefined,
    });
  });

  document.querySelectorAll<HTMLElement>("*").forEach((element) => {
    const style = window.getComputedStyle(element);
    const iconProperties = [style.maskImage, style.getPropertyValue("-webkit-mask-image")];
    const imageProperties = [style.backgroundImage, ...iconProperties];
    for (const imageProperty of imageProperties) {
      const isMask = iconProperties.includes(imageProperty);
      for (const match of imageProperty.matchAll(/url\((?:"|')?(.*?)(?:"|')?\)/g)) {
        if (match[1] && wasLoaded(match[1])) {
          const identityText = [element.getAttribute("aria-label"), element.getAttribute("title"), element.className, element.id]
            .filter((value) => typeof value === "string")
            .join(" ");
          const isIcon = isMask || iconName.test(identityText);
          add(isIcon ? "icon" : "image", match[1], isIcon ? "Background icon" : "Background image");
        }
      }
    }
  });

  Array.from(document.styleSheets).forEach((stylesheet) => {
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

  return { pageUrl, pageTitle, faviconUrl, resources };
}
