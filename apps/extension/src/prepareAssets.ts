import { loadImageFile, type ImageFile } from "@stashwell/library-ui/asset-tools";
import type { LibrarySelectionItem } from "@stashwell/library-ui";
import { zipSync, strToU8 } from "fflate";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const MAX_SET_BYTES = 64 * 1024 * 1024;
const MAX_BOARD_BYTES = 16 * 1024 * 1024;
export const MAX_DESIGN_ASSETS = 100;

export type DesignApplication = { id: string; name: string; format: "auto" | "png"; copySvg: boolean; url?: string; instructions: string; help?: string };
export const designApplications: readonly DesignApplication[] = [
  { id: "figma", name: "Figma", format: "auto", copySvg: true, url: "https://www.figma.com/files/", instructions: "Copy SVG, open a design in Figma, and paste onto the canvas. Or unzip the download and drag the asset files into your design.", help: "https://help.figma.com/hc/en-us/articles/360040028034-Add-images-and-videos-to-designs" },
  { id: "penpot", name: "Penpot", format: "auto", copySvg: false, url: "https://design.penpot.app/", instructions: "Download and unzip the set. In an open Penpot design, drag the SVG and PNG files onto the canvas.", help: "https://help.penpot.app/user-guide/designing/layers/" },
  { id: "sketch", name: "Sketch", format: "auto", copySvg: true, instructions: "Copy SVG and paste into a Sketch document. Or unzip the download and drag the asset files onto the canvas in the Mac app.", help: "https://www.sketch.com/docs/designing/importing-and-exporting/" },
  { id: "canva", name: "Canva", format: "png", copySvg: false, url: "https://www.canva.com/", instructions: "Download and unzip the set. Open your Canva design, choose Uploads → Upload files, and select the PNG files.", help: "https://www.canva.com/help/upload-formats-requirements/" },
  { id: "illustrator", name: "Adobe Illustrator", format: "auto", copySvg: false, instructions: "Download and unzip the set. Open an SVG in Illustrator to edit its paths, or use File → Place to add an asset to your document.", help: "https://helpx.adobe.com/illustrator/using/importing-artwork-files.html" },
  { id: "photoshop", name: "Adobe Photoshop", format: "png", copySvg: false, instructions: "Download and unzip the set. Use File → Place Embedded to add each PNG to your Photoshop document. Copy image pastes the whole set as one image.", help: "https://helpx.adobe.com/photoshop/desktop/create-open-import-images/import-files/place-a-file-in-photoshop.html" },
  { id: "affinity", name: "Affinity", format: "auto", copySvg: false, instructions: "Download and unzip the set. Open an SVG to work with vectors, or use File → Place to add the SVG and PNG assets to your document.", help: "https://affinity.help/designer2/en-US.lproj/pages/Media/placeImages.html" },
  { id: "photopea", name: "Photopea", format: "auto", copySvg: false, url: "https://www.photopea.com/#%7B%7D", instructions: "Download and unzip the set. In Photopea, use File → Open & Place to add the SVG and PNG assets to an open document.", help: "https://www.photopea.com/learn/opening-saving" },
  { id: "inkscape", name: "Inkscape", format: "auto", copySvg: false, instructions: "Download and unzip the set. Open an SVG in Inkscape, or use File → Import to add the SVG and PNG assets to your document.", help: "https://inkscape-manuals.readthedocs.io/en/latest/import-other-formats.html" },
  { id: "other", name: "Other applications", format: "auto", copySvg: false, instructions: "Download and unzip the set, then import its SVG and PNG files into your application. Choose PNG if your application does not support SVG.", help: undefined },
];

export type TransferOptions = { format: "auto" | "png"; edge: number; padding: number; background: "transparent" | "white" | "black" };
export type PreparedAsset = { file: File; width: number; height: number; vector: boolean; sources: LibrarySelectionItem[] };
export type PreparationFailure = { item: LibrarySelectionItem; reason: string };
export type PreparedSet = { assets: PreparedAsset[]; failures: PreparationFailure[]; duplicates: number; ignored: number };
export type SourceCache = Map<string, ImageFile>;

