import { validMediaUrl } from "@stashwell/core";

export function playlistType(url: string, mime = ""): "hls" | "dash" | undefined {
  let path = "";
  try { path = new URL(url).pathname; } catch { /* Imported records may have an invalid URL. */ }
  if (/mpegurl|^m3u8$/i.test(mime) || /\.m3u8$/i.test(path)) return "hls";
  if (/dash\+xml|^mpd$/i.test(mime) || /\.mpd$/i.test(path)) return "dash";
}

export function mediaSources(url: string, mime?: string, alternatives: readonly string[] = []): string[] {
  // Only the scanner's explicitly related <source> files can replace this media.
  const candidates = playlistType(url, mime) ? [...alternatives, url] : [url, ...alternatives];
  return [...new Set(candidates.filter(validMediaUrl))];
}

export function sourcePageStream(kind: string, url: string, media?: { mimeType?: string; variantUrls?: readonly string[] }): boolean {
  return (kind === "audio" || kind === "video") && playlistType(url, media?.mimeType) === "dash" && !media?.variantUrls?.some(validMediaUrl);
}

export async function tryMediaSources<T>(url: string, mime: string | undefined, alternatives: readonly string[] | undefined,
  signal: AbortSignal, read: (source: string) => Promise<T>): Promise<T> {
  let failure: unknown;
  for (const source of mediaSources(url, mime, alternatives)) {
    signal.throwIfAborted();
    try { return await read(source); }
    catch (error) { if (!failure || source === url) failure = error; }
  }
  signal.throwIfAborted();
  throw failure ?? new Error("This media has no usable file address.");
}
