"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  AudioLines,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  File,
  FileImage,
  FileText,
  Files,
  Globe,
  Grid2X2,
  Image as ImageIcon,
  Link2,
  List,
  LoaderCircle,
  Menu,
  MoreVertical,
  Music2,
  PanelLeft,
  Search,
  Shapes,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  Type as TypeIcon,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  createArchive,
  flattenResources,
  labelForResource,
  mergeCaptures,
  parseArchive,
  upsertPageCapture,
  type CapturedResource,
  type PageCapture,
  type ResourceKind,
  type RiskLevel,
} from "@allhere/core";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { LibraryAdapter } from "./adapters";
import { sampleCaptures } from "./sample";

type Mode = "web" | "extension";
type Category = "all" | "pages" | "images" | "saved" | "icons" | "fonts" | "links" | "media" | "files";
type DisplayItem = {
  id: string;
  kind: ResourceKind | "page";
  title: string;
  url: string;
  capture: PageCapture;
  resource?: CapturedResource;
  imageUrl?: string;
};

const categoryItems: Array<{ id: Category; label: string; Icon: LucideIcon }> = [
  { id: "all", label: "All resources", Icon: Files },
  { id: "pages", label: "Pages", Icon: Globe },
  { id: "images", label: "Images", Icon: ImageIcon },
  { id: "saved", label: "Saved items", Icon: Bookmark },
  { id: "icons", label: "Icons", Icon: Shapes },
  { id: "fonts", label: "Fonts", Icon: TypeIcon },
  { id: "links", label: "Links", Icon: Link2 },
  { id: "media", label: "Video & audio", Icon: AudioLines },
  { id: "files", label: "Files", Icon: FileText },
];

function hostnameFor(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "data:") return "Inline resource";
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Local resource";
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function safeWebUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function safeAssetPreviewUrl(rawUrl: string, kind: ResourceKind): string | undefined {
  const webUrl = safeWebUrl(rawUrl);
  if (webUrl) return webUrl;
  if (kind === "icon" && rawUrl.length <= 8_000 && /^data:image\/svg\+xml;charset=utf-8,/i.test(rawUrl)) return rawUrl;
  return undefined;
}

function faviconFor(url: string): string | undefined {
  const safeUrl = safeWebUrl(url);
  if (!safeUrl) return undefined;
  try {
    return `${new URL(safeUrl).origin}/favicon.ico`;
  } catch {
    return undefined;
  }
}

function resourceDescription(item: DisplayItem): string {
  return item.resource?.alt?.trim() || item.title || labelForResource(item.kind === "page" ? "link" : item.kind);
}

function securityState(resource: CapturedResource): {
  label: string;
  level: RiskLevel;
  Icon: LucideIcon;
} {
  const signals = resource.security.signals;
  if (signals.some((item) => item.level === "high-risk")) {
    return { label: "High risk", level: "high-risk", Icon: ShieldAlert };
  }
  if (signals.some((item) => item.level === "caution")) {
    return { label: "Review link", level: "caution", Icon: AlertTriangle };
  }
  if (resource.security.transport === "https") {
    return { label: "HTTPS", level: "clear-signal", Icon: ShieldCheck };
  }
  return { label: "Local check", level: "local-only", Icon: ShieldQuestion };
}

function displayItems(captures: PageCapture[], category: Category): DisplayItem[] {
  if (category === "pages") {
    return captures.map((capture) => ({
      id: `page:${capture.id}`,
      kind: "page",
      title: capture.pageTitle || hostnameFor(capture.pageUrl),
      url: capture.pageUrl,
      capture,
    }));
  }

  return captures.flatMap((capture) =>
    capture.resources
      .filter((resource) => {
        if (category === "images") return resource.kind === "image";
        if (category === "saved") return resource.saved === true;
        if (category === "icons") return resource.kind === "icon";
        if (category === "fonts") return resource.kind === "font";
        if (category === "links") return resource.kind === "link";
        if (category === "media") return resource.kind === "video" || resource.kind === "audio";
        if (category === "files") return resource.kind === "document";
        return true;
      })
      .map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        title: resource.label || labelForResource(resource.kind),
        url: resource.url,
        capture,
        resource,
        imageUrl: resource.kind === "image" || resource.kind === "icon"
          ? safeAssetPreviewUrl(resource.url, resource.kind)
          : undefined,
      })),
  );
}

function kindIcon(kind: DisplayItem["kind"]): LucideIcon {
  switch (kind) {
    case "image":
      return FileImage;
    case "icon":
      return Shapes;
    case "font":
      return TypeIcon;
    case "link":
      return Link2;
    case "video":
      return Video;
    case "audio":
      return Music2;
    case "document":
      return FileText;
    case "page":
      return Globe;
    case "stylesheet":
      return Activity;
    case "script":
      return Activity;
    default:
      return File;
  }
}