export function applicationInstructions(application: DesignApplication, options: TransferOptions): string {
  const files = options.format === "png" ? "PNG files" : "SVG and PNG files";
  if (application.id === "figma") return `${options.format === "auto" ? "Copy SVG, open a design in Figma, and paste onto the canvas. Or download" : "Download"} and unzip the set, then drag the ${files} onto your design’s canvas.`;
  if (application.id === "sketch") return `${options.format === "auto" ? "Copy SVG and paste into a Sketch document. Or download" : "Download"} and unzip the set, then drag the ${files} onto the canvas in the Mac app.`;
  if (application.id === "canva") return `Download and unzip the set. Open your Canva design, choose Uploads → Upload files, and select the ${files}.`;
  if (application.id === "photoshop") return `Download and unzip the set. Use File → Place Embedded to add each ${options.format === "png" ? "PNG" : "asset"} to your Photoshop document. Copy image pastes the whole set as one image.`;
  return application.instructions.replace("SVG and PNG files", files).replace("SVG and PNG assets", options.format === "png" ? "PNG assets" : "SVG and PNG assets");
}

export function isDesignAsset(item: LibrarySelectionItem): boolean {
  if (item.kind === "image" || item.kind === "icon") return true;
  if (item.kind !== "document" && item.kind !== "other") return false;
  try { return /\.(?:svg|png|jpe?g|webp|gif|avif|bmp|ico)$/i.test(new URL(item.url).pathname); }
  catch { return false; }
}

export function designSelection(items: LibrarySelectionItem[]) {
  const groups = new Map<string, LibrarySelectionItem[]>();
  let ignored = 0;
  let duplicates = 0;
  for (const item of items) {
    if (!isDesignAsset(item)) { ignored++; continue; }
    const key = item.identity || item.url;
    const group = groups.get(key);
    if (group) { group.push(item); duplicates++; }
    else groups.set(key, [item]);
  }
  return { groups: [...groups.values()], ignored, duplicates };
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Preparation cancelled.", "AbortError");
}

function dimensions(source: ImageFile, options: TransferOptions) {
  const scale = options.edge ? options.edge / Math.max(source.width, source.height) : 1;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const outerWidth = width + options.padding * 2;
  const outerHeight = height + options.padding * 2;
  if (outerWidth > 8192 || outerHeight > 8192 || outerWidth * outerHeight > 24_000_000) {
    throw new Error("This asset is too large to prepare at this size. Choose a smaller longest edge.");
  }
  return { width, height, outerWidth, outerHeight };
}

async function pngBlob(source: Blob, width: number, height: number, options: Pick<TransferOptions, "padding" | "background">, signal?: AbortSignal): Promise<Blob> {
  checkAbort(signal);
  const image = new Image();
  const url = URL.createObjectURL(source);
  const canvas = document.createElement("canvas");
  let timeout: number | undefined;
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(new DOMException("Preparation cancelled.", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      timeout = window.setTimeout(() => reject(new Error("This image took too long to render. Try a smaller size.")), 15_000);
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This asset could not be rendered. Scan the page for a fresh copy."));
      image.src = url;
    });
    checkAbort(signal);
    canvas.width = width + options.padding * 2;
    canvas.height = height + options.padding * 2;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preparation is unavailable in this browser.");
    if (options.background !== "transparent") {
      context.fillStyle = options.background === "white" ? "#ffffff" : "#000000";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, options.padding, options.padding, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => {
      if (result?.type === "image/png") resolve(result);
      else reject(new Error("This asset could not be converted to PNG. Try a smaller size."));
    }, "image/png"));
    checkAbort(signal);
    return blob;
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    if (abort) signal?.removeEventListener("abort", abort);
    image.onload = null; image.onerror = null; image.removeAttribute("src");
    URL.revokeObjectURL(url);
    canvas.width = 0; canvas.height = 0;
  }
}

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The prepared file could not be read. Prepare the set again."));
    reader.readAsDataURL(blob);
  });
}

