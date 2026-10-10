const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export type ImageFile = {
  blob: Blob;
  extension: string;
  width: number;
  height: number;
  svg?: string;
};

// An HTTP success can still contain a login page, an expired-link message, or
// negotiated image bytes that differ from the extension in the original URL.
async function imageBlob(rawUrl: string, signal?: AbortSignal): Promise<Blob> {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new Error("This image address is invalid. Scan the source page again."); }
  const inlineImage = url.protocol === "data:" && /^data:image\//i.test(rawUrl);
  if ((!inlineImage && !["http:", "https:"].includes(url.protocol)) || url.username || url.password) {
    throw new Error("This resource does not have a supported image address.");
  }
  if (inlineImage && rawUrl.length > MAX_IMAGE_BYTES * 1.5) {
    throw new Error("This image is too large to download here.");
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url.href, {
      credentials: "omit", mode: "cors", referrerPolicy: "no-referrer", signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403, 404, 410].includes(response.status)) {
        throw new Error("The image is unavailable or its link has expired. Scan the source page again.");
      }
      throw new Error(`The image host returned HTTP ${response.status}. Try again later.`);
    }
    if (Number(response.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) {
      await response.body?.cancel();
      throw new Error("This image is larger than the 64 MB download limit.");
    }
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw new Error("This image is larger than the 64 MB download limit.");
        }
        chunks.push(Uint8Array.from(value).buffer as ArrayBuffer);
      }
    } else {
      const bytes = await response.arrayBuffer();
      size = bytes.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error("This image is larger than the 64 MB download limit.");
      chunks.push(bytes);
    }
    if (!size) throw new Error("The image host returned an empty file. Scan the source page again.");
    return new Blob(chunks);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The image download timed out. Try again.");
    if (error instanceof TypeError) {
      throw new Error("The image could not be fetched. Check your connection and the extension’s site access, then try again.");
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    window.clearTimeout(timeout);
  }
}

const svgElements = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs",
  "symbol", "use", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern",
  "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feComposite", "feFlood",
  "feMerge", "feMergeNode", "feMorphology", "feTurbulence", "feDisplacementMap", "title", "desc",
  "text", "tspan", "textPath", "image",
]);
const svgStyles = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
  "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "color",
  "stop-color", "stop-opacity", "clip-path", "clip-rule", "mask", "filter", "font-family", "font-size",
  "font-weight", "text-anchor", "dominant-baseline", "visibility", "display", "paint-order",
]);

function safeSvgValue(value: string): boolean {
  if (/[\\<>@]|javascript:|expression\s*\(|(?:https?|file|data):/i.test(value)) return false;
  return !/url\s*\(/i.test(value) || /^url\(\s*["']?#[\w:.-]+["']?\s*\)$/.test(value);
}

export function sanitizeSvg(markup: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(markup)) throw new Error("This SVG contains unsupported document declarations.");
  const document = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = document.documentElement;
  if (document.querySelector("parsererror") || root.localName !== "svg" ||
    (root.namespaceURI && root.namespaceURI !== SVG_NAMESPACE)) {
    throw new Error("The host did not return a valid SVG image. Scan the source page again.");
  }

  // Resolve simple class styles into the SVG before removing stylesheet nodes.
  // This keeps copied markup self-contained without leaking CSS into its destination.
  for (const style of Array.from(root.querySelectorAll("style"))) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(style.textContent ?? "");
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const targets = [...(root.matches(rule.selectorText) ? [root] : []), ...root.querySelectorAll(rule.selectorText)];
        for (const property of Array.from(rule.style)) {
          const value = rule.style.getPropertyValue(property);
          if (!svgStyles.has(property) || !safeSvgValue(value)) continue;
          for (const target of targets) {
            const inline = (target as SVGElement).style?.getPropertyValue(property);
            if (!inline) target.setAttribute(property, value);
          }
        }
      }
    } catch { /* Unusable stylesheet rules are omitted from the copied icon. */ }
    style.remove();
  }

  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (!svgElements.has(element.localName) || (element.namespaceURI && element.namespaceURI !== SVG_NAMESPACE)) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "xml:base" || name === "src" || name === "tabindex") {
        element.removeAttributeNode(attribute);
      } else if (name === "style") {
        const declaration = (element as SVGElement).style;
        for (const property of Array.from(declaration)) {
          if (!svgStyles.has(property) || !safeSvgValue(declaration.getPropertyValue(property))) declaration.removeProperty(property);
        }
        if (!declaration.length) element.removeAttribute("style");
      } else if (name === "href" || name.endsWith(":href")) {
        const localReference = /^#[\w:.-]+$/.test(value);
        const embeddedImage = element.localName === "image" && /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd.microsoft.icon);base64,[a-z0-9+/=\s]+$/i.test(value);
        if (!localReference && !embeddedImage) element.removeAttributeNode(attribute);
      } else if (!name.startsWith("xmlns") && !safeSvgValue(value)) {
        element.removeAttributeNode(attribute);
      }
    }
  }
  root.setAttribute("xmlns", SVG_NAMESPACE);
  if (!root.hasAttribute("viewBox")) {
    const width = Number(root.getAttribute("width")) || 24;
    const height = Number(root.getAttribute("height")) || 24;
    root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error("This SVG has invalid dimensions.");
  }
  if (!root.hasAttribute("width") || !Number(root.getAttribute("width"))) root.setAttribute("width", String(viewBox[2]));
  if (!root.hasAttribute("height") || !Number(root.getAttribute("height"))) root.setAttribute("height", String(viewBox[3]));
  return new XMLSerializer().serializeToString(root);
}

