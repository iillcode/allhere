export type ResourceKind =
  | "image"
  | "icon"
  | "font"
  | "video"
  | "audio"
  | "document"
  | "stylesheet"
  | "script"
  | "link"
  | "other";

export type RiskLevel = "clear-signal" | "caution" | "high-risk" | "local-only";

export type SecuritySignal = {
  id: string;
  level: RiskLevel;
  label: string;
  explanation: string;
};

export type ResourceSecurity = {
  transport: "https" | "http" | "local" | "unknown";
  relation: "same-host" | "external-host" | "unknown";
  hostname: string;
  signals: SecuritySignal[];
  checkedAt: string;
  method: "local-heuristics";
};

export type CapturedResource = {
  id: string;
  kind: ResourceKind;
  url: string;
  pageUrl: string;
  pageTitle: string;
  label: string;
  alt?: string;
  description?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  saved?: boolean;
  capturedAt: string;
  security: ResourceSecurity;
};

export type PageCapture = {
  id: string;
  pageUrl: string;
  pageTitle: string;
  hostname: string;
  faviconUrl?: string;
  capturedAt: string;
  resources: CapturedResource[];
};

export type LibraryArchive = {
  format: "allhere-library";
  version: 1;
  exportedAt: string;
  captures: PageCapture[];
};

export const LIBRARY_STORAGE_KEY = "allhere.library.v1";
export const ARCHIVE_FORMAT = "allhere-library" as const;

const SHORTENERS = new Set([
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "ow.ly",
  "is.gd",
  "lnkd.in",
  "goo.gl",
]);

const EXECUTABLE_EXTENSIONS = new Set([
  "apk",
  "bat",
  "cmd",
  "com",
  "dmg",
  "exe",
  "msi",
  "ps1",
  "scr",
  "sh",
]);

const LOCAL_SCHEMES = new Set(["blob:", "data:"]);
const ACTIVE_SCHEMES = new Set(["http:", "https:"]);

function signal(
  id: string,
  level: RiskLevel,
  label: string,
  explanation: string,
): SecuritySignal {
  return { id, level, label, explanation };
}

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
}

function isSameHost(resourceHost: string, pageHost: string): boolean {
  return resourceHost.toLowerCase() === pageHost.toLowerCase();
}

/**
 * Reads only the URL string and the source page URL. It does not fetch, ping,
 * or disclose the destination to a third party.
 */
export function inspectResourceUrl(
  rawUrl: string,
  pageUrl: string,
  checkedAt = new Date().toISOString(),
): ResourceSecurity {
  const signals: SecuritySignal[] = [];

  if (!rawUrl.trim()) {
    return {
      transport: "unknown",
      relation: "unknown",
      hostname: "",
      signals: [
        signal(
          "empty-url",
          "high-risk",
          "Missing address",
          "No destination address was available to inspect.",
        ),
      ],
      checkedAt,
      method: "local-heuristics",
    };
  }

  let url: URL;
  let page: URL | undefined;
  try {
    url = new URL(rawUrl, pageUrl);
    page = new URL(pageUrl);
  } catch {
    return {
      transport: "unknown",
      relation: "unknown",
      hostname: "",
      signals: [
        signal(
          "invalid-url",
          "high-risk",
          "Unreadable URL",
          "The address could not be parsed, so its destination and transport could not be checked.",
        ),
      ],
      checkedAt,
      method: "local-heuristics",
    };
  }

  const scheme = url.protocol.toLowerCase();
  const hostname = url.hostname;
  const isLocal = LOCAL_SCHEMES.has(scheme);
  const transport =
    scheme === "https:"
      ? "https"
      : scheme === "http:"
        ? "http"
        : isLocal
          ? "local"
          : "unknown";
  const relation =
    hostname && page?.hostname
      ? isSameHost(hostname, page.hostname)
        ? "same-host"
        : "external-host"
      : "unknown";

  if (scheme === "https:") {
    signals.push(
      signal(
        "https-transport",
        "clear-signal",
        "HTTPS transport",
        "The URL uses HTTPS. This protects the connection in transit, but does not establish that the destination is trustworthy.",
      ),
    );
  } else if (scheme === "http:") {
    signals.push(
      signal(
        "http-transport",
        "caution",
        "Unencrypted HTTP",
        "This URL does not encrypt its connection. Content or redirects could be changed in transit.",
      ),
    );
  } else if (isLocal) {
    signals.push(
      signal(
        "local-resource",
        "local-only",
        scheme === "blob:" ? "Page-created blob" : "Embedded data URL",
        "This address is local to the page or embedded in it; it does not identify a public HTTPS destination.",
      ),
    );
  } else if (scheme === "javascript:" || scheme === "vbscript:") {
    signals.push(
      signal(
        "script-link",
        "high-risk",
        "Executable link scheme",
        "This address can run script code when opened. Do not open it unless you fully understand its source and behavior.",
      ),
    );
  } else if (scheme === "mailto:" || scheme === "tel:") {
    signals.push(
      signal(
        "external-handler",
        "local-only",
        "Opens an external handler",
        "This address may open an email or phone app instead of a webpage. No web destination was checked.",
      ),
    );
  } else {
    signals.push(
      signal(
        "unsupported-scheme",
        "caution",
        `Non-web link scheme: ${scheme || "missing"}`,
        "This address does not use standard web transport. Check which app or handler will open it.",
      ),
    );
  }

  if (url.username || url.password) {
    signals.push(
      signal(
        "embedded-credentials",
        "high-risk",
        "Credentials in address",
        "The URL contains a username or password before the host, a pattern that can disguise the actual destination.",
      ),
    );
  }

  if (hostname.toLowerCase().includes("xn--")) {
    signals.push(
      signal(
        "punycode-host",
        "caution",
        "Encoded hostname",
        "The host contains an internationalized-domain encoding. Check the displayed hostname carefully for lookalike characters.",
      ),
    );
  }

  if (hostname && isIpAddress(hostname)) {
    signals.push(
      signal(
        "ip-host",
        "caution",
        "Direct IP address",
        "This URL points directly to an IP address instead of a named domain.",
      ),
    );
  }

  if (hostname && SHORTENERS.has(hostname.toLowerCase())) {
    signals.push(
      signal(
        "shortened-url",
        "caution",
        "Shortened destination",
        "The final destination is hidden behind a URL shortener and has not been followed or checked.",
      ),
    );
  }

  const extension = url.pathname.split(".").at(-1)?.toLowerCase();
  if (extension && EXECUTABLE_EXTENSIONS.has(extension)) {
    signals.push(
      signal(
        "executable-file",
        "high-risk",
        `Executable file (.${extension})`,
        "This link appears to point to an executable or installable file. Only open it if you trust its source.",
      ),
    );
  }

  if (scheme === "https:" && relation === "external-host") {
    signals.push(
      signal(
        "external-host",
        "local-only",
        "External host",
        "This resource is served by a different host than the page where it was found.",
      ),
    );
  }

  return {
    transport,
    relation,
    hostname,
    signals,
    checkedAt,
    method: "local-heuristics",
  };
}

