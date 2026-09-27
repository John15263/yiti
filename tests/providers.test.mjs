import test from 'node:test';
import assert from 'node:assert/strict';
import { textJSON, textError } from '../server/llm.mjs';
import { config } from '../server/config.mjs';

const opts = { instructions: '只返回 JSON', schema: { type: 'object' } };
const reply = { choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], model: 'deepseek-flash' };

test('DeepSeek translates without thinking first, and still thinks when it judges maths', async () => {
  const bodies = [];
  const request = async (url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true, json: async () => reply }; };
  const cfg = config({ TEXT_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-key' });
  await textJSON({ q: 1 }, cfg, { ...opts, purpose: 'translate', cheap: true }, request);
  await textJSON({ q: 1 }, cfg, { ...opts, purpose: 'check' }, request);
  assert.deepEqual(bodies.map(b => b.thinking), [{ type: 'disabled' }, undefined]);
});

// DeepSeek sends its headers at once and the answer only when done, so a dropped connection shows up while reading it.
test('a reply cut off after its headers is a network error, for DeepSeek and for Gemini', async () => {
  const cut = async () => ({ ok: true, json: async () => { throw new TypeError('terminated'); } });
  await assert.rejects(textJSON({ q: 1 }, config({ TEXT_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-key' }), { ...opts, purpose: 'check' }, cut),
    /^Error: DeepSeek network error or timeout$/);
  await assert.rejects(textJSON({ q: 1 }, config({ GEMINI_API_KEY: 'test-key' }), { ...opts, purpose: 'check' }, cut), /^Error: Gemini network error or timeout$/);
});

test('a failed text call is told by the provider that was asked, never as Gemini when it was DeepSeek', () => {
  assert.equal(textError(new Error('Invalid model response'), { textProvider: 'deepseek' }), '这次未取得有效的 DeepSeek 内容，可以重试。');
  assert.equal(textError(new Error('DeepSeek network error or timeout'), { textProvider: 'deepseek' }), 'DeepSeek 暂时连接不上或等待超时，可以重试。');
  assert.equal(textError(new Error('DeepSeek HTTP 402'), { textProvider: 'deepseek' }), 'DeepSeek 账户余额不足，充值后可以重试。');
  assert.equal(textError(new Error('Invalid model response'), { textProvider: 'qwen' }), '这次未取得有效的千问内容，可以重试。');
  assert.equal(textError(new Error('Invalid model response'), {}), '这次未取得有效的 Gemini 内容，可以重试。');
});
