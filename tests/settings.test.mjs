import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../server/store.mjs';
import { createServer } from '../server/http.mjs';
import { config } from '../server/config.mjs';
import { Settings, testServices } from '../server/settings.mjs';
import { settingsFile } from '../server/settings-file.mjs';

test('keys are kept on disk for the owner only and shown back by their last four characters', async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'yiti-')), 'settings.json');
  const settings = new Settings(settingsFile(path));
  const cfg = config(settings.env({}));
  const token = 't'.repeat(64);
  const app = createServer({ store: new Store(':memory:'), cfg, settings, token, webRoot: fileURLToPath(new URL('../web', import.meta.url)) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => { app.closeStreams(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (path, body) => {
    const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await api('/api/state')).body.gemini, false);

  const saved = await api('/api/settings', { TEXT_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-abcdef1234', VOICE_PROVIDER: 'qwen', DASHSCOPE_API_KEY: 'sk-dash9876', DASHSCOPE_REGION: 'cn-beijing', DASHSCOPE_WORKSPACE_ID: '' });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.keys, { GEMINI_API_KEY: '', DEEPSEEK_API_KEY: '…1234', DASHSCOPE_API_KEY: '…9876' });
  assert.ok(!JSON.stringify(saved.body).includes('sk-abcdef'), 'the key never comes back to the page');
  // Live at once: text and voice are both usable without a restart.
  const state = (await api('/api/state')).body;
  assert.equal(state.gemini, true);
  assert.equal(state.voice, true);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).DEEPSEEK_API_KEY, 'sk-abcdef1234');

  // An empty key keeps the saved one; a malformed one is refused.
  const kept = await api('/api/settings', { DEEPSEEK_API_KEY: '', TEXT_PROVIDER: 'deepseek' });
  assert.equal(kept.body.keys.DEEPSEEK_API_KEY, '…1234');
  assert.equal((await api('/api/settings', { DEEPSEEK_API_KEY: 'has space' })).status, 400);
  assert.equal((await api('/api/settings', { VOICE_PROVIDER: 'openai' })).status, 400);
  // Only this page may write them.
  const cross = await fetch(base + '/api/settings', { method: 'POST', headers: { Cookie: `yiti_auth=${token}`, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(cross.status, 403);
});

test('testing the services: text by listing models, Qwen voice by its greeting', async () => {
  const cfg = config({ TEXT_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'good', VOICE_PROVIDER: 'qwen', DASHSCOPE_API_KEY: 'k', DASHSCOPE_WORKSPACE_ID: 'ws' });
  const seen = [];
  const request = async (url, { headers }) => { seen.push([url, headers.Authorization]); return { ok: headers.Authorization === 'Bearer good', status: 401 }; };
  class Socket extends EventTarget { close() {} }
  const greeted = () => { const s = new Socket(); setTimeout(() => s.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'session.created' }) })), 5); return s; };
  assert.deepEqual(await testServices(cfg, { request, connect: greeted }), { text: { ok: true }, voice: { ok: true } });
  assert.deepEqual(seen[0], ['https://api.deepseek.com/models', 'Bearer good']);
  const refused = () => { const s = new Socket(); setTimeout(() => s.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'error', error: { message: 'Invalid API-key' } }) })), 5); return s; };
  const bad = await testServices({ ...cfg, deepseekKey: 'bad' }, { request, connect: refused });
  assert.equal(bad.text.ok, false);
  assert.match(bad.text.message, /key 不对/);
  assert.deepEqual(bad.voice, { ok: false, message: 'Invalid API-key' });
  const quiet = await testServices({ ...cfg, voiceProvider: 'none' }, { request, connect: greeted });
  assert.deepEqual(quiet.voice, { ok: true, message: '不用语音' });
});

test('Qwen text: strict schema on the Model Studio chat endpoint, thinking off, translation on the cheaper model', async () => {
  const { textJSON } = await import('../server/llm.mjs');
  const cfg = config({ TEXT_PROVIDER: 'qwen', DASHSCOPE_API_KEY: 'k', DASHSCOPE_REGION: 'cn-beijing' });
  const sent = [];
  const request = async (url, init) => { sent.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ model: JSON.parse(init.body).model, choices: [{ finish_reason: 'stop', message: { content: '{"verdict":"pass"}' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }) }; };
  const schema = { type: 'object', properties: { verdict: { type: 'string' } }, required: ['verdict'], additionalProperties: false };
  const out = await textJSON({ a: 1 }, cfg, { instructions: '检查', schema, purpose: 'check' }, request);
  assert.deepEqual(out.value, { verdict: 'pass' });
  assert.equal(sent[0].url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(sent[0].auth, 'Bearer k');
  assert.equal(sent[0].body.model, 'qwen3.8-max');
  assert.equal(sent[0].body.response_format.type, 'json_schema');
  assert.equal(sent[0].body.response_format.json_schema.strict, true);
  assert.equal(sent[0].body.enable_thinking, false);
  await textJSON({ a: 1 }, cfg, { instructions: '翻译', schema, purpose: 'translate', cheap: true }, request);
  assert.equal(sent[1].body.model, 'qwen3.8-flash');
});
