// background.js
// Opens organizer.html when the extension icon is clicked.
// Routes FETCH requests by executing them inside a claude.ai tab (same-origin).
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('organizer.html') });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'FETCH') return;
  (async () => {
    try {
      // Find an open claude.ai tab, or open one in the background.
      let tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
      let tabId;
      if (tabs.length > 0) {
        tabId = tabs[0].id;
      } else {
        const tab = await chrome.tabs.create({ url: 'https://claude.ai', active: false });
        await new Promise(resolve => {
          chrome.tabs.onUpdated.addListener(function listener(id, info) {
            if (id === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          });
        });
        tabId = tab.id;
      }
      // Execute fetch inside the claude.ai tab — same-origin, credentials included.
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (path, opts) => {
          const r = await fetch(path, {
            method: opts?.method || 'GET',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'anthropic-client-platform': 'web_claude_ai',
              'x-requested-with': 'XMLHttpRequest',
            },
            ...(opts?.body ? { body: opts.body } : {}),
          });
          let body;
          try { body = await r.json(); } catch { body = {}; }
          return { ok: r.ok, status: r.status, body };
        },
        args: [msg.path, msg.opts],
      });
      sendResponse(results[0].result);
    } catch (err) {
      sendResponse({ ok: false, status: 0, body: {}, error: err.message });
    }
  })();
  return true;
});