export function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

export function createArchive(captures: PageCapture[]): LibraryArchive {
  return {
    format: ARCHIVE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    captures,
  };
}

export function parseArchive(value: unknown): LibraryArchive {
  if (
    !value ||
    typeof value !== "object" ||
    (value as Partial<LibraryArchive>).format !== ARCHIVE_FORMAT ||
    (value as Partial<LibraryArchive>).version !== 1 ||
    !Array.isArray((value as Partial<LibraryArchive>).captures)
  ) {
    throw new Error("This file is not a supported Allhere library archive.");
  }

  const now = new Date().toISOString();
  const captures = (value as { captures: unknown[] }).captures.flatMap((entry, captureIndex) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<PageCapture>;
    if (typeof candidate.pageUrl !== "string" || typeof candidate.pageTitle !== "string") return [];
    const pageTitle = candidate.pageTitle;
    let pageUrl: URL;
    try {
      pageUrl = new URL(candidate.pageUrl);
    } catch {
      return [];
    }
    if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") return [];

    const capturedAt =
      typeof candidate.capturedAt === "string" && !Number.isNaN(Date.parse(candidate.capturedAt))
        ? candidate.capturedAt
        : now;
    const resources = Array.isArray(candidate.resources)
      ? candidate.resources.flatMap((rawResource, resourceIndex) => {
          if (!rawResource || typeof rawResource !== "object") return [];
          const resource = rawResource as Partial<CapturedResource>;
          if (typeof resource.url !== "string" || typeof resource.label !== "string") return [];
          const validKinds: ResourceKind[] = [
            "image", "icon", "font", "video", "audio", "document", "stylesheet", "script", "link", "other",
          ];
          if (!resource.kind || !validKinds.includes(resource.kind)) return [];
          const resourceCapturedAt =
            typeof resource.capturedAt === "string" && !Number.isNaN(Date.parse(resource.capturedAt))
              ? resource.capturedAt
              : capturedAt;
          const stringId = typeof resource.id === "string" && resource.id.length < 180
            ? resource.id
            : `imported_resource_${captureIndex}_${resourceIndex}`;
          return [{
            id: stringId,
            kind: resource.kind,
            url: resource.url,
            pageUrl: pageUrl.href,
            pageTitle,
            label: resource.label,
            ...(typeof resource.alt === "string" ? { alt: resource.alt } : {}),
            ...(typeof resource.description === "string" ? { description: resource.description } : {}),
            ...(Number.isFinite(resource.width) ? { width: resource.width } : {}),
            ...(Number.isFinite(resource.height) ? { height: resource.height } : {}),
            ...(typeof resource.mimeType === "string" ? { mimeType: resource.mimeType } : {}),
            ...(resource.saved === true ? { saved: true } : {}),
            capturedAt: resourceCapturedAt,
            security: inspectResourceUrl(resource.url, pageUrl.href, now),
          } satisfies CapturedResource];
        })
      : [];

    return [{
      id: typeof candidate.id === "string" && candidate.id.length < 180
        ? candidate.id
        : `imported_capture_${captureIndex}`,
      pageUrl: pageUrl.href,
      pageTitle,
      hostname: pageUrl.hostname,
      ...(typeof candidate.faviconUrl === "string" ? { faviconUrl: candidate.faviconUrl } : {}),
      capturedAt,
      resources,
    } satisfies PageCapture];
  });

  return {
    format: ARCHIVE_FORMAT,
    version: 1,
    exportedAt: now,
    captures,
  };
}