function countLabel(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function filenameForResource(item: DisplayItem): string {
  const base = (item.resource?.alt || item.title || "resource")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim()
    .slice(0, 90) || "image";
  let extension = "";
  const mimeType = item.resource?.mimeType?.toLowerCase() ?? "";
  if (mimeType === "image/svg+xml") extension = "svg";
  else if (mimeType === "image/jpeg") extension = "jpg";
  else if (mimeType.startsWith("image/")) extension = mimeType.slice(6).split(";")[0].replace(/[^a-z0-9]/g, "");
  else if (/woff2?|font-woff/.test(mimeType)) extension = mimeType.includes("woff2") ? "woff2" : "woff";
  else if (mimeType === "text/html") extension = "html";
  else if (mimeType === "text/css") extension = "css";
  else if (mimeType.includes("javascript")) extension = "js";
  if (!extension) {
    try {
      extension = new URL(item.url).pathname.match(/\.([a-z0-9]{2,6})$/i)?.[1]?.toLowerCase() ?? "";
    } catch {
      // Use a generic extension when a captured URL cannot be parsed.
    }
  }
  if (!extension) {
    if (item.kind === "image" || item.kind === "icon") extension = "img";
    else if (item.kind === "font") extension = "font";
    else if (item.kind === "video") extension = "mp4";
    else if (item.kind === "audio") extension = "audio";
    else if (item.kind === "link" || item.kind === "page") extension = "html";
    else extension = "bin";
  }
  return `${base}.${extension}`;
}

function topRisk(resource: CapturedResource): RiskLevel {
  const levels: RiskLevel[] = resource.security.signals.map((item) => item.level);
  if (levels.includes("high-risk")) return "high-risk";
  if (levels.includes("caution")) return "caution";
  if (levels.includes("clear-signal")) return "clear-signal";
  return "local-only";
}

function ResourceArt({ item }: { item: DisplayItem }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [failedBlobSource, setFailedBlobSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [blobPreview, setBlobPreview] = useState<{ source: string; url: string } | null>(null);
  const Icon = kindIcon(item.kind);
  const sourceKey = `${item.id}\u0000${item.imageUrl ?? ""}`;
  const directFailed = failedSource === sourceKey;
  const blobUrl = blobPreview?.source === sourceKey && failedBlobSource !== sourceKey
    ? blobPreview.url
    : undefined;
  const imageSource = blobUrl ?? (!directFailed ? item.imageUrl : undefined);

  useEffect(() => {
    if (!directFailed || !item.imageUrl || window.location.protocol !== "chrome-extension:") return;

    const controller = new AbortController();
    let disposed = false;
    let createdUrl: string | undefined;
    const loadPreview = async () => {
      try {
        const response = await fetch(item.imageUrl!, {
          credentials: "omit",
          signal: controller.signal,
        });
        if (!response.ok) return;

        const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
        if (mimeType && !mimeType.startsWith("image/") && mimeType !== "application/octet-stream") return;

        const maxBytes = 16 * 1024 * 1024;
        const declaredBytes = Number(response.headers.get("content-length") ?? 0);
        if (declaredBytes > maxBytes) return;

        let blob: Blob;
        if (response.body) {
          const reader = response.body.getReader();
          const chunks: ArrayBuffer[] = [];
          let totalBytes = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
              await reader.cancel();
              return;
            }
            chunks.push(Uint8Array.from(value).buffer as ArrayBuffer);
          }
          blob = new Blob(chunks, { type: mimeType || "application/octet-stream" });
        } else {
          blob = await response.blob();
          if (blob.size > maxBytes) return;
        }
        if (!blob.size || disposed) return;

        createdUrl = URL.createObjectURL(blob);
        setBlobPreview({ source: sourceKey, url: createdUrl });
      } catch {
        // Keep the placeholder for resources that cannot be fetched or decoded.
      }
    };
    void loadPreview();

    return () => {
      disposed = true;
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [directFailed, item.imageUrl, sourceKey]);

  return (
    <div className={`resource-art resource-art--${item.kind}`}>
      {imageSource && (
        <img
          className={`resource-art__image${loadedSource === imageSource ? " resource-art__image--loaded" : ""}`}
          src={imageSource}
          alt={item.resource?.alt || item.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedSource(imageSource)}
          onError={() => {
            setLoadedSource(null);
            if (imageSource === blobUrl) setFailedBlobSource(sourceKey);
            else setFailedSource(sourceKey);
          }}
        />
      )}
      {(!imageSource || loadedSource !== imageSource) && (
        <div className="resource-art__placeholder" aria-hidden="true">
          <Icon size={26} strokeWidth={1.7} />
        </div>
      )}
      <span className="resource-art__kind">{item.kind === "page" ? "Page" : labelForResource(item.kind)}</span>
    </div>
  );
}

function ResourceFavicon({ item }: { item: DisplayItem }) {
  const candidates = [faviconFor(item.url), safeWebUrl(item.capture.faviconUrl ?? "")]
    .filter((source): source is string => Boolean(source))
    .filter((source, index, all) => all.indexOf(source) === index);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const source = candidates[candidateIndex];

  useEffect(() => setCandidateIndex(0), [item.id, item.url, item.capture.faviconUrl]);

  return (
    <span className="table-name__favicon" aria-hidden="true">
      {source ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onError={() => setCandidateIndex((current) => Math.min(current + 1, candidates.length))}
        />
      ) : <Link2 size={17} strokeWidth={1.8} />}
    </span>
  );
}

function SourcePageMark({ capture, allPages = false }: { capture?: PageCapture; allPages?: boolean }) {
  const source = capture ? safeWebUrl(capture.faviconUrl ?? "") : undefined;
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [capture?.id, source]);

  return (
    <span className="page-scope__mark" aria-hidden="true">
      {allPages ? <Files size={17} strokeWidth={1.8} /> : source && !failed ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onError={() => setFailed(true)}
        />
      ) : <Globe size={17} strokeWidth={1.8} />}
    </span>
  );
}

