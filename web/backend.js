// How the page reaches 一题's engine. This one talks to the local server over HTTP; the browser extension
// ships its own backend.js with the same exports, which runs the engine inside the side panel instead.

// A call to the engine: GET without a body, POST with one. Resolves with the reply, rejects with its message.
export async function request(path, body) {
  let res;
  try { res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error('连不上本机的一题服务。'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '没有成功。');
  return data;
}

// Every change to what the page shows arrives here; `down` says the engine is out of reach for now.
export function subscribe(onState, down = () => {}) {
  const events = new EventSource('/api/events');
  events.addEventListener('state', e => onState(JSON.parse(e.data)));
  events.onerror = () => down();
}

// Without the microphone: in a browser tab the permission is asked for in the address bar.
export function microphoneDenied() { return '没有取得麦克风权限。在地址栏里允许麦克风后再试。'; }

// A live voice call about one moment of one step. The server relays it, so the page streams its microphone as
// 16 kHz PCM and plays back 24 kHz PCM ('pcm'); events come back as { voice: 'ready' | 'audio' | 'heard' | … }.
export function openVoice({ key, mode }, on) {
  const ws = new WebSocket(`ws://${location.host}/api/voice?key=${encodeURIComponent(key)}&mode=${encodeURIComponent(mode)}`);
  ws.onmessage = event => { try { on.message(JSON.parse(event.data)); } catch {} };
  ws.onerror = () => on.error?.();
  ws.onclose = () => on.close();
  return {
    transport: 'pcm',
    ready: () => ws.readyState === WebSocket.OPEN,
    send: value => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); },
    close: () => { try { ws.close(); } catch {} },
  };
}
