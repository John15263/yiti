// The extension's backend: the local server's engine (board, teach, voice), running inside the side panel.
// Math Academy's steps come straight from its tab; keys and records live in the browser's own storage, and
// every model is called directly from here. Nothing passes through a server of ours.
import { Board } from '../server/board.js';
import { Teach, usePrompts } from '../server/teach.js';
import { config } from '../server/config.js';
import { Settings, testServices } from '../server/settings.js';
import { textConfigured } from '../server/llm.js';
import { voiceConfigured } from '../server/voice-providers.js';
import { Voice } from '../server/voice.js';
import { HttpError } from '../server/validation.js';
import { tokensOf, costOf, PURPOSES } from '../server/usage.js';
import PROMPTS from '../prompts.js';
import { BrowserStore } from './store.js';
import { rtcUpstream, qwenRtcCheck } from './rtc.js';
import { DEMO } from './demo.js';

usePrompts(PROMPTS);
const store = await BrowserStore.open();
const settings = new Settings({ read: () => store.get('settings'), write: values => store.set('settings', values) });
// There is no .env in a browser: the settings page is the only source.
const cfg = config(settings.env({}));
// What each call used, kept like the local server's usage log (last thousand calls).
cfg.usage = {
  record({ purpose, model, usage, round_id = null }) {
    try {
      if (!usage || !PURPOSES[purpose]) return null;
      const at = new Date().toISOString(), tokens = tokensOf(usage), usd = costOf(model, tokens, at);
      store.set('usage', [...(store.get('usage') || []), { at, purpose, model: String(model).slice(0, 100), round_id, ...tokens, usd }].slice(-1000));
      return { ...tokens, usd };
    } catch { return null; }
  },
};

const listeners = new Set();
const view = () => ({ ...board.state(), gemini: textConfigured(cfg), voice: voiceConfigured(cfg), build: null });
const publish = () => { const value = view(); for (const listener of listeners) listener(value); };
const board = new Board(store, publish);
const teach = new Teach(board, cfg);

// Gemini Live takes its key in the address, so a plain socket reaches it; Qwen goes over WebRTC.
let opened = null;
const voice = new Voice(board, cfg, (url, options) => (opened = url.startsWith('wss://generativelanguage.googleapis.com/') ? new WebSocket(url) : rtcUpstream(url, options)));

// Steps read off Math Academy: live while the panel is open, and the last one kept for when it opens.
const fromMathAcademy = sender => /^https:\/\/(www\.)?mathacademy\.com\//.test(sender?.url || sender?.tab?.url || '');
const capture = value => { try { board.capture(value); } catch {} };
chrome.runtime.onMessage.addListener((message, sender) => { if (message?.capture && fromMathAcademy(sender)) capture(message.capture); });
const last = (await chrome.storage.session.get('capture')).capture;
if (last) capture(last);

export async function request(path, body) {
  try {
    if (path === '/api/state') return view();
    if (path === '/api/command') { board.command(body); return view(); }
    if (path === '/api/demo') { board.capture(DEMO); return view(); }
    const action = { '/api/prepare': 'prepare', '/api/translate': 'translate', '/api/check': 'check', '/api/say': 'say' }[path];
    if (action) { teach[action](body); return view(); }
    if (path === '/api/settings' && body === undefined) return settings.view(cfg);
    if (path === '/api/settings') {
      const values = settings.patch(body);
      let next;
      try { next = config(settings.env({}, values)); } catch (e) { throw new HttpError(400, `设置不对：${e.message}`); }
      settings.save(values);
      Object.assign(cfg, next);
      publish();
      return settings.view(cfg);
    }
    if (path === '/api/settings/test') return await testServices(cfg, { voiceCheck: qwenRtcCheck });
    throw new HttpError(404, 'Not found');
  } catch (e) { throw new Error(e instanceof HttpError ? e.message : `出错了：${e.message || e}`); }
}

export function subscribe(onState) {
  listeners.add(onState);
  onState(view());
}

// A voice call, relayed in this page the way the local server relays it. The page streams PCM for Gemini;
// for Qwen it hands over its microphone as a track and the service's voice plays from the WebRTC stream.
export function openVoice({ key, mode }, on) {
  const handlers = {};
  let upstream = null, microphone = null;
  const conn = {
    send: text => queueMicrotask(() => { try { on.message(JSON.parse(text)); } catch {} }),
    close: () => queueMicrotask(() => on.close()),
    on: (event, handler) => { handlers[event] = handler; },
  };
  setTimeout(() => {
    opened = null;
    voice.start(conn, new URLSearchParams({ key, mode }));
    upstream = opened;
    if (microphone) upstream?.useMicrophone?.(microphone);
  });
  return {
    transport: cfg.voiceProvider === 'qwen' ? 'track' : 'pcm',
    ready: () => Boolean(handlers.message),
    send: value => handlers.message?.(JSON.stringify(value)),
    close: () => handlers.close?.(),
    useMicrophone(stream) { microphone = stream; upstream?.useMicrophone?.(stream); },
  };
}

// A side panel may not be allowed to ask for the microphone itself; a tab of the extension can, once.
export function microphoneDenied() {
  void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
  return '已打开一个授权页：在那里允许麦克风，再回来按 ⌘ ]。';
}
