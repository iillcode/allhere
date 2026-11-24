import { prepareMedia } from "@stashwell/library-ui/media-files";
import { tryMediaSources } from "@stashwell/library-ui/media-sources";

type MediaRequest = { type: string; id: string; url: string; kind: "audio" | "video"; mimeType?: string; variantUrls?: string[] };
declare const chrome: { runtime: {
  id: string; getURL: (path: string) => string;
  onMessage: { addListener: (fn: (message: MediaRequest, sender: { id?: string; url?: string; tab?: unknown }, reply: (value: unknown) => void) => true | undefined) => void };
} };

const tasks = new Map<string, { controller: AbortController; objectUrl?: string }>();
function release(id: string) {
  const task = tasks.get(id);
  task?.controller.abort();
  if (task?.objectUrl) URL.revokeObjectURL(task.objectUrl);
  tasks.delete(id);
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.tab || (sender.url && sender.url !== chrome.runtime.getURL("service-worker.js"))) return;
  if (message.type === "stashwell.media.release") {
    release(message.id);
    reply({ ok: true });
    return;
  }
  if (message.type !== "stashwell.media.prepare") return;
  const controller = new AbortController();
  const task: { controller: AbortController; objectUrl?: string } = { controller };
  tasks.set(message.id, task);
  const timer = setTimeout(() => controller.abort(), 120_000);
  void tryMediaSources(message.url, message.mimeType, message.variantUrls, controller.signal, async url => {
    const { blob, extension, expectedBytes, responseMime } = await prepareMedia(url, message.kind, { signal: controller.signal });
    controller.signal.throwIfAborted();
    if (blob) task.objectUrl = URL.createObjectURL(blob);
    return { url: task.objectUrl || url, extension, expectedBytes, responseMime };
  }).then(result => reply({ ok: true, ...result }), error => reply({
    ok: false, error: controller.signal.aborted ? "Media preparation was interrupted or timed out. Try again."
      : error instanceof TypeError ? "The media host could not be reached. Open its source page or check the extension’s site access."
      : error.message || "The media could not be prepared.",
  })).finally(() => {
    clearTimeout(timer);
    if (!task.objectUrl) tasks.delete(message.id);
  });
  return true;
});
