"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  AudioLines,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  File,
  FileArchive,
  FileAudio2,
  FileChartColumn,
  FileCode2,
  FileCog,
  FileImage,
  FileJson2,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo2,
  Files,
  Globe,
  Grid2X2,
  GripVertical,
  Image as ImageIcon,
  Link2,
  List,
  LoaderCircle,
  Menu,
  MoreVertical,
  Music2,
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
  resourceIdentity,
  upsertPageCapture,
  type CapturedResource,
  type PageCapture,
  type ResourceKind,
  type RiskLevel,
} from "@allhere/core";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type HTMLAttributes, type ReactNode } from "react";
import type { LibraryAdapter } from "./adapters";
import { iconAsSvg, loadImageFile } from "./assetFiles";
import { createResourceZip } from "./bulkExport";
import { extensionForMime, loadDownloadFile } from "./downloadFiles";
import { DownloadFormatSelect } from "./DownloadFormatSelect";
import { convertImageDownload, originalDownloadFormats, type DownloadFormats, type IconDownloadFormat, type ImageDownloadFormat } from "./imageDownloads";
import { iconNeedsDarkBackground } from "./iconContrast";
import { loadResourceFile } from "./resourceFiles";
import { useResourceDrag } from "./useResourceDrag";
import { useActivePage } from "./useActivePage";
import { useAutoUpdates, type AutoCaptureRequest } from "./useAutoUpdates";
import { TabFavicon } from "./TabFavicon";
import { sampleCaptures } from "./sample";
import { LibraryManager } from "./LibraryManager";
import { DownloadTray } from "./DownloadTray";
import { useDownloads, youtubeId } from "./downloads";
import { emptyCaptureExclusions, filterExcludedCapture, restorePageCapture, scopeSavedCaptures, type CaptureExclusions } from "./libraryManagement";
import { requestWebsiteAccess, websiteOrigins } from "./websiteAccess";

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

function selectionKey(item: DisplayItem): string {
  return `${item.capture.id}:${item.id}`;
}

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

const tabCategoryItems = categoryItems.filter(({ id }) => id !== "pages" && id !== "saved");
const albumCategories: Category[] = ["images", "icons", "media", "links", "fonts", "files"];

type FileTone = "archive" | "audio" | "code" | "document" | "font" | "image" | "package" | "pdf" | "presentation" | "script" | "sheet" | "video" | "generic";

function isFileKind(kind: DisplayItem["kind"]): boolean {
  return kind === "document" || kind === "stylesheet" || kind === "script" || kind === "other";
}

function fileTypeFor(item: DisplayItem): { extension: string; Icon: LucideIcon; tone: FileTone } {
  let extension = "";
  try {
    extension = new URL(item.url).pathname.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase() ?? "";
  } catch {
    // An inline or malformed resource can still be identified by MIME type or kind.
  }

  const mime = item.resource?.mimeType?.toLowerCase() ?? "";
  if (!extension) {
    if (/^[a-z0-9]{1,10}$/.test(mime)) extension = mime;
    else if (mime.includes("pdf")) extension = "pdf";
    else if (mime.includes("csv")) extension = "csv";
    else if (mime.includes("spreadsheet") || mime.includes("excel")) extension = "xlsx";
    else if (mime.includes("wordprocessing") || mime.includes("msword")) extension = "docx";
    else if (mime.includes("presentation") || mime.includes("powerpoint")) extension = "pptx";
    else if (mime.includes("json")) extension = "json";
    else if (mime.includes("javascript")) extension = "js";
    else if (mime.includes("css")) extension = "css";
    else if (mime.includes("html")) extension = "html";
    else if (mime.includes("xml")) extension = "xml";
    else if (mime.includes("zip")) extension = "zip";
    else if (mime.startsWith("text/")) extension = "txt";
    else if (item.kind === "stylesheet") extension = "css";
    else if (item.kind === "script") extension = "js";
  }

  const badge = (extension || "file").slice(0, 4).toUpperCase();
  if (extension === "pdf") return { extension: badge, Icon: FileText, tone: "pdf" };
  if (["csv", "tsv", "xls", "xlsx", "ods", "numbers"].includes(extension)) return { extension: badge, Icon: FileSpreadsheet, tone: "sheet" };
  if (["ppt", "pptx", "odp", "key"].includes(extension)) return { extension: badge, Icon: FileChartColumn, tone: "presentation" };
  if (["doc", "docx", "odt", "rtf", "pages", "txt", "md", "markdown", "epub"].includes(extension)) return { extension: badge, Icon: FileText, tone: "document" };
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz"].includes(extension)) return { extension: badge, Icon: FileArchive, tone: "archive" };
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "ico", "tiff", "psd", "ai", "sketch", "fig"].includes(extension)) return { extension: badge, Icon: FileImage, tone: "image" };
  if (["exe", "dmg", "msi", "apk", "deb", "rpm"].includes(extension)) return { extension: badge, Icon: FileCog, tone: "package" };
  if (["mp4", "webm", "mov", "avi", "mkv", "m4v"].includes(extension)) return { extension: badge, Icon: FileVideo2, tone: "video" };
  if (["mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(extension)) return { extension: badge, Icon: FileAudio2, tone: "audio" };
  if (["woff", "woff2", "ttf", "otf", "eot"].includes(extension)) return { extension: badge, Icon: FileType2, tone: "font" };
  if (["json", "jsonl", "map"].includes(extension)) return { extension: badge, Icon: FileJson2, tone: "code" };
  if (["js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "java", "rs", "c", "cpp", "h", "sh", "bat", "ps1", "sql", "wasm"].includes(extension)) return { extension: badge, Icon: FileCode2, tone: "script" };
  if (["css", "scss", "sass", "less", "html", "htm", "xml", "yaml", "yml", "vue", "svelte"].includes(extension)) return { extension: badge, Icon: FileCode2, tone: "code" };
  return { extension: badge, Icon: item.kind === "document" ? FileText : File, tone: "generic" };
}

function FileTypeMark({ item }: { item: DisplayItem }) {
  const { extension, Icon, tone } = fileTypeFor(item);
  return (
    <span className={`file-type-mark file-type-mark--${tone}`}>
      <Icon size={36} strokeWidth={1.6} aria-hidden="true" />
      <span className="file-type-mark__badge" aria-hidden="true">{extension}</span>
    </span>
  );
}

function resourceMatchesCategory(resource: CapturedResource, category: Category): boolean {
  if (category === "images") return resource.kind === "image";
  if (category === "saved") return resource.saved === true;
  if (category === "icons") return resource.kind === "icon";
  if (category === "fonts") return resource.kind === "font";
  if (category === "links") return resource.kind === "link";
  if (category === "media") return resource.kind === "video" || resource.kind === "audio";
  if (category === "files") return ["document", "stylesheet", "script", "other"].includes(resource.kind);
  return true;
}

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
  if ((kind === "image" || kind === "icon") && /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)(?:;[^,]*)?,/i.test(rawUrl)) return rawUrl;
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
  return item.resource?.description?.trim() || item.resource?.alt?.trim() || item.title || labelForResource(item.kind === "page" ? "link" : item.kind);
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
      .filter((resource) => resourceMatchesCategory(resource, category))
      .map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        title: resource.label || labelForResource(resource.kind),
        url: resource.url,
        capture,
        resource,
        imageUrl: resource.kind === "image" || resource.kind === "icon" || resource.kind === "video"
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

function filenameForResource(item: DisplayItem, verifiedExtension?: string, sourceFilename?: string): string {
  let base = (sourceFilename || item.resource?.alt || item.title || "resource")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim().replace(/[. ]+$/, "")
    .slice(0, 90) || "image";
  const existingExtension = base.match(/\.([a-z0-9]{1,12})$/i)?.[1]?.toLowerCase();
  if (verifiedExtension && existingExtension && existingExtension !== verifiedExtension) base = base.slice(0, -(existingExtension.length + 1)) || "resource";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `_${base}`;
  if (verifiedExtension) return existingExtension === verifiedExtension ? base : `${base}.${verifiedExtension}`;
  let extension = "";
  const mimeType = item.resource?.mimeType?.toLowerCase() ?? "";
  extension = extensionForMime(mimeType) || (/^[a-z0-9]{1,12}$/.test(mimeType) ? mimeType : "");
  if (!extension) {
    try {
      extension = new URL(item.url).pathname.match(/\.([a-z0-9]{1,12})$/i)?.[1]?.toLowerCase() ?? "";
    } catch {
      // Use a generic extension when a captured URL cannot be parsed.
    }
  }
  if (!extension) extension = existingExtension || "";
  if (!extension) {
    if (item.kind === "image" || item.kind === "icon") extension = "img";
    else if (item.kind === "font") extension = "font";
    else if (item.kind === "video") extension = "mp4";
    else if (item.kind === "audio") extension = "audio";
    else if (item.kind === "link" || item.kind === "page") extension = "url";
    else extension = "bin";
  }
  return existingExtension === extension ? base : `${base}.${extension}`;
}

function topRisk(resource: CapturedResource): RiskLevel {
  const levels: RiskLevel[] = resource.security.signals.map((item) => item.level);
  if (levels.includes("high-risk")) return "high-risk";
  if (levels.includes("caution")) return "caution";
  if (levels.includes("clear-signal")) return "clear-signal";
  return "local-only";
}

const previewFontLoads = new Map<string, Promise<string | undefined>>();

async function fontFileForPreview(url: string): Promise<string> {
  if (!/\.css(?:$|[?#])/i.test(url) && !/fonts\.googleapis\.com/i.test(url)) return url;
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) return url;
  const stylesheet = await response.text();
  const match = stylesheet.match(/url\(\s*["']?([^"')\s]+)["']?\s*\)/i);
  return match ? new URL(match[1], url).href : url;
}

async function verifiedFontBlobUrl(url: string): Promise<string | undefined> {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) return undefined;
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (/^(?:text\/(?:html|plain|css)|application\/(?:json|xml))$/.test(mime)) return undefined;

  const maxBytes = 8 * 1024 * 1024;
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) return undefined;
  let blob: Blob;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) { await reader.cancel(); return undefined; }
      chunks.push(Uint8Array.from(value).buffer as ArrayBuffer);
    }
    blob = new Blob(chunks, { type: mime || "application/octet-stream" });
  } else {
    blob = await response.blob();
  }
  if (!blob.size || blob.size > maxBytes) return undefined;

  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const signature = String.fromCharCode(...header.slice(0, 4));
  const sfnt = header[0] === 0 && header[1] === 1 && header[2] === 0 && header[3] === 0;
  const eotHeader = new DataView(header.buffer);
  const eot = header.length >= 12
    && eotHeader.getUint32(0, true) === blob.size
    && [0x00010000, 0x00020001, 0x00020002, 0x00020003].includes(eotHeader.getUint32(8, true));
  if (!["wOFF", "wOF2", "OTTO", "ttcf"].includes(signature) && !sfnt && !eot) return undefined;
  return URL.createObjectURL(blob);
}

