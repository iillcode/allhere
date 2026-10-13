// Cross-process drags may discard in-memory Files. A short-lived capability
// lets the destination receive the exact file through extension messaging.
(() => {
  if (globalThis.__allhereFileDropInstalled) return;
  globalThis.__allhereFileDropInstalled = true;
  const prefix = "application/x-allhere-file-";
  const replayed = new WeakSet();
  const dragListeners = [];
  let active, toast;
  let stopped = false;
  let stopWatching = () => undefined;
  const contextLostMessage = "Allhere was updated. Refresh this page to use drag and drop again.";
  function stop() {
    if (stopped) return;
    stopped = true;
    stopWatching();
    document.removeEventListener("DOMContentLoaded", watchResources);
    for (const [type, listener] of dragListeners) window.removeEventListener(type, listener, true);
    active = undefined;
    toast?.remove();
  }
  async function sendMessage(message) {
    if (stopped) throw new Error(contextLostMessage);
    try {
      const runtime = globalThis.chrome?.runtime;
      if (typeof runtime?.sendMessage !== "function") throw new Error("Extension context invalidated.");
      return await runtime.sendMessage(message);
    } catch (error) {
      if (/Extension context invalidated|Cannot read properties of undefined.*sendMessage/i.test(String(error))) {
        stop();
        throw new Error(contextLostMessage);
      }
      throw error;
    }
  }
  const tokenFor = event => [...(event.dataTransfer?.types || [])].find(type => type.startsWith(prefix))?.slice(prefix.length);
  function showMessage(message) {
    toast?.remove();
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    const note = document.createElement("div");
    note.setAttribute("role", "status"); note.textContent = message;
    note.style.cssText = "max-width:360px;padding:12px 16px;border-radius:10px;background:#e8f0fe;color:#174ea6;font:14px/1.5 system-ui,sans-serif;box-shadow:0 4px 16px #0002;overflow-wrap:anywhere";
    shadow.append(note);
    host.style.cssText = "all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483647;pointer-events:none";
    document.documentElement.append(host); toast = host;
    setTimeout(() => { host.remove(); if (toast === host) toast = undefined; }, 6000);
  }
  async function request(token, offset) {
    const response = await sendMessage({ type: "allhere.drag.read", token, ...(offset === undefined ? {} : { offset }) });
    if (!response || response.error) throw new Error(response?.error || "Keep Allhere open and drag the file again.");
    return response;
  }
  function acquire(token) {
    if (active?.token === token) return active;
    const state = { token, file: undefined, preview: undefined, error: undefined, lastTarget: undefined };
    active = state;
    setTimeout(() => { if (active === state) active = undefined; state.file = undefined; state.preview = undefined; }, 125_000);
    state.pending = (async () => {
      const meta = await request(token);
      if (!Number.isInteger(meta.size) || meta.size <= 0 || meta.size > 64 * 1024 * 1024 || meta.chunkBytes !== 1024 * 1024 || typeof meta.name !== "string" || typeof meta.mime !== "string") throw new Error("The file could not be transferred. Drag it again.");
      state.preview = new File([], meta.name, { type: meta.mime });
      const chunks = [];
      for (let offset = 0; offset < meta.size; offset += meta.chunkBytes) {
        const chunk = await request(token, offset);
        if (typeof chunk.bytes !== "string") throw new Error("The file transfer was interrupted. Drag it again.");
        const bytes = Uint8Array.from(atob(chunk.bytes), char => char.charCodeAt(0));
        if (bytes.length !== Math.min(meta.chunkBytes, meta.size - offset)) throw new Error("The file transfer was incomplete. Drag it again.");
        chunks.push(bytes);
      }
      state.file = new File(chunks, meta.name, { type: meta.mime }); return state.file;
    })().catch(error => { state.error = error.message || "The file could not be transferred."; return undefined; });
    return state;
  }
  function transfer(file) {
    const data = new DataTransfer(); data.items.add(file);
    data.effectAllowed = "copy"; data.dropEffect = "copy"; return data;
  }
  function replay(type, event, file, target = event.composedPath()[0]) {
    const replacement = new DragEvent(type, { bubbles: true, cancelable: true, composed: true,
      dataTransfer: transfer(file), clientX: event.clientX, clientY: event.clientY,
      screenX: event.screenX, screenY: event.screenY, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
      altKey: event.altKey, metaKey: event.metaKey });
    replayed.add(replacement); return target?.dispatchEvent(replacement);
  }
  function accepts(input, file) {
    if (!input.accept.trim()) return true;
    return input.accept.split(",").some(value => {
      const type = value.trim().toLowerCase();
      if (!type) return false;
      if (type.startsWith(".")) return file.name.toLowerCase().endsWith(type);
      if (type.endsWith("/*")) return file.type.toLowerCase().startsWith(type.slice(0, -1));
      return type === file.type.toLowerCase();
    });
  }
  for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
    const listener = event => {
      if (stopped) return;
      if (replayed.has(event)) return;
      const token = tokenFor(event);
      if (!token || !/^[a-f0-9-]{36}$/.test(token)) return;
      const target = event.composedPath()[0];
      const state = acquire(token);
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      if (type !== "drop") {
        if (state.file || state.preview) {
          if (type === "dragover" && state.lastTarget !== target) replay("dragenter", event, state.file || state.preview, target);
          replay(type, event, state.file || state.preview, target);
          state.lastTarget = type === "dragleave" ? undefined : target;
        }
        return;
      }
      void (async () => {
        try {
          const file = await state.pending;
          if (!file) throw new Error(state.error || "The file could not be transferred.");
          if (!target?.isConnected) throw new Error("The upload field changed. Drop the file again.");
          const input = target instanceof HTMLInputElement && target.type === "file" ? target
            : target instanceof Element ? target.closest("label")?.control : undefined;
          if (input instanceof HTMLInputElement && input.type === "file") {
            if (input.disabled) throw new Error("This upload field is disabled.");
            if (!accepts(input, file)) throw new Error(`This upload field does not accept ${file.name}. Choose a matching field.`);
            input.files = transfer(file).files;
            input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
            input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          } else {
            replay("dragenter", event, file, target); replay("dragover", event, file, target); replay("drop", event, file, target);
          }
        } catch (error) { showMessage(error.message || "Drop failed. Download the file and upload it from your device."); }
        finally { if (active === state) active = undefined; }
      })();
    };
    window.addEventListener(type, listener, true);
    dragListeners.push([type, listener]);
  }
  window.addEventListener("pagehide", () => { active = undefined; toast?.remove(); stopWatching(); });
  window.addEventListener("pageshow", event => { if (event.persisted && !stopped) watchResources(); });

  // A capture taken while a client-rendered page is still settling is only a
  // partial snapshot. Signal the side panel after resource-bearing DOM changes;
  // its merge keeps previously found assets when transient nodes disappear.
  function watchResources() {
    if (stopped || !document.documentElement) return;
    let quietTimer, deadlineTimer;
    let pendingUrl = location.href;
    const observer = new MutationObserver(records => {
      if (records.some(record => record.type === "attributes" || [...record.addedNodes].some(node => node.nodeType === 1) ||
        (record.type === "characterData" && record.target.parentElement?.matches('mat-icon, [class*="material-icons"], [class*="material-symbols"]')))) signal();
    });
    stopWatching = () => {
      observer.disconnect(); clearTimeout(quietTimer); clearTimeout(deadlineTimer);
      document.fonts?.removeEventListener("loadingdone", signal);
    };
    const signal = () => {
      if (stopped || document.visibilityState === "hidden") return;
      if (location.href !== pendingUrl) {
        clearTimeout(quietTimer); clearTimeout(deadlineTimer);
        quietTimer = deadlineTimer = undefined;
        pendingUrl = location.href;
      }
      const send = () => {
        clearTimeout(quietTimer); clearTimeout(deadlineTimer);
        quietTimer = deadlineTimer = undefined;
        if (location.href !== pendingUrl) return;
        void sendMessage({ type: "allhere.page.changed" }).catch(() => undefined);
      };
      clearTimeout(quietTimer);
      quietTimer = setTimeout(send, 1_200);
      if (!deadlineTimer) deadlineTimer = setTimeout(send, 5_000);
    };
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true,
      attributeFilter: ["src", "srcset", "href", "poster", "style", "data", "width", "height", "class", "fonticon", "data-mat-icon-name", "data-mat-icon-type"] });
    document.fonts?.addEventListener("loadingdone", signal);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchResources, { once: true });
  else watchResources();
})();
