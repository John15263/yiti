// Clicking the toolbar icon opens 一题 in the side panel. The panel hears Math Academy's steps directly while
// it is open; the last one is kept here so a panel opened later starts on the right step.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message?.capture || !/^https:\/\/(www\.)?mathacademy\.com\//.test(sender.url || '')) return;
  void chrome.storage.session.set({ capture: message.capture });
});
