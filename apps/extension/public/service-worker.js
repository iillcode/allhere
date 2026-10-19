importScripts("download-worker.js");

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Stashwell side panel could not be enabled", error));
