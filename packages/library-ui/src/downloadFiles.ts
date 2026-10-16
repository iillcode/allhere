import type { ResourceKind } from "@stashwell/core";

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf", "application/zip": "zip", "application/json": "json",
  "application/x-7z-compressed": "7z", "application/x-rar-compressed": "rar",
  "application/x-tar": "tar", "application/gzip": "gz", "application/x-bzip2": "bz2",
  "application/x-xz": "xz", "application/wasm": "wasm",
  "application/vnd.android.package-archive": "apk", "application/x-apple-diskimage": "dmg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/msword": "doc", "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt", "application/epub+zip": "epub",
  "text/plain": "txt", "text/html": "html", "text/css": "css",
  "text/csv": "csv", "text/tab-separated-values": "tsv", "text/javascript": "js",
  "application/javascript": "js", "application/xml": "xml", "text/xml": "xml",
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg",
  "image/bmp": "bmp", "image/tiff": "tiff", "image/x-icon": "ico",
  "image/heic": "heic", "image/heif": "heif", "image/jxl": "jxl", "image/apng": "apng",
  "font/woff": "woff", "font/woff2": "woff2", "font/ttf": "ttf", "font/otf": "otf",
  "application/vnd.ms-fontobject": "eot",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "video/x-matroska": "mkv", "audio/mpeg": "mp3", "audio/mp4": "m4a",
  "audio/ogg": "ogg", "audio/wav": "wav", "audio/flac": "flac",
  "audio/aac": "aac", "audio/x-flac": "flac", "video/x-msvideo": "avi",
};

export function extensionForMime(mime: string): string | undefined {
  return MIME_EXTENSIONS[mime.split(";")[0].trim().toLowerCase()];
}

function signatureExtension(head: Uint8Array, text: string): string | undefined {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => head[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (starts(0xff, 0xd8, 0xff)) return "jpg";
  if (/^GIF8[79]a/.test(text)) return "gif";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "webp";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WAVE") return "wav";
  if (text.startsWith("%PDF-")) return "pdf";
  if (text.startsWith("wOF2")) return "woff2";
  if (text.startsWith("wOFF")) return "woff";
  if (text.startsWith("OTTO")) return "otf";
  if (starts(0, 1, 0, 0)) return "ttf";
  if (text.startsWith("fLaC")) return "flac";
  if (text.startsWith("OggS")) return "ogg";
  if (starts(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return "7z";
  if (text.startsWith("Rar!")) return "rar";
  return undefined;
}

function responseFilename(header: string | null): string | undefined {
  if (!header) return undefined;
  const encoded = header.match(/(?:^|;)\s*filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)?.[1];
  const plain = header.match(/(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i);
  let name: string | undefined;
  if (encoded) {
    try { name = decodeURIComponent(encoded.trim().replace(/^"|"$/g, "").replace(/^UTF-8''/i, "")); } catch { /* Use the plain filename. */ }
  }
  name ||= plain?.[1] || plain?.[2]?.trim();
  return name?.split(/[\\/]/).pop()?.replace(/[<>:"|?*\u0000-\u001f]/g, "-").trim() || undefined;
}

export type DownloadFile = { blob: Blob; extension?: string; filename?: string };

/** Read arbitrary file formats without decoding or changing their bytes. */
export async function loadDownloadFile(rawUrl: string, kind: ResourceKind | "page", maxBytes: number, limitMessage = "This file exceeds the 256 MB download limit."): Promise<DownloadFile> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("This file address is invalid. Scan its page again."); }
  if (!(["http:", "https:"].includes(url.protocol) || (url.protocol === "data:" && /^data:image\//i.test(rawUrl))) || url.username || url.password) {
    throw new Error("This resource does not have a downloadable file address.");
  }
  if (/\.(m3u8|mpd)$/i.test(url.pathname)) throw new Error("This is a stream playlist, not a complete file.");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(url.href, { credentials: "omit", mode: "cors", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`The file host returned HTTP ${response.status}. Scan its page again for a fresh link.`); }
    if (Number(response.headers.get("content-length") || 0) > maxBytes) {
      await response.body?.cancel(); throw new Error(limitMessage);
    }
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new Error(limitMessage); }
        chunks.push(Uint8Array.from(value));
      }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      size = bytes.byteLength;
      chunks.push(bytes);
    }
    if (!size) throw new Error("The file host returned an empty file.");
    if (size > maxBytes) throw new Error(limitMessage);
    const blob = new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
    const head = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
    const text = new TextDecoder().decode(head);
    const mime = blob.type.split(";")[0].toLowerCase();
    const urlExtension = url.pathname.match(/\.([a-z0-9]{1,12})$/i)?.[1]?.toLowerCase();
    const filename = responseFilename(response.headers.get("content-disposition"));
    const filenameExtension = filename?.match(/\.([a-z0-9]{1,12})$/i)?.[1]?.toLowerCase();
    if ((/text\/html|(?:dash\+xml|mpegurl)/i.test(mime) || /^\s*(?:<!doctype|<html|<head|<body|#EXTM3U)/i.test(text))
      && !["html", "htm"].includes(filenameExtension || urlExtension || "") && kind !== "page" && kind !== "link") {
      throw new Error("The host returned a web page or playlist instead of the file.");
    }
    const mimeExtension = extensionForMime(mime);
    const extension = signatureExtension(head, text) || filenameExtension
      || (urlExtension && !["bin", "dat", "download"].includes(urlExtension) ? urlExtension : undefined)
      || mimeExtension || urlExtension;
    return { blob, extension, filename };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("File preparation timed out. Try again.");
    if (error instanceof TypeError) throw new Error("The file could not be fetched. Check the extension's site access or open its source page.");
    throw error;
  } finally { window.clearTimeout(timer); }
}
