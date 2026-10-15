import { iconAsSvg, loadImageFile } from "./assetFiles";

export type ImageDownloadFormat = "original" | "png" | "jpeg" | "webp";
export type IconDownloadFormat = ImageDownloadFormat | "svg";
export type ImageScale = 1 | 2 | 4;
export type DownloadFormats = { images: ImageDownloadFormat; icons: IconDownloadFormat; imageScale: ImageScale };

export const originalDownloadFormats: DownloadFormats = { images: "original", icons: "original", imageScale: 1 };

export function scaledImageFilename(filename: string, scale: ImageScale): string {
  if (scale === 1) return filename;
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? `${filename.slice(0, dot)}-${scale}x${filename.slice(dot)}` : `${filename}-${scale}x`;
}

export async function convertImageDownload(rawUrl: string, format: IconDownloadFormat, scale: ImageScale = 1, signal?: AbortSignal): Promise<{ blob: Blob; extension: string; width?: number; height?: number }> {
  if (![1, 2, 4].includes(scale)) throw new Error("Choose Original, 2×, or 4× image size.");
  signal?.throwIfAborted();
  if (format === "svg") {
    if (scale !== 1) throw new Error("SVG icons already scale as vectors. Choose a raster format to resize an image.");
    const { markup } = await iconAsSvg(rawUrl);
    return { blob: new Blob([markup], { type: "image/svg+xml" }), extension: "svg" };
  }
  const file = await loadImageFile(rawUrl, signal);
  signal?.throwIfAborted();
  if (format === "original" && scale === 1) return file;
  // Enlarging an original uses a durable PNG frame. Explicit JPEG/WebP choices
  // still use their requested encoder, including JPEG's white background.
  const outputFormat = format === "original" ? "png" : format;
  const width = file.width * scale, height = file.height * scale;
  if (width * height > 40_000_000 || width > 16_384 || height > 16_384) {
    throw new Error(scale === 1 ? "This image is too large to convert. Choose Original to download it."
      : `This ${scale}× image would be too large (${width} × ${height} pixels). Choose a smaller size or Original.`);
  }
  const objectUrl = URL.createObjectURL(file.blob);
  const image = new Image();
  try {
    image.src = objectUrl;
    await image.decode();
    signal?.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image conversion is unavailable. Choose Original to download it.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      if (outputFormat === "jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0, width, height);
      const mime = `image/${outputFormat}`;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => {
        if (!result || result.type !== mime) reject(new Error(`This browser cannot export ${outputFormat.toUpperCase()}. Choose another format.`));
        else resolve(result);
      }, mime, 0.92));
      signal?.throwIfAborted();
      return { blob, extension: outputFormat === "jpeg" ? "jpg" : outputFormat, width, height };
    } finally { canvas.width = 0; canvas.height = 0; }
  } finally { image.removeAttribute("src"); URL.revokeObjectURL(objectUrl); }
}
