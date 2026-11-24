import type { CapturedResource, ResourceKind } from "@stashwell/core";
import { extensionForMime } from "./downloadFiles";

const fileSuffix = /\.([a-z0-9]{1,12})$/i;
const imageSuffix = /^(?:apng|avif|bmp|cur|gif|heic|heif|ico|jpe?g|jxl|png|svg|tiff?|webp)$/i;
const webHandlerSuffix = /^(?:action|ashx|asp|aspx|cfm|cgi|do|jsp|php)$/i;

export function resourceExtension(url: string, mimeType = ""): string | undefined {
  const mime = extensionForMime(mimeType) || (/^[a-z0-9]{1,12}$/i.test(mimeType) ? mimeType.toLowerCase() : undefined);
  if (mime && !webHandlerSuffix.test(mime)) return mime;
  try {
    const source = new URL(url);
    if (source.protocol === "data:") return extensionForMime(source.pathname.split(/[;,]/, 1)[0]);
    if (source.protocol === "https:" || source.protocol === "http:") {
      const extension = source.pathname.match(fileSuffix)?.[1].toLowerCase();
      if (extension && !webHandlerSuffix.test(extension)) return extension;
    }
  } catch { /* An older archive may contain an incomplete source URL. */ }
}

export function matchingFilename(name: string, extension: string, sourceExtension?: string): string {
  let stem = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/^[.\s]+|[.\s]+$/g, "");
  const suffix = stem.match(fileSuffix)?.[1].toLowerCase();
  if (suffix && (suffix === extension || suffix === sourceExtension || (imageSuffix.test(extension) && imageSuffix.test(suffix)))) {
    stem = stem.slice(0, -(suffix.length + 1)).trimEnd();
  }
  stem = stem.slice(0, 120).replace(/[.\s]+$/g, "") || "resource";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  return `${stem}.${extension}`;
}

export function resourceFilename(
  name: string, kind: ResourceKind | "page", url: string, resource?: Pick<CapturedResource, "mimeType">, extension?: string,
): string {
  const sourceExtension = resourceExtension(url, resource?.mimeType);
  const visual = kind === "image" || kind === "icon";
  const fallback = visual ? "img" : kind === "font" ? "font" : kind === "video" ? "mp4" :
    kind === "audio" ? "audio" : kind === "link" || kind === "page" ? "url" : "bin";
  return matchingFilename(name, extension || sourceExtension || fallback, sourceExtension);
}
