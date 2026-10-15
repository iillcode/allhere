importScripts("download-worker.js");

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: typeof chrome.sidePanel.open !== "function" })
  .catch((error) => console.error("Allhere side panel could not be enabled", error));

// Chrome grants activeTab when the toolbar action is invoked. Opening the
// panel here keeps it visible when granting access on another tab; it never
// starts a scan. Chrome 114–115 use the built-in panel toggle above instead.
chrome.action.onClicked.addListener((tab) => {
  // Refresh the panel's favicon after Chrome grants temporary tab access.
  // A panel that is not open yet will read the metadata when it mounts.
  chrome.runtime.sendMessage({ type: "allhere.tab.invoked" }).catch(() => {});
  if (typeof chrome.sidePanel.open === "function" && typeof tab.windowId === "number") {
    chrome.sidePanel.open({ windowId: tab.windowId })
      .catch((error) => console.error("Allhere side panel could not be opened", error));
  }
});