export function LibraryApp({ adapter, mode }: { adapter: LibraryAdapter; mode: Mode }) {
  const [captures, setCaptures] = useState<PageCapture[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [category, setCategory] = useState<Category>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DisplayItem | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sampleMode, setSampleMode] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sourcePageMenuOpen, setSourcePageMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const sourcePageMenuRef = useRef<HTMLDivElement>(null);
  const captureSequenceRef = useRef(0);
  const captureHandlerRef = useRef<(automatic?: boolean) => Promise<void>>(async () => undefined);

  useEffect(() => {
    let alive = true;
    adapter
      .load()
      .then((stored) => {
        if (alive) {
          setCaptures(stored);
          setSelectedCaptureId(stored[0]?.id ?? null);
        }
      })
      .catch(() => {
        if (alive) setNotice("The library could not be loaded. Refresh the page to try again.");
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    const unsubscribe = adapter.subscribe((stored) => setCaptures(stored));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [adapter]);

  const visibleCaptures = sampleMode ? sampleCaptures : captures;
  const selectedCapture = visibleCaptures.find((capture) => capture.id === selectedCaptureId);
  const scopedCaptures = selectedCapture ? [selectedCapture] : visibleCaptures;
  const allPageResourceCount = useMemo(() => flattenResources(visibleCaptures).length, [visibleCaptures]);
  const allResources = useMemo(() => flattenResources(scopedCaptures), [scopedCaptures]);
  const currentItems = useMemo(
    () => displayItems(scopedCaptures, category),
    [scopedCaptures, category],
  );
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return currentItems;
    return currentItems.filter((item) => {
      const resource = item.resource;
      return [
        item.title,
        item.url,
        hostnameFor(item.url),
        item.capture.pageTitle,
        item.capture.hostname,
        resource?.security.signals.map((signal) => signal.label).join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [currentItems, query]);

  const totalCounts = useMemo(() => {
    const resources = flattenResources(scopedCaptures);
    return {
      all: resources.length,
      pages: scopedCaptures.length,
      images: resources.filter((resource) => resource.kind === "image").length,
      icons: resources.filter((resource) => resource.kind === "icon").length,
      fonts: resources.filter((resource) => resource.kind === "font").length,
      links: resources.filter((resource) => resource.kind === "link").length,
      media: resources.filter((resource) => resource.kind === "video" || resource.kind === "audio").length,
      files: resources.filter((resource) => resource.kind === "document").length,
      saved: resources.filter((resource) => resource.saved === true).length,
    };
  }, [scopedCaptures]);

  useEffect(() => {
    if (selectedCaptureId && !visibleCaptures.some((capture) => capture.id === selectedCaptureId)) {
      setSelectedCaptureId(visibleCaptures[0]?.id ?? null);
    }
  }, [selectedCaptureId, visibleCaptures]);

  useEffect(() => {
    if (!openActionMenuId) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) setOpenActionMenuId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenActionMenuId(null);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openActionMenuId]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!sourcePageMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!sourcePageMenuRef.current?.contains(event.target as Node)) setSourcePageMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSourcePageMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [sourcePageMenuOpen]);

  useEffect(() => {
    setOpenActionMenuId(null);
  }, [category, selectedCaptureId, query, view]);

  const saveCapture = async (capture: PageCapture) => {
    const next = upsertPageCapture(captures, capture);
    await adapter.save(next);
    setCaptures(next);
    setSelectedCaptureId(next.find((saved) => saved.pageUrl === capture.pageUrl)?.id ?? null);
    setSampleMode(false);
    setCategory("all");
    setNotice(`${countLabel(capture.resources.length, "resource")} saved from ${capture.hostname}.`);
  };

  const handleCapture = async (automatic = false) => {
    if (!adapter.captureCurrentPage) return;
    const sequence = ++captureSequenceRef.current;
    setBusy(true);
    if (!automatic) setNotice("");
    try {
      const capture = await adapter.captureCurrentPage();
      if (sequence !== captureSequenceRef.current) return;
      await saveCapture(capture);
    } catch (error) {
      if (sequence === captureSequenceRef.current) {
        setNotice(error instanceof Error ? error.message : "The page could not be scanned. Try again.");
      }
    } finally {
      if (sequence === captureSequenceRef.current) setBusy(false);
    }
  };

  captureHandlerRef.current = handleCapture;

  useEffect(() => {
    if (mode !== "extension" || !loaded || !adapter.subscribeToActiveTabChanges) return;

    let timer: number | undefined;
    let disposed = false;
    const scheduleCapture = () => {
      // Ignore a result from the tab we just switched away from.
      captureSequenceRef.current += 1;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!disposed) void captureHandlerRef.current(true);
      }, 450);
    };

    // Populate the panel for the active tab as soon as the saved library loads.
    scheduleCapture();
    const unsubscribe = adapter.subscribeToActiveTabChanges(scheduleCapture);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      captureSequenceRef.current += 1;
      unsubscribe();
    };
  }, [adapter, loaded, mode]);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const parsed = parseArchive(JSON.parse(await file.text()));
      const imported = mergeCaptures(captures, parsed.captures);
      await adapter.save(imported);
      setCaptures(imported);
      setSelectedCaptureId(imported[0]?.id ?? null);
      setSampleMode(false);
      setNotice(`${countLabel(parsed.captures.length, "page")} imported into this library.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This library file could not be imported.");
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () => {
    if (!captures.length) return;
    const archive = createArchive(captures);
    const blob = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `allhere-library-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
    setNotice("Your library archive has been downloaded.");
  };

  const handleDelete = async (item: DisplayItem) => {
    const next =
      item.kind === "page"
        ? captures.filter((capture) => capture.id !== item.capture.id)
        : captures
            .map((capture) => ({
              ...capture,
              resources: capture.resources.filter((resource) => resource.id !== item.id),
            }));
    await adapter.save(next);
    setCaptures(next);
    setSelected(null);
    setSampleMode(false);
    setNotice(item.kind === "page" ? "Page removed from your library." : "Resource removed from your library.");
  };

  const handleCopy = async (url: string, label = "Address") => {
    try {
      await navigator.clipboard.writeText(url);
      setNotice(`${label} copied to clipboard.`);
    } catch {
      setNotice("Clipboard access is unavailable in this browser context.");
    }
  };

  const handleDownloadResource = async (item: DisplayItem) => {
    setOpenActionMenuId(null);
    const url = safeWebUrl(item.url);
    if (!url) {
      setNotice("This resource does not have a downloadable web address.");
      return;
    }

    const filename = filenameForResource(item);
    try {
      const response = await fetch(url, { credentials: "omit", mode: "cors" });
      if (!response.ok) throw new Error("The image host rejected the download.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      setNotice(`Downloading ${filename}.`);
    } catch {
      setNotice("This resource host blocked the download. Try opening its URL in your browser.");
    }
  };

  const handleToggleSavedResource = async (item: DisplayItem) => {
    const resource = item.resource;
    if (!resource || sampleMode) return;
    const shouldSave = resource.saved !== true;
    const next = captures.map((capture) => ({
      ...capture,
      resources: capture.resources.map((candidate) =>
        candidate.id === resource.id
          ? { ...candidate, saved: shouldSave || undefined }
          : candidate,
      ),
    }));
    try {
      await adapter.save(next);
      setCaptures(next);
      setNotice(shouldSave ? "Resource saved in Saved items." : "Resource removed from Saved items.");
    } catch {
      setNotice("This resource could not be updated in your library. Try again.");
    }
    setOpenActionMenuId(null);
  };

  const selectCategory = (next: Category) => {
    setCategory(next);
    setSelected(null);
    setMobileNavOpen(false);
    setSourcePageMenuOpen(false);
  };

  const selectSourcePage = (captureId: string | null) => {
    setSelectedCaptureId(captureId);
    setCategory("all");
    setSelected(null);
    setQuery("");
    setMobileNavOpen(false);
    setSourcePageMenuOpen(false);
  };

  const activeCount = category === "all" ? totalCounts.all : totalCounts[category];
  const title = categoryItems.find((item) => item.id === category)?.label ?? "All resources";
  const headingTitle = category === "all" ? selectedCapture?.pageTitle || "My library" : title;
  const canExport = captures.length > 0 && !sampleMode;
  const activeView = category === "links" ? "list" : view;

  const renderResourceActions = (item: DisplayItem, inTable = false) => {
    const description = resourceDescription(item);
    const isMenuOpen = openActionMenuId === item.id;
    const isSaved = item.resource?.saved === true;
    const itemLabel = item.kind === "page" ? "page" : labelForResource(item.kind);

    return (
      <div className={`resource-actions${inTable ? " resource-actions--table" : ""}${isMenuOpen ? " resource-actions--open" : ""}`} ref={isMenuOpen ? actionMenuRef : undefined}>
        <button
          className="resource-actions__trigger"
          type="button"
          aria-label={`More actions for ${description}`}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          onClick={(event) => {
            if (isMenuOpen) {
              setOpenActionMenuId(null);
              setActionMenuPosition(null);
              return;
            }
            if (inTable) {
              const rect = event.currentTarget.getBoundingClientRect();
              const menuHeight = item.resource ? 144 : 96;
              const top = rect.bottom + menuHeight + 6 <= window.innerHeight - 8
                ? rect.bottom + 6
                : Math.max(8, rect.top - menuHeight - 6);
              const right = Math.max(8, window.innerWidth - rect.right);
              setActionMenuPosition({ top, right });
            } else {
              setActionMenuPosition(null);
            }
            setOpenActionMenuId(item.id);
          }}
        >
          <MoreVertical size={18} strokeWidth={2} />
        </button>
        {isMenuOpen && (
          <div
            className={`resource-actions__menu${inTable ? " resource-actions__menu--fixed" : ""}`}
            role="menu"
            aria-label={`Actions for ${description}`}
            style={inTable && actionMenuPosition ? { top: actionMenuPosition.top, right: actionMenuPosition.right } : undefined}
          >
            <button className="resource-actions__item" type="button" role="menuitem" onClick={() => { setOpenActionMenuId(null); void handleCopy(item.url, `${itemLabel} URL`); }}>
              <Copy size={16} /><span>Copy URL</span>
            </button>
            <button className="resource-actions__item" type="button" role="menuitem" onClick={() => void handleDownloadResource(item)}>
              <ArrowDownToLine size={16} /><span>Download</span>
            </button>
            {item.resource && (
              <>
                <span className="resource-actions__divider" aria-hidden="true" />
                <button
                  className="resource-actions__item"
                  type="button"
                  role="menuitem"
                  disabled={sampleMode}
                  onClick={() => void handleToggleSavedResource(item)}
                >
                  <Bookmark size={16} fill={isSaved ? "currentColor" : "none"} />
                  <span>{isSaved ? "Remove from Saved items" : "Save to Saved items"}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`allhere-shell allhere-shell--${mode}`}>
      <header className="topbar">
        <div className="topbar__brand-cluster">
          <button
            className="icon-button topbar__menu"
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileNavOpen}
            aria-controls="library-navigation"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <a className="brand" href={mode === "web" ? "/" : "#library"} aria-label="Allhere library home">
            <span className="brand__mark" aria-hidden="true"><PanelLeft size={19} strokeWidth={2.2} /></span>
            <span className="brand__word">allhere</span>
          </a>
        </div>

        <label className="searchbox">
          <Search size={19} strokeWidth={1.9} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your library"
            aria-label="Search your library"
          />
          {query && (
            <button className="searchbox__clear" type="button" aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={16} />
            </button>
          )}
        </label>

        <div className="topbar__actions">
          {mode === "extension" ? (
            <button className="button button--primary button--scan" aria-label="Scan this page" onClick={() => void handleCapture()} disabled={busy || !loaded}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <Activity size={17} />}
              <span>{busy ? "Scanning…" : "Scan this page"}</span>
            </button>
          ) : (
            <button className="button button--primary" aria-label="Import library" onClick={handleImportClick} disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowUpFromLine size={17} />}
              <span>Import library</span>
            </button>
          )}
          <button className="icon-button topbar__export" aria-label="Export library" title="Export library" onClick={handleExport} disabled={!canExport}>
            <ArrowDownToLine size={19} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={handleImport}
          tabIndex={-1}
          aria-hidden="true"
        />
      </header>

      <div className="workspace" id="library">
        <aside id="library-navigation" className={`sidebar${mobileNavOpen ? " sidebar--open" : ""}`} aria-label="Library sections">
          <button className="create-button" onClick={mode === "extension" ? () => void handleCapture() : handleImportClick} disabled={busy}>
            {mode === "extension" ? <Activity size={18} /> : <ArrowUpFromLine size={18} />}
            <span>{mode === "extension" ? "Capture page" : "Import files"}</span>
          </button>

          <div className="nav-group">
            <div className="nav-group__label">Library</div>
            <nav className="nav-list">
              {categoryItems.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={`nav-item${category === id ? " nav-item--active" : ""}`}
                  onClick={() => selectCategory(id)}
                  aria-current={category === id ? "page" : undefined}
                >
                  <Icon size={18} strokeWidth={1.9} />
                  <span>{label}</span>
                  <span className="nav-item__count">{totalCounts[id]}</span>
                </button>
              ))}
            </nav>
          </div>

          {mode === "web" && (
            <div className="sidebar__pages">
              <div className="nav-group__label">Saved pages</div>
              <nav className="nav-list" aria-label="Saved pages">
                <button
                  className={`page-nav-item${selectedCaptureId === null ? " page-nav-item--active" : ""}`}
                  onClick={() => selectSourcePage(null)}
                  aria-current={selectedCaptureId === null ? "page" : undefined}
                >
                  <Files size={16} strokeWidth={1.9} />
                  <span className="page-nav-item__copy"><strong>All pages</strong><small>Every saved source</small></span>
                  <span className="page-nav-item__count">{visibleCaptures.length}</span>
                </button>
                {visibleCaptures.map((capture) => (
                  <button
                    key={capture.id}
                    className={`page-nav-item${selectedCaptureId === capture.id ? " page-nav-item--active" : ""}`}
                    onClick={() => selectSourcePage(capture.id)}
                    aria-current={selectedCaptureId === capture.id ? "page" : undefined}
                    title={`${capture.pageTitle} · ${capture.hostname}`}
                  >
                    <Globe size={16} strokeWidth={1.9} />
                    <span className="page-nav-item__copy">
                      <strong>{capture.pageTitle || capture.hostname}</strong>
                      <small>{capture.hostname}</small>
                    </span>
                    <span className="page-nav-item__count">{capture.resources.length}</span>
                  </button>
                ))}
              </nav>
            </div>
          )}

          <div className="sidebar__bottom">
            <div className="local-status">
              <span className="local-status__icon"><ShieldCheck size={15} /></span>
              <span><strong>Stored on this device</strong><small>Private by default</small></span>
            </div>
            <button className="sidebar-link" onClick={canExport ? handleExport : handleImportClick}>
              {canExport ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}
              {canExport ? "Export library" : "Import an archive"}
            </button>
          </div>
        </aside>
        {mode === "web" && mobileNavOpen && (
          <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />
        )}

        <main className="main-content">
          <div className="content-heading">
            <div className="content-heading__title">
              <h1>{headingTitle}</h1>
              <p>
                {sampleMode
                  ? "A sample workspace with example page resources."
                  : loaded
                    ? selectedCapture
                      ? `${selectedCapture.hostname} · ${countLabel(allResources.length, "resource")}`
                      : `${countLabel(visibleCaptures.length, "page")} · ${countLabel(allResources.length, "resource")}`
                    : "Loading your library…"}
              </p>
            </div>
            <div className="content-heading__actions">
              <button
                className={`button button--secondary${sampleMode ? " button--preview-active" : ""}`}
                onClick={() => {
                  const showSample = !sampleMode;
                  setSampleMode(showSample);
                  setSelectedCaptureId(showSample ? null : captures[0]?.id ?? null);
                  setSelected(null);
                  setQuery("");
                }}
                title={sampleMode ? "Return to your saved library" : "Preview an example library"}
              >
                {sampleMode ? <X size={16} /> : <Files size={16} />}
                <span>{sampleMode ? "Exit preview" : "Preview sample"}</span>
              </button>
              {category !== "links" && (
                <div className="view-switch" role="group" aria-label="Choose layout">
                  <button className={activeView === "grid" ? "is-active" : ""} aria-label="Grid view" aria-pressed={activeView === "grid"} onClick={() => setView("grid")}>
                    <Grid2X2 size={17} />
                  </button>
                  <button className={activeView === "list" ? "is-active" : ""} aria-label="List view" aria-pressed={activeView === "list"} onClick={() => setView("list")}>
                    <List size={18} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {sampleMode && (
            <div className="sample-notice" role="status">
              <span><Files size={16} /> Sample preview</span>
              <p>Example entries are for preview only and are not saved in your library.</p>
            </div>
          )}

          <div className="collection-toolbar">
            {mode === "extension" && (
              <div className="page-scope">
                <span className="page-scope__label">Source page</span>
                <div className={`page-scope__control${sourcePageMenuOpen ? " page-scope__control--open" : ""}`} ref={sourcePageMenuRef}>
                  <button
                    className="page-scope__trigger"
                    type="button"
                    aria-label="Filter resources by source page"
                    aria-haspopup="menu"
                    aria-expanded={sourcePageMenuOpen}
                    aria-controls="source-page-menu"
                    onClick={() => setSourcePageMenuOpen((open) => !open)}
                  >
                    <SourcePageMark capture={selectedCapture} allPages={!selectedCapture} />
                    <span className="page-scope__selection">
                      <strong>{selectedCapture?.pageTitle || selectedCapture?.hostname || "All pages"}</strong>
                      <small>{selectedCapture?.hostname || `${visibleCaptures.length} saved pages`}</small>
                    </span>
                    <span className="page-scope__count">{selectedCapture?.resources.length ?? allPageResourceCount}</span>
                    <ChevronDown size={17} aria-hidden="true" />
                  </button>
                  {sourcePageMenuOpen && (
                    <div className="page-scope__menu" id="source-page-menu" role="menu" aria-label="Choose a source page">
                      <button
                        className={`page-scope__option${selectedCapture ? "" : " page-scope__option--active"}`}
                        type="button"
                        role="menuitemradio"
                        aria-checked={!selectedCapture}
                        onClick={() => selectSourcePage(null)}
                      >
                        <SourcePageMark allPages />
                        <span className="page-scope__option-copy"><strong>All pages</strong><small>{countLabel(visibleCaptures.length, "saved page")}</small></span>
                        <span className="page-scope__count">{allPageResourceCount}</span>
                      </button>
                      {visibleCaptures.map((capture) => (
                        <button
                          key={capture.id}
                          className={`page-scope__option${selectedCapture?.id === capture.id ? " page-scope__option--active" : ""}`}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selectedCapture?.id === capture.id}
                          title={`${capture.pageTitle || capture.hostname} · ${capture.pageUrl}`}
                          onClick={() => selectSourcePage(capture.id)}
                        >
                          <SourcePageMark capture={capture} />
                          <span className="page-scope__option-copy"><strong>{capture.pageTitle || capture.hostname}</strong><small>{capture.pageUrl}</small></span>
                          <span className="page-scope__count">{capture.resources.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="category-pills" role="tablist" aria-label="Filter resources">
              {categoryItems.map(({ id, label }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={category === id}
                  className={`category-pill${category === id ? " category-pill--active" : ""}`}
                  onClick={() => selectCategory(id)}
                >
                  {label}
                  <span>{totalCounts[id]}</span>
                </button>
              ))}
            </div>
            <div className="collection-meta">
              <span>{query ? `${filteredItems.length} of ${activeCount}` : countLabel(activeCount, "item")}</span>
              {category !== "links" && (
                <>
                  <span className="collection-meta__dot" aria-hidden="true">·</span>
                  <button className="sort-button" onClick={() => setView((current) => current === "grid" ? "list" : "grid")}>
                    {activeView === "grid" ? <Grid2X2 size={15} /> : <List size={16} />}
                    <span>{activeView === "grid" ? "Grid" : "List"}</span>
                    <ChevronRight className="sort-button__chevron" size={15} />
                  </button>
                </>
              )}
            </div>
          </div>

          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              <button className="icon-button icon-button--small" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16} /></button>
            </div>
          )}

          <div className={`library-layout${selected ? " library-layout--details" : ""}`}>
            <section className="resource-section" aria-label={title}>
              {!loaded ? (
                <div className="loading-state"><LoaderCircle className="spin" size={23} /><span>Opening your library…</span></div>
              ) : filteredItems.length === 0 ? (
                query ? (
                  <div className="empty-state empty-state--compact">
                    <Search size={25} />
                    <h2>No results found</h2>
                    <p>Try another title, website, or resource type.</p>
                    <button className="button button--secondary" onClick={() => setQuery("")}>Clear search</button>
                  </div>
                ) : captures.length === 0 && !sampleMode ? (
                  <div className="empty-state">
                    <div className="empty-state__mark"><ImageIcon size={25} /><Link2 size={18} /></div>
                    <h2>Your library starts with a page</h2>
                    <p>
                      {mode === "extension"
                        ? "Scan this page to collect its images, icons, fonts, links, media, and files."
                        : "Capture resources in the Chrome side panel, then import your library here."}
                    </p>
                    {mode === "extension" ? (
                      <button className="button button--primary" onClick={() => void handleCapture()} disabled={busy}>
                        {busy ? <LoaderCircle className="spin" size={17} /> : <Activity size={17} />}
                        <span>{busy ? "Scanning…" : "Scan this page"}</span>
                      </button>
                    ) : (
                      <button className="button button--primary" onClick={handleImportClick}>
                        <ArrowUpFromLine size={17} /><span>Import from extension</span>
                      </button>
                    )}
                    <button className="text-button" onClick={() => setSampleMode(true)}>Explore a sample library</button>
                  </div>
                ) : (
                  <div className="empty-state empty-state--compact">
                    <Files size={27} />
                    <h2>{selectedCapture ? `No ${category === "all" ? "resources" : title.toLowerCase()} on this page` : `No ${title.toLowerCase()} yet`}</h2>
                    <p>{selectedCapture ? "Choose another page or scan this page again." : "Choose another section or scan a page that contains this kind of resource."}</p>
                  </div>
                )
              ) : activeView === "grid" ? (
                <div className="resource-grid">
                  {filteredItems.map((item) => {
                    const description = resourceDescription(item);
                    const isMenuOpen = openActionMenuId === item.id;

                    return (
                      <div className={`resource-card-frame${isMenuOpen ? " resource-card-frame--menu-open" : ""}`} key={item.id}>
                        <button
                          className={`resource-card${selected?.id === item.id ? " resource-card--selected" : ""}`}
                          onClick={() => setSelected(item)}
                          aria-label={description}
                        >
                          <ResourceArt item={item} />
                          <span className="resource-card__copy resource-card__copy--description">
                            <span className="resource-card__description" title={description}>{description}</span>
                          </span>
                        </button>
                        {renderResourceActions(item)}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="resource-table-wrap">
                  <table className={`resource-table${category === "links" ? " resource-table--links" : ""}`}>
                    <thead>
                      <tr>
                        <th scope="col">{category === "links" ? "Link" : "Name"}</th>
                        {category !== "links" && <th scope="col">Type</th>}
                        {category === "links" && <th scope="col">Security</th>}
                        <th scope="col">Source page</th>
                        {category !== "links" && <th scope="col">Security</th>}
                        <th scope="col">Captured</th>
                        <th scope="col"><span className="visually-hidden">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item) => {
                        const Icon = kindIcon(item.kind);
                        return (
                          <tr key={item.id} className={selected?.id === item.id ? "row-selected" : ""}>
                            <td>
                              <button className={`table-name${category === "links" ? " table-name--link" : ""}`} onClick={() => setSelected(item)}>
                                {category === "links" ? <ResourceFavicon item={item} /> : <span className={`table-name__icon table-name__icon--${item.kind}`}><Icon size={17} /></span>}
                                <span><strong>{item.title}</strong><small>{category === "links" ? item.url : hostnameFor(item.url)}</small></span>
                              </button>
                            </td>
                            {category !== "links" && <td>{item.kind === "page" ? "Page" : labelForResource(item.kind)}</td>}
                            {category === "links" && <td>{item.resource ? <SecurityPip resource={item.resource} /> : <span className="muted-dash">—</span>}</td>}
                            <td className="table-source">{item.capture.pageTitle}</td>
                            {category !== "links" && <td>{item.resource ? <SecurityPip resource={item.resource} /> : <span className="muted-dash">—</span>}</td>}
                            <td>{dateLabel(item.capture.capturedAt)}</td>
                            <td className="table-actions">{renderResourceActions(item, true)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {selected && (
              <ResourceDetails
                item={selected}
                onClose={() => setSelected(null)}
                onDelete={() => sampleMode ? setSelected(null) : handleDelete(selected)}
                onCopy={handleCopy}
                allowDelete={!sampleMode}
              />
            )}
          </div>
        </main>
      </div>

      <footer className="app-footer">
        <span><ShieldCheck size={14} /> Link checks run on this device</span>
        <span>HTTPS is a connection signal, not a trust guarantee.</span>
      </footer>
    </div>
  );
}

function SecurityPip({ resource }: { resource: CapturedResource }) {
  const state = securityState(resource);
  const Icon = state.Icon;
  return (
    <span className={`security-pip security-pip--${state.level}`} title={state.label}>
      <Icon size={13} strokeWidth={2} />
      <span>{state.label}</span>
    </span>
  );
}

function ResourceDetails({
  item,
  onClose,
  onDelete,
  onCopy,
  allowDelete,
}: {
  item: DisplayItem;
  onClose: () => void;
  onDelete: () => void;
  onCopy: (url: string) => void;
  allowDelete: boolean;
}) {
  const resource = item.resource;
  const webUrl = safeWebUrl(item.url);
  const Icon = kindIcon(item.kind);

  return (
    <aside className="details-panel" aria-label="Resource details">
      <div className="details-panel__top">
        <span className="details-panel__heading">Details</span>
        <button className="icon-button icon-button--small" aria-label="Close details" onClick={onClose}><X size={17} /></button>
      </div>

      <ResourceArt item={item} />

      <div className="details-title">
        <span className={`details-title__icon details-title__icon--${item.kind}`}><Icon size={17} /></span>
        <div><h2>{item.title}</h2><p>{item.kind === "page" ? "Source page" : labelForResource(item.kind)}</p></div>
      </div>

      <div className="details-block">
        <div className="details-label">Address</div>
        <div className="address-box">
          <span className="address-box__url" title={item.url}>{item.url}</span>
          <button className="icon-button icon-button--small" aria-label="Copy address" onClick={() => onCopy(item.url)}><Copy size={15} /></button>
        </div>
        <div className="host-line"><Globe size={14} /><span>{hostnameFor(item.url)}</span></div>
      </div>

      <div className="details-block">
        <div className="details-label">Found on</div>
        <div className="source-detail">
          <span className="source-detail__icon"><Globe size={16} /></span>
          <span><strong>{item.capture.pageTitle}</strong><small>{item.capture.hostname}</small></span>
        </div>
      </div>

      <div className="details-block details-block--security">
        <div className="details-label">Local security check</div>
        <div className="check-method"><Activity size={14} /><span>URL patterns only · {resource?.security.transport === "https" ? "HTTPS connection" : resource?.security.transport === "http" ? "HTTP connection" : "No web transport"}</span></div>
        {resource ? (
          <ul className="signal-list">
            {resource.security.signals.map((signal) => {
              const SignalIcon = signal.level === "high-risk" ? ShieldAlert : signal.level === "caution" ? AlertTriangle : signal.level === "clear-signal" ? ShieldCheck : ShieldQuestion;
              return (
                <li className={`signal signal--${signal.level}`} key={signal.id}>
                  <SignalIcon size={16} />
                  <span><strong>{signal.label}</strong><small>{signal.explanation}</small></span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="check-method"><ShieldQuestion size={15} /><span>Page address is shown for context. Page safety is not assessed.</span></div>
        )}
        <p className="details-disclaimer">A local pattern check cannot confirm site reputation, redirects, page content, or whether a file is safe.</p>
      </div>

      <div className="details-block details-block--metadata">
        <div className="details-label">Resource details</div>
        <dl className="metadata-list">
          <div><dt>Captured</dt><dd><Clock3 size={13} />{dateLabel(item.capture.capturedAt)}</dd></div>
          {resource?.width && resource.height && <div><dt>Dimensions</dt><dd>{resource.width} × {resource.height}</dd></div>}
          {resource?.mimeType && <div><dt>Format</dt><dd>{resource.mimeType}</dd></div>}
          {resource?.alt && <div><dt>Alt text</dt><dd className="metadata-alt">{resource.alt}</dd></div>}
        </dl>
      </div>

      <div className="details-actions">
        {webUrl ? (
          <a className="button button--primary details-open" href={webUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} /><span>Open resource</span>
          </a>
        ) : (
          <button className="button button--disabled" disabled title="Only standard web URLs can be opened from the library">
            <ExternalLink size={16} /><span>Cannot open this address</span>
          </button>
        )}
        {allowDelete && <button className="icon-button details-delete" aria-label="Remove from library" title="Remove from library" onClick={onDelete}><Trash2 size={17} /></button>}
      </div>
    </aside>
  );
}
