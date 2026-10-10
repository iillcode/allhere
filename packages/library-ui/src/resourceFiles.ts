import type { ResourceKind } from "@allhere/core";
import { loadImageFile } from "./assetFiles";

export const MAX_DRAG_BYTES = 64 * 1024 * 1024;
const formats: Record<string, string> = {
  "application/pdf": "pdf", "font/woff": "woff", "font/woff2": "woff2",
  "application/font-woff": "woff", "font/ttf": "ttf", "font/otf": "otf",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav",
  "text/css": "css", "text/javascript": "js", "application/javascript": "js",
  "text/plain": "txt", "text/csv": "csv", "text/html": "html",
  "application/json": "json", "application/zip": "zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export async function loadResourceFile(rawUrl: string, kind: ResourceKind | "page", signal?: AbortSignal): Promise<{ blob: Blob; extension: string }> {
  if (kind === "image" || kind === "icon") return loadImageFile(rawUrl, signal);
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("This file address is invalid. Scan its page again."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("This resource cannot be fetched as a file. Use a direct HTTP or HTTPS file link.");
  }
  if (/\.(m3u8|mpd)$/i.test(url.pathname)) throw new Error("This is a streaming playlist. Choose a direct video or audio file to drag.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = window.setTimeout(abort, 60_000);
  try {
    const response = await fetch(url.href, { credentials: "omit", mode: "cors", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`The file host returned HTTP ${response.status}. Scan its page again for a fresh link.`); }
    if (Number(response.headers.get("content-length") || 0) > MAX_DRAG_BYTES) {
      await response.body?.cancel(); throw new Error("This file exceeds the 64 MB limit. Open its URL to download it.");
    }
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_DRAG_BYTES) { await reader.cancel(); throw new Error("This file exceeds the 64 MB limit. Open its URL to download it."); }
        chunks.push(Uint8Array.from(value).buffer as ArrayBuffer);
      }
    } else { const bytes = await response.arrayBuffer(); size = bytes.byteLength; chunks.push(bytes); }
    if (!size) throw new Error("The file host returned an empty file. Scan its page again.");
    if (size > MAX_DRAG_BYTES) throw new Error("This file exceeds the 64 MB limit. Open its URL to download it.");
    const original = new Blob(chunks);
    const head = new Uint8Array(await original.slice(0, 512).arrayBuffer());
    const text = new TextDecoder().decode(head);
    const urlExtension = url.pathname.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase();
    let mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "application/octet-stream";
    let extension = formats[mime] || urlExtension || "bin";
    // Prefer byte signatures over stale labels and negotiated response headers.
    if (text.startsWith("%PDF-")) { mime = "application/pdf"; extension = "pdf"; }
    else if (text.startsWith("wOF2")) { mime = "font/woff2"; extension = "woff2"; }
    else if (text.startsWith("wOFF")) { mime = "font/woff"; extension = "woff"; }
    else if (text.startsWith("OTTO")) { mime = "font/otf"; extension = "otf"; }
    else if (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0) { mime = "font/ttf"; extension = "ttf"; }
    else if (text.slice(4, 8) === "ftyp") { mime = kind === "audio" ? "audio/mp4" : "video/mp4"; extension = kind === "audio" ? "m4a" : "mp4"; }
    else if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) { mime = kind === "audio" ? "audio/webm" : "video/webm"; extension = "webm"; }
    else if (text.startsWith("OggS")) { mime = "audio/ogg"; extension = "ogg"; }
    else if (text.startsWith("RIFF") && text.slice(8, 12) === "WAVE") { mime = "audio/wav"; extension = "wav"; }
    else if (text.startsWith("ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) { mime = "audio/mpeg"; extension = "mp3"; }
    if (/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(text) && kind !== "page" && kind !== "link" && !["html", "htm"].includes(urlExtension || "")) {
      throw new Error("The host returned a web page instead of the file. Scan its page again for a direct file link.");
    }
    if (kind === "font" && !mime.startsWith("font/") && !mime.includes("font")) throw new Error("The host did not return a supported font file.");
    if ((kind === "video" || kind === "audio") && !/^(video|audio)\//.test(mime)) throw new Error("The host did not return a direct video or audio file.");
    return { blob: new Blob([original], { type: mime }), extension };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("File preparation was interrupted or timed out. Try again.");
    if (error instanceof TypeError) throw new Error("The file could not be fetched. Check the extension’s site access or download from its source page.");
    throw error;
  } finally { window.clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