async function decodedSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  let timeout: number | undefined;
  try {
    return await new Promise((resolve, reject) => {
      timeout = window.setTimeout(() => reject(new Error("This image could not be checked. Try downloading it again.")), 15_000);
      image.onload = () => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve({ width: image.naturalWidth, height: image.naturalHeight });
        else reject(new Error("This image has invalid dimensions."));
      };
      image.onerror = () => reject(new Error("The downloaded data is damaged or unsupported. Scan the source page for a fresh image link."));
      image.src = url;
    });
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}

export async function loadImageFile(rawUrl: string, signal?: AbortSignal): Promise<ImageFile> {
  const original = await imageBlob(rawUrl, signal);
  const header = new Uint8Array(await original.slice(0, 512).arrayBuffer());
  const text = new TextDecoder().decode(header);
  const matches = (...bytes: number[]) => bytes.every((byte, index) => header[index] === byte);
  let format: { extension: string; mimeType: string } | undefined;
  let svg: string | undefined;
  if (matches(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) format = { extension: "png", mimeType: "image/png" };
  else if (matches(0xff, 0xd8, 0xff)) format = { extension: "jpg", mimeType: "image/jpeg" };
  else if (/^GIF8[79]a/.test(text)) format = { extension: "gif", mimeType: "image/gif" };
  else if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") format = { extension: "webp", mimeType: "image/webp" };
  else if (matches(0x42, 0x4d)) format = { extension: "bmp", mimeType: "image/bmp" };
  else if (matches(0, 0, 1, 0)) format = { extension: "ico", mimeType: "image/x-icon" };
  else if (matches(0, 0, 2, 0)) format = { extension: "cur", mimeType: "image/x-icon" };
  else if (text.slice(4, 8) === "ftyp" && /avif|avis/.test(text.slice(8, 128))) format = { extension: "avif", mimeType: "image/avif" };
  else if (text.trimStart().startsWith("<")) {
    if (original.size > 4 * 1024 * 1024) throw new Error("This SVG is larger than the 4 MB download limit.");
    svg = sanitizeSvg(await original.text());
    format = { extension: "svg", mimeType: "image/svg+xml" };
  }
  if (!format) throw new Error("The host returned a page or unsupported file instead of an image. Scan the source page again.");
  const blob = new Blob([svg ?? original], { type: format.mimeType });
  return { blob, extension: format.extension, ...await decodedSize(blob), ...(svg ? { svg } : {}) };
}

export async function iconAsSvg(rawUrl: string): Promise<{ markup: string; embeddedRaster: boolean }> {
  const file = await loadImageFile(rawUrl);
  if (file.svg) return { markup: file.svg, embeddedRaster: false };
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("This icon could not be copied. Try again."));
    reader.readAsDataURL(file.blob);
  });
  const root = document.createElementNS(SVG_NAMESPACE, "svg");
  root.setAttribute("xmlns", SVG_NAMESPACE);
  root.setAttribute("width", String(file.width));
  root.setAttribute("height", String(file.height));
  root.setAttribute("viewBox", `0 0 ${file.width} ${file.height}`);
  const image = document.createElementNS(SVG_NAMESPACE, "image");
  image.setAttribute("width", String(file.width));
  image.setAttribute("height", String(file.height));
  image.setAttribute("href", dataUrl);
  root.appendChild(image);
  return { markup: new XMLSerializer().serializeToString(root), embeddedRaster: true };
}
