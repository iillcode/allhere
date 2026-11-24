import { validPosterUrl } from "@stashwell/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadDownloadFile } from "./downloadFiles";
import { mediaSources, playlistType } from "./mediaSources";
import { ResourceImage } from "./ResourceImage";

type Props = { url: string; title: string; kind: "video" | "audio"; mimeType?: string; variantUrls?: string[];
  posterUrl?: string; preview: boolean; placeholder: ReactNode };

export function MediaArtwork({ url, title, kind, mimeType, variantUrls, posterUrl, preview, placeholder }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(preview);
  const [brokenPoster, setBrokenPoster] = useState<string>();
  const [attempt, setAttempt] = useState({ index: 0, file: false });
  const [prepared, setPrepared] = useState<{ source: string; url: string }>();
  const [loaded, setLoaded] = useState<string>();
  const [error, setError] = useState("");
  const sources = useMemo(() => mediaSources(url, mimeType, variantUrls), [url, mimeType, variantUrls]);
  const source = sources[attempt.index];
  const stream = source && playlistType(source, source === url ? mimeType : undefined);
  const poster = validPosterUrl(posterUrl) && brokenPoster !== posterUrl ? posterUrl : undefined;
  const nativeHls = useMemo(() => stream === "hls" && typeof document !== "undefined" &&
    !!document.createElement("video").canPlayType("application/vnd.apple.mpegurl"), [stream]);
  const needsFile = attempt.file || (stream === "hls" && !nativeHls);
  const shouldLoad = (preview || (visible && !poster)) && stream !== "dash";
  const playableUrl = shouldLoad && source ? needsFile ? prepared?.source === source ? prepared.url : undefined : source : undefined;
  const showPoster = !!poster && (!preview || !playableUrl);

  useEffect(() => {
    if (preview || !host.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "100px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [preview]);

  useEffect(() => {
    if (!needsFile || !shouldLoad || !source) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const limit = (preview ? 64 : 8) * 1024 * 1024;
    void loadDownloadFile(source, kind, limit, "This file is too large for a local preview. Open its source page to play it.", controller.signal, { previewSeconds: preview ? 8 : 0.1 })
      .then(({ blob }) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPrepared({ source, url: objectUrl });
      }).catch(reason => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "");
        setAttempt(current => ({ index: current.index + 1, file: false }));
      });
    return () => {
      controller.abort();
      if (objectUrl) { URL.revokeObjectURL(objectUrl); setPrepared(undefined); }
    };
  }, [kind, needsFile, preview, shouldLoad, source]);

  const failed = () => {
    setLoaded(undefined);
    if (!needsFile) setAttempt({ index: attempt.index, file: true });
    else {
      setError("This browser could not play the video or audio format. Open the source page to play it.");
      setAttempt({ index: attempt.index + 1, file: false });
    }
  };
  const message = stream === "dash" ? "Play this DASH stream on its source page."
    : !source ? error || "The preview is unavailable. Open the source page or scan it for a fresh link."
    : needsFile && !playableUrl ? "Preparing media preview…" : "";
  return <div className="resource-art__media-surface" ref={host}>
    {showPoster && <ResourceImage key={poster} source={{ url: poster }} alt={title} isIcon={false} className="resource-art__media-surface"
      preview={preview} placeholder={placeholder} onUnavailable={() => setBrokenPoster(poster)} />}
    {playableUrl && (kind === "audio" ? <audio key={playableUrl} src={playableUrl} controls preload="metadata"
      aria-label={`Preview of ${title}`} onLoadedMetadata={() => setLoaded(playableUrl)} onError={failed} /> :
      <video key={playableUrl} src={playableUrl} poster={preview ? poster : undefined} aria-label={`Preview of ${title}`}
        className={`resource-art__video${preview || loaded === playableUrl ? " resource-art__video--loaded" : ""}`}
        muted={!preview} controls={preview} preload={preview ? "auto" : "metadata"} playsInline disablePictureInPicture={!preview}
        onLoadedMetadata={event => {
          const video = event.currentTarget;
          if (!video.videoWidth) { failed(); return; }
          // Metadata preloading alone can leave a card without a decoded frame.
          if (!preview && Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(1, video.duration / 2);
        }}
        onLoadedData={() => setLoaded(playableUrl)} onSeeked={() => setLoaded(playableUrl)} onError={failed} />)}
    {!showPoster && (!playableUrl || (!preview && loaded !== playableUrl)) && placeholder}
    {preview && message && <span className="resource-art__preview-message" role="status">{message}</span>}
    {preview && stream === "hls" && prepared?.url === playableUrl && playableUrl && <span className="resource-art__kind">Stream preview · up to 8s</span>}
  </div>;
}
