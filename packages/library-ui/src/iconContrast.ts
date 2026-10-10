const SAMPLE_SIZE = 48;
const MAX_ICON_BYTES = 4 * 1024 * 1024;
const analyses = new Map<string, Promise<boolean>>();

function isMostlyWhiteOnTransparent(image: CanvasImageSource): boolean | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;

  try {
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    let transparent = 0;
    let visible = 0;
    let white = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      if (alpha < 32) transparent++;
      if (alpha < 96) continue;
      visible++;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (Math.min(red, green, blue) >= 210 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 40) white++;
    }
    return transparent > SAMPLE_SIZE * SAMPLE_SIZE * 0.12 && visible > 12 && white / visible > 0.72;
  } catch {
    // A cross-origin image can render in <img> while canvas pixel access is blocked.
    return undefined;
  }
}

async function fetchedIconNeedsDarkBackground(url: string): Promise<boolean> {
  if (window.location.protocol !== "chrome-extension:" || !/^https?:\/\//i.test(url)) return false;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { credentials: "omit", signal: controller.signal });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > MAX_ICON_BYTES) return false;
    const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (mime && !mime.startsWith("image/") && mime !== "application/octet-stream") return false;

    const reader = response.body?.getReader();
    if (!reader) return false;
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ICON_BYTES) { await reader.cancel(); return false; }
      chunks.push(Uint8Array.from(value).buffer as ArrayBuffer);
    }
    if (!size) return false;
    const bitmap = await createImageBitmap(new Blob(chunks, { type: mime || "application/octet-stream" }));
    try {
      return isMostlyWhiteOnTransparent(bitmap) ?? false;
    } finally {
      bitmap.close();
    }
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function iconNeedsDarkBackground(url: string, image: HTMLImageElement): Promise<boolean> {
  const cached = analyses.get(url);
  if (cached) return cached;
  const direct = isMostlyWhiteOnTransparent(image);
  const analysis = Promise.resolve(direct ?? fetchedIconNeedsDarkBackground(url));
  analyses.set(url, analysis);
  if (analyses.size > 300) analyses.delete(analyses.keys().next().value!);
  return analysis;
}