async function preparedBlob(source: ImageFile, options: TransferOptions, signal?: AbortSignal) {
  const { width, height, outerWidth, outerHeight } = dimensions(source, options);
  if (options.format === "png" || !source.svg) {
    return { blob: await pngBlob(source.blob, width, height, options, signal), width: outerWidth, height: outerHeight, vector: false };
  }
  const artwork = new DOMParser().parseFromString(source.svg, "image/svg+xml").documentElement;
  // SVG consumers agree on PNG/JPEG embeds. Normalize newer raster encodings
  // inside an SVG too, so importing the set does not leave empty image layers.
  for (const image of Array.from(artwork.querySelectorAll("image"))) {
    const href = image.getAttribute("href") || image.getAttributeNS(XLINK_NS, "href");
    if (!href?.startsWith("data:")) continue;
    const embedded = await loadImageFile(href, signal, { selfContained: true });
    if (embedded.width * embedded.height > 24_000_000 || embedded.width > 8192 || embedded.height > 8192) throw new Error("An image embedded in this SVG is too large. Use a smaller source.");
    const dataUrl = await blobDataUrl(await pngBlob(embedded.blob, embedded.width, embedded.height, { padding: 0, background: "transparent" }, signal));
    image.setAttribute("href", dataUrl);
    image.setAttributeNS(XLINK_NS, "xlink:href", dataUrl);
  }
  const root = document.createElementNS(SVG_NS, "svg");
  root.setAttribute("xmlns", SVG_NS);
  root.setAttribute("version", "1.1");
  root.setAttribute("width", String(outerWidth));
  root.setAttribute("height", String(outerHeight));
  root.setAttribute("viewBox", `0 0 ${outerWidth} ${outerHeight}`);
  if (options.background !== "transparent") {
    const background = document.createElementNS(SVG_NS, "rect");
    background.setAttribute("width", "100%"); background.setAttribute("height", "100%");
    background.setAttribute("fill", options.background === "white" ? "#ffffff" : "#000000");
    root.appendChild(background);
  }
  artwork.setAttribute("x", String(options.padding)); artwork.setAttribute("y", String(options.padding));
  artwork.setAttribute("width", String(width)); artwork.setAttribute("height", String(height));
  root.appendChild(artwork);
  return { blob: new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" }), width: outerWidth, height: outerHeight, vector: true };
}

function filenameFor(label: string, extension: string, used: Set<string>) {
  let stem = label.replace(/\.[a-z0-9]{1,6}$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 80) || "asset";
  if (/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem)) stem = `asset-${stem}`;
  let name = `${stem}.${extension}`;
  let index = 2;
  while (used.has(name.toLowerCase())) name = `${stem} (${index++}).${extension}`;
  used.add(name.toLowerCase());
  return name;
}

