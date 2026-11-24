import { Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { iconNeedsDarkBackground } from "./iconContrast";

function faviconSource(value?: string, pageUrl?: string): string | undefined {
  try {
    if (value && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)[;,]/i.test(value)) return value;
    const url = new URL(value || pageUrl || "");
    if (!url.username && !url.password && ["http:", "https:"].includes(url.protocol)) {
      return value ? url.href : new URL("/favicon.ico", url).href;
    }
  } catch { /* A tab or saved capture may lack a usable site address. */ }
}

export function TabFavicon({ url, pageUrl, className = "scan-favicon", fallbackSize = 16 }: { url?: string; pageUrl?: string; className?: string; fallbackSize?: number }) {
  const source = faviconSource(url, pageUrl);
  const [loaded, setLoaded] = useState<{ source: string; url: string }>();
  const [failedImage, setFailedImage] = useState<{ source: string; url: string }>();
  const [darkImage, setDarkImage] = useState<{ source: string; url: string }>();

  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    // Fetch using existing access only. A local blob also displays icons from
    // sites whose Cross-Origin-Resource-Policy blocks direct image embedding.
    void (async () => {
      const response = await fetch(source, { credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
      if (!response.ok || Number(response.headers.get("content-length")) > 512_000) { controller.abort(); return; }
      const reader = response.body?.getReader();
      if (!reader) return;
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512_000) { await reader.cancel(); return; }
        chunks.push(value);
      }
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob(chunks, { type: response.headers.get("content-type")?.split(";")[0] || "image/x-icon" }));
      setLoaded({ source, url: objectUrl });
    })().catch(() => {
      // Some CDN icons allow image embedding but do not allow CORS fetches.
      // Try their original URL without requesting additional host access.
      if (!controller.signal.aborted) setLoaded({ source, url: source });
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  const image = loaded?.source === source && loaded !== failedImage ? loaded : undefined;
  return (
    <span className={image && image === darkImage ? `${className} site-favicon--dark` : className} aria-hidden="true">
      {image
        ? <img key={image.url} src={image.url} data-favicon-url={image.source} alt="" draggable={false} referrerPolicy="no-referrer"
          onLoad={(event) => {
            const element = event.currentTarget;
            void iconNeedsDarkBackground(image.source, element).then(dark => {
              if (element.isConnected) setDarkImage(dark ? image : undefined);
            });
          }}
          onError={() => setFailedImage(image)} />
        : <Globe size={fallbackSize} />}
    </span>
  );
}
