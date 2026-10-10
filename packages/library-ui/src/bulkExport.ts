import type { ResourceKind } from "@allhere/core";
import { Zip, ZipPassThrough } from "fflate";
import { loadResourceFile } from "./resourceFiles";

type BulkEntry = {
  kind: ResourceKind | "page";
  url: string;
  label: string;
  filename: (extension?: string) => string;
};

const MAX_ZIP_BYTES = 256 * 1024 * 1024;

function uniqueFilename(filename: string, used: Set<string>): string {
  const safe = filename.replace(/[/\\\u0000-\u001f]/g, "-").trim() || "resource";
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";
  let name = safe;
  let suffix = 2;
  while (used.has(name.toLowerCase())) name = `${stem} (${suffix++})${extension}`;
  used.add(name.toLowerCase());
  return name;
}

export async function createResourceZip(
  entries: BulkEntry[],
  onProgress: (processed: number, total: number) => void,
): Promise<{ blob: Blob; included: number; skipped: number }> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const usedNames = new Set<string>();
  const skipped: string[] = [];
  let firstFailure = "";
  let included = 0;
  let bytesAdded = 0;
  let finish!: (blob: Blob) => void;
  let fail!: (error: Error) => void;
  const completed = new Promise<Blob>((resolve, reject) => { finish = resolve; fail = reject; });
  void completed.catch(() => undefined);
  const archive = new Zip((error, chunk, final) => {
    if (error) { fail(error); return; }
    if (chunk.length) chunks.push(chunk);
    if (final) finish(new Blob(chunks, { type: "application/zip" }));
  });

  const addFile = (name: string, data: Uint8Array) => {
    const file = new ZipPassThrough(uniqueFilename(name, usedNames));
    archive.add(file);
    file.push(data, true);
  };

  for (const [index, entry] of entries.entries()) {
    try {
      let bytes: Uint8Array;
      let filename: string;
      if (entry.kind === "link" || entry.kind === "page") {
        const url = new URL(entry.url);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("This link is not a web address.");
        bytes = new TextEncoder().encode(`[InternetShortcut]\r\nURL=${url.href}\r\n`);
        filename = entry.filename("url");
      } else {
        const file = await loadResourceFile(entry.url, entry.kind);
        if (bytesAdded + file.blob.size > MAX_ZIP_BYTES) throw new Error("The ZIP reached its 256 MB size limit.");
        bytes = new Uint8Array(await file.blob.arrayBuffer());
        filename = entry.filename(file.extension);
      }
      if (bytesAdded + bytes.byteLength > MAX_ZIP_BYTES) throw new Error("The ZIP reached its 256 MB size limit.");
      addFile(filename, bytes);
      bytesAdded += bytes.byteLength;
      included++;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The resource could not be downloaded.";
      if (!firstFailure) firstFailure = reason;
      skipped.push(`${entry.label}\n${entry.url}\n${reason}`);
    }
    onProgress(index + 1, entries.length);
  }

  if (!included) {
    archive.terminate();
    throw new Error(`No selected resources could be added to the ZIP. ${firstFailure || "Check the links and try again."}`);
  }
  if (skipped.length) {
    addFile("allhere-skipped.txt", new TextEncoder().encode(
      `These ${skipped.length} selected resources could not be included.\n\n${skipped.join("\n\n")}`,
    ));
  }
  archive.end();
  return { blob: await completed, included, skipped: skipped.length };
}
