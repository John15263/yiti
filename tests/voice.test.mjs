import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Board } from '../server/board.mjs';
import { Voice } from '../server/voice.mjs';
import { voiceMode } from '../web/mode.js';

const text = v => ({ t: 'text', v });
const answered = { page: 'lesson', task: '1', topic: '2', step: { id: 'q9', type: 'question', index: 3, total: 9 }, title: 'Question 1',
  sections: { question: [[text('A pocket contains 4 quarters…')]], choices: [], result: 'Correct', explanation: [[text('Multiply 50 by 3/5.')]] } };

class Upstream extends EventTarget {
  readyState = 0; sent = [];
  send(s) { this.sent.push(JSON.parse(s)); }
  close() {}
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  push(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
}
function call(cfg) {
  const board = new Board(new Store(':memory:'));
  board.capture(answered);
  const rec = board.record('1-q9'), up = new Upstream(), page = [], on = {};
  let opened;
  const voice = new Voice(board, { voiceMaxSeconds: 60, voiceIdleSeconds: 30, ...cfg }, (url, options) => { opened = { url, options }; return up; });
  const conn = { send: s => page.push(JSON.parse(s)), close() {}, on: (e, f) => (on[e] = f) };
  voice.start(conn, new URLSearchParams({ key: rec.key, mode: voiceMode(rec).key }));
  return { board, up, page, on, opened: () => opened };
}
const events = page => page.filter(m => ['audio', 'heard', 'said', 'interrupted', 'turn'].includes(m.voice)).map(m => m.voice);

test('Qwen-Omni-Realtime: set up with the key in a header, and read back as the same events', () => {
  const metered = [];
  const { board, up, page, on, opened } = call({ voiceProvider: 'qwen', dashscopeKey: 'k', dashscopeRegion: 'cn-beijing', dashscopeWorkspace: 'ws1',
    qwenRealtimeModel: 'qwen3.8-omni-flash-realtime', qwenVoice: 'longanlingxin',
    usage: { record: u => (metered.push(u), { text_in: 10, audio_in: 70, text_out: 5, audio_out: 40, thoughts: 0, usd: null }) } });
  assert.equal(opened().url, 'wss://ws1.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime');
  assert.equal(opened().options.headers.Authorization, 'Bearer k');
  up.open();
  const setup = up.sent[0];
  assert.equal(setup.type, 'session.update');
  assert.match(setup.session.instructions, /一句话/);
  assert.equal(setup.session.audio.output.voice, 'longanlingxin');
  on.message(JSON.stringify({ type: 'audio', data: 'AAAA' }));
  assert.deepEqual(up.sent.at(-1), { type: 'input_audio_buffer.append', audio: 'AAAA' });
  // The tutor is asked to begin only once the session is set up.
  up.push({ type: 'session.updated' });
  assert.deepEqual(up.sent.slice(-2).map(m => m.type), ['conversation.item.create', 'response.create']);
  up.push({ type: 'response.audio.delta', delta: 'UklG' });
  up.push({ type: 'response.audio_transcript.delta', delta: '你抓住了' });
  up.push({ type: 'response.audio_transcript.delta', delta: '关键一步。' });
  up.push({ type: 'input_audio_buffer.speech_started' });
  up.push({ type: 'conversation.item.input_audio_transcription.completed', transcript: '为什么乘以 50？' });
  up.push({ type: 'response.done', response: { usage: { input_tokens: 80, output_tokens: 45, input_token_details: { audio_tokens: 70 }, output_token_details: { audio_tokens: 40 } } } });
  assert.deepEqual(events(page), ['audio', 'said', 'said', 'interrupted', 'heard', 'turn']);
  assert.equal(page.find(m => m.voice === 'audio').data, 'UklG');
  assert.equal(metered[0].usage.promptTokensDetails[0].tokenCount, 70);
  // A price not known here is never shown as $0.
  assert.equal(page.find(m => m.voice === 'usage').usd, null);
  on.close();
  const saved = board.record('1-q9').voice[0];
  assert.deepEqual(saved.transcript, [{ role: 'tutor', text: '你抓住了关键一步。' }, { role: 'user', text: '为什么乘以 50？' }]);
  assert.equal(saved.model, 'qwen3.8-omni-flash-realtime');
  assert.equal(saved.usage.usd, null);
});

test('Qwen without a workspace id uses the shared address for its region', () => {
  const { opened } = call({ voiceProvider: 'qwen', dashscopeKey: 'k', dashscopeRegion: 'ap-southeast-1', dashscopeWorkspace: '', qwenRealtimeModel: 'm', qwenVoice: 'v' });
  assert.equal(opened().url, 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=m');
});

test('Gemini Live still reads back as the same events', () => {
  const { board, up, page, on, opened } = call({ voiceProvider: 'gemini', geminiKey: 'g', geminiLiveModel: 'gemini-live', voiceThinkingLevel: 'LOW',
    usage: { record: () => ({ text_in: 1, audio_in: 0, text_out: 1, audio_out: 0, thoughts: 0, usd: 0.002 }) } });
  assert.match(opened().url, /BidiGenerateContent\?key=g$/);
  up.open();
  assert.equal(up.sent[0].setup.model, 'models/gemini-live');
  up.push({ setupComplete: {} });
  assert.equal(up.sent.at(-1).clientContent.turnComplete, true);
  up.push({ serverContent: { modelTurn: { parts: [{ inlineData: { data: 'UklG' } }] }, outputTranscription: { text: '讲完了。' } } });
  up.push({ serverContent: { inputTranscription: { text: '好的' }, interrupted: true } });
  up.push({ serverContent: { turnComplete: true }, usageMetadata: { promptTokenCount: 10 } });
  assert.deepEqual(events(page), ['audio', 'said', 'heard', 'interrupted', 'turn']);
  assert.equal(page.find(m => m.voice === 'usage').usd, 0.002);
  on.close();
  assert.equal(board.record('1-q9').voice[0].transcript.length, 2);
});

test('an error from the service ends the call and says why', () => {
  const { up, page } = call({ voiceProvider: 'qwen', dashscopeKey: 'k', dashscopeRegion: 'cn-beijing', dashscopeWorkspace: 'w', qwenRealtimeModel: 'm', qwenVoice: 'v' });
  up.open();
  up.push({ type: 'error', error: { message: 'voice not found' } });
  assert.match(page.find(m => m.voice === 'closed').reason, /voice not found/);
});
