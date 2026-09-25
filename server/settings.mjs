import { check, fields } from './validation.mjs';
import { voiceProvider } from './voice-providers.mjs';

// What the settings page may change: which services to use and their keys. Where it is kept is up to the
// runner — data/settings.json (owner-only) for the local server, the browser's own storage for the extension —
// and it takes precedence over .env, so a key typed into the page wins over a file.
const KEYS = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY'];
const CHOICES = { TEXT_PROVIDER: ['gemini', 'deepseek', 'qwen'], VOICE_PROVIDER: ['gemini', 'qwen', 'none'], DASHSCOPE_REGION: ['cn-beijing', 'ap-southeast-1'] };
const NAMES = [...KEYS, ...Object.keys(CHOICES), 'DASHSCOPE_WORKSPACE_ID'];

export class Settings {
  // disk: { read() → values or null, write(values) }; none keeps the settings in memory only.
  constructor(disk = null, values = disk?.read() || {}) {
    this.disk = disk;
    this.values = values && typeof values === 'object' ? values : {};
  }
  // The environment the server runs with: .env, with whatever was set on the page on top.
  env(base = process.env, values = this.values) { return { ...base, ...values }; }
  // A key is only ever shown by its last four characters.
  view(cfg) {
    const key = v => v ? `…${v.slice(-4)}` : '';
    return { text: cfg.textProvider, voice: cfg.voiceProvider, region: cfg.dashscopeRegion, workspace: cfg.dashscopeWorkspace,
      keys: { GEMINI_API_KEY: key(cfg.geminiKey), DEEPSEEK_API_KEY: key(cfg.deepseekKey), DASHSCOPE_API_KEY: key(cfg.dashscopeKey) },
      from_page: Object.keys(this.values) };
  }
  // A key left empty keeps the current one; null removes it from the page's settings.
  patch(body) {
    fields(body, NAMES);
    const next = { ...this.values };
    for (const [name, value] of Object.entries(body)) {
      if (value === null) { delete next[name]; continue; }
      check(typeof value === 'string', 'Invalid setting');
      const v = value.trim();
      if (KEYS.includes(name)) {
        if (!v) continue;
        check(v.length <= 300 && /^[\x21-\x7e]+$/.test(v), '这个 key 的格式不对：只能是一整串字母、数字和符号，不能有空格。');
      } else if (CHOICES[name]) check(CHOICES[name].includes(v), 'Invalid setting');
      else if (name === 'DASHSCOPE_WORKSPACE_ID') check(!v || /^[A-Za-z0-9-]{1,64}$/.test(v), '业务空间 ID 的格式不对。');
      if (v) next[name] = v; else delete next[name];
    }
    return next;
  }
  save(values) {
    this.values = values;
    this.disk?.write(values);
  }
}

// Does each chosen service accept its key? Listing models costs nothing; the voice check opens the live
// socket and waits for the service to greet it, sending no audio.
// voiceCheck replaces the Qwen voice check where a socket cannot carry the key (the browser extension checks over WebRTC).
export async function testServices(cfg, { request = fetch, connect = (url, options) => new WebSocket(url, options), voiceCheck = null } = {}) {
  const get = async (url, headers) => {
    try {
      const res = await request(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
      return res.ok ? { ok: true } : { ok: false, message: res.status === 401 || res.status === 403 ? 'key 不对，或者没有权限' : `服务返回 HTTP ${res.status}` };
    } catch { return { ok: false, message: '连不上，检查网络' }; }
  };
  const dashscope = `https://${cfg.dashscopeRegion === 'cn-beijing' ? 'dashscope' : 'dashscope-intl'}.aliyuncs.com/compatible-mode/v1/models`;
  const text = cfg.textProvider === 'deepseek'
    ? (cfg.deepseekKey ? await get('https://api.deepseek.com/models', { Authorization: `Bearer ${cfg.deepseekKey}` }) : { ok: false, message: '还没填 DeepSeek key' })
    : cfg.textProvider === 'qwen'
    ? (cfg.dashscopeKey ? await get(dashscope, { Authorization: `Bearer ${cfg.dashscopeKey}` }) : { ok: false, message: '还没填百炼 key' })
    : (cfg.geminiKey ? await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { 'x-goog-api-key': cfg.geminiKey }) : { ok: false, message: '还没填 Gemini key' });
  const provider = voiceProvider(cfg);
  let voice;
  if (cfg.voiceProvider === 'none') voice = { ok: true, message: '不用语音' };
  else if (!provider.configured(cfg)) voice = { ok: false, message: `还没填 ${provider.missing}` };
  else if (voiceCheck && cfg.voiceProvider === 'qwen') voice = await voiceCheck(cfg);
  else if (cfg.voiceProvider === 'gemini') voice = cfg.textProvider === 'gemini' ? { ...text } : await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { 'x-goog-api-key': cfg.geminiKey });
  else voice = await new Promise(resolve => {
    let socket;
    const done = result => { clearTimeout(timer); try { socket?.close(); } catch {} resolve(result); };
    const timer = setTimeout(() => done({ ok: false, message: '等了 10 秒没有回应，检查区域和业务空间 ID' }), 10000);
    try { socket = provider.open(cfg, connect); } catch { done({ ok: false, message: '连不上' }); return; }
    socket.addEventListener('message', event => {
      let m; try { m = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)); } catch { return; }
      if (m.type === 'session.created') done({ ok: true });
      else if (m.type === 'error') done({ ok: false, message: String(m.error?.message || m.error?.code || '服务报错').slice(0, 160) });
    });
    socket.addEventListener('error', () => done({ ok: false, message: 'key 不对、区域不对，或者没有这个模型的权限' }));
    socket.addEventListener('close', () => done({ ok: false, message: '服务关闭了连接：key、区域或业务空间 ID 可能不对' }));
  });
  return { text, voice };
}
