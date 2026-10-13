import { iconAsSvg, loadImageFile } from "./assetFiles";

export type ImageDownloadFormat = "original" | "png" | "jpeg" | "webp";
export type IconDownloadFormat = ImageDownloadFormat | "svg";
export type DownloadFormats = { images: ImageDownloadFormat; icons: IconDownloadFormat };

export const originalDownloadFormats: DownloadFormats = { images: "original", icons: "original" };

export async function convertImageDownload(rawUrl: string, format: Exclude<IconDownloadFormat, "original">): Promise<{ blob: Blob; extension: string }> {
  if (format === "svg") {
    const { markup } = await iconAsSvg(rawUrl);
    return { blob: new Blob([markup], { type: "image/svg+xml" }), extension: "svg" };
  }
  const file = await loadImageFile(rawUrl);
  if (file.width * file.height > 40_000_000) throw new Error("This image is too large to convert. Choose Original to download it.");
  const objectUrl = URL.createObjectURL(file.blob);
  const image = new Image();
  try {
    image.src = objectUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = file.width;
    canvas.height = file.height;
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image conversion is unavailable. Choose Original to download it.");
      if (format === "jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0);
      const mime = `image/${format}`;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => {
        if (!result || result.type !== mime) reject(new Error(`This browser cannot export ${format.toUpperCase()}. Choose another format.`));
        else resolve(result);
      }, mime, 0.92));
      return { blob, extension: format === "jpeg" ? "jpg" : format };
    } finally { canvas.width = 0; canvas.height = 0; }
  } finally { image.removeAttribute("src"); URL.revokeObjectURL(objectUrl); }
}
