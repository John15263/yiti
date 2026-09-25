// Passes what extract.js read from this page on to the extension, which alone can reach 127.0.0.1.
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'yiti-extract') return;
  try { chrome.runtime.sendMessage({ capture: event.data.payload }); } catch {}
});
