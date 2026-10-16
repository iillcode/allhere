// Installed only for a tab the user has scanned in the current panel session.
// Each frame observes resources only while its panel-owned port is connected.
(() => {
  if (globalThis.__stashwellAutoUpdatesInstalled) return;
  globalThis.__stashwellAutoUpdatesInstalled = true;
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== "stashwell.auto-updates" || port.sender?.id !== chrome.runtime.id) return;
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
          try { port.postMessage({ type: "changed" }); } catch { stop(); }
        }
      };
      clearTimeout(quietTimer);
      quietTimer = setTimeout(send, 900);
      if (!deadlineTimer) deadlineTimer = setTimeout(send, 4_000);
    };
    const loaded = event => {
      if (event.target?.tagName === "IFRAME") {
        try { port.postMessage({ type: "frames" }); } catch { stop(); }
      }
      signal();
    };
    const discover = root => {
      if (!root || roots.has(root)) return;
      roots.add(root);
      observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true,
        attributeFilter: ["src", "srcset", "href", "poster", "style", "data", "width", "height", "class", "hidden", "slot", "dir", "alt", "title", "aria-label", "download", "type", "rel",
          "data-src", "data-srcset", "data-original", "data-lazy-src", "data-lazy-srcset", "data-lazy", "data-url", "d", "points", "viewBox", "fill", "stroke", "mask", "clip-path", "xlink:href", "fonticon", "data-mat-icon-name", "data-mat-icon-type",
          "sizes", "media", "crossorigin", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "x2", "y1", "y2", "transform", "opacity", "fill-opacity", "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stop-color", "stop-opacity", "offset"] });
      for (const element of root.querySelectorAll("*")) { const shadow = shadowRootFor(element); if (shadow) discover(shadow); }
    };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node.nodeType === 1) {
          const shadow = shadowRootFor(node); if (shadow) discover(shadow);
          for (const element of node.querySelectorAll("*")) { const shadow = shadowRootFor(element); if (shadow) discover(shadow); }
        }
      }
      if (records.some(record => record.type === "attributes" || record.type === "childList" ||
        (record.type === "characterData" && record.target.parentElement?.closest('a[href], svg, title, mat-icon, [class*="material-icons"], [class*="material-symbols"]')))) signal();
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
    function stop() {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      clearTimeout(quietTimer); clearTimeout(deadlineTimer); clearInterval(discoveryTimer);
      document.removeEventListener("load", loaded, true);
      document.fonts?.removeEventListener("loadingdone", signal);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("resize", signal);
    }
    port.onDisconnect.addListener(stop);
    window.addEventListener("pagehide", stop, { once: true });
    window.addEventListener("resize", signal);
    document.addEventListener("load", loaded, true);
    document.fonts?.addEventListener("loadingdone", signal);
    discover(document);
    signal();
  });
})();