export async function prepareDesignAssets(
  items: LibrarySelectionItem[], options: TransferOptions, cache: SourceCache,
  onProgress: (done: number, total: number) => void, signal: AbortSignal,
): Promise<PreparedSet> {
  const { groups, duplicates, ignored } = designSelection(items);
  if (!groups.length) throw new Error("Select images or icons to send to a design application.");
  if (groups.length > MAX_DESIGN_ASSETS) throw new Error(`Choose up to ${MAX_DESIGN_ASSETS} unique assets at a time.`);
  if (![0, 24, 32, 48, 64, 128, 256, 512, 1024, 2048, 4096].includes(options.edge) || ![0, 8, 16, 24].includes(options.padding)) throw new Error("Choose a supported asset size and padding.");
  if (!["auto", "png"].includes(options.format) || !["transparent", "white", "black"].includes(options.background)) throw new Error("Choose a supported format and background.");
  const result: PreparedSet = { assets: [], failures: [], duplicates, ignored };
  const names = new Set<string>();
  const hashes = new Map<string, PreparedAsset>();
  let sourceBytes = 0;
  let preparedBytes = 0;
  for (const [index, sources] of groups.entries()) {
    checkAbort(signal);
    onProgress(index, groups.length);
    const item = sources[0]!;
    try {
      let source = cache.get(item.url);
      if (!source) {
        source = await loadImageFile(item.url, signal, { selfContained: true });
        checkAbort(signal);
        const cachedBytes = [...cache.values()].reduce((sum, file) => sum + file.blob.size, 0);
        if (cachedBytes + source.blob.size <= MAX_SET_BYTES) cache.set(item.url, source);
      }
      sourceBytes += source.blob.size;
      if (sourceBytes > MAX_SET_BYTES) throw new Error("The set exceeds 64 MB of source images. Choose fewer assets.");
      const prepared = await preparedBlob(source, options, signal);
      checkAbort(signal);
      const bytes = await prepared.blob.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
      const previous = hashes.get(hash);
      if (previous) { previous.sources.push(...sources); result.duplicates++; }
      else {
        if (preparedBytes + prepared.blob.size > MAX_SET_BYTES) throw new Error("The prepared set exceeds 64 MB. Choose a smaller size or fewer assets.");
        preparedBytes += prepared.blob.size;
        const file = new File([prepared.blob], filenameFor(item.label, prepared.vector ? "svg" : "png", names), { type: prepared.blob.type });
        const asset = { file, width: prepared.width, height: prepared.height, vector: prepared.vector, sources: [...sources] };
        hashes.set(hash, asset); result.assets.push(asset);
      }
    } catch (error) {
      checkAbort(signal);
      result.failures.push({ item, reason: error instanceof Error ? error.message : "This asset could not be prepared. Try again." });
    }
    onProgress(index + 1, groups.length);
  }
  return result;
}

function namespaceSvg(root: Element, prefix: string) {
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  const ids = new Map<string, string>();
  for (const element of elements) if (element.id) ids.set(element.id, `${prefix}-${element.id}`);
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "id") element.setAttribute("id", ids.get(attribute.value)!);
      else {
        const value = attribute.value.replace(/url\(\s*(["']?)#([^\s)'"\u0000]+)\1\s*\)/g, (match, _quote, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : match);
        if ((attribute.localName === "href") && value.startsWith("#") && ids.has(value.slice(1))) attribute.value = `#${ids.get(value.slice(1))}`;
        else attribute.value = value;
      }
    }
  }
}

