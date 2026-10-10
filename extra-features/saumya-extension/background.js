// Relays tracker (webcam/mic window) -> active tab, and runs tab-level commands.
chrome.action.onClicked.addListener(() =>
  chrome.windows.create({ url: 'tracker.html', type: 'popup', width: 340, height: 430 })
);

chrome.runtime.onMessage.addListener((m, sender) => {
  if (m.from === 'tracker') {
    chrome.tabs.query({ active: true, windowType: 'normal' }).then((tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, m).catch(() => {});
    });
    return;
  }
  if (m.from === 'content' && sender.tab) {
    const tab = sender.tab;
    switch (m.action) {
      case 'newtab': chrome.tabs.create({}); break;
      case 'closetab': chrome.tabs.remove(tab.id); break;
      case 'goto': chrome.tabs.update(tab.id, { url: m.arg }); break;
      case 'nexttab':
      case 'prevtab': {
        const d = m.action === 'nexttab' ? 1 : -1;
        chrome.tabs.query({ windowId: tab.windowId }).then((tabs) => {
          const t = tabs.find((x) => x.index === (tab.index + d + tabs.length) % tabs.length);
          if (t) chrome.tabs.update(t.id, { active: true });
        });
        break;
      }
    }
  }
});

chrome.runtime.onInstalled.addListener(async (d) => {
  if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
  // Make Handsfree work on tabs that were already open before install or update.
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['grammar.js', 'content.js'] }).catch(() => {});
});
