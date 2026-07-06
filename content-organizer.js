// content-organizer.js
// Runs inside organizer.html (chrome-extension:// origin).
// Bridges postMessage API calls to the background service worker.
window.addEventListener('message', async (e) => {
  if (e.data?.type !== 'ORGANIZER_REQUEST') return;
  const { id, path, opts } = e.data;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'FETCH', path, opts });
    window.postMessage({ type: 'ORGANIZER_RESPONSE', id, ok: resp.ok, status: resp.status, body: resp.body }, '*');
  } catch (err) {
    window.postMessage({ type: 'ORGANIZER_RESPONSE', id, error: err.message }, '*');
  }
});