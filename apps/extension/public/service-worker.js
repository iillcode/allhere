chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Allhere side panel could not be enabled", error));

chrome.runtime.onInstalled.addListener(() => {
  void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs
    .filter(tab => tab.id && /^https?:\/\//.test(tab.url || ""))
    .map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["file-drop.js"] }))));
});
