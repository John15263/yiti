import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { createServer } from '../server/http.mjs';
import { normalize, paraText } from '../server/capture.mjs';
import { blocksOf } from '../server/teach.mjs';
import { voiceMode } from '../web/mode.js';

const text = v => ({ t: 'text', v });
const math = (tex, display = false) => ({ t: 'math', tex, display, mml: `<math><mi>${tex}</mi></math>` });
const example = {
  page: 'lesson', task: '13061309', topic: '7222', url: 'https://www.mathacademy.com/tasks/13061309/topics/7222/lesson',
  step: { id: 'e24956', type: 'example', index: 1, total: 26 }, title: 'Example: Using Probability to Make Predictions',
  sections: {
    question: [[text('A bag contains '), math('3'), text(' red marbles…')]],
    explanation: [[text('The estimated number is the product of trials and probability:')], [math('n \\cdot P', true)],
      [text('The probability of drawing a red or blue marble is')], [math('\\frac{8}{10}', true)], [text('So the expected number is 48.')]],
  },
};
const question = (answered) => ({
  page: 'lesson', task: '13061309', topic: '7222', step: { id: 'q360462', type: 'question', index: 2, total: 26 }, title: 'Question 1',
  sections: { question: [[text('A pocket contains 4 quarters…')]], choices: [{ letter: 'a', content: [[math('30')]], picked: true }],
    ...(answered ? { result: 'Correct', explanation: [[text('Multiply 50 by 3/5.')]] } : {}) },
});

function fakeInfer(calls) {
  return async (packet, opts) => {
    calls.push({ purpose: opts.purpose, packet });
    if (opts.purpose === 'prepare') return { model: 'fake', value: { summary: '用概率估计次数', blocks: [
      { start: 0, meaning: '公式', focus: '写出公式', answer: 'n * P', terms: [{ en: 'product', zh: '乘积' }], hints: ['想乘法', 'n × ?', 'n × P'] },
      { start: 2, meaning: '算概率', focus: '写出概率', answer: '8/10', terms: [], hints: [] },
      { start: 2, meaning: 'duplicate start is dropped', focus: '', answer: '', terms: [], hints: [] },
      { start: 4, meaning: '结论', focus: '写出结果', answer: '48', terms: [], hints: [] }] } };
    if (opts.purpose === 'check') return { model: 'fake', value: { verdict: packet.written.includes('P') ? 'pass' : 'adjust', note: 'ok', fixed: 'n * P' } };
    if (opts.purpose === 'say') return { model: 'fake', value: { score: 88, math: 'right', note: '成立', suggestion: 'Multiply 50 by 3/5.', changes: [{ from: 'multiple', to: 'multiply', why: '动词' }] } };
    throw new Error('unexpected');
  };
}
const settle = () => new Promise(r => setTimeout(r, 20));

