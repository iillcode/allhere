import { useEffect, useRef, useState } from "react";
import { convertImageDownload, type ImageScale, type ImageDownloadFormat } from "./imageDownloads";

type Preview = { key: string; url: string; width: number; height: number };

/** Only an explicit size click/retry may request resource-host access. */
export function useImageUpscale({ url, scale, enabled, format, onChange, requestAccess }: {
  url: string; scale: ImageScale; enabled: boolean; format: ImageDownloadFormat;
  onChange?: (scale: ImageScale) => void; requestAccess?: () => Promise<boolean>;
}) {
  const [result, setResult] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: string; message: string }>();
  const callbacks = useRef({ onChange, requestAccess });
  callbacks.current = { onChange, requestAccess };
  const generation = useRef(0);
  const currentKey = useRef("");
  const controller = useRef<AbortController | undefined>(undefined);
  const objectUrl = useRef<string | undefined>(undefined);
  const wantedKey = `${url}\u0000${enabled ? scale : 1}\u0000${format}`;

  const prepare = (nextScale: ImageScale, allowAccess: boolean) => {
    const token = ++generation.current;
    const key = `${url}\u0000${enabled ? nextScale : 1}\u0000${format}`;
    currentKey.current = key;
    controller.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = undefined;
    setResult(undefined); setError(undefined); setBusy(false);
    if (!enabled || nextScale === 1) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    // Start permission requests in the original click, before any await.
    void (async () => {
      try {
        const access = allowAccess && callbacks.current.requestAccess ? callbacks.current.requestAccess() : Promise.resolve(true);
        if (!await access) throw new Error("Image access was not granted. Retry the preview to allow this image's host.");
        abort.signal.throwIfAborted();
        const image = await convertImageDownload(url, format, nextScale, abort.signal);
        if (token !== generation.current || abort.signal.aborted) return;
        const createdUrl = URL.createObjectURL(image.blob);
        objectUrl.current = createdUrl;
        setResult({ key, url: createdUrl, width: image.width!, height: image.height! });
      } catch (error) {
        if (token === generation.current && !abort.signal.aborted) setError({ key, message: error instanceof Error ? error.message : "The enlarged preview could not be prepared. Retry or choose Original." });
      } finally { if (token === generation.current) setBusy(false); }
    })();
  };

  useEffect(() => () => {
    generation.current += 1;
    currentKey.current = "";
    controller.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);
  useEffect(() => { if (currentKey.current !== wantedKey) prepare(scale, false); }, [wantedKey]);

  return {
    result: result?.key === wantedKey ? result : undefined,
    busy,
    error: error?.key === wantedKey ? error.message : undefined,
    change: (nextScale: ImageScale) => { callbacks.current.onChange?.(nextScale); prepare(nextScale, true); },
    retry: () => prepare(scale, true),
  };
}
