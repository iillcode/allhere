import type { ResourceKind } from "@stashwell/core";

type RawResource = {
  kind: ResourceKind;
  url: string;
  label: string;
  alt?: string;
  description?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  posterUrl?: string;
  identityUrl?: string;
  variantUrls?: string[];
  position?: [top: number, left: number, documentIndex: number];
};

export type RawPageScan = {
  pageUrl: string;
  pageTitle: string;
  faviconUrl?: string;
  resources: RawResource[];
  framePath?: number[];
  frames?: Array<{ index: number; position?: RawResource["position"] }>;
};

export function orderedPageResources(scans: RawPageScan[]): RawResource[] {
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

export async function collectPageResources(expectedTopUrl?: string): Promise<RawPageScan | undefined> {
  if (window === window.top && expectedTopUrl && location.href !== expectedTopUrl) return;
  const resources: RawResource[] = [];
  const resourceIndexes = new Map<string, number>();
  const blobImages = new Map<string, { kind: "image" | "icon"; label: string; extras: Pick<RawResource, "alt" | "description" | "width" | "height" | "mimeType" | "position" | "identityUrl" | "variantUrls"> }>();
  const svgArtworks: Array<{ clone: SVGSVGElement; kind: "icon" | "image"; label: string; width: number; height: number; position?: RawResource["position"] }> = [];
  const fontIcons = new Map<string, { glyph: string; label: string; family: string; font: string; color: string; direction: CanvasDirection; size: number; position?: RawResource["position"] }>();
  const pageUrl = window.location.href;
  const pageTitle = document.title || window.location.hostname;
  const taskScheduler = (globalThis as typeof globalThis & { scheduler?: { postTask?: (task: () => void) => Promise<void> } }).scheduler;
  let yieldAt = performance.now() + 12;
  function pauseIfBusy() {
    if (performance.now() < yieldAt) return;
    // Give the source tab time to handle input and paint during large scans.
    const resume = () => { yieldAt = performance.now() + 12; };
    return taskScheduler?.postTask
      ? taskScheduler.postTask(resume)
      : new Promise<void>(resolve => window.setTimeout(() => { resume(); resolve(); }, 0));
  }
  async function visitInBatches<T>(items: Iterable<T>, visit: (item: T) => void) {
    for (const item of items) {
      visit(item);
      const pause = pauseIfBusy();
      if (pause) await pause;
    }
  }
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
  const pageElements: Element[] = [];
  const documentIndexes = new Map<Element, number>();
  const shadowRoots: ShadowRoot[] = [];
  const pending = [...document.children].reverse();
  while (pending.length) {
    const element = pending.pop()!;
    documentIndexes.set(element, pageElements.length);
    pageElements.push(element);
    for (let child = element.lastElementChild; child; child = child.previousElementSibling) pending.push(child);
    const root = shadowRootFor(element);
    if (root) {
      shadowRoots.push(root);
      for (let child = root.lastElementChild; child; child = child.previousElementSibling) pending.push(child);
    }
    const pause = pauseIfBusy();
    if (pause) await pause;
  }
  const queryAll = <T extends Element>(selector: string): T[] => shadowRoots.length
    ? pageElements.filter(element => element.matches(selector)) as T[]
    : [...document.querySelectorAll<T>(selector)];
  const faviconUrl = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href;
  const loadedRequests = new Set<string>();
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
  const iconExtensions = new Set(["ico", "cur"]);
  const imageExtension = /^(?:apng|avif|bmp|cur|gif|heic|heif|ico|jpe?g|jxl|png|svg|tiff?|webp)$/i;
  const videoExtensions = new Set(["avi", "m3u8", "m4v", "mkv", "mov", "mp4", "mpd", "ogv", "webm"]);
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
  type ResourceRequest = Pick<PerformanceResourceTiming, "name" | "initiatorType" | "responseEnd"> & { responseStatus?: number; contentType?: string };
  const observedVisualRequests = (globalThis as typeof globalThis & { __stashwellVisualRequests?: Map<string, ResourceRequest> }).__stashwellVisualRequests;
  const resourceRequests = () => new Map<string, ResourceRequest>([
    ...(observedVisualRequests ?? []),
    ...(performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map(entry => [entry.name, entry] as const),
  ]).values();
  const fileExtensions = new Set([
    "7z", "ai", "apk", "avif", "bmp", "bz2", "csv", "deb", "doc", "docx", "dmg", "epub", "exe", "fig", "gif", "gz", "ico",
    "jpeg", "jpg", "json", "jsonl", "key", "map", "markdown", "md", "msi", "numbers", "odp", "ods", "odt",
    "pages", "pdf", "png", "ppt", "pptx", "psd", "rar", "rpm", "rtf", "sketch", "svg", "tar", "tgz", "tiff", "tsv",
    "txt", "webp", "xls", "xlsx", "xz", "yaml", "yml", "zip",
  ]);

  for (const resource of resourceRequests()) {
    const status = resource.responseStatus;
    if (!resource.name || resource.responseEnd <= 0 || (status !== undefined && status >= 400)) continue;
    try {
      const url = new URL(resource.name, pageUrl);
      url.hash = "";
      loadedRequests.add(url.href);
    } catch {
      // Ignore performance entries that are not valid URLs.
    }
  }

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
    extras: Omit<RawResource, "kind" | "url" | "label"> = {},
  ) => {
    if (!rawUrl?.trim()) return;
    let url: string;
    try {
      const parsed = new URL(rawUrl, baseUrl);
      if (browserOnlyProtocols.has(parsed.protocol)) return;
      if ((kind === "image" || kind === "icon") && parsed.protocol === "blob:") {
        const previous = blobImages.get(parsed.href);
        if (!previous || (extras.position && !previous.extras.position)) blobImages.set(parsed.href, { kind, label, extras });
        return;
      }
      if (kind === "image" && !["http:", "https:", "data:"].includes(parsed.protocol)) return;
      if (kind === "icon" && !["http:", "https:", "data:"].includes(parsed.protocol)) return;
      if (kind === "font" && !["http:", "https:"].includes(parsed.protocol) &&
        !(parsed.protocol === "data:" && /^data:(?:font\/|application\/(?:font-|x-font-|vnd\.ms-fontobject|octet-stream))/i.test(rawUrl))) return;
      if ((kind === "video" || kind === "audio") && (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)) return;
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
      if (kind === "audio" || kind === "video") {
        existing.posterUrl ||= extras.posterUrl;
        existing.mimeType ||= extras.mimeType;
        existing.variantUrls ||= extras.variantUrls;
      } else if (kind === "font" && existing.kind === "font") {
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
  const referencedText = (element: Element, attribute: string) => element.getAttribute(attribute)?.trim().split(/\s+/)
    .map(id => (element.getRootNode() as Document | ShadowRoot).getElementById(id)?.textContent).filter(Boolean).join(" ");
  const accessibleName = (element: Element) => [
    referencedText(element, "aria-labelledby"), element.getAttribute("aria-label"), element.getAttribute("title"),
  ].map(cleanDescription).find(usefulDescription);
  const iconClassName = (element: Element) => {
    const icon = [...element.classList].map(name =>
      name.match(/^(?:octicon|lucide|icon-tabler|tabler-icon|heroicon|feather|ion|fa|bi|mdi|ri|icon|logo)[-_](.+)$/i)?.[1],
    ).find(name => name && !/^(?:solid|regular|brand|brands|spin|pulse|fw|lg|sm|xs|\d+x)$/i.test(name));
    return icon?.replace(/[-_]+/g, " ");
  };
  queryAll<HTMLLinkElement>(
    'link[rel~="icon"][href], link[rel~="apple-touch-icon"][href], link[rel~="apple-touch-icon-precomposed"][href], link[rel~="mask-icon"][href]',
  ).forEach((link) => {
    add("icon", link.href, accessibleName(link) || "Page icon", {
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
  const lazySources = (element: Element) => ["data-src", "data-original", "data-original-src", "data-lazy-src", "data-lazy", "data-ll-src", "data-image-src", "data-url"]
    .map(name => element.getAttribute(name)).filter((value): value is string => !!value?.trim());
  const lazySrcsets = (element: Element) => ["data-srcset", "data-lazy-srcset", "data-original-srcset", "data-ll-srcset"]
    .flatMap(name => srcsetUrls(element.getAttribute(name)));
  const visualCandidates = (values: Array<string | undefined>, rejected?: string): string[] => [...new Set(values.flatMap(value => {
    if (!value?.trim()) return [];
    try {
      const url = new URL(value, baseUrl);
      if (url.href === rejected || url.username || url.password || !["http:", "https:", "blob:", "data:"].includes(url.protocol)) return [];
      if (url.protocol === "data:" && !/^data:image\//i.test(value)) return [];
      return [url.href];
    } catch { return []; }
  }))];
  const pageImages = queryAll<HTMLImageElement>("img");
  await visitInBatches(pageImages, (image) => {
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
    const description = [
      image.getAttribute("alt"),
      referencedText(image, "aria-labelledby"),
      image.getAttribute("aria-description"),
      referencedText(image, "aria-describedby"),
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
    const deferred = [...lazySources(image), ...lazySrcsets(image)];
    const responsive = srcsetUrls(image.getAttribute("srcset"));
    const active = image.currentSrc || image.src;
    const candidates = [...deferred, ...responsive];
    if (image.parentElement?.localName === "picture") for (const source of image.parentElement.querySelectorAll("source")) {
      candidates.push(...srcsetUrls(source.getAttribute("srcset")), ...lazySrcsets(source), ...lazySources(source));
    }
    const hasDeferredSource = deferred.length > 0 || (image.parentElement?.localName === "picture" &&
      [...image.parentElement.querySelectorAll("source")].some(source => lazySources(source).length || lazySrcsets(source).length));
    // Chrome can report a cached SVG request's fragment in currentSrc even
    // when this element declared a different view of the same file.
    if (!hasDeferredSource) candidates.push(image.getAttribute("src") || active);
    const variantUrls = visualCandidates(candidates, broken ? active : undefined);
    // src, srcset, and picture sources describe one logical image. Keep all
    // addresses for future matching without adding a card for each alternative.
    // A lazy placeholder is deliberately excluded: many different images use it.
    if (active && variantUrls.includes(active)) {
      variantUrls.splice(variantUrls.indexOf(active), 1);
      variantUrls.unshift(active);
    }
    const [primary] = variantUrls;
    add(isIcon ? "icon" : "image", primary, description || image.alt || image.title || (isIcon ? "Page icon" : "Image"), {
      ...extras, identityUrl: primary, variantUrls,
    });
  });

  queryAll<HTMLInputElement>('input[type="image"][src]').forEach(input => {
    add("icon", input.src, cleanDescription(input.alt) || accessibleName(input) || "Icon", { position: positionFor(input) });
  });
  queryAll<HTMLLinkElement>('link[rel~="preload"][as="image"]').forEach(link => {
    const variantUrls = visualCandidates([link.getAttribute("href") || undefined, ...srcsetUrls(link.getAttribute("imagesrcset"))]);
    const [primary] = variantUrls;
    add(iconName.test(primary || "") ? "icon" : "image", primary, accessibleName(link) || "Image", {
      mimeType: link.type || undefined, identityUrl: primary, variantUrls,
    });
  });

  const svgNamespace = "http://www.w3.org/2000/svg";
  const inlineRaster = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon);base64,[a-z\d+/=\s]+$/i;
  const svgProperties = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "color", "stop-color",
    "stop-opacity", "clip-path", "clip-rule", "mask", "filter", "paint-order", "vector-effect", "font-family",
    "font-size", "font-weight", "text-anchor", "dominant-baseline"];
  const svgDefaults: Record<string, string> = {
    fill: "rgb(0, 0, 0)", "fill-opacity": "1", "fill-rule": "nonzero", stroke: "none", "stroke-width": "1px",
    "stroke-opacity": "1", "stroke-linecap": "butt", "stroke-linejoin": "miter", "stroke-miterlimit": "4",
    "stroke-dasharray": "none", "stroke-dashoffset": "0px", opacity: "1", "stop-color": "rgb(0, 0, 0)",
    "stop-opacity": "1", "clip-path": "none", "clip-rule": "nonzero", mask: "none", filter: "none",
    "paint-order": "normal", "vector-effect": "none",
  };
  const nonInherited = new Set(["opacity", "clip-path", "mask", "filter", "vector-effect", "stop-color", "stop-opacity"]);
  const svgSerializer = new XMLSerializer();
  const styledClone = (source: SVGElement) => {
    const clone = source.cloneNode(true) as SVGElement;
    const originals = [source, ...source.querySelectorAll<SVGElement>("*")];
    const copies = [clone, ...clone.querySelectorAll<SVGElement>("*")];
    const inheritedDefaults = new WeakMap<Element, Set<string>>();
    originals.forEach((original, index) => {
      const copy = copies[index];
      const style = getComputedStyle(original);
      const parentDefaults = original.parentElement ? inheritedDefaults.get(original.parentElement) : undefined;
      const defaults = new Set<string>();
      for (const name of svgProperties) {
        const value = style.getPropertyValue(name);
        if (!value) continue;
        // Serialization removes these defaults. Avoid creating attributes that
        // have the same value the standalone SVG would already inherit.
        if (value === svgDefaults[name] && (!index || nonInherited.has(name) || parentDefaults?.has(name))) {
          defaults.add(name);
          copy.removeAttribute(name);
        } else {
          copy.setAttribute(name, value);
        }
      }
      inheritedDefaults.set(original, defaults);
      // CSS transforms on child shapes affect their geometry. The root's CSS
      // transform positions the entire icon on the page and is not intrinsic.
      if (index && style.transform !== "none") copy.setAttribute("transform", style.transform);
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
  const referenceIds = (elements: Element[]) => {
    const ids = new Set<string>();
    for (const element of elements) for (const attribute of element.attributes) {
      if (attribute.name === "href" || attribute.name.endsWith(":href")) {
        const id = fragment(attribute.value); if (id) ids.add(id);
      }
      const value = attribute.value;
      if (!/url\(/i.test(value)) continue;
      for (const match of value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
        const id = fragment(match[1]); if (id) ids.add(id);
      }
    }
    return ids;
  };
  const embedDefinitions = (clone: SVGSVGElement, source: Document | ShadowRoot) => {
    const children = [...clone.querySelectorAll("*")];
    const pending = referenceIds([clone, ...children]);
    if (!pending.size) return false;
    const copiedIds = new Set(children.flatMap(element => element.id ? [element.id] : []));
    const defs = document.createElementNS(svgNamespace, "defs");
    for (const id of pending) {
      if (copiedIds.has(id)) continue;
      const original = source.getElementById(id);
      if (!original || original.namespaceURI !== svgNamespace) continue;
      const copy = original.cloneNode(true) as Element;
      defs.append(copy);
      const elements = [copy, ...copy.querySelectorAll("*")];
      for (const element of elements) if (element.id) copiedIds.add(element.id);
      for (const reference of referenceIds(elements)) pending.add(reference);
    }
    if (defs.childElementCount) clone.prepend(defs);
    return true;
  };
  const serializeSvg = (clone: SVGSVGElement, width: number, height: number, hasReferences = true) => {
    clone.setAttribute("xmlns", svgNamespace);
    if (!clone.hasAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const viewBox = clone.getAttribute("viewBox")!.trim().split(/[\s,]+/).map(Number);
    clone.setAttribute("width", String(viewBox[2] > 0 ? viewBox[2] : width));
    clone.setAttribute("height", String(viewBox[3] > 0 ? viewBox[3] : height));
    clone.querySelectorAll("script, foreignObject, iframe, object, embed, style, animate, animateTransform, set, title, desc").forEach(node => node.remove());
    const elements = [clone, ...clone.querySelectorAll("*")];
    const ids = new Map<string, string>();
    if (hasReferences) {
      const referenced = referenceIds(elements);
      for (const element of elements) if (element.id && referenced.has(element.id)) ids.set(element.id, `asset-${ids.size}`);
    }
    const hasText = !!clone.querySelector("text, tspan, textPath");
    const usesCurrentColor = elements.some(element => {
      for (const attribute of element.attributes) if (/currentcolor/i.test(attribute.value)) return true;
      return false;
    });
    const presentation = new WeakMap<Element, Record<string, string>>();
    for (const element of elements) {
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
          else if (!(element.localName === "image" && inlineRaster.test(value))) {
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
        if (value !== attribute.value) element.setAttribute(attribute.name, value);
      }
      const inherited = element.parentElement ? presentation.get(element.parentElement) ?? svgDefaults : svgDefaults;
      const values = { ...inherited };
      for (const name of svgProperties) {
        const value = element.getAttribute(name);
        if (value === null) continue;
        if (!nonInherited.has(name)) values[name] = value;
        if ((!hasText && /^(?:font-|text-anchor|dominant-baseline)/.test(name)) || (!usesCurrentColor && name === "color") ||
          value === (nonInherited.has(name) ? svgDefaults[name] : inherited[name])) element.removeAttribute(name);
      }
      presentation.set(element, values);
      // Deterministic markup deduplicates icons with different React IDs,
      // accessibility labels, CSS classes, attribute order, and rendered sizes.
      const attributes = [...element.attributes];
      const compareAttributes = (left: Attr, right: Attr) => left.name.localeCompare(right.name);
      if (attributes.some((attribute, index) => index > 0 && compareAttributes(attributes[index - 1], attribute) > 0)) {
        attributes.sort(compareAttributes);
        attributes.forEach(attribute => element.removeAttributeNode(attribute));
        attributes.forEach(attribute => attribute.namespaceURI
          ? element.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
          : element.setAttribute(attribute.name, attribute.value));
      }
      for (const child of [...element.childNodes]) if (child.nodeType === Node.COMMENT_NODE ||
        (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim() && !["text", "tspan", "textPath"].includes(element.localName))) child.remove();
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgSerializer.serializeToString(clone))}`;
  };
  await visitInBatches(queryAll<SVGSVGElement>("svg"), (svg) => {
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
      let symbolName: string | undefined;
      clone.querySelectorAll<SVGElement>("use").forEach((use) => {
        const reference = use.getAttribute("href") || use.getAttribute("xlink:href");
        if (!reference) {
          unresolvedReference = true;
          return;
        }
        const localId = fragment(reference);
        const identifier = localId || reference.split("#")[1];
        if (!symbolName && identifier && /^[a-z][\w.-]*$/i.test(identifier)) {
          symbolName = identifier.replace(/^icon[-_]/i, "").replace(/[-_]+/g, " ");
        }
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
        if (reference && !reference.startsWith("#") && !inlineRaster.test(reference)) {
          const label = accessibleName(image) || (clone.querySelectorAll("image").length === 1
            ? accessibleName(svg) || cleanDescription(svg.querySelector("title")?.textContent) : undefined);
          const [url] = visualCandidates([reference]);
          if (url && !url.startsWith("data:")) add("image", url, label || "SVG image layer", { position: positionFor(svg) });
          externalImage = true;
        }
      });
      if (unresolvedReference) return;
      const hasReferences = embedDefinitions(clone, svg.getRootNode() as Document | ShadowRoot);
      const control = svg.closest("button, [role=button], a");
      const label = accessibleName(svg) || cleanDescription(svg.querySelector("title")?.textContent) ||
        cleanDescription(svg.getAttribute("data-icon")) || iconClassName(svg) || symbolName ||
        (control ? accessibleName(control) : undefined) || cleanDescription(svg.id) || "Inline SVG icon";
      const kind = (width > 512 || height > 512) && !iconName.test(semantic) ? "image" : "icon";
      if (externalReference || externalImage) {
        svgArtworks.push({ clone, kind, label, width: Math.round(width), height: Math.round(height), position: positionFor(svg) });
        return;
      }
      add(kind, serializeSvg(clone, width, height, hasReferences), label, {
        position: positionFor(svg),
        width: Math.round(width),
        height: Math.round(height),
        mimeType: "image/svg+xml",
      });
    } catch { /* One malformed SVG must not discard other assets on the page. */ }
  });

  const frameCache = globalThis as typeof globalThis & {
    __stashwellVideoFrames?: WeakMap<HTMLVideoElement, { source: string; poster?: string }>;
  };
  const capturedFrame = (video: HTMLVideoElement) => {
    if (!video.currentSrc || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight || video.mediaKeys || video.srcObject) return;
    const cache = frameCache.__stashwellVideoFrames ??= new WeakMap();
    const previous = cache.get(video);
    if (previous?.source === video.currentSrc) return previous.poster;
    let poster: string | undefined;
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 240 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        poster = canvas.toDataURL("image/jpeg", 0.75);
      }
    } catch { /* Cross-origin video may restrict reading a frame. */ }
    cache.set(video, { source: video.currentSrc, poster });
    return poster;
  };
  const posterUrls = new Set<string>();
  queryAll<HTMLMediaElement>("video, audio").forEach(media => {
    const video = media instanceof HTMLVideoElement ? media : undefined;
    const kind = video ? "video" : "audio";
    const position = positionFor(media);
    const name = accessibleName(media);
    const [declaredPoster] = video ? visualCandidates([video.getAttribute("poster") || undefined, video.dataset.poster]).filter(url => !url.startsWith("blob:")) : [];
    if (declaredPoster) {
      posterUrls.add(declaredPoster);
      add("image", declaredPoster, "Video poster image", { description: name, position });
    }
    const sources = new Map<string, string | undefined>();
    const remember = (raw: string | undefined, type?: string) => {
      if (!raw?.trim()) return;
      try {
        const url = new URL(raw, baseUrl);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password) return;
        url.hash = "";
        sources.set(url.href, type || sources.get(url.href));
      } catch { /* Keep the other files declared by this player. */ }
    };
    for (const raw of [media.currentSrc, media.getAttribute("src") || undefined, media.dataset.src, media.dataset.lazySrc]) remember(raw);
    for (const source of media.querySelectorAll("source")) {
      for (const raw of [source.getAttribute("src") || undefined, source.dataset.src, source.dataset.lazySrc]) remember(raw, source.type);
    }
    if (!sources.size) return;
    const posterUrl = declaredPoster || (video && capturedFrame(video));
    const direct = [...sources].filter(([url, type]) => !/\.(?:m3u8|mpd)$/i.test(new URL(url).pathname) && !/mpegurl|dash\+xml/i.test(type || ""));
    for (const [url, mimeType] of sources) {
      const alternatives = direct.map(([href]) => href).filter(href => href !== url);
      add(kind, url, name || (video ? "Video" : "Audio"), {
        position, mimeType, posterUrl,
        width: video?.videoWidth || video?.width || undefined, height: video?.videoHeight || video?.height || undefined,
        variantUrls: alternatives,
      });
    }
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
    const mimeType = node.getAttribute("type") || undefined;
    let kind: ResourceKind = "document";
    try {
      const extension = new URL(url, baseUrl).pathname.match(/\.([a-z\d]+)$/i)?.[1]?.toLowerCase() || "";
      if (imageExtension.test(extension) || /^image\//i.test(mimeType || "") || /^data:image\//i.test(url)) {
        kind = iconExtensions.has(extension) || iconName.test([url, node.id, node.className].join(" ")) ? "icon" : "image";
      }
    } catch { /* add handles malformed addresses consistently. */ }
    add(kind, url, accessibleName(node) || (kind === "document" ? "Embedded file" : kind === "icon" ? "Icon" : "Image"), {
      position: positionFor(node),
      mimeType,
    });
  });

  await visitInBatches(queryAll<HTMLAnchorElement>("a[href]"), (anchor) => {
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
    const kind: ResourceKind = (imageExtension.test(extension) || /^image\//i.test(anchor.type) || /^data:image\//i.test(url)) && !isIconLink
      ? "image" : fontExtensions.has(extension)
      ? "font"
      : isIconLink
        ? "icon"
        : videoExtensions.has(extension) || /^(?:video\/|application\/(?:dash\+xml|(?:vnd\.apple\.|x-)mpegurl))/i.test(anchor.type)
          ? "video"
          : audioExtensions.has(extension) || /^audio\//i.test(anchor.type)
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
    add(kind, url, cleanDescription(anchor.download) || accessibleName(anchor) || cleanDescription(text) || (kind === "link" ? url : "File"), {
      position: positionFor(anchor),
      mimeType: kind === "font"
        ? fontMimeTypes[extension]
        : kind === "icon"
          ? extension === "ico" ? "image/x-icon" : "image/svg+xml"
          : anchor.type || (kind === "document" || kind === "other" || kind === "video" || kind === "audio" || kind === "stylesheet" || kind === "script" ? extension : undefined),
    });
  });

  // Quoted URLs can contain parentheses, and image-set also accepts strings.
  const cssImageUrls = (value: string) => {
    if (!/(?:url|image-set)\(/i.test(value)) return [];
    const urls = [...value.matchAll(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*?))\s*\)/gi)]
      .map(match => match[1] ?? match[2] ?? match[3]);
    if (/image-set\(/i.test(value)) for (const match of value.matchAll(/(?:image-set\(|,)\s*["']([^"']+)["']/gi)) urls.push(match[1]);
    return urls.map(url => url.replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_, hex: string, character: string) =>
      hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : character));
  };
  const namedFontIcon = 'mat-icon[data-mat-icon-type="font"], .material-icons, .material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp';
  const fontIconFamily = /(?:symbols|icons|font\s*awesome|icomoon|glyphicons|ionicons|remixicon)/i;
  await visitInBatches(pageElements, (element) => {
    let appearance: { label?: string; icon: boolean } | undefined;
    const describe = () => {
      if (!appearance) {
        const label = [element.getAttribute("aria-description"), accessibleName(element),
          element.getAttribute("data-description"), element.getAttribute("data-caption")].map(cleanDescription).find(usefulDescription);
        const identity = [label, element.className, element.id].filter(value => typeof value === "string").join(" ");
        appearance = { label, icon: iconName.test(identity) };
      }
      return appearance;
    };
    for (const name of ["data-bg", "data-bg-src", "data-background", "data-background-image"]) {
      const value = element.getAttribute(name)?.trim();
      if (!value || value.startsWith("#") || /^(?:none|transparent|currentcolor|inherit)$/i.test(value)) continue;
      const candidates = cssImageUrls(value);
      if (!candidates.length && /^(?:https?:|data:image\/|blob:|[/.])|\.[a-z\d]{2,5}(?:[?#]|$)/i.test(value)) candidates.push(value);
      for (const url of visualCandidates(candidates)) {
        const { label, icon } = describe();
        add(icon ? "icon" : "image", url, label || (icon ? "Background icon" : "Background image"), {
          description: label, position: positionFor(element),
        });
      }
    }
    for (const pseudo of [null, "::before", "::after"] as const) {
      const style = window.getComputedStyle(element, pseudo);
      const content = style.content;
      // Material/Google Symbols and CSS icon fonts render glyphs, not image URLs.
      // Read the pseudo-element's font as it can differ from its parent (e.g. Font Awesome).
      const pseudoGlyph = pseudo ? content.match(/^(["'])([\s\S]+)\1$/)?.[2] : undefined;
      if (pseudo ? pseudoGlyph : !element.childElementCount) {
        const fontFamily = style.fontFamily;
        if ((fontIconFamily.test(fontFamily) || element.matches(namedFontIcon)) && style.display !== "none" && !element.querySelector("svg")) {
          const glyph = (pseudo ? pseudoGlyph?.replace(/\\([\da-f]{1,6})\s?|\\([\s\S])/gi, (_, hex: string, character: string) =>
            hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : character)
            : element.textContent?.trim() || element.getAttribute("fonticon") || element.getAttribute("data-mat-icon-name"))?.trim();
          const size = parseFloat(style.fontSize);
          const bounds = glyph && glyph.length <= 100 && size > 0 && Number.isFinite(size) ? element.getBoundingClientRect() : undefined;
          if (glyph && bounds && bounds.width > 0 && bounds.height > 0) {
            const font = `${style.fontStyle} ${style.fontWeight} ${size}px ${fontFamily}`;
            const key = JSON.stringify([glyph, font, style.color, style.direction]);
            if (!fontIcons.has(key)) fontIcons.set(key, {
              position: positionFor(element),
              glyph, family: fontFamily, font, color: style.color,
              direction: style.direction === "rtl" ? "rtl" : "ltr", size,
              label: accessibleName(element) ||
                element.getAttribute("data-mat-icon-name") || element.getAttribute("fonticon") ||
                iconClassName(element) || element.closest("button, a")?.getAttribute("aria-label") ||
                (/^[\w -]+$/.test(glyph) ? glyph.replace(/_/g, " ") : "Font icon"),
            });
          }
        }
      }
      const iconProperties = [style.maskImage, style.getPropertyValue("-webkit-mask-box-image-source"), style.cursor];
      const imageProperties = [style.backgroundImage, content, style.borderImageSource, style.listStyleImage, ...iconProperties];
      for (const imageProperty of imageProperties) {
        if (!imageProperty || imageProperty === "none") continue;
        const isMask = iconProperties.includes(imageProperty);
        for (const url of cssImageUrls(imageProperty)) {
          if (!url || url.startsWith("#")) continue;
          const smallVector = /^(?:data:image\/svg\+xml)|\.svg(?:[?#]|$)/i.test(url) && parseFloat(style.width) <= 96 && parseFloat(style.height) <= 96;
          const { label, icon } = describe();
          const isIcon = isMask || icon || smallVector;
          const name = label || (isIcon ? iconClassName(element) : undefined) || (isIcon ? "Background icon" : "Background image");
          add(isIcon ? "icon" : "image", url, name, { description: label, position: positionFor(element) });
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
  for (const root of shadowRoots) stylesheets.push(...root.styleSheets, ...root.adoptedStyleSheets);
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

  const brokenImageUrls = new Set(pageImages.filter(image => image.complete && !image.naturalWidth)
    .map(image => image.currentSrc || image.src));
  for (const resource of resourceRequests()) {
    if (!resource.name || resource.responseEnd <= 0 || (resource.responseStatus !== undefined && resource.responseStatus >= 400)) continue;
    try {
      const url = new URL(resource.name, pageUrl);
      const extension = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
      const label = fontFaceMetadata.get(url.href);
      const filename = url.pathname.split("/").pop()?.replace(/\.[^.]+$/, "") || "Web font";
      const declaredImage = /^(?:img|image|input|icon)$/.test(resource.initiatorType) || posterUrls.has(url.href) ||
        (resource.initiatorType === "video" && (imageExtension.test(extension) || /^image\//i.test(resource.contentType || "")));
      const knownFile = /^(?:css|link|body|object|embed)$/.test(resource.initiatorType);
      const icon = iconExtensions.has(extension) || iconName.test(filename);
      if (fontExtensions.has(extension) || label) add("font", url.href, label || filename, { mimeType: fontMimeTypes[extension] });
      else if (declaredImage || (knownFile && imageExtension.test(extension))) {
        if (!brokenImageUrls.has(url.href)) add(icon ? "icon" : "image", url.href, icon ? "Icon" : "Image");
      } else if (["js", "mjs", "cjs", "wasm"].includes(extension)) add("script", url.href, filename);
      else if (extension === "css") add("stylesheet", url.href, filename, { mimeType: "text/css" });
      else if (!/^(?:m4s|cmfv|cmfa|ts)$/.test(extension) && !/[?&](?:bytestart=\d+|range=\d+-\d+)/i.test(url.search) && !/iso\.segment/i.test(resource.contentType || "")) {
        const mime = resource.contentType;
        if (videoExtensions.has(extension) || /^(?:video\/|application\/(?:dash\+xml|(?:vnd\.apple\.|x-)mpegurl))/i.test(mime || "") || resource.initiatorType === "video") {
          add("video", url.href, filename, { mimeType: mime });
        } else if (audioExtensions.has(extension) || /^audio\//i.test(mime || "") || resource.initiatorType === "audio") {
          add("audio", url.href, filename, { mimeType: mime });
        }
      }
    } catch {
      // Ignore invalid resource timing URLs.
    }
  }

  const spriteDocuments = new Map<string, Promise<Document | undefined>>();
  const readDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const imageMime = async (blob: Blob) => {
    const header = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
    const text = new TextDecoder().decode(header);
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) return "image/png";
    if (header[0] === 0xff && header[1] === 0xd8) return "image/jpeg";
    if (/^GIF8[79]a/.test(text)) return "image/gif";
    if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
    if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) return "image/svg+xml";
    return blob.type.split(";")[0].trim().toLowerCase();
  };
  const rasterLayers = new Map<string, Promise<string | undefined>>();
  const fetchRasterLayer = async (url: string) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await fetch(url, { credentials: "same-origin", signal: controller.signal, referrerPolicy: "no-referrer" });
      const limit = 2 * 1024 * 1024;
      if (!response.ok || Number(response.headers.get("content-length") || 0) > limit) {
        await response.body?.cancel();
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) return;
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); return; }
        chunks.push(value);
      }
      if (!size) return;
      const source = new Blob(chunks, { type: response.headers.get("content-type") || "" });
      const mime = await imageMime(source);
      if (!/^image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/.test(mime)) return;
      return readDataUrl(new Blob([source], { type: mime }));
    } catch { return undefined; }
    finally { window.clearTimeout(timeout); }
  };
  const captureArtwork = async (icon: typeof svgArtworks[number]) => {
    const externalUses = [...icon.clone.querySelectorAll<SVGElement>("use")].filter(use => !(use.getAttribute("href") || use.getAttribute("xlink:href") || "").startsWith("#"));
    const references = externalUses.map(use => use.getAttribute("href") || use.getAttribute("xlink:href") || undefined);
    const fallback = () => references.forEach(reference => add(icon.kind, reference, icon.label,
      { width: icon.width, height: icon.height, mimeType: "image/svg+xml", position: icon.position }));
    try {
      const imported = new Map<string, string>();
      for (const [index, use] of externalUses.entries()) {
        const reference = references[index] || "";
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
          else if (attribute.name === "href" || attribute.name.endsWith(":href")) {
            if (attribute.value.startsWith("#")) element.setAttribute(attribute.name, `#${names.get(attribute.value.slice(1)) ?? attribute.value.slice(1)}`);
            else if (element.localName === "image") element.setAttribute(attribute.name, new URL(attribute.value, spriteUrl).href);
          }
          else element.setAttribute(attribute.name, value);
        }
        const localReference = `#${names.get(symbolId)}`;
        imported.set(reference, localReference);
        use.setAttribute("href", localReference); use.removeAttribute("xlink:href");
        placeholder.remove();
        for (const defs of [...standalone.children]) icon.clone.prepend(defs);
      }
      for (const layer of icon.clone.querySelectorAll("image")) {
        const reference = layer.getAttribute("href") || layer.getAttribute("xlink:href") || "";
        if (!reference || reference.startsWith("#") || inlineRaster.test(reference)) continue;
        const [url] = visualCandidates([reference]);
        if (!url) return;
        let request = rasterLayers.get(url);
        if (!request) { request = fetchRasterLayer(url); rasterLayers.set(url, request); }
        const data = await request;
        if (!data) return;
        layer.setAttribute("href", data);
        layer.removeAttribute("xlink:href");
      }
      add(icon.kind, serializeSvg(icon.clone, icon.width, icon.height), icon.label, {
        position: icon.position,
        width: icon.width, height: icon.height, mimeType: "image/svg+xml",
      });
    } catch { fallback(); }
  };
  let artworkIndex = 0;
  await Promise.all(Array.from({ length: Math.min(6, svgArtworks.length) }, async () => {
    while (artworkIndex < svgArtworks.length) await captureArtwork(svgArtworks[artworkIndex++]);
  }));

  // blob: addresses expire with the page. Persist their bytes as data URLs so
  // the library keeps actual images instead of dead references after a reload.
  for (const [url, image] of blobImages) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const original = await response.blob();
      if (!original.size || original.size > 64 * 1024 * 1024) continue;
      const mime = await imageMime(original);
      if (!/^image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(mime)) continue;
      const dataUrl = await readDataUrl(new Blob([original], { type: mime }));
      add(image.kind, dataUrl, image.label, { ...image.extras, mimeType: mime });
    } catch {
      // Revoked or inaccessible blob URLs cannot be saved as persistent files.
    }
  }

  return { pageUrl, pageTitle, faviconUrl, resources, framePath, frames };
}