export function mergeCaptures(
  current: PageCapture[],
  incoming: PageCapture[],
): PageCapture[] {
  const byId = new Map(current.map((capture) => [capture.id, capture]));
  for (const capture of incoming) byId.set(capture.id, capture);
  return [...byId.values()].sort(
    (left, right) =>
      new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime(),
  );
}

// Only URL parameters that describe a resized representation are collapsed.
// Signed IDs and other query parameters stay part of the resource identity.
export function resourceIdentity(resource: Pick<CapturedResource, "kind" | "url">): string {
  if (resource.kind !== "image" && resource.kind !== "icon") return `${resource.kind}:${resource.url}`;
  try {
    const url = new URL(resource.url);
    // SVG fragment IDs select different symbols in the same sprite file.
    if (resource.kind !== "icon") url.hash = "";
    for (const name of [...url.searchParams.keys()]) {
      if (/^(?:dpr|fm|format|h|height|imwidth|q|quality|sz|w|width|fbclid|gclid|igshid|utm_.*)$/i.test(name)) {
        url.searchParams.delete(name);
      }
    }
    url.searchParams.sort();
    return `visual:${url.href}`;
  } catch { return `visual:${resource.url}`; }
}

export function dedupeResources(resources: CapturedResource[]): CapturedResource[] {
  const result: CapturedResource[] = [];
  const indexes = new Map<string, number>();
  for (const resource of resources) {
    const key = resourceIdentity(resource);
    const index = indexes.get(key);
    if (index === undefined) { indexes.set(key, result.length); result.push(resource); continue; }
    const existing = result[index];
    const visual = resource.kind === "image" || resource.kind === "icon";
    const oldArea = (existing.width ?? 0) * (existing.height ?? 0);
    const newArea = (resource.width ?? 0) * (resource.height ?? 0);
    const preferNew = visual ? newArea > oldArea : true;
    const winner = preferNew ? resource : existing;
    const descriptive = (label: string) => !/^(?:image|icon|page icon|inline svg icon|background image|background icon)$/i.test(label);
    result[index] = {
      ...winner,
      id: existing.id,
      kind: visual && (existing.kind === "icon" || resource.kind === "icon") ? "icon" : winner.kind,
      label: descriptive(winner.label) ? winner.label : descriptive(resource.label) ? resource.label : descriptive(existing.label) ? existing.label : winner.label,
      alt: winner.alt || resource.alt || existing.alt,
      description: winner.description || resource.description || existing.description,
      saved: existing.saved || resource.saved || undefined,
      capturedAt: resource.capturedAt,
    };
  }
  return result;
}

export function upsertPageCapture(
  current: PageCapture[],
  incoming: PageCapture,
): PageCapture[] {
  const previous = current.find((capture) => capture.pageUrl === incoming.pageUrl);
  const replacement = previous
    ? {
        ...incoming,
        id: previous.id,
        resources: dedupeResources([...previous.resources, ...incoming.resources]),
      }
    : { ...incoming, resources: dedupeResources(incoming.resources) };
  return mergeCaptures(
    current.filter((capture) => capture.pageUrl !== incoming.pageUrl),
    [replacement],
  );
}

export function flattenResources(captures: PageCapture[]): CapturedResource[] {
  return captures.flatMap((capture) => capture.resources);
}

export function labelForResource(kind: ResourceKind): string {
  const labels: Record<ResourceKind, string> = {
    image: "Image",
    icon: "Icon",
    font: "Font",
    video: "Video",
    audio: "Audio",
    document: "File",
    stylesheet: "Stylesheet",
    script: "Script",
    link: "Link",
    other: "Resource",
  };
  return labels[kind];
}
