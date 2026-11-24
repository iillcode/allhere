import { useEffect, useMemo, useState, type ReactNode } from "react";
import { imageSourceUrls, loadImageFile, type ImageSources } from "./assetFiles";
import { iconNeedsDarkBackground } from "./iconContrast";

type Attempt = { index: number; method: "auto" | "file" | "direct" };

function hasSvgFragment(url: string, icon: boolean): boolean {
  if (/^data:/i.test(url)) return false;
  const source = new URL(url);
  return !!source.hash && (icon || /\.svg$/i.test(source.pathname));
}

export function ResourceImage({ source, alt, isIcon, className, preview, placeholder, badge, onUnavailable }: {
  source: ImageSources; alt: string; isIcon: boolean; className: string; preview: boolean; placeholder: ReactNode; badge?: ReactNode; onUnavailable?: () => void;
}) {
  const { url, variantUrls } = source;
  const sources = useMemo(() => imageSourceUrls({ url, variantUrls }), [url, variantUrls]);
  const [attempt, setAttempt] = useState<Attempt>({ index: 0, method: "auto" });
  const [file, setFile] = useState<{ source: string; url: string }>();
  const [loaded, setLoaded] = useState<string>();
  const [light, setLight] = useState<string>();
  const candidate = sources[attempt.index];
  const fromFile = !!candidate && (attempt.method === "file" || (attempt.method === "auto" && hasSvgFragment(candidate, isIcon)));
  const displayUrl = fromFile ? (file?.source === candidate ? file?.url : undefined) : candidate;
  const showImage = !!displayUrl && loaded === displayUrl;
  useEffect(() => { if (!candidate) onUnavailable?.(); }, [candidate, onUnavailable]);

  useEffect(() => {
    if (!candidate || !fromFile) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void loadImageFile(candidate, controller.signal).then(({ blob }) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setFile({ source: candidate, url: objectUrl });
    }).catch(() => {
      if (controller.signal.aborted) return;
      setAttempt(attempt.method === "auto"
        ? { index: attempt.index, method: "direct" } : { index: attempt.index + 1, method: "auto" });
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attempt, candidate, fromFile]);

  return (
    <div className={`${className}${showImage && light === displayUrl ? " resource-art--icon-light" : ""}`}>
      {displayUrl && <img
        key={displayUrl}
        className={`resource-art__image${showImage ? " resource-art__image--loaded" : ""}`}
        src={displayUrl}
        alt={alt}
        loading={preview ? "eager" : "lazy"}
        draggable={false}
        referrerPolicy="no-referrer"
        onLoad={event => {
          const image = event.currentTarget;
          setLoaded(displayUrl);
          if (isIcon || fromFile || /^(?:data:image\/)|\.svg(?:[?#]|$)/i.test(displayUrl)) {
            void iconNeedsDarkBackground(candidate ?? displayUrl, image).then(dark => {
              if (image.isConnected) setLight(dark ? displayUrl : undefined);
            });
          }
        }}
        onError={() => {
          setLoaded(undefined);
          if (fromFile && attempt.method === "auto") setAttempt({ index: attempt.index, method: "direct" });
          else if (!fromFile && attempt.method === "auto") setAttempt({ index: attempt.index, method: "file" });
          else setAttempt({ index: attempt.index + 1, method: "auto" });
        }}
      />}
      {!showImage && placeholder}
      {preview && !candidate && !onUnavailable && <p className="resource-art__preview-message" role="status">This image could not load. Scan its source page for a fresh link.</p>}
      {badge}
    </div>
  );
}