function previewFontFamily(url: string): Promise<string | undefined> {
  const existing = previewFontLoads.get(url);
  if (existing) return existing;

  const family = `AllherePreview_${previewFontLoads.size}`;
  const loaded = fontFileForPreview(url)
    .then(async (fontFile) => {
      const blobUrl = await verifiedFontBlobUrl(fontFile);
      if (!blobUrl) return undefined;
      try {
        const face = await new FontFace(family, `url(${JSON.stringify(blobUrl)})`).load();
        document.fonts.add(face);
        return family;
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    })
    .catch(() => undefined);
  previewFontLoads.set(url, loaded);
  return loaded;
}

function FontPreview({ item }: { item: DisplayItem }) {
  const source = safeWebUrl(item.url);
  const [family, setFamily] = useState<string>();

  useEffect(() => {
    let alive = true;
    setFamily(undefined);
    if (!source || typeof FontFace === "undefined") return () => { alive = false; };
    void previewFontFamily(source).then((loaded) => {
      if (alive) setFamily(loaded);
    });
    return () => { alive = false; };
  }, [source]);

  return <span className={`resource-art__font-sample${family ? " resource-art__font-sample--loaded" : ""}`} style={family ? { fontFamily: `"${family}", var(--font-ui)` } : undefined}>Ag</span>;
}

function ResourceArt({ item, compact = false, preview = false }: { item: DisplayItem; compact?: boolean; preview?: boolean }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [failedBlobSource, setFailedBlobSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [darkIconSource, setDarkIconSource] = useState<string | null>(null);
  const [blobPreview, setBlobPreview] = useState<{ source: string; url: string } | null>(null);
  const iconImageRef = useRef<HTMLImageElement>(null);
  const Icon = kindIcon(item.kind);
  const hostedId = item.kind === "video" ? youtubeId(item.url) : undefined;
  const assetUrl = hostedId ? `https://i.ytimg.com/vi/${hostedId}/hqdefault.jpg` : preview && item.kind === "audio" ? safeWebUrl(item.url) : item.imageUrl;
  const sourceKey = `${item.id}\u0000${assetUrl ?? ""}`;
  const directFailed = failedSource === sourceKey;
  const blobUrl = blobPreview?.source === sourceKey && failedBlobSource !== sourceKey
    ? blobPreview.url
    : undefined;
  const previewSource = blobUrl ?? (!directFailed ? assetUrl : undefined);
  const isImagePreview = item.kind === "image" || item.kind === "icon" || Boolean(hostedId);
  const isVideoPreview = item.kind === "video" && !hostedId;
  const isMediaPreview = preview && !hostedId && (item.kind === "video" || item.kind === "audio");

  useEffect(() => {
    if (item.kind !== "icon" || !previewSource || loadedSource !== previewSource) return;
    const image = iconImageRef.current;
    if (!image) return;
    let active = true;
    void iconNeedsDarkBackground(previewSource, image).then((dark) => {
      if (active) setDarkIconSource(dark ? sourceKey : null);
    });
    return () => { active = false; };
  }, [item.kind, loadedSource, previewSource, sourceKey]);

  useEffect(() => {
    if (!directFailed || (!isImagePreview && !isMediaPreview) || !assetUrl || window.location.protocol !== "chrome-extension:") return;

    const controller = new AbortController();
    let disposed = false;
    let createdUrl: string | undefined;
    const loadPreview = async () => {
      try {
        if (isMediaPreview) {
          const file = await loadResourceFile(item.url, item.kind, controller.signal);
          if (disposed) return;
          createdUrl = URL.createObjectURL(file.blob);
          setBlobPreview({ source: sourceKey, url: createdUrl });
          return;
        }
        const response = await fetch(assetUrl!, {
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
  }, [directFailed, isImagePreview, isMediaPreview, assetUrl, item.url, item.kind, sourceKey]);

  return (
    <div className={`resource-art resource-art--${item.kind}${compact ? " resource-art--compact" : ""}${preview ? " resource-art--preview" : ""}${item.kind === "icon" && darkIconSource === sourceKey ? " resource-art--icon-light" : ""}`}>
      {isImagePreview && previewSource && (
        <img
          ref={item.kind === "icon" ? iconImageRef : undefined}
          className={`resource-art__image${loadedSource === previewSource ? " resource-art__image--loaded" : ""}`}
          src={previewSource}
          alt={item.kind === "image" ? resourceDescription(item) : item.resource?.alt || item.title}
          loading={preview ? "eager" : "lazy"}
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedSource(previewSource)}
          onError={() => {
            setLoadedSource(null);
            if (previewSource === blobUrl) setFailedBlobSource(sourceKey);
            else setFailedSource(sourceKey);
          }}
        />
      )}
      {isVideoPreview && previewSource && (
        <video
          className={`resource-art__video${loadedSource === previewSource ? " resource-art__video--loaded" : ""}`}
          src={previewSource}
          aria-label={`Preview of ${item.title}`}
          preload="metadata"
          muted={!preview}
          controls={preview}
          playsInline
          disablePictureInPicture={!preview}
          onLoadedData={() => setLoadedSource(previewSource)}
          onError={() => {
            setLoadedSource(null);
            if (previewSource === blobUrl) setFailedBlobSource(sourceKey);
            else setFailedSource(sourceKey);
          }}
        />
      )}
      {preview && item.kind === "audio" && previewSource && <audio
        src={previewSource} controls preload="metadata" aria-label={`Preview of ${item.title}`}
        onLoadedMetadata={() => setLoadedSource(previewSource)}
        onError={() => {
          setLoadedSource(null);
          if (previewSource === blobUrl) setFailedBlobSource(sourceKey);
          else setFailedSource(sourceKey);
        }}
      />}
      {item.kind === "font" && <FontPreview item={item} />}
      {(!previewSource || loadedSource !== previewSource) && item.kind !== "font" && (
        <div className={`resource-art__placeholder${isFileKind(item.kind) ? " resource-art__placeholder--file" : ""}`} aria-hidden="true">
          {isFileKind(item.kind) ? <FileTypeMark item={item} /> : <Icon size={26} strokeWidth={1.7} />}
        </div>
      )}
      {!compact && !preview && <span className="resource-art__kind">{item.kind === "page" ? "Page" : labelForResource(item.kind)}</span>}
      {preview && directFailed && !blobUrl && <p className="resource-art__preview-message" role="status">This preview could not load. Try downloading the resource or scan its page again.</p>}
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
          draggable={false}
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

function ResourceSelect({ item, checked, onToggle, className = "", disabled = false }: { item: DisplayItem; checked: boolean; onToggle: (item: DisplayItem) => void; className?: string; disabled?: boolean }) {
  return (
    <input
      className={`resource-select ${className}`}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={`Select ${resourceDescription(item)}`}
      onChange={() => onToggle(item)}
    />
  );
}

function ResourceAlbum({ category, items, onOpen, onPreview, dragProps, selectedKeys, onToggleSelection, selectionActive, selectionDisabled }: {
  category: Category;
  items: DisplayItem[];
  onOpen: () => void;
  onPreview?: (item: DisplayItem) => void;
  dragProps: (item: DisplayItem) => HTMLAttributes<HTMLElement>;
  selectedKeys: Set<string>;
  onToggleSelection: (item: DisplayItem) => void;
  selectionActive: boolean;
  selectionDisabled: boolean;
}) {
  const { label, Icon } = categoryItems.find((item) => item.id === category)!;
  const previews = items.slice(0, 10);
  return (
    <section className="resource-album" aria-label={label} data-album-category={category}>
      <button className="resource-album__open" type="button" onClick={onOpen} aria-label={`Open ${label} tab, ${countLabel(items.length, "resource")}`}>
        <span className="resource-album__heading">
          <span className="resource-album__title"><Icon size={17} /><strong>{label}</strong><span>{items.length}</span></span>
          <span className="resource-album__action">View all <ChevronRight size={16} /></span>
        </span>
      </button>
      <div className="resource-album__grid">
        {previews.map((item) => {
          const checked = selectedKeys.has(selectionKey(item));
          return <div className={`resource-album__preview${checked ? " resource-album__preview--selected" : ""}${selectionActive ? " resource-album__preview--selecting" : ""}`} key={item.id}>
            <button className="resource-album__tile" type="button" onClick={() => onPreview ? onPreview(item) : onOpen()} aria-label={`${onPreview ? "Preview" : `Open ${label}:`} ${resourceDescription(item)}`} {...dragProps(item)}>
              {category === "links" ? <span className="resource-album__link"><ResourceFavicon item={item} /></span> : <ResourceArt item={item} />}
              {(category === "images" ? Boolean(item.resource?.description || item.resource?.alt) : category !== "icons") && <span className="resource-album__caption">{resourceDescription(item)}</span>}
            </button>
            <ResourceSelect item={item} checked={checked} onToggle={onToggleSelection} className="resource-select--album" disabled={selectionDisabled} />
          </div>;
        })}
      </div>
      {items.length > previews.length && <span className="resource-album__more">Showing {previews.length} of {items.length}</span>}
    </section>
  );
}

export function LibraryApp({ adapter, mode }: { adapter: LibraryAdapter; mode: Mode }) {
  const [captures, setCaptures] = useState<PageCapture[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [category, setCategory] = useState<Category>("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [managementQuery, setManagementQuery] = useState("");
  const [managementBusy, setManagementBusy] = useState(false);
  const [managementError, setManagementError] = useState("");
  const [undoDeletion, setUndoDeletion] = useState<{ label: string; pages: PageCapture[]; wholePages: boolean } | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DisplayItem | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sampleMode, setSampleMode] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sourcePageMenuOpen, setSourcePageMenuOpen] = useState(false);
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  const [resourceActionId, setResourceActionId] = useState<string | null>(null);
  const [downloadFormats, setDownloadFormats] = useState<DownloadFormats>(originalDownloadFormats);
  const downloads = useDownloads(mode === "extension");
  const activePage = useActivePage(adapter);
  const resourceActionInFlight = useRef(false);
  const resourceDrag = useResourceDrag(filenameForResource, setNotice);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const sourcePageMenuRef = useRef<HTMLDivElement>(null);
  const libraryMenuRef = useRef<HTMLDivElement>(null);
  const bulkMenuRef = useRef<HTMLDivElement>(null);
  const libraryMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const savedMenuItemRef = useRef<HTMLButtonElement>(null);
  const captureSequenceRef = useRef(0);
  const captureInFlightRef = useRef<number | null>(null);
  const automaticTaskRef = useRef<Promise<void> | null>(null);
  const capturesRef = useRef<PageCapture[]>([]);
  const exclusionsRef = useRef<CaptureExclusions>(emptyCaptureExclusions());
  const libraryWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const managementMutationInFlight = useRef(false);
  const autoUpdates = useAutoUpdates({
    adapter, page: activePage.page,
    suspended: mode !== "extension" || busy || managementOpen || managementBusy || sampleMode || Boolean(activePage.page.url && exclusionsRef.current.pages.includes(activePage.page.url)),
    onCapture: request => {
      const task = handleAutomaticCapture(request);
      automaticTaskRef.current = task;
      return task.finally(() => { if (automaticTaskRef.current === task) automaticTaskRef.current = null; });
    }, onError: setNotice,
  });

  useEffect(() => {
    const header = topbarRef.current;
    if (!header) return;
    const measure = () => shellRef.current?.style.setProperty("--topbar-height", `${header.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([adapter.load(), adapter.loadExclusions?.() ?? Promise.resolve(emptyCaptureExclusions())])
      .then(([stored, exclusions]) => {
        if (alive) {
          capturesRef.current = stored;
          exclusionsRef.current = exclusions;
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
    const unsubscribe = adapter.subscribe((stored) => {
      capturesRef.current = stored;
      setCaptures(stored);
    });
    const unsubscribeExclusions = adapter.subscribeExclusions?.((exclusions) => { exclusionsRef.current = exclusions; });
    return () => {
      alive = false;
      unsubscribe();
      unsubscribeExclusions?.();
    };
  }, [adapter]);

  const visibleCaptures = sampleMode ? sampleCaptures : captures;
  const selectedCapture = visibleCaptures.find((capture) => capture.id === selectedCaptureId);
  const showAlbums = category === "all";
  const savedScopedCaptures = useMemo(() => scopeSavedCaptures(visibleCaptures, savedOnly), [visibleCaptures, savedOnly]);
  const sourceCapture = savedScopedCaptures.find((capture) => capture.id === selectedCaptureId);
  const sourceOptions = savedOnly ? savedScopedCaptures.filter((capture) => capture.resources.length > 0) : savedScopedCaptures;
  const scopedCaptures = selectedCapture ? savedScopedCaptures.filter((capture) => capture.id === selectedCapture.id) : savedScopedCaptures;
  const allPageResourceCount = useMemo(() => flattenResources(savedScopedCaptures).length, [savedScopedCaptures]);
  const savedResourceCount = useMemo(() => flattenResources(visibleCaptures).filter((resource) => resource.saved).length, [visibleCaptures]);
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
        resource?.description,
        resource?.alt,
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

  const selectableItems = useMemo(() => [
    ...displayItems(savedScopedCaptures, "all"),
    ...displayItems(savedScopedCaptures, "pages"),
  ], [savedScopedCaptures]);
  const selectedItems = useMemo(() => selectableItems.filter((item) => selectedKeys.has(selectionKey(item))), [selectableItems, selectedKeys]);
  const selectedIcons = selectedItems.some(item => item.kind === "icon");
  const selectedImages = selectedItems.some(item => item.kind === "image");
  const allVisibleSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedKeys.has(selectionKey(item)));

  const toggleSelection = (item: DisplayItem) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      const key = selectionKey(item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const selectAllVisible = () => setSelectedKeys((current) => {
    const next = new Set(current);
    filteredItems.forEach((item) => next.add(selectionKey(item)));
    return next;
  });

  useEffect(() => {
    setSelectedKeys(new Set());
    setBulkMenuOpen(false);
  }, [sampleMode, savedOnly, managementOpen]);

  useEffect(() => {
    setSelectedKeys((current) => new Set([...current].filter((key) =>
      selectedCaptureId && key.startsWith(`${selectedCaptureId}:`),
    )));
    setBulkMenuOpen(false);
  }, [selectedCaptureId]);

  useEffect(() => {
    const valid = new Set(selectableItems.map(selectionKey));
    setSelectedKeys((current) => {
      if ([...current].every((key) => valid.has(key))) return current;
      return new Set([...current].filter((key) => valid.has(key)));
    });
  }, [selectableItems]);

  const pageAlbums = useMemo(() => scopedCaptures.map((capture) => ({
    capture,
    sections: albumCategories.map((id) => ({
      id,
      items: filteredItems.filter((item) => item.capture.id === capture.id && item.resource && resourceMatchesCategory(item.resource, id)),
    })).filter((section) => section.items.length > 0),
  })).filter((page) => page.sections.length > 0), [scopedCaptures, filteredItems]);

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
      files: resources.filter((resource) => resourceMatchesCategory(resource, "files")).length,
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
    if (!libraryMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!libraryMenuRef.current?.contains(event.target as Node)) setLibraryMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLibraryMenuOpen(false);
        libraryMenuTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [libraryMenuOpen]);

  useEffect(() => {
    if (!bulkMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!bulkMenuRef.current?.contains(event.target as Node)) setBulkMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBulkMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [bulkMenuOpen]);

  useEffect(() => {
    setOpenActionMenuId(null);
  }, [category, selectedCaptureId, query, view]);

  function updateLibrary<T extends { captures: PageCapture[]; exclusions: CaptureExclusions }>(
    mutate: (current: PageCapture[], exclusions: CaptureExclusions) => T,
  ): Promise<T> {
    const pending = libraryWriteQueue.current.then(async () => {
      const result = mutate(capturesRef.current, exclusionsRef.current);
      if (result.captures !== capturesRef.current || result.exclusions !== exclusionsRef.current) await adapter.save(result.captures, result.exclusions);
      capturesRef.current = result.captures;
      exclusionsRef.current = result.exclusions;
      setCaptures(result.captures);
      return result;
    });
    libraryWriteQueue.current = pending.then(() => undefined, () => undefined);
    return pending;
  }

  const saveCapture = (capture: PageCapture, sequence: number, automatic = false, isCurrent = () => true) => updateLibrary((previous, currentExclusions) => {
    if (sequence !== captureSequenceRef.current || !isCurrent()) return { captures: previous, exclusions: currentExclusions, savedCapture: undefined };
    const exclusions = automatic ? currentExclusions : restorePageCapture(currentExclusions, capture.pageUrl);
    const allowedCapture = filterExcludedCapture(capture, exclusions);
    if (!allowedCapture) return { captures: previous, exclusions, savedCapture: undefined };
    const existing = previous.find(page => page.pageUrl === capture.pageUrl);
    if (automatic && existing && existing.pageTitle === capture.pageTitle && existing.faviconUrl === capture.faviconUrl) {
      const known = new Map(existing.resources.map(resource => [resourceIdentity(resource), resource]));
      const fields = ["label", "alt", "description", "width", "height", "mimeType"] as const;
      if (allowedCapture.resources.every(resource => {
        const old = known.get(resourceIdentity(resource));
        return old && fields.every(field => old[field] === resource[field]);
      })) return { captures: previous, exclusions, savedCapture: existing };
    }
    const next = upsertPageCapture(previous, allowedCapture);
    const savedCapture = next.find((saved) => saved.pageUrl === capture.pageUrl);
    return { captures: next, exclusions, savedCapture };
  });

  const handleCapture = async () => {
    if (!adapter.captureCurrentPage) return;
    const isSessionCurrent = autoUpdates.beginAuthorization();
    const previousAutomaticTask = automaticTaskRef.current;
    const sequence = ++captureSequenceRef.current;
    captureInFlightRef.current = sequence;
    setBusy(true);
    setNotice("");
    try {
      const startedPage = await activePage.beginScan();
      await previousAutomaticTask?.catch(() => undefined);
      if (sequence !== captureSequenceRef.current) return;
      const capture = await adapter.captureCurrentPage(startedPage);
      if (sequence !== captureSequenceRef.current) return;
      const { savedCapture } = await saveCapture(capture, sequence);
      if (sequence !== captureSequenceRef.current) return;
      if (!savedCapture) return;
      await activePage.finishScan(startedPage, capture.pageUrl, isSessionCurrent);
      await autoUpdates.authorize(startedPage, isSessionCurrent);
      if (!savedOnly) {
        setSelectedCaptureId(savedCapture.id);
        setSelected(null);
        setSampleMode(false);
      }
      setNotice(`${countLabel(savedCapture.resources.length, "resource")} saved from ${capture.hostname}.`);
    } catch (error) {
      if (sequence === captureSequenceRef.current) {
        setNotice(error instanceof Error ? error.message : "The page could not be scanned. Try again.");
      }
    } finally {
      if (captureInFlightRef.current === sequence) captureInFlightRef.current = null;
      if (sequence === captureSequenceRef.current) setBusy(false);
    }
  };

  async function handleAutomaticCapture({ page, isCurrent, followTab }: AutoCaptureRequest) {
    if (!adapter.captureCurrentPage || !isCurrent()) return;
    if (captureInFlightRef.current !== null) throw new Error("A scan is already in progress.");
    const sequence = ++captureSequenceRef.current;
    captureInFlightRef.current = sequence;
    try {
      const capture = await adapter.captureCurrentPage(page);
      if (!isCurrent() || sequence !== captureSequenceRef.current) return;
      const current = await adapter.getActivePage?.();
      if (!current || !isCurrent() || current.tabId !== page.tabId || current.url !== capture.pageUrl || current.revision !== page.revision || current.accessEpoch !== page.accessEpoch) return;
      const { savedCapture } = await saveCapture(capture, sequence, true, isCurrent);
      if (!savedCapture || !isCurrent() || sequence !== captureSequenceRef.current) return;
      await activePage.finishScan(page, capture.pageUrl, isCurrent);
      if (followTab && !savedOnly && !managementOpen && !selected && selectedKeys.size === 0) setSelectedCaptureId(savedCapture.id);
    } finally {
      if (captureInFlightRef.current === sequence) captureInFlightRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      captureSequenceRef.current += 1;
    };
  }, [adapter]);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const parsed = parseArchive(JSON.parse(await file.text()));
      const { captures: imported } = await updateLibrary((current, exclusions) => ({
        captures: mergeCaptures(current, parsed.captures),
        exclusions: parsed.captures.reduce((next, capture) => restorePageCapture(next, capture.pageUrl), exclusions),
      }));
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

  const handleDeletePages = async (captureIds: string[]) => {
    if (managementMutationInFlight.current) return;
    managementMutationInFlight.current = true;
    setManagementBusy(true);
    setManagementError("");
    try {
      const ids = new Set(captureIds);
      const result = await updateLibrary((current, exclusions) => {
        const removed = current.filter((capture) => ids.has(capture.id));
        return {
          captures: current.filter((capture) => !ids.has(capture.id)),
          exclusions: { ...exclusions, pages: [...new Set([...exclusions.pages, ...removed.map((capture) => capture.pageUrl)])] },
          removed,
        };
      });
      if (result.removed.length) {
        const label = `${countLabel(result.removed.length, "page")} deleted`;
        setUndoDeletion({ label, pages: result.removed, wholePages: true });
        setNotice(`${label}.`);
        setSelected(null);
      }
    } catch {
      setManagementError("The pages could not be deleted. Try again.");
      setNotice("The pages could not be deleted. Try again.");
    } finally {
      managementMutationInFlight.current = false;
      setManagementBusy(false);
    }
  };

  const handleDeleteResources = async (captureId: string, resourceIds: string[]) => {
    if (managementMutationInFlight.current) return;
    managementMutationInFlight.current = true;
    setManagementBusy(true);
    setManagementError("");
    try {
      const ids = new Set(resourceIds);
      const result = await updateLibrary((current, exclusions) => {
        const page = current.find((capture) => capture.id === captureId);
        const removed = page?.resources.filter((resource) => ids.has(resource.id)) ?? [];
        const resources = { ...exclusions.resources };
        if (page && removed.length) resources[page.pageUrl] = [...new Set([...(resources[page.pageUrl] ?? []), ...removed.map(resourceIdentity)])];
        return {
          captures: current.map((capture) => capture.id === captureId ? { ...capture, resources: capture.resources.filter((resource) => !ids.has(resource.id)) } : capture),
          exclusions: { ...exclusions, resources },
          removed: page && removed.length ? [{ ...page, resources: removed }] : [],
          count: removed.length,
        };
      });
      if (result.count) {
        const label = `${countLabel(result.count, "item")} deleted`;
        setUndoDeletion({ label, pages: result.removed, wholePages: false });
        setNotice(`${label}.`);
        if (selected?.capture.id === captureId && ids.has(selected.id)) setSelected(null);
      }
    } catch {
      setManagementError("The items could not be deleted. Try again.");
      setNotice("The items could not be deleted. Try again.");
    } finally {
      managementMutationInFlight.current = false;
      setManagementBusy(false);
    }
  };

  const handleUndoDeletion = async () => {
    if (!undoDeletion || managementMutationInFlight.current) return;
    managementMutationInFlight.current = true;
    setManagementBusy(true);
    setManagementError("");
    try {
      const undo = undoDeletion;
      await updateLibrary((current, exclusions) => {
        const restoredUrls = new Set(undo.pages.map((capture) => capture.pageUrl));
        const resources = { ...exclusions.resources };
        if (!undo.wholePages) for (const page of undo.pages) {
          const restoredKeys = new Set(page.resources.map(resourceIdentity));
          resources[page.pageUrl] = (resources[page.pageUrl] ?? []).filter((key) => !restoredKeys.has(key));
        }
        return {
          captures: undo.pages.reduce((next, page) => {
            const existing = next.find((capture) => capture.pageUrl === page.pageUrl);
            return upsertPageCapture(next, existing ? { ...existing, resources: page.resources } : page);
          }, current),
          exclusions: { pages: undo.wholePages ? exclusions.pages.filter((url) => !restoredUrls.has(url)) : exclusions.pages, resources },
        };
      });
      setUndoDeletion(null);
      setNotice("Deleted items restored.");
    } catch {
      setManagementError("The deleted items could not be restored. Try Undo again.");
      setNotice("The deleted items could not be restored. Try Undo again.");
    } finally {
      managementMutationInFlight.current = false;
      setManagementBusy(false);
    }
  };

  const handleDelete = (item: DisplayItem) => item.kind === "page"
    ? handleDeletePages([item.capture.id])
    : handleDeleteResources(item.capture.id, [item.id]);

  const handleCopy = async (url: string, label = "Address") => {
    try {
      await navigator.clipboard.writeText(url);
      setNotice(`${label} copied to clipboard.`);
    } catch {
      setNotice("Clipboard access is unavailable in this browser context.");
    }
  };

  const handleBulkCopy = async () => {
    setBulkMenuOpen(false);
    const urls = [...new Set(selectedItems.map((item) => item.url))];
    if (!urls.length) return;
    try {
      await navigator.clipboard.writeText(urls.join("\n"));
      setNotice(`${countLabel(urls.length, "URL")} copied to clipboard.`);
    } catch {
      setNotice("Clipboard access is unavailable in this browser context.");
    }
  };

  const handleBulkDownload = async () => {
    if (!selectedItems.length || bulkBusy || resourceActionInFlight.current) return;
    const items = [...selectedItems];
    setBulkMenuOpen(false);
    setBulkBusy(true);
    setBulkProgress(`Preparing 0 of ${items.length}`);
    setResourceActionId("bulk");
    resourceActionInFlight.current = true;
    try {
      if (mode === "extension" && !await requestWebsiteAccess(websiteOrigins(items.filter(item => item.kind !== "link" && item.kind !== "page").map(item => item.url)))) {
        throw new Error("Website access was not granted. Choose Download as ZIP to try again.");
      }
      const result = await createResourceZip(items.map((item) => ({
        kind: item.kind,
        url: item.url,
        label: resourceDescription(item),
        filename: (extension?: string, sourceFilename?: string) => filenameForResource(item, extension, sourceFilename),
      })), (processed, total) => setBulkProgress(`Preparing ${processed} of ${total}`), downloadFormats);
      const suffix = selectedCapture?.hostname.replace(/[^a-z0-9.-]+/gi, "-") || "resources";
      const filename = `allhere-${suffix}-${new Date().toISOString().slice(0, 10)}.zip`;
      const objectUrl = URL.createObjectURL(result.blob);
      if (mode === "extension") {
        try { await downloads.start({ url: objectUrl, kind: "other", title: filename, filename }); }
        finally { window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000); }
        setNotice(result.skipped ? `${result.included} resources included; ${result.skipped} skipped. See allhere-skipped.txt inside the ZIP.` : "");
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      setNotice(result.skipped
        ? `Downloading ${filename}: ${result.included} included, ${result.skipped} skipped. See allhere-skipped.txt inside the ZIP.`
        : `Downloading ${filename} with ${countLabel(result.included, "resource")}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The selected resources could not be added to a ZIP.");
    } finally {
      resourceActionInFlight.current = false;
      setResourceActionId(null);
      setBulkBusy(false);
      setBulkProgress("");
    }
  };

  const handleDownloadResource = async (item: DisplayItem, format: IconDownloadFormat = "original") => {
    if (youtubeId(item.url)) return;
    if (resourceActionInFlight.current) return;
    resourceActionInFlight.current = true;
    setResourceActionId(item.id);
    setOpenActionMenuId(null);
    const isImage = item.kind === "image" || item.kind === "icon";
    setNotice(isImage ? "Checking the image before downloading…" : "Preparing your download…");
    try {
      if (mode === "extension" && item.kind !== "link" && item.kind !== "page" && !await requestWebsiteAccess(websiteOrigins([item.url]))) {
        throw new Error("Website access was not granted. Choose Download to try again.");
      }
      if (mode === "extension" && item.kind !== "image" && item.kind !== "icon" && item.kind !== "link" && item.kind !== "page") {
        setNotice("");
        await downloads.start({ url: item.url, kind: item.kind, title: resourceDescription(item), filename: filenameForResource(item), sourcePage: item.capture.pageUrl });
        return;
      }
      let blob: Blob;
      let filename: string;
      if (item.kind === "link" || item.kind === "page") {
        const url = safeWebUrl(item.url);
        if (!url) throw new Error("This link does not have a web address.");
        blob = new Blob([`[InternetShortcut]\r\nURL=${url}\r\n`], { type: "application/octet-stream" });
        filename = filenameForResource(item, "url");
      } else {
        let file;
        if (isImage && format !== "original") file = await convertImageDownload(item.url, format);
        else if (isImage) {
          try { file = await loadImageFile(item.url); }
          catch (error) {
            if (!(error instanceof Error) || !/unsupported file instead of an image/i.test(error.message)) throw error;
            file = await loadDownloadFile(item.url, item.kind, 256 * 1024 * 1024);
          }
        } else file = await loadDownloadFile(item.url, item.kind, 256 * 1024 * 1024);
        blob = file.blob;
        filename = filenameForResource(item, file.extension, "filename" in file ? file.filename : undefined);
      }
      const objectUrl = URL.createObjectURL(blob);
      if (mode === "extension") {
        try { await downloads.start({ url: objectUrl, kind: item.kind, title: resourceDescription(item), filename }); }
        finally { window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000); }
        setNotice("");
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      setNotice(`Downloading ${filename}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This resource could not be downloaded. Try opening its URL.");
    } finally {
      resourceActionInFlight.current = false;
      setResourceActionId(null);
    }
  };

  const downloadTray = downloads.jobs.length ? <DownloadTray jobs={downloads.jobs}
    onCancel={id => void downloads.cancel(id).catch(error => setNotice(error.message))}
    onDismiss={id => void downloads.dismiss(id).catch(error => setNotice(error.message))}
    onShow={id => void downloads.show(id).catch(error => setNotice(error.message))}
    onAllowAccess={job => downloads.allowAccess(job.permissionOrigins).then(async granted => {
      if (!granted) throw new Error("Access was not granted. Choose Allow access & retry to request it again.");
      await downloads.retry(job);
    })}
    onHeight={height => shellRef.current?.style.setProperty("--download-tray-height", `${height}px`)}
  /> : undefined;

  const handleCopyIconSvg = async (item: DisplayItem) => {
    if (resourceActionInFlight.current) return;
    resourceActionInFlight.current = true;
    setResourceActionId(item.id);
    setOpenActionMenuId(null);
    setNotice("Preparing the icon’s SVG…");
    try {
      const access = mode === "extension" ? requestWebsiteAccess(websiteOrigins([item.url])) : Promise.resolve(true);
      const icon = access.then(granted => {
        if (!granted) throw new Error("Website access was not granted. Choose Copy SVG to try again.");
        return iconAsSvg(item.url);
      });
      void icon.catch(() => undefined);
      // Supply the promise while the click still has clipboard user activation.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        const clipboardData = icon.then(({ markup }) => new Blob([markup], { type: "text/plain" }));
        void clipboardData.catch(() => undefined);
        await navigator.clipboard.write([new ClipboardItem({
          "text/plain": clipboardData,
        })]);
      } else {
        await navigator.clipboard.writeText((await icon).markup);
      }
      const { embeddedRaster } = await icon;
      setNotice(embeddedRaster ? "SVG copied with the original raster image embedded." : "SVG icon copied to clipboard.");
    } catch (error) {
      setNotice(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Clipboard access was blocked. Keep the panel open and try Copy SVG again."
        : error instanceof Error ? error.message : "This icon could not be copied as SVG.");
    } finally {
      resourceActionInFlight.current = false;
      setResourceActionId(null);
    }
  };

  const handleToggleSavedResource = async (item: DisplayItem) => {
    const resource = item.resource;
    if (!resource || sampleMode) return;
    const shouldSave = resource.saved !== true;
    try {
      await updateLibrary((current, exclusions) => ({
        captures: current.map((capture) => capture.id === item.capture.id ? {
          ...capture,
          resources: capture.resources.map((candidate) => candidate.id === resource.id ? { ...candidate, saved: shouldSave || undefined } : candidate),
        } : capture),
        exclusions,
      }));
      setNotice(shouldSave ? "Resource saved in Saved items." : "Resource removed from Saved items.");
      if (savedOnly && !shouldSave && selected?.id === item.id && selected.capture.id === item.capture.id) setSelected(null);
    } catch {
      setNotice("This resource could not be updated in your library. Try again.");
    }
    setOpenActionMenuId(null);
  };

  const selectCategory = (next: Category) => {
    setManagementOpen(false);
    if (next === "saved") {
      setSavedOnly(true);
      setCategory("all");
      setSelectedCaptureId(null);
      setQuery("");
    } else setCategory(next);
    if (next === "all") {
      setQuery("");
    }
    setSelected(null);
    setMobileNavOpen(false);
    setSourcePageMenuOpen(false);
    setLibraryMenuOpen(false);
  };

  const openLibrary = () => {
    setManagementOpen(false);
    setSavedOnly(false);
    selectCategory("all");
    setQuery("");
  };

  const openManagement = () => {
    captureSequenceRef.current += 1;
    setBusy(false);
    setManagementOpen(true);
    setManagementQuery("");
    setManagementError("");
    setLibraryMenuOpen(false);
    setSourcePageMenuOpen(false);
    setOpenActionMenuId(null);
    setSelected(null);
    setSelectedKeys(new Set());
  };

  const closeManagement = () => {
    setManagementOpen(false);
    window.requestAnimationFrame(() => libraryMenuTriggerRef.current?.focus());
  };

  const openPreview = (item: DisplayItem) => {
    setSelected(item);
    setOpenActionMenuId(null);
    setSourcePageMenuOpen(false);
    setLibraryMenuOpen(false);
    if (mode === "extension") setNotice("");
  };

  const selectSourcePage = (captureId: string | null) => {
    setManagementOpen(false);
    setSelectedCaptureId(captureId);
    setCategory("all");
    setSelected(null);
    setQuery("");
    setMobileNavOpen(false);
    setSourcePageMenuOpen(false);
  };

  const openAlbumCategory = (captureId: string, next: Category) => {
    setSelectedCaptureId(captureId);
    selectCategory(next);
    setQuery("");
    setView("grid");
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-resource-tab="${next}"]`)?.focus({ preventScroll: true }));
  };

  const activeCount = totalCounts[category];
  const title = categoryItems.find((item) => item.id === category)?.label ?? "All resources";
  const headingTitle = savedOnly ? category === "all" ? "Saved items" : `Saved ${title.toLowerCase()}` : category === "all" ? selectedCapture?.pageTitle || "My library" : title;
  const canExport = captures.length > 0 && !sampleMode;
  const activeView = category === "links" ? "list" : category === "all" ? "grid" : view;

  const renderResourceActions = (item: DisplayItem, inTable = false) => {
    const description = resourceDescription(item);
    const isMenuOpen = openActionMenuId === item.id;
    const isSaved = item.resource?.saved === true;
    const itemLabel = item.kind === "page" ? "page" : labelForResource(item.kind);
    const isVisual = item.kind === "icon" || item.kind === "image";
    const downloadFormat = item.kind === "icon" ? downloadFormats.icons : downloadFormats.images;

    return (
      <div className={`resource-actions${inTable ? " resource-actions--table" : ""}${isMenuOpen ? " resource-actions--open" : ""}`} ref={isMenuOpen ? actionMenuRef : undefined}>
        <button
          className="resource-actions__trigger"
          type="button"
          aria-label={`More actions for ${description}`}
          aria-haspopup={isVisual ? "dialog" : "menu"}
          aria-expanded={isMenuOpen}
          aria-busy={resourceActionId === item.id || resourceDrag.status(item) === "loading"}
          onClick={(event) => {
            if (isMenuOpen) {
              setOpenActionMenuId(null);
              setActionMenuPosition(null);
              return;
            }
            if (inTable) {
              const rect = event.currentTarget.getBoundingClientRect();
              const menuHeight = Math.min(280, (item.resource ? 156 : 104) + (item.kind === "icon" ? 44 : 0) - (youtubeId(item.url) ? 44 : 0) + (item.kind !== "link" && item.kind !== "page" ? 44 : 0) + (isVisual ? 100 : 0));
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
          {resourceActionId === item.id || resourceDrag.status(item) === "loading" ? <LoaderCircle className="spin" size={18} /> : <MoreVertical size={18} strokeWidth={2} />}
        </button>
        {isMenuOpen && (
          <div
            className={`resource-actions__menu${inTable ? " resource-actions__menu--fixed" : ""}`}
            role={isVisual ? "dialog" : "menu"}
            aria-label={`Actions for ${description}`}
            style={inTable && actionMenuPosition ? { top: actionMenuPosition.top, right: actionMenuPosition.right } : undefined}
          >
            <button className="resource-actions__item" type="button" role={isVisual ? undefined : "menuitem"} onClick={() => { setOpenActionMenuId(null); void handleCopy(item.url, `${itemLabel} URL`); }}>
              <Copy size={16} /><span>Copy URL</span>
            </button>
            {item.kind === "icon" && (
              <button className="resource-actions__item" type="button" disabled={resourceActionId !== null} onClick={() => void handleCopyIconSvg(item)}>
                <Shapes size={16} /><span>Copy SVG</span>
              </button>
            )}
            {isVisual && <DownloadFormatSelect label="Download format" value={downloadFormat} allowSvg={item.kind === "icon"} disabled={resourceActionId !== null}
              onChange={format => setDownloadFormats(current => item.kind === "icon" ? { ...current, icons: format } : { ...current, images: format as ImageDownloadFormat })} />}
            {!youtubeId(item.url) && <button className="resource-actions__item" type="button" role={isVisual ? undefined : "menuitem"} disabled={resourceActionId !== null} onClick={() => void handleDownloadResource(item, isVisual ? downloadFormat : "original")}>
              <ArrowDownToLine size={16} /><span>Download</span>
            </button>}
            {item.kind !== "link" && item.kind !== "page" && (
              <button className="resource-actions__item" type="button" role={isVisual ? undefined : "menuitem"} disabled={resourceDrag.status(item) === "loading"} onClick={() => { setOpenActionMenuId(null); void resourceDrag.prepare(item, true); }}>
                {resourceDrag.status(item) === "loading" ? <LoaderCircle className="spin" size={16} /> : <GripVertical size={16} />}
                <span>{resourceDrag.status(item) === "loading" ? "Preparing file…" : "Prepare for dragging"}</span>
              </button>
            )}
            {item.resource && (
              <>
                <span className="resource-actions__divider" aria-hidden="true" />
                <button
                  className="resource-actions__item"
                  type="button"
                  role={isVisual ? undefined : "menuitem"}
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
    <div ref={shellRef} className={`allhere-shell allhere-shell--${mode}${selectedItems.length ? " allhere-shell--selecting" : ""}${downloads.jobs.length ? " allhere-shell--downloading" : ""}`}>
      <header ref={topbarRef} className="topbar">
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
          <a className="brand" href={mode === "web" ? "/" : "#library"} aria-label="Allhere library home" onClick={(event) => { event.preventDefault(); openLibrary(); }}>
            <span className="brand__mark" aria-hidden="true">
              <img src="/icons/allhere.svg" alt="" />
            </span>
            <span className="brand__word">allhere</span>
          </a>
        </div>

        <label className="searchbox">
          <Search size={19} strokeWidth={1.9} aria-hidden="true" />
          <input
            type="search"
            value={managementOpen ? managementQuery : query}
            onChange={(event) => managementOpen ? setManagementQuery(event.target.value) : setQuery(event.target.value)}
            placeholder={managementOpen ? "Search captured pages and items" : "Search your library"}
            aria-label={managementOpen ? "Search captured pages and items" : "Search your library"}
          />
          {(managementOpen ? managementQuery : query) && (
            <button className="searchbox__clear" type="button" aria-label="Clear search" onClick={() => managementOpen ? setManagementQuery("") : setQuery("")}>
              <X size={16} />
            </button>
          )}
        </label>

        <div className="topbar__actions">
          <button className="icon-button topbar__export" aria-label="Export library" title="Export library" onClick={handleExport} disabled={!canExport}>
            <ArrowDownToLine size={19} />
          </button>
          {mode === "extension" ? (
            <button
              className={`button button--primary button--scan${activePage.needsScan ? " button--scan-needed" : ""}`}
              type="button" aria-label="Scan this page"
              data-scan-state={busy ? "scanning" : activePage.needsScan ? "needed" : "ready"}
              title={autoUpdates.authorized ? autoUpdates.paused ? "Refresh this tab once. Automatic updates remain paused." : "Refresh this tab now. Automatic updates are enabled." : "Scan this tab and keep its resources updated while Allhere is open. Click the toolbar icon first if access is needed."}
              onClick={() => void handleCapture()} disabled={busy || !loaded}
            >
              {busy ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <TabFavicon key={`${activePage.page.tabId}:${activePage.page.revision}`} url={activePage.page.faviconUrl} />}
              <span>{busy ? "Scanning…" : activePage.needsScan ? "Scan page" : "Scan again"}</span>
            </button>
          ) : (
            <button className="button button--primary" aria-label="Import library" onClick={handleImportClick} disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowUpFromLine size={17} />}
              <span>Import library</span>
            </button>
          )}
          {(
            <div className={`library-menu${libraryMenuOpen ? " library-menu--open" : ""}`} ref={libraryMenuRef}>
              <button
                ref={libraryMenuTriggerRef}
                className="icon-button library-menu__trigger"
                type="button"
                aria-label="Open library menu"
                aria-haspopup="menu"
                aria-expanded={libraryMenuOpen}
                aria-controls="library-menu"
                onClick={() => setLibraryMenuOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setLibraryMenuOpen(true);
                    window.requestAnimationFrame(() => savedMenuItemRef.current?.focus());
                  }
                }}
              >
                <MoreVertical size={20} aria-hidden="true" />
              </button>
              {libraryMenuOpen && (
                <div className="library-menu__panel" id="library-menu" role="menu" aria-label="Library menu" onKeyDown={(event) => {
                  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
                  const current = items.indexOf(document.activeElement as HTMLButtonElement);
                  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
                  items[next]?.focus();
                }}>
                  <button ref={savedMenuItemRef} className={`library-menu__item${!savedOnly && !managementOpen ? " library-menu__item--active" : ""}`} type="button" role="menuitemradio" aria-checked={!savedOnly && !managementOpen} onClick={() => { openLibrary(); libraryMenuTriggerRef.current?.focus(); }}>
                    <Files size={17} aria-hidden="true" /><span>All resources</span>
                  </button>
                  <button className={`library-menu__item${savedOnly && !managementOpen ? " library-menu__item--active" : ""}`} type="button" role="menuitemradio" aria-checked={savedOnly && !managementOpen} onClick={() => { selectCategory("saved"); libraryMenuTriggerRef.current?.focus(); }}>
                    <Bookmark size={17} aria-hidden="true" />
                    <span>Saved items</span>
                    <span className="library-menu__count">{savedResourceCount}</span>
                  </button>
                  <span className="resource-actions__divider" aria-hidden="true" />
                  <button className={`library-menu__item${managementOpen ? " library-menu__item--active" : ""}`} type="button" role="menuitem" disabled={!loaded} onClick={openManagement}>
                    <FileCog size={17} aria-hidden="true" /><span>Manage</span><span className="library-menu__count">{captures.length}</span>
                  </button>
                </div>
              )}
            </div>
          )}
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
        {mode === "extension" && (
          <div className="auto-updates" data-auto-state={autoUpdates.authorized ? autoUpdates.paused ? "paused" : autoUpdates.onHold ? "hold" : "on" : "manual"}>
            {autoUpdates.authorized ? (
              <>
                <span className="auto-updates__status" title={autoUpdates.onHold ? "Updates wait while loading, managing the library, or after deleting this page. Scan again can restore a deleted page." : "Automatic updates apply only to this authorized tab while the panel is visible."}>
                  <span className={`auto-updates__dot${autoUpdates.updating ? " auto-updates__dot--busy" : ""}`} aria-hidden="true" />
                  {autoUpdates.paused ? "Auto-updates paused" : autoUpdates.onHold ? "Auto-updates on hold" : "Auto-updates on"}
                </span>
                <button className="auto-updates__toggle" type="button" aria-label={autoUpdates.paused ? "Resume automatic updates for this tab" : "Pause automatic updates for this tab"} onClick={autoUpdates.toggle}>
                  {autoUpdates.paused ? "Resume" : "Pause"}
                </button>
              </>
            ) : <span>Scan page also keeps this tab updated while Allhere is open. Pause anytime.</span>}
          </div>
        )}
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
                  className={`nav-item${!managementOpen && (id === "saved" ? savedOnly : !savedOnly && category === id) ? " nav-item--active" : ""}`}
                  onClick={() => { if (id !== "saved") setSavedOnly(false); selectCategory(id); }}
                  aria-current={!managementOpen && (id === "saved" ? savedOnly : !savedOnly && category === id) ? "page" : undefined}
                >
                  <Icon size={18} strokeWidth={1.9} />
                  <span>{label}</span>
                  <span className="nav-item__count">{id === "saved" ? savedResourceCount : totalCounts[id]}</span>
                </button>
              ))}
            </nav>
          </div>

          {mode === "web" && (
            <div className="sidebar__pages">
              <div className="nav-group__label">Saved pages</div>
              <nav className="nav-list" aria-label="Saved pages">
                <button
                  className={`page-nav-item${!sourceCapture ? " page-nav-item--active" : ""}`}
                  onClick={() => selectSourcePage(null)}
                  aria-current={!sourceCapture ? "page" : undefined}
                >
                  <Files size={16} strokeWidth={1.9} />
                  <span className="page-nav-item__copy"><strong>All pages</strong><small>Every saved source</small></span>
                  <span className="page-nav-item__count">{visibleCaptures.length}</span>
                </button>
                {visibleCaptures.map((capture) => (
                  <button
                    key={capture.id}
                    className={`page-nav-item${sourceCapture?.id === capture.id ? " page-nav-item--active" : ""}`}
                    onClick={() => selectSourcePage(capture.id)}
                    aria-current={sourceCapture?.id === capture.id ? "page" : undefined}
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
          {managementOpen ? <LibraryManager
            captures={captures}
            query={managementQuery}
            onQueryChange={setManagementQuery}
            busy={managementBusy}
            error={managementError}
            undoLabel={undoDeletion?.label}
            onClose={closeManagement}
            onUndo={handleUndoDeletion}
            onDeletePages={handleDeletePages}
            onDeleteResources={handleDeleteResources}
            renderPreview={(capture, resource) => <ResourceArt compact item={{
              id: resource.id, kind: resource.kind, title: resource.label, url: resource.url, capture, resource,
              imageUrl: safeAssetPreviewUrl(resource.url, resource.kind),
            }} />}
          /> : <>
          {savedOnly && <button className="saved-scope-back" type="button" onClick={openLibrary}><ArrowLeft size={16} />Back to library</button>}
          <div className="content-heading">
            <div className="content-heading__title">
              <h1>{headingTitle}</h1>
              <p>
                {sampleMode
                  ? "A sample workspace with example page resources."
                  : loaded
                    ? selectedCapture
                      ? `${selectedCapture.hostname} · ${countLabel(allResources.length, savedOnly ? "saved resource" : "resource")}`
                      : `${countLabel(sourceOptions.length, "page")} · ${countLabel(allResources.length, savedOnly ? "saved resource" : "resource")}`
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
              {category !== "links" && category !== "all" && (
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

          {mode === "extension" && (
            <div className="page-scope">
              <span className="page-scope__label">Source page <span title="On each new tab, click Allhere's toolbar icon before choosing Scan page.">Toolbar icon first, then Scan page</span></span>
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
                  <SourcePageMark capture={sourceCapture} allPages={!sourceCapture} />
                  <span className="page-scope__selection">
                    <strong>{sourceCapture?.pageTitle || sourceCapture?.hostname || "All pages"}</strong>
                    <small>{sourceCapture?.hostname || `${sourceOptions.length} ${savedOnly ? "pages with saved items" : "captured pages"}`}</small>
                  </span>
                  <span className="page-scope__count">{sourceCapture?.resources.length ?? allPageResourceCount}</span>
                  <ChevronDown size={17} aria-hidden="true" />
                </button>
                {sourcePageMenuOpen && (
                  <div className="page-scope__menu" id="source-page-menu" role="menu" aria-label="Choose a source page">
                    <button
                      className={`page-scope__option${sourceCapture ? "" : " page-scope__option--active"}`}
                      type="button"
                      role="menuitemradio"
                      aria-checked={!sourceCapture}
                      onClick={() => selectSourcePage(null)}
                    >
                      <SourcePageMark allPages />
                      <span className="page-scope__option-copy"><strong>All pages</strong><small>{countLabel(sourceOptions.length, savedOnly ? "page with saved items" : "captured page")}</small></span>
                      <span className="page-scope__count">{allPageResourceCount}</span>
                    </button>
                    {sourceOptions.map((capture) => (
                      <button
                        key={capture.id}
                        className={`page-scope__option${sourceCapture?.id === capture.id ? " page-scope__option--active" : ""}`}
                        type="button"
                        role="menuitemradio"
                        aria-checked={sourceCapture?.id === capture.id}
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

          <div className="collection-toolbar">
            <div className="category-pills" role="tablist" aria-label="Filter resources">
              {tabCategoryItems.map(({ id, label }) => (
                <button
                  key={id}
                  role="tab"
                  data-resource-tab={id}
                  aria-selected={category === id}
                  className={`category-pill${category === id ? " category-pill--active" : ""}`}
                  onClick={() => selectCategory(id)}
                >
                  {savedOnly && id === "all" ? "All saved" : label}
                  <span>{totalCounts[id]}</span>
                </button>
              ))}
            </div>
            <div className="collection-meta">
              <span>{query ? `${filteredItems.length} of ${activeCount} items` : countLabel(activeCount, showAlbums ? "resource" : "item")}</span>
              {category !== "links" && category !== "all" && (
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
              {undoDeletion && <button className="notice__undo" type="button" disabled={managementBusy} onClick={() => void handleUndoDeletion()}>Undo deletion</button>}
              <button className="icon-button icon-button--small" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16} /></button>
            </div>
          )}

          <div className={`library-layout${selected && mode === "web" ? " library-layout--details" : ""}`}>
            <section className="resource-section" aria-label={title}>
              {!loaded ? (
                <div className="loading-state"><LoaderCircle className="spin" size={23} /><span>Opening your library…</span></div>
              ) : showAlbums && pageAlbums.length > 0 ? (
                <div className="resource-albums" aria-label="Resource albums">
                  {pageAlbums.map(({ capture, sections }) => (
                    <div className="page-albums" key={capture.id} data-album-page={capture.id}>
                      {scopedCaptures.length > 1 && <h2 className="page-albums__title"><SourcePageMark capture={capture} /><span>{capture.pageTitle || capture.hostname}</span></h2>}
                      {sections.map(({ id, items }) => <ResourceAlbum key={id} category={id} items={items} onOpen={() => openAlbumCategory(capture.id, id)} onPreview={mode === "extension" ? openPreview : undefined} dragProps={resourceDrag.props} selectedKeys={selectedKeys} onToggleSelection={toggleSelection} selectionActive={selectedItems.length > 0} selectionDisabled={bulkBusy} />)}
                    </div>
                  ))}
                </div>
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
                        ? "Click Allhere's toolbar icon on this tab, then choose Scan page to collect images, icons, fonts, links, media, and files. This also starts automatic updates for this tab while the panel is open; pause them anytime."
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
                    <h2>{savedOnly ? category === "all" ? "No saved items yet" : `No saved ${title.toLowerCase()} yet` : selectedCapture ? `No ${category === "all" ? "resources" : title.toLowerCase()} on this page` : `No ${title.toLowerCase()} yet`}</h2>
                    <p>{savedOnly ? "Use a resource’s menu to save it, or choose another source page." : selectedCapture ? "Choose another page or scan this page again." : "Choose another section or scan a page that contains this kind of resource."}</p>
                  </div>
                )
              ) : activeView === "grid" ? (
                <div className="resource-grid">
                  {filteredItems.map((item) => {
                    const description = resourceDescription(item);
                    const isMenuOpen = openActionMenuId === item.id;
                    const checked = selectedKeys.has(selectionKey(item));

                    return (
                      <div className={`resource-card-frame${isMenuOpen ? " resource-card-frame--menu-open" : ""}${checked ? " resource-card-frame--selected" : ""}${selectedItems.length ? " resource-card-frame--selecting" : ""}`} key={item.id}>
                        <button
                          className={`resource-card${selected?.id === item.id ? " resource-card--selected" : ""}`}
                          onClick={() => openPreview(item)}
                          aria-label={description}
                          {...resourceDrag.props(item)}
                        >
                          <ResourceArt item={item} />
                          <span className="resource-card__copy resource-card__copy--description">
                            <span className="resource-card__description" title={description}>{description}</span>
                          </span>
                        </button>
                        <ResourceSelect item={item} checked={checked} onToggle={toggleSelection} className="resource-select--grid" disabled={bulkBusy} />
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
                        const checked = selectedKeys.has(selectionKey(item));
                        return (
                          <tr key={item.id} className={`${selected?.id === item.id ? "row-selected " : ""}${checked ? "row-bulk-selected " : ""}${selectedItems.length ? "row-selecting" : ""}`}>
                            <td>
                              <div className="table-name-cell">
                                <ResourceSelect item={item} checked={checked} onToggle={toggleSelection} className="resource-select--list" disabled={bulkBusy} />
                                <button className={`table-name${category === "links" ? " table-name--link" : ""}`} onClick={() => openPreview(item)} {...resourceDrag.props(item)}>
                                  {category === "links" ? <ResourceFavicon item={item} /> : item.kind === "page" ? <span className={`table-name__icon table-name__icon--${item.kind}`}><Icon size={17} /></span> : <ResourceArt item={item} compact />}
                                  <span>
                                    <strong title={item.kind === "image" ? resourceDescription(item) : item.title}>{item.kind === "image" ? resourceDescription(item) : item.title}</strong>
                                    <small title={category === "links" ? item.url : hostnameFor(item.url)}>
                                      {category === "links" ? item.url : hostnameFor(item.url)}
                                    </small>
                                  </span>
                                </button>
                              </div>
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

            {selected && mode === "web" && (
              <ResourceDetails
                item={selected}
                onClose={() => setSelected(null)}
                onDelete={() => sampleMode ? setSelected(null) : handleDelete(selected)}
                onCopy={handleCopy}
                allowDelete={!sampleMode}
              />
            )}
          </div>
          </>}
        </main>
      </div>

      {selected && mode === "extension" && <ResourceModal key={selectionKey(selected)} item={selected}
        onClose={() => setSelected(null)} onDelete={() => sampleMode ? setSelected(null) : handleDelete(selected)}
        onCopy={handleCopy} allowDelete={!sampleMode} onDownload={youtubeId(selected.url) ? undefined : () => void handleDownloadResource(selected, selected.kind === "icon" ? downloadFormats.icons : selected.kind === "image" ? downloadFormats.images : "original")}
        downloadFormat={selected.kind === "icon" ? downloadFormats.icons : downloadFormats.images}
        onDownloadFormatChange={selected.kind === "icon" || selected.kind === "image" ? format => setDownloadFormats(current => selected.kind === "icon" ? { ...current, icons: format } : { ...current, images: format as ImageDownloadFormat }) : undefined}
        downloadBusy={resourceActionId === selected.id}
        statusMessage={notice}
        downloadTray={downloadTray}
      />}

      {!(selected && mode === "extension") && downloadTray}

      {selectedItems.length > 0 && (
        <div className="bulk-selection" role="region" aria-label="Selected resources" aria-busy={bulkBusy}>
          <span className="bulk-selection__count" aria-live="polite">
            <strong>{selectedItems.length}</strong> selected
            {bulkBusy && <small>{bulkProgress}</small>}
          </span>
          <span className="bulk-selection__controls">
            <button type="button" onClick={selectAllVisible} disabled={bulkBusy || allVisibleSelected || !filteredItems.length}>Select all</button>
            <button type="button" onClick={() => { setSelectedKeys(new Set()); setBulkMenuOpen(false); }} disabled={bulkBusy}>Unselect all</button>
          </span>
          <div className="bulk-selection__menu" ref={bulkMenuRef}>
            <button
              className="bulk-selection__menu-trigger"
              type="button"
              aria-label="More actions for selected resources"
              aria-haspopup={selectedIcons || selectedImages ? "dialog" : "menu"}
              aria-expanded={bulkMenuOpen}
              onClick={() => setBulkMenuOpen((open) => !open)}
              disabled={bulkBusy || resourceActionId !== null}
            >
              {bulkBusy ? <LoaderCircle className="spin" size={18} /> : <MoreVertical size={19} />}
            </button>
            {bulkMenuOpen && (
              <div className="bulk-selection__menu-panel" role={selectedIcons || selectedImages ? "dialog" : "menu"} aria-label="Bulk actions">
                {selectedIcons && <DownloadFormatSelect label="Icon format" value={downloadFormats.icons} allowSvg onChange={format => setDownloadFormats(current => ({ ...current, icons: format }))} />}
                {selectedImages && <DownloadFormatSelect label="Image format" value={downloadFormats.images} onChange={format => setDownloadFormats(current => ({ ...current, images: format as ImageDownloadFormat }))} />}
                <button type="button" role={selectedIcons || selectedImages ? undefined : "menuitem"} onClick={() => void handleBulkDownload()}><FileArchive size={17} /><span>Download as ZIP</span></button>
                <button type="button" role={selectedIcons || selectedImages ? undefined : "menuitem"} onClick={() => void handleBulkCopy()}><Copy size={17} /><span>Copy URLs</span></button>
              </div>
            )}
          </div>
        </div>
      )}

      <footer className="app-footer">
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

function ResourceModal(props: Parameters<typeof ResourceDetails>[0]) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.querySelectorAll<HTMLMediaElement>("video, audio").forEach((media) => {
        media.pause();
        media.removeAttribute("src");
        media.load();
      });
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialogRef} className="resource-modal" aria-label={`Preview of ${resourceDescription(props.item)}`}
    onCancel={(event) => { event.preventDefault(); props.onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) props.onClose();
    }}>
    <ResourceDetails {...props} preview />
  </dialog>;
}

function ResourceDetails({
  item,
  onClose,
  onDelete,
  onCopy,
  allowDelete,
  preview = false,
  downloadTray,
  onDownload,
  downloadBusy = false,
  downloadFormat = "original",
  onDownloadFormatChange,
  statusMessage,
}: {
  item: DisplayItem;
  onClose: () => void;
  onDelete: () => void;
  onCopy: (url: string) => void;
  allowDelete: boolean;
  preview?: boolean;
  onDownload?: () => void;
  downloadBusy?: boolean;
  downloadFormat?: IconDownloadFormat;
  onDownloadFormatChange?: (format: IconDownloadFormat) => void;
  statusMessage?: string;
  downloadTray?: ReactNode;
}) {
  const resource = item.resource;
  const webUrl = safeWebUrl(item.url);
  const Icon = kindIcon(item.kind);
  const imageDescription = item.kind === "image" ? resource?.description?.trim() || resource?.alt?.trim() : undefined;

  return (
    <aside className="details-panel" aria-label="Resource details">
      <div className="details-panel__top">
        <span className="details-panel__heading">{preview ? "Preview" : "Details"}</span>
        <button className="icon-button icon-button--small" aria-label={preview ? "Close preview" : "Close details"} onClick={onClose}><X size={17} /></button>
      </div>

      <ResourceArt item={item} preview={preview} />
      {preview && !["image", "icon", "font", "video", "audio"].includes(item.kind) && <p className="resource-modal__unsupported">An inline preview is not available for this resource. You can copy its address{item.kind === "link" || item.kind === "page" ? "." : " or download the file."}</p>}

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
          {imageDescription && <div><dt>Description</dt><dd className="metadata-alt">{imageDescription}</dd></div>}
          {resource?.alt && resource.alt.trim() !== imageDescription && <div><dt>Alt text</dt><dd className="metadata-alt">{resource.alt}</dd></div>}
        </dl>
      </div>

      <div className="details-actions">
        {preview && onDownloadFormatChange && <DownloadFormatSelect label="Download format" value={downloadFormat} allowSvg={item.kind === "icon"} disabled={downloadBusy} onChange={onDownloadFormatChange} />}
        {preview ? (
          item.kind === "link" || item.kind === "page" || !onDownload
            ? <button className="button button--primary details-open" onClick={() => onCopy(item.url)}><Copy size={16} /><span>Copy URL</span></button>
            : <button className="button button--primary details-open" onClick={onDownload} disabled={downloadBusy}>
              {downloadBusy ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}<span>{downloadBusy ? "Preparing…" : "Download"}</span>
            </button>
        ) : webUrl ? (
          <a className="button button--primary details-open" href={webUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} /><span>Open resource</span>
          </a>
        ) : (
          <button className="button button--disabled" disabled title="Only standard web URLs can be opened from the library">
            <ExternalLink size={16} /><span>Cannot open this address</span>
          </button>
        )}
        {allowDelete && <button className="icon-button details-delete" aria-label="Remove from library" title="Remove from library" onClick={onDelete}><Trash2 size={17} /></button>}
        {preview && statusMessage && <p className="resource-modal__status" role="status">{statusMessage}</p>}
      </div>
      {preview && downloadTray && <div className="modal-downloads">{downloadTray}</div>}
    </aside>
  );
}
