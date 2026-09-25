import { voiceMode } from './mode.js';
import { openVoice, microphoneDenied } from './backend.js';
// Live voice tutor: the page carries the microphone, never the API key; the local server owns the prompt
// and records what was said. The audio side is 一句's, unchanged.
const OUTPUT_RATE = 24000;
const KINDS = { learn: '讲解', write: '默写陪练', check: '检查讲解', say: '一句讲解', prereq: '前置知识（交答案前）' };
// What the voice button in the top bar does at this moment, said on hover; its face only says 语音 ⌘].
const LABELS = { learn: '让陪练讲这一块', write: '默写时的陪练：只引导，不报答案', check: '让陪练讲这次检查', say: '让陪练讲这道题和你那一句', prereq: '问前置知识：不讲这道题的做法' };
const headingOf = (mode, index) => `${Number.isInteger(index) ? `第 ${index + 1} 块 · ` : ''}${KINDS[mode] || '陪练'}`;

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function fromBase64(value) {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
// null: a service whose price is not known here; its usage is kept in tokens, never guessed.
const money = value => value === null ? '费用见服务商控制台' : !value ? '$0' : value < 0.001 ? '< $0.001' : `$${value.toFixed(3)}`;

export function createVoice({ getRecord, draftOf, available = () => true }) {
  const $ = id => document.getElementById(id);
  let socket = null, capture = null, stream = null, playback = null, playHead = 0, sources = new Set();
  let live = false, status = '', startedAt = 0, ticker = null, lines = [], sentDraft = '', usd = 0;
  let modeKey = '', mode = '', heading = '', sessionID = '', generation = 0, ended = null, shownKey;
  // Conversations opened from this page about the moment on screen stay open to read; everything else is folded away.
  let mine = new Set();

  function elapsed() {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function paint() {
    const rec = getRecord(), m = voiceMode(rec);
    // Voice needs a Gemini key even when the text calls go to another provider.
    const can = !!m && available();
    $('voice-open').hidden = !can && !live;
    $('voice-open').textContent = live ? `● ${elapsed()}` : '语音 ⌘]';
    $('voice-open').title = live ? '结束语音（⌘ ]）' : `${LABELS[m?.mode] || '语音陪练'}（⌘ ]）`;
    $('voice-open').classList.toggle('live', live);
    const line = live ? [!sessionID ? '正在连接…' : sources.size ? '陪练在讲' : '在听，你可以提问', usd === undefined ? '' : money(usd)].filter(Boolean).join(' · ') : status;
    $('voice-status').textContent = line; $('voice-status').hidden = !line;
    const past = (rec?.voice || []);
    if (ended && past.some(v => v.session_id === ended.id)) ended = null;
    const blocks = past.map(v => ({ id: v.session_id, heading: headingOf(v.mode, v.index), lines: v.transcript }));
    if (ended) blocks.push({ id: ended.id, heading: ended.heading, lines: ended.lines });
    if (live) blocks.push({ id: sessionID, heading, lines });
    const here = blocks.filter(b => b.lines.length && (mine.has(b.id) || (live && b.id === sessionID)));
    const earlier = blocks.filter(b => b.lines.length && !here.includes(b));
    const list = $('voice-transcript'), following = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    fill(list, here, here.length > 1); list.hidden = !here.length;
    $('voice-earlier').hidden = !earlier.length;
    $('voice-earlier-title').textContent = `之前的语音对话 · ${earlier.length} 段`;
    fill($('voice-earlier-list'), earlier, true);
    $('voice').hidden = !line && !here.length && !earlier.length;
    if (following) list.scrollTop = list.scrollHeight;
  }
  function fill(list, blocks, headings) {
    list.replaceChildren();
    for (const b of blocks) {
      if (headings) { const h = document.createElement('p'); h.className = 'session'; h.textContent = b.heading; list.append(h); }
      for (const line of b.lines) { const p = document.createElement('p'); p.className = line.role === 'tutor' ? 'tutor' : 'user'; p.textContent = line.text; list.append(p); }
    }
  }
  function note(role, text) {
    const last = lines.at(-1);
    if (last && last.role === role && !last.done) last.text += text; else lines.push({ role, text });
    paint();
  }
  // The microphone and speakers of one start; closed on the spot if that start was abandoned meanwhile.
  // A call that carries audio itself ('track', WebRTC) only needs the microphone; one that relays it as PCM
  // ('pcm') also needs the capture worklet and a player.
  async function openAudio(transport) {
    const audio = { stream: await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }) };
    if (transport === 'track') return audio;
    try {
      audio.capture = new AudioContext({ sampleRate: 16000 });
      audio.playback = new AudioContext({ sampleRate: OUTPUT_RATE });
      await audio.capture.audioWorklet.addModule(new URL('./voice-worklet.js', import.meta.url));
      const source = audio.capture.createMediaStreamSource(audio.stream);
      const worklet = new AudioWorkletNode(audio.capture, 'voice-capture', { processorOptions: { target: 16000, chunk: 1600 } });
      worklet.port.onmessage = event => {
        if (capture === audio.capture && socket?.ready()) socket.send({ type: 'audio', data: toBase64(event.data) });
      };
      source.connect(worklet);
      await Promise.race([Promise.all([audio.capture.resume(), audio.playback.resume()].map(p => p.catch(() => {}))), new Promise(r => setTimeout(r, 1500))]);
      if (audio.playback.state !== 'running') throw Object.assign(new Error('Audio blocked'), { name: 'AudioBlocked' });
      return audio;
    } catch (e) { free(audio); throw e; }
  }
  function free(audio) {
    for (const track of audio?.stream?.getTracks() || []) track.stop();
    audio?.capture?.close().catch(() => {});
    audio?.playback?.close().catch(() => {});
  }
  function play(base64) {
    if (!playback) return;
    const bytes = fromBase64(base64), samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    if (!samples.length) return;
    const buffer = playback.createBuffer(1, samples.length, OUTPUT_RATE), channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;
    const source = playback.createBufferSource();
    source.buffer = buffer; source.connect(playback.destination);
    playHead = Math.max(playHead, playback.currentTime + 0.06);
    source.start(playHead); playHead += buffer.duration;
    sources.add(source); source.onended = () => sources.delete(source);
  }
  function silence() {
    for (const source of sources) { try { source.stop(); } catch {} }
    sources.clear(); playHead = playback ? playback.currentTime : 0;
  }
  async function start() {
    const rec = getRecord(), m = voiceMode(rec);
    if (live || !m || !available()) return;
    const run = ++generation;
    // Cost is shown once the service has reported some; before that there is nothing to show.
    live = true; lines = []; sentDraft = ''; usd = undefined; startedAt = Date.now(); sessionID = '';
    modeKey = m.key; mode = m.mode; heading = headingOf(m.mode, m.index); status = ''; paint();
    // Each call answers only for itself: an old one still closing must never end the call that replaced it.
    let call = null;
    const message = value => {
      if (socket !== call) return;
      if (value.voice === 'ready') { startedAt = Date.now(); sessionID = value.session || 'ready'; mine.add(sessionID); paint(); return; }
      if (value.voice === 'error') { status = value.message; paint(); return; }
      if (value.voice === 'usage') { usd = value.usd; paint(); return; }
      if (value.voice === 'closed') { status = value.reason; stop(false); return; }
      // The same few events whichever service is speaking; the engine translates.
      if (value.voice === 'audio') play(value.data);
      else if (value.voice === 'interrupted') silence();
      else if (value.voice === 'heard') note('user', value.text);
      else if (value.voice === 'said') note('tutor', value.text);
      else if (value.voice === 'turn') for (const line of lines) line.done = true;
    };
    call = openVoice({ key: rec.key, mode: m.key }, { message,
      error: () => { if (socket === call) status = '语音连接出错，已结束。'; },
      close: () => { if (socket === call && live) { status = status || '语音已结束。'; stop(false); } } });
    socket = call;
    let audio;
    try { audio = await openAudio(call.transport); }
    catch (e) {
      if (run !== generation) return;
      status = e.name === 'NotAllowedError' ? microphoneDenied()
        : e.name === 'AudioBlocked' ? '浏览器没有允许播放声音，再按一次 ⌘ ]。' : '打不开麦克风，这次没有开始。';
      stop(); return;
    }
    if (run !== generation) { free(audio); return; }
    ({ stream, capture, playback } = audio); playHead = 0;
    if (call.transport === 'track') call.useMicrophone(stream);
    ticker = setInterval(() => { if (!live) return; paint(); sendDraft(); }, 1000);
  }
  function sendDraft() {
    if (mode !== 'write') return;
    const value = draftOf();
    if (value === sentDraft || !socket?.ready()) return;
    sentDraft = value; socket.send({ type: 'draft', data: value });
  }
  function stop(closeSocket = true) {
    generation++;
    if (!live && !socket) return;
    if (live && sessionID) status = `${status || '语音已结束。'} 用时 ${elapsed()}${usd === undefined ? '' : usd === null ? ` · ${money(usd)}` : ` · 实际花费 ${money(usd)}`}`;
    live = false;
    // What was just said stays on screen until the recorded copy of it arrives.
    if (sessionID && lines.length) ended = { id: sessionID, key: modeKey, heading, lines };
    lines = []; sessionID = '';
    clearInterval(ticker); ticker = null;
    const call = socket; socket = null;
    if (call && closeSocket) call.close();
    silence(); free({ stream, capture, playback }); stream = null; capture = null; playback = null;
    paint();
  }
  $('voice-open').onclick = () => toggle();
  function toggle() { if (live) { status = '语音已结束。'; stop(); } else void start(); }
  return {
    toggle,
    // Each moment has its own call: when the step, block or check changes, the call ends with it.
    update() {
      const m = voiceMode(getRecord());
      if (live && m?.key !== modeKey) { status = m ? '到了下一段，语音结束。按 ⌘ ] 可以接着问。' : '这一步不开语音，语音结束。'; stop(); }
      if (m?.key !== shownKey) { if (!live && shownKey !== undefined) status = ''; if (!live) mine = new Set(); shownKey = m?.key; }
      paint();
    },
  };
}
