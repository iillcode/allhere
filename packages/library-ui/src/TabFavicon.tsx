import { Globe } from "lucide-react";
import { useEffect, useState } from "react";

function faviconSource(value?: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!url.username && !url.password && (["http:", "https:"].includes(url.protocol) || /^data:image\/(?:png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)[;,]/i.test(value))) return value;
  } catch { /* Chrome may omit the favicon until temporary tab access is granted. */ }
}

export function TabFavicon({ url, className = "scan-favicon", fallbackSize = 16 }: { url?: string; className?: string; fallbackSize?: number }) {
  const source = faviconSource(url);
  const [loaded, setLoaded] = useState<{ source: string; url: string }>();
  const [failedSource, setFailedSource] = useState<string>();

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

  return (
    <span className={className} aria-hidden="true">
      {source && loaded?.source === source && source !== failedSource
        ? <img key={source} src={loaded.url} data-favicon-url={source} alt="" referrerPolicy="no-referrer" onError={() => setFailedSource(source)} />
        : <Globe size={fallbackSize} />}
    </span>
  );
}