// Clipboard sets use a compact grid. Downloaded files retain their prepared
// dimensions and remain independent; SVG groups keep their actual vector paths.
export async function createSvgBoard(assets: PreparedAsset[]): Promise<{ blob: Blob; width: number; height: number }> {
  if (!assets.length) throw new Error("There are no prepared assets to copy.");
  if (assets.reduce((sum, asset) => sum + asset.file.size, 0) > MAX_BOARD_BYTES * 0.7) throw new Error("This set is too large to copy together. Download the set to keep every asset.");
  const sizes = assets.map(asset => {
    const scale = Math.min(1, 512 / Math.max(asset.width, asset.height));
    return { width: Math.max(1, Math.round(asset.width * scale)), height: Math.max(1, Math.round(asset.height * scale)) };
  });
  const columns = Math.ceil(Math.sqrt(assets.length));
  const rows = Math.ceil(assets.length / columns);
  const gap = assets.length > 1 ? 24 : 0;
  const cellWidth = Math.max(...sizes.map(size => size.width));
  const cellHeight = Math.max(...sizes.map(size => size.height));
  const width = cellWidth * columns + gap * (columns - 1);
  const height = cellHeight * rows + gap * (rows - 1);
  const root = document.createElementNS(SVG_NS, "svg");
  root.setAttribute("xmlns", SVG_NS); root.setAttribute("xmlns:xlink", XLINK_NS); root.setAttribute("version", "1.1");
  root.setAttribute("width", String(width)); root.setAttribute("height", String(height)); root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  for (const [index, asset] of assets.entries()) {
    const size = sizes[index]!;
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("id", `asset-${index + 1}`);
    const title = document.createElementNS(SVG_NS, "title"); title.textContent = asset.file.name; group.appendChild(title);
    let artwork: Element;
    if (asset.vector) {
      artwork = new DOMParser().parseFromString(await asset.file.text(), "image/svg+xml").documentElement;
      namespaceSvg(artwork, `stashwell-${index + 1}`);
    } else {
      artwork = document.createElementNS(SVG_NS, "image");
      const dataUrl = await blobDataUrl(asset.file);
      artwork.setAttribute("href", dataUrl); artwork.setAttributeNS(XLINK_NS, "xlink:href", dataUrl);
    }
    artwork.setAttribute("x", String(index % columns * (cellWidth + gap) + (cellWidth - size.width) / 2));
    artwork.setAttribute("y", String(Math.floor(index / columns) * (cellHeight + gap) + (cellHeight - size.height) / 2));
    artwork.setAttribute("width", String(size.width)); artwork.setAttribute("height", String(size.height));
    group.appendChild(artwork); root.appendChild(group);
  }
  const blob = new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" });
  if (blob.size > MAX_BOARD_BYTES) throw new Error("This set is too large to copy together. Download the set to keep every asset.");
  return { blob, width, height };
}

export async function createPngBoard(assets: PreparedAsset[]): Promise<Blob> {
  const board = await createSvgBoard(assets);
  const scale = Math.min(1, 4096 / Math.max(board.width, board.height));
  return pngBlob(board.blob, Math.max(1, Math.round(board.width * scale)), Math.max(1, Math.round(board.height * scale)), { padding: 0, background: "transparent" });
}

export async function createAssetPack(result: PreparedSet, application: DesignApplication, options: TransferOptions): Promise<File> {
  if (!result.assets.length) throw new Error("There are no prepared assets to download.");
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const asset of result.assets) files[`assets/${asset.file.name}`] = new Uint8Array(await asset.file.arrayBuffer());
  files["sources.json"] = strToU8(JSON.stringify({
    application: "Stashwell", destination: application.name, preparedAt: new Date().toISOString(), options,
    duplicateCount: result.duplicates, otherResourceCount: result.ignored,
    assets: result.assets.map(asset => ({ filename: `assets/${asset.file.name}`, width: asset.width, height: asset.height, vector: asset.vector,
      sources: asset.sources.map(item => ({ label: item.label, url: item.url.startsWith("data:") ? "Inline image" : item.url, pageUrl: item.pageUrl })),
    })),
    excluded: result.failures.map(({ item, reason }) => ({ label: item.label, url: item.url.startsWith("data:") ? "Inline image" : item.url, reason })),
  }, null, 2));
  files["README.txt"] = strToU8(`Stashwell asset set for ${application.name}\n\n${applicationInstructions(application, options)}\n\nOpen the assets folder after extracting this ZIP. Import the individual SVG and PNG files, not the ZIP.\n\nSVG files retain vector artwork; raster source images remain raster. PNG output is a still image. Padding and backgrounds reflect your preparation settings. Clipboard copies arrange the set in a compact grid and do not affect these files.\n\n${result.assets.length} files included. ${result.duplicates} duplicates removed. ${result.ignored} non-image resources excluded. ${result.failures.length} assets could not be prepared; any exclusions were confirmed in Stashwell and are listed in sources.json.\n\nsources.json records each asset's original page and URL.\n`);
  const archive = zipSync(files, { level: 0 });
  return new File([archive as Uint8Array<ArrayBuffer>], `stashwell-${application.id}-assets.zip`, { type: "application/zip" });
}
