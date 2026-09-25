// Hands each capture to the local 一题 server. Nothing leaves this machine.
const ENDPOINT = 'http://127.0.0.1:4318/api/capture';
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message?.capture || !/^https:\/\/(www\.)?mathacademy\.com\//.test(sender.url || '')) return;
  fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message.capture) })
    .catch(() => {}); // 一题 not running: the next change on the page tries again.
});
