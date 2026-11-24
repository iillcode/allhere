(() => {
  if (globalThis.__stashwellAutoUpdatesInstalled) return;
  globalThis.__stashwellAutoUpdatesInstalled = true;
  // Visual requests can continue after the browser's Resource Timing buffer fills.
  const visualRequests = globalThis.__stashwellVisualRequests = new Map();
  const imageRequest = /^(?:img|image|input|icon)$/;
  const imageFile = /\.(?:apng|avif|bmp|cur|gif|heic|heif|ico|jpe?g|jxl|png|svg|tiff?|webp)(?:[?#]|$)/i;
  const resourceText = 'a[href], svg, style, title, figcaption, mat-icon, [class*="material-icons"], [class*="material-symbols"]';
  const fontIconFamily = /(?:symbols|icons|font\s*awesome|icomoon|glyphicons|ionicons|remixicon)/i;
  const containsText = nodes => Array.from(nodes).some(node => node.nodeType === Node.TEXT_NODE && node.length > 0);
  function changesResourceText(record) {
    if (record.type === "childList") {
      const added = containsText(record.addedNodes);
      const removed = containsText(record.removedNodes);
      if (!added && !removed) return false;
      if (added !== removed) return true; // Text insertion or removal can affect :empty styles.
    } else if (Boolean(record.oldValue) !== Boolean(record.target.data)) return true;

    const element = record.target instanceof Element ? record.target : record.target.parentElement;
    if (!element) return false;
    if (element.closest(resourceText)) return true;
    const root = element.getRootNode();
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      if (!ancestor.id) continue;
      const id = CSS.escape(ancestor.id);
      if (root.querySelector?.(`[aria-labelledby~="${id}"], [aria-describedby~="${id}"]`)) return true;
    }
    return !element.childElementCount && fontIconFamily.test(getComputedStyle(element).fontFamily);
  }
  let stopWatching;
  function startWatching() {
    let stopped = false, quietTimer, deadlineTimer;
    const roots = new WeakSet();
    const shadowRootFor = element => {
      if (element.shadowRoot) return element.shadowRoot;
      if (!(element instanceof HTMLElement) || /^(?:input|textarea|select|video|audio|img)$/.test(element.localName)) return null;
      try { return chrome.dom?.openOrClosedShadowRoot(element) ?? null; } catch { return null; }
    };
    const signal = () => {
      if (stopped || document.visibilityState === "hidden") return;
      const send = () => {
        clearTimeout(quietTimer); clearTimeout(deadlineTimer);
        quietTimer = deadlineTimer = undefined;
        if (!stopped && document.visibilityState !== "hidden") {
          try {
            void chrome.runtime.sendMessage({ type: "stashwell.capture.changed" }).then(response => {
              if (response?.watching === false) shutdown();
            }).catch(() => {});
          } catch { shutdown(); }
        }
      };
      clearTimeout(quietTimer);
      quietTimer = setTimeout(send, 900);
      if (!deadlineTimer) deadlineTimer = setTimeout(send, 4_000);
    };
    const discover = root => {
      if (!root || roots.has(root)) return;
      roots.add(root);
      observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true, characterDataOldValue: true,
        attributeFilter: ["src", "srcset", "imagesrcset", "as", "href", "poster", "style", "data", "width", "height", "class", "hidden", "slot", "dir", "alt", "title", "aria-label", "aria-labelledby", "aria-describedby", "aria-description", "download", "type", "rel",
          "data-src", "data-srcset", "data-original", "data-original-src", "data-original-srcset", "data-lazy-src", "data-lazy-srcset", "data-lazy", "data-ll-src", "data-ll-srcset", "data-image-src", "data-url", "data-poster",
          "data-bg", "data-bg-src", "data-background", "data-background-image", "data-caption", "data-description", "data-icon", "d", "points", "viewBox", "fill", "stroke", "mask", "clip-path", "xlink:href", "fonticon", "data-mat-icon-name", "data-mat-icon-type",
          "sizes", "media", "crossorigin", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "x2", "y1", "y2", "transform", "opacity", "fill-opacity", "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stop-color", "stop-opacity", "offset"] });
      for (const element of root.querySelectorAll("*")) { const shadow = shadowRootFor(element); if (shadow) discover(shadow); }
    };
    const observer = new MutationObserver(records => {
      let changed = false;
      for (const record of records) {
        let elementsChanged = false;
        for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) {
          elementsChanged = true;
          const shadow = shadowRootFor(node); if (shadow) discover(shadow);
          for (const element of node.querySelectorAll("*")) { const shadow = shadowRootFor(element); if (shadow) discover(shadow); }
        }
        if (!changed) changed = elementsChanged || record.type === "attributes" ||
          Array.from(record.removedNodes).some(node => node.nodeType === Node.ELEMENT_NODE) ||
          changesResourceText(record);
      }
      if (changed) signal();
    });
    // Attaching a shadow root to an existing host does not mutate the
    // outer DOM. Discover these roots without reading form values or text.
    const discoveryTimer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const visit = root => {
        for (const element of root.querySelectorAll("*")) {
          const shadow = shadowRootFor(element);
          if (!shadow) continue;
          if (!roots.has(shadow)) { discover(shadow); signal(); }
          visit(shadow);
        }
      };
      visit(document);
    }, 2_000);
    const loading = new PerformanceObserver(list => {
      let discovered = false;
      for (const { name, initiatorType, responseEnd, responseStatus, contentType } of list.getEntries()) {
        if (!/^https?:/i.test(name) || !responseEnd || responseStatus >= 400 || visualRequests.has(name)) continue;
        const declared = /^(?:link|css|body|object|embed)$/.test(initiatorType);
        const segment = /\.(?:m4s|cmfv|cmfa|ts)(?:[?#]|$)|[?&](?:bytestart=\d+|range=\d+-\d+)/i.test(name) || /iso\.segment/i.test(contentType || "");
        const media = !segment && (/^(?:video|audio)$/.test(initiatorType) || /^(?:video\/|audio\/)|mpegurl|dash\+xml/i.test(contentType || "") || /\.(?:mp4|webm|m3u8|mpd)(?:$|[?#])/i.test(name));
        if (!media && !imageRequest.test(initiatorType) && !(declared && imageFile.test(name))) continue;
        visualRequests.set(name, { name, initiatorType, responseEnd, responseStatus, contentType });
        discovered = true;
      }
      if (discovered) signal();
    });
    loading.observe({ type: "resource", buffered: true });
    function stop() {
      if (stopped) return;
      stopped = true;
      stopWatching = undefined;
      observer.disconnect();
      loading.disconnect();
      clearTimeout(quietTimer); clearTimeout(deadlineTimer); clearInterval(discoveryTimer);
      document.removeEventListener("load", signal, true);
      document.fonts?.removeEventListener("loadingdone", signal);
      window.removeEventListener("resize", signal);
    }
    stopWatching = stop;
    window.addEventListener("resize", signal);
    document.addEventListener("load", signal, true);
    document.fonts?.addEventListener("loadingdone", signal);
    discover(document);
    signal();
  }
  // Resume observation after tab activation or a return from the back-forward cache.
  const update = () => {
    if (document.visibilityState === "hidden") stopWatching?.();
    else if (!stopWatching) startWatching();
  };
  const suspend = () => stopWatching?.();
  const onMessage = (message, sender) => {
    if (sender.id === chrome.runtime.id && message?.type === "stashwell.capture.stop") shutdown();
  };
  function shutdown() {
    stopWatching?.();
    document.removeEventListener("visibilitychange", update);
    window.removeEventListener("pagehide", suspend);
    window.removeEventListener("pageshow", update);
    chrome.runtime?.onMessage?.removeListener(onMessage);
    if (globalThis.__stashwellVisualRequests === visualRequests) {
      delete globalThis.__stashwellVisualRequests;
      delete globalThis.__stashwellAutoUpdatesInstalled;
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);
  document.addEventListener("visibilitychange", update);
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", update);
  update();
})();
