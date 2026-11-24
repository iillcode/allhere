import { useEffect, useState } from "react";
import { loadDownloadFile } from "./downloadFiles";
import { resourceExtension } from "./resourceNames";

const TEXT_LIMIT = 64 * 1024;
const PDF_LIMIT = 24 * 1024 * 1024;

export function filePreviewFormat(url: string, mimeType?: string): "pdf" | "text" | undefined {
  const extension = resourceExtension(url, mimeType);
  if (extension === "pdf") return "pdf";
  if (/^text\//i.test(mimeType || "") ||
    /^(?:c|cpp|css|csv|htm|html|java|js|json|jsonl|jsx|log|markdown|md|mjs|py|rs|scss|sql|toml|ts|tsv|tsx|txt|xml|yaml|yml)$/i.test(extension || "")) return "text";
}

async function readText(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal });
  if (!response.ok || !response.body) throw new Error("The file could not be opened.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  let truncated = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const remaining = TEXT_LIMIT - size;
    text += decoder.decode(value.subarray(0, remaining), { stream: true });
    size += value.byteLength;
    if (size > TEXT_LIMIT) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  text += decoder.decode();
  if (text.includes("\u0000")) throw new Error("This file is not readable text.");
  return { text, truncated };
}

export function FilePreview({ url, name, format }: { url: string; name: string; format: "pdf" | "text" }) {
  const [result, setResult] = useState<{ kind: "text"; text: string; truncated: boolean } | { kind: "pdf"; url: string } | { kind: "unavailable" }>();
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort("timeout"), 15_000);
    let objectUrl: string | undefined;
    const load = async () => {
      const source = new URL(url);
      if (!["http:", "https:"].includes(source.protocol) || source.username || source.password) throw new Error("Invalid file URL.");
      if (format === "text") {
        const content = await readText(source.href, controller.signal);
        if (!controller.signal.aborted) setResult({ kind: "text", ...content });
        return;
      }
      const { blob } = await loadDownloadFile(source.href, "document", PDF_LIMIT, "The PDF exceeds the preview size limit.", controller.signal);
      if (!(await blob.slice(0, 8).text()).startsWith("%PDF-")) throw new Error("This file is not a PDF.");
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      setResult({ kind: "pdf", url: objectUrl });
    };
    setResult(undefined);
    void load().catch(() => {
      if (!controller.signal.aborted || controller.signal.reason === "timeout") setResult({ kind: "unavailable" });
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [format, url]);

  return <div className="resource-file-preview">
    {result?.kind === "pdf" ? <iframe title={`Preview of ${name}`} src={result.url} referrerPolicy="no-referrer" />
      : result?.kind === "text" ? <>
        <pre tabIndex={0} aria-label={`Preview of ${name}`}>{result.text || "This file is empty."}</pre>
        {result.truncated && <p>Showing the first 64 KB. Download the file for the full contents.</p>}
      </> : <p role="status">{result ? "This file could not be previewed. You can download it instead." : "Loading file preview…"}</p>}
  </div>;
}
