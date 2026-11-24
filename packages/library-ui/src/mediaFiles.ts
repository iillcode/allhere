import {
  ADTS, BlobSource, BufferTarget, Conversion, CustomPathedSource, EncodedPacketSink, FLAC, HLS_FORMATS,
  Input, MATROSKA, MP3, MP4, Mp4OutputFormat, OGG, Output, QTFF, UrlSource, VideoSampleSink, WAVE, WEBM,
} from "mediabunny";
import { validMediaUrl } from "@stashwell/core";

type MediaKind = "audio" | "video";
const MAX_STREAM_BYTES = 256 * 1024 * 1024;
const MANIFEST_LIMIT = 2 * 1024 * 1024;
const requestOptions = { credentials: "omit", referrerPolicy: "no-referrer" } as const;
const incomplete = "The site returned only part of this media. Open the source page for a complete file.";
const noVideo = "This file has no readable video frames. Try another source for this video.";
const dashMessage = "This DASH stream plays on its source page. Use a direct file offered by the player to download it.";
const directFormats = [MP4, QTFF, WEBM, MATROSKA, OGG, MP3, WAVE, FLAC, ADTS];

async function openMedia(url: string, signal: AbortSignal) {
  if (!validMediaUrl(url)) throw new Error("The media needs an HTTP or HTTPS file address.");
  const response = await fetch(url, { ...requestOptions, signal });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`The media host returned HTTP ${response.status}. Scan the page for a fresh link.`);
  }
  const range = response.headers.get("content-range");
  if (response.status === 206 || range) {
    const full = range?.match(/^bytes 0-(\d+)\/(\d+)$/i);
    if (!full || Number(full[1]) + 1 !== Number(full[2])) {
      await response.body.cancel();
      throw new Error(incomplete);
    }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  const read = async () => {
    const { done, value } = await reader.read();
    if (done) return false;
    chunks.push(value);
    size += value.byteLength;
    return true;
  };
  try {
    while (size < 512 && await read()) { /* A signature can span network chunks. */ }
    const head = new Uint8Array(await new Blob(chunks).slice(0, 512).arrayBuffer());
    const length = response.headers.has("content-encoding") ? 0 : Number(response.headers.get("content-length"));
    return {
      url: response.url, head, length, mime: response.headers.get("content-type") || "",
      cancel: () => reader.cancel().catch(() => {}),
      smallBlob: async (limit: number) => {
        if (length > limit) return;
        while (size <= limit && await read()) { /* Keep short, chunked responses from the original request. */ }
        if (size <= limit) return new Blob(chunks);
      },
      blob: async (limit: number, limitMessage: string) => {
        if (length > limit || size > limit) throw new Error(limitMessage);
        while (await read()) if (size > limit) throw new Error(limitMessage);
        if (length && size !== length) throw new Error(incomplete);
        return new Blob(chunks);
      },
    };
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
}

function checkPlaylist(text: string) {
  if (text.split(/\r?\n/).some(line => /^#EXT-X-(?:SESSION-)?KEY:/i.test(line.trim()) && !/^#EXT-X-KEY:\s*METHOD=NONE\s*$/i.test(line.trim()))) {
    throw new Error("This stream is encrypted. Play it on its source page.");
  }
  if ((/^#EXTINF:/m.test(text) || !/^#EXT-X-STREAM-INF:/m.test(text)) && !/^#EXT-X-ENDLIST\s*$/m.test(text)) {
    throw new Error("This playlist has no ending yet. Open the source page to watch the stream.");
  }
  if (/^#EXT-X-I-FRAMES-ONLY\s*$/m.test(text)) throw new Error("This playlist contains thumbnail frames. Choose the full video on its source page.");
}

async function assembleHls(url: string, manifest: Blob, kind: MediaKind, signal: AbortSignal, limit: number, limitMessage: string, previewSeconds?: number) {
  checkPlaylist(await manifest.text());
  let received = 0;
  const source = new CustomPathedSource(url, async request => {
    if (request.isRoot) return new BlobSource(manifest);
    const file = await openMedia(request.path, signal);
    try {
      const playlist = new TextDecoder().decode(file.head).trimStart().startsWith("#EXTM3U");
      const blob = await file.blob(playlist ? MANIFEST_LIMIT : limit - received, playlist ? "The stream playlist is too large." : limitMessage);
      if (playlist) checkPlaylist(await blob.text());
      else {
        received += blob.size;
        if (received > limit) throw new Error(limitMessage);
      }
      return new BlobSource(blob);
    } finally { await file.cancel(); }
  });
  const input = new Input({ formats: HLS_FORMATS, source, formatOptions: { hls: { offsetTimestampsByDateTime: false } } });
  const dispose = () => input.dispose();
  signal.addEventListener("abort", dispose, { once: true });
  try {
    signal.throwIfAborted();
    const track = kind === "video" ? await input.getPrimaryVideoTrack() : await input.getPrimaryAudioTrack();
    if (!track || !(await new EncodedPacketSink(track).getFirstPacket())?.byteLength) throw new Error(kind === "video" ? noVideo : "This stream contains no readable audio.");
    const target = new BufferTarget();
    target.on("write", ({ end }) => { if (end > limit) throw new Error(limitMessage); });
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
    const conversion = await Conversion.init({
      input, output, tracks: "primary", copy: { mode: "forced", shiftTolerance: Infinity },
      video: { discard: kind === "audio" }, ...(previewSeconds ? { trim: { end: (await track.getFirstTimestamp()) + previewSeconds } } : {}),
    });
    if (!conversion.isValid || conversion.discardedTracks.some(entry => entry.reason !== "discarded_by_user")) {
      throw new Error("This stream uses a format that cannot be saved as MP4. Open its source page.");
    }
    await conversion.execute();
    if (!target.buffer?.byteLength) throw new Error(incomplete);
    return { blob: new Blob([target.buffer], { type: kind === "video" ? "video/mp4" : "audio/mp4" }), extension: kind === "video" ? "mp4" : "m4a" };
  } finally { signal.removeEventListener("abort", dispose); input.dispose(); }
}

async function directFormat(source: Blob | string, kind: MediaKind, signal: AbortSignal) {
  const input = new Input({ formats: directFormats, source: typeof source === "string"
    ? new UrlSource(source, { requestInit: requestOptions, getRetryDelay: () => null, maxCacheSize: 4 * 1024 * 1024 })
    : new BlobSource(source) });
  const dispose = () => input.dispose();
  signal.addEventListener("abort", dispose, { once: true });
  try {
    signal.throwIfAborted();
    const format = await input.getFormat();
    if (kind === "video") {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error(noVideo);
      const packets = new EncodedPacketSink(track);
      const first = await packets.getFirstKeyPacket();
      if (!first?.data.byteLength) throw new Error(noVideo);
      if (typeof VideoDecoder !== "undefined" && await track.canDecode()) {
        const frame = await new VideoSampleSink(track).getSample(first.timestamp);
        if (!frame) throw new Error(noVideo);
        frame.close();
      }
      if (source instanceof Blob && (format === MP4 || format === QTFF) && !(await packets.getPacket(Infinity))?.data.byteLength) throw new Error(incomplete);
    }
    const extension = format === MP4 ? (kind === "audio" ? "m4a" : "mp4") : format === QTFF ? "mov"
      : format === WEBM ? "webm" : format === MATROSKA ? "mkv" : format === OGG ? (kind === "video" ? "ogv" : "ogg")
      : format === WAVE ? "wav" : format === FLAC ? "flac" : format === ADTS ? "aac" : "mp3";
    const mime = format === MP4 || format === WEBM ? `${kind}/${format === MP4 ? "mp4" : "webm"}`
      : format === OGG ? `${kind}/ogg` : format.mimeType;
    return { extension, mime };
  } catch (error) {
    signal.throwIfAborted();
    throw new Error(kind === "video" ? noVideo : "The host did not return a recognized audio file.", { cause: error });
  } finally { signal.removeEventListener("abort", dispose); input.dispose(); }
}

type MediaOptions = { signal: AbortSignal; maxBytes?: number; limitMessage?: string; previewSeconds?: number };
type MediaFile = { blob: Blob; extension: string };
export function prepareMedia(url: string, kind: MediaKind, options: MediaOptions & { maxBytes: number }): Promise<MediaFile>;
export function prepareMedia(url: string, kind: MediaKind, options: MediaOptions): Promise<{ blob?: Blob; extension: string; expectedBytes?: number; responseMime?: string }>;
export async function prepareMedia(url: string, kind: MediaKind, options: MediaOptions) {
  const { signal, maxBytes, previewSeconds, limitMessage = "This stream exceeds the 256 MB download limit." } = options;
  const file = await openMedia(url, signal);
  try {
    const text = new TextDecoder().decode(file.head);
    if (text.trimStart().startsWith("#EXTM3U")) {
      const manifest = await file.blob(MANIFEST_LIMIT, "The stream playlist is too large.");
      return await assembleHls(file.url, manifest, kind, signal, maxBytes ?? MAX_STREAM_BYTES, limitMessage, previewSeconds);
    }
    if (/<(?:\w+:)?MPD\b/i.test(text) || /dash\+xml/i.test(file.mime)) throw new Error(dashMessage);
    if (!file.head.length || /^\s*(?:[<{\[]|#EXT)/.test(text)) throw new Error("The host returned a page or an empty file. Scan the source page for a fresh media link.");
    if (/^(?:moof|styp|sidx|mdat)$/.test(text.slice(4, 8))) throw new Error(incomplete);
    // Small videos can be saved from the exact bytes we verify. Large direct transfers stay in Chrome's download manager.
    const blob = maxBytes !== undefined ? await file.blob(maxBytes, limitMessage) : kind === "video" ? await file.smallBlob(4 * 1024 * 1024) : undefined;
    if (!blob) await file.cancel();
    const format = text.startsWith("RIFF") && text.slice(8, 12) === "AVI " && kind === "video" && text.includes("vids")
      ? { extension: "avi", mime: "video/x-msvideo" } : await directFormat(blob ?? file.url, kind, signal);
    return { extension: format.extension, ...(blob ? { blob: blob.slice(0, blob.size, format.mime) }
      : { expectedBytes: file.length, responseMime: file.mime.split(";")[0].trim().toLowerCase() }) };
  } finally { await file.cancel(); }
}
