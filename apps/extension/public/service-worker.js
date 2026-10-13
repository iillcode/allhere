importScripts("download-worker.js");

// Chrome omits Referer for extension frames; identify our own YouTube previews.
void chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [47001], addRules: [{
  id: 47001, priority: 1,
  condition: { initiatorDomains: [chrome.runtime.id], requestDomains: ["www.youtube.com", "www.youtube-nocookie.com"], resourceTypes: ["sub_frame"], urlFilter: "/embed/" },
  action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: chrome.runtime.id }] },
}] }).catch(() => {});

// Retire the former downloader's temporary player tabs and their scoped rules.
void chrome.declarativeNetRequest.getSessionRules().then(async rules => {
  const retired = rules.filter(rule => rule.condition.resourceTypes?.includes("main_frame")
    && rule.condition.requestDomains?.includes("www.youtube-nocookie.com")
    && rule.action.requestHeaders?.some(header => header.header === "referer" && header.value === chrome.runtime.id));
  for (const rule of retired) {
    for (const id of rule.condition.tabIds || []) {
      const tab = await chrome.tabs.get(id).catch(() => undefined);
      if (tab?.url?.startsWith("https://www.youtube-nocookie.com/embed/")) await chrome.tabs.remove(id).catch(() => {});
    }
  }
  if (retired.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: retired.map(rule => rule.id) });
}).catch(() => {});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Allhere side panel could not be enabled", error));

chrome.runtime.onInstalled.addListener(() => {
  void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs
    .filter(tab => tab.id && /^https?:\/\//.test(tab.url || ""))
    .map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["file-drop.js"] }))));
});
