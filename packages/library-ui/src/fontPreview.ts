const previewFontLoads = new Map<string, Promise<string | undefined>>();

async function fontFileForPreview(url: string): Promise<string> {
  if (!/\.css(?:$|[?#])/i.test(url) && !/fonts\.googleapis\.com/i.test(url)) return url;
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8000) });
  if (!response.ok) return url;
  const stylesheet = await response.text();
  const match = stylesheet.match(/url\(\s*["']?([^"')\s]+)["']?\s*\)/i);
  return match ? new URL(match[1], url).href : url;
}

async function verifiedFontBlobUrl(url: string): Promise<string | undefined> {
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8000) });
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

export function previewFontFamily(url: string, descriptors: FontFaceDescriptors = {}): Promise<string | undefined> {
  const key = JSON.stringify([url, descriptors]);
  const existing = previewFontLoads.get(key);
  if (existing) return existing;

  const family = `StashwellPreview_${previewFontLoads.size}`;
  const loaded = fontFileForPreview(url)
    .then(async (fontFile) => {
      const blobUrl = await verifiedFontBlobUrl(fontFile);
      if (!blobUrl) return undefined;
      try {
        const face = await new FontFace(family, `url(${JSON.stringify(blobUrl)})`, descriptors).load();
        document.fonts.add(face);
        return family;
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    })
    .catch(() => undefined);
  previewFontLoads.set(key, loaded);
  return loaded;
}