async function harness(t) {
  const calls = [];
  const app = createServer({ store: new Store(':memory:'), cfg: { geminiKey: 'test', geminiModel: 'fake', voiceMaxSeconds: 60, voiceIdleSeconds: 30 }, webRoot: new URL('../web', import.meta.url).pathname, token: 't'.repeat(64), infer: fakeInfer(calls) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => { app.closeStreams(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const capture = (payload, origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop') =>
    fetch(`${base}/api/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(payload) });
  const api = async (path, body) => {
    const res = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${'t'.repeat(64)}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { app, calls, capture, api };
}

test('captures are accepted only from the extension or Math Academy itself', async t => {
  const { capture, api } = await harness(t);
  assert.equal((await capture(example, 'https://evil.example')).status, 403);
  assert.equal((await capture(example, 'https://www.mathacademy.com')).status, 200);
  assert.equal((await capture(example)).status, 200);
  const { body } = await api('/api/state');
  assert.equal(body.record.key, '13061309-e24956');
  assert.equal(body.record.step.type, 'example');
});

test('non-lesson pages keep no content', () => {
  assert.deepEqual(normalize({ page: 'quiz', task: '1', topic: '2', sections: { body: [[text('secret')]] } }), { page: 'quiz', task: '1', topic: '2' });
  assert.equal(paraText([text('a '), math('x^2'), text(' b')]), 'a $x^2$ b');
});

test('blocks always cover every paragraph once, in order', () => {
  const blocks = blocksOf([{ start: 3 }, { start: 1 }, { start: 9 }, { start: 5 }], 7);
  assert.deepEqual(blocks.map(b => [b.start, b.end]), [[0, 5], [5, 7]]);
  assert.deepEqual(blocksOf([], 3).map(b => [b.start, b.end]), [[0, 3]]);
});

test('an example is learned block by block: learn, write, check, next', async t => {
  const { capture, api, calls } = await harness(t);
  await capture(example);
  const key = '13061309-e24956';
  await api('/api/prepare', { key }); await settle();
  let rec = (await api('/api/state')).body.record;
  assert.equal(rec.prep.status, 'ready');
  assert.deepEqual(rec.prep.blocks.map(b => [b.start, b.end]), [[0, 2], [2, 4], [4, 5]]);
  assert.equal(voiceMode(rec).mode, 'learn');
  // The question is context; the blocks come from the explanation.
  assert.match(calls[0].packet.题目, /bag contains \$3\$/);

  assert.equal((await api('/api/check', { key, index: 0, text: 'n * P' })).status, 409, 'cannot check before hiding the block');
  await api('/api/command', { type: 'write', key, index: 0 });
  await api('/api/command', { type: 'hint', key, index: 0 });
  await api('/api/check', { key, index: 0, text: 'n times P' }); await settle();
  rec = (await api('/api/state')).body.record;
  assert.equal(rec.progress.phase, 'checked');
  assert.equal(rec.progress.inputs[0].attempts[0].verdict, 'pass');
  assert.equal(rec.progress.inputs[0].attempts[0].hints, 1);
  assert.equal(voiceMode(rec).mode, 'check');

  await api('/api/command', { type: 'next', key, index: 0 });
  assert.equal((await api('/api/command', { type: 'next', key, index: 0 })).status, 409, 'a stale index is refused');
  await api('/api/command', { type: 'write', key, index: 1 });
  await api('/api/command', { type: 'next', key, index: 1 });
  await api('/api/command', { type: 'write', key, index: 2 });
  await api('/api/command', { type: 'next', key, index: 2 });
  rec = (await api('/api/state')).body.record;
  assert.equal(rec.progress.phase, 'done');
  assert.deepEqual(rec.progress.inputs.map(i => [i.passed, i.skipped]), [[true, false], [false, true], [false, true]]);
});

test('a question gets nothing until it is answered, then one sentence is reviewed', async t => {
  const { capture, api } = await harness(t);
  await capture(question(false));
  const key = '13061309-q360462';
  let rec = (await api('/api/state')).body.record;
  assert.equal(voiceMode(rec).mode, 'prereq', 'only prerequisites before answering');
  assert.equal(rec.sections.explanation, undefined);
  assert.equal((await api('/api/say', { key, text: 'Multiple 50 by 3/5.' })).status, 409);

  await capture(question(true));
  rec = (await api('/api/state')).body.record;
  assert.equal(voiceMode(rec).mode, 'say');
  await api('/api/say', { key, text: 'Multiple 50 by 3/5.' }); await settle();
  rec = (await api('/api/state')).body.record;
  assert.equal(rec.say.attempts[0].score, 88);
  assert.equal(rec.say.attempts[0].changes[0].to, 'multiply');
});

test('only the step being followed can be changed', async t => {
  const { capture, api } = await harness(t);
  await capture(example);
  await capture(question(false));
  const res = await api('/api/prepare', { key: '13061309-e24956' });
  assert.equal(res.status, 409);
  await capture({ page: 'quiz', task: '99', topic: '1' });
  const { body } = await api('/api/state');
  assert.equal(body.current.page, 'quiz');
  assert.equal(body.record, null);
});

test('records fingerprinted with the old hash keep their preparation and translation', async () => {
  const { Board } = await import('../server/board.mjs');
  const { fingerprint, textFingerprint } = await import('../server/capture.mjs');
  const store = new Store(':memory:');
  const sections = { explanation: [[text('Multiply.')]] };
  store.putStep({ key: '1-e2', task: '1', step: { id: 'e2', type: 'example', index: 0, total: 1 }, title: 'E', sections, hash: 'oldsha', text_hash: 'oldtext',
    updated_at: 'x', prep: { status: 'ready', hash: 'oldsha', blocks: [{ start: 0, end: 1 }] }, translation: { status: 'ready', hash: 'oldtext' },
    progress: { index: 0, phase: 'learn', inputs: [{ hints: 0, peeks: 0, skipped: false, passed: false, attempts: [] }] }, say: { attempts: [] }, voice: [] });
  const rec = new Board(store).record('1-e2');
  assert.equal(rec.hash, fingerprint(sections));
  assert.equal(rec.prep.hash, rec.hash);
  assert.equal(rec.prep.status, 'ready');
  assert.equal(rec.translation.hash, textFingerprint(sections));
});
