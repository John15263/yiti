import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { createServer } from '../server/http.mjs';
import { lessonItems } from '../server/variant.mjs';

const text = v => ({ t: 'text', v });
const TASK = '13061309';
// Math Academy's practice questions of one lesson; the last one is the lesson's last step.
const question = (n, { answered = true, index = n, total = 5 } = {}) => ({
  page: 'lesson', task: TASK, topic: '7222', step: { id: `q${100 + n}`, type: 'question', index, total }, title: `Question ${n}`,
  sections: { question: [[text(`A bag holds ${n + 2} red and 3 blue marbles…`)]],
    ...(answered ? { result: 'Correct', explanation: [[text('Use the complement rule.')]] } : {}) },
});

function fakeInfer(calls, check = () => ({ verdict: 'slip', note: '关键一步对了，1 - 3/8 算错了', fixed: '1 - 3/8 = 5/8' })) {
  return async (packet, opts) => {
    calls.push({ purpose: opts.purpose, packet });
    if (opts.purpose === 'say') return { model: 'fake', value: { score: 90, math: 'right', note: '成立', suggestion: '用补集：1 减去蓝色的概率。', changes: [] } };
    if (opts.purpose === 'variant_make') return { model: 'fake', value: { items: packet.items.map((item, i) => ({
      question_en: `A spinner… (${calls.length}-${i})`, question_zh: `转盘有 8 格，3 格是蓝色（${calls.length}-${i}）。不是蓝色的概率是多少？`,
      answer: '5/8', solution: '不是蓝色 = 1 - 蓝色\n= 1 - 3/8 = 5/8', hint: '先求蓝色的概率' })) } };
    if (opts.purpose === 'variant_check') return { model: 'fake', value: check(packet) };
    throw new Error(`unexpected ${opts.purpose}`);
  };
}
const settle = () => new Promise(r => setTimeout(r, 20));

async function harness(t, check) {
  const calls = [];
  const app = createServer({ store: new Store(':memory:'), cfg: { geminiKey: 'test', geminiModel: 'fake', voiceMaxSeconds: 60, voiceIdleSeconds: 30 },
    webRoot: new URL('../web', import.meta.url).pathname, token: 't'.repeat(64), infer: fakeInfer(calls, check) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => { app.closeStreams(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const capture = payload => fetch(`${base}/api/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }, body: JSON.stringify(payload) });
  const api = async (path, body) => {
    const res = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${'t'.repeat(64)}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  // A question answered on Math Academy, and its key step said and reviewed here.
  const answer = async n => {
    await capture(question(n));
    const key = `${TASK}-q${100 + n}`;
    await api('/api/say', { key, text: '用补集' }); await settle();
    return key;
  };
  return { app, calls, capture, api, answer };
}

test('a variant is only made once the question is answered on Math Academy and its key step reviewed', async t => {
  const { capture, api, calls } = await harness(t);
  await capture(question(1, { answered: false }));
  const key = `${TASK}-q101`;
  assert.equal((await api('/api/variant', { key })).status, 409, 'not before the answer: that would be help with the question');
  await capture(question(1));
  assert.equal((await api('/api/variant', { key })).status, 409, 'not before the key step is said');
  await api('/api/say', { key, text: '用补集' }); await settle();
  const started = await api('/api/variant', { key });
  assert.equal(started.status, 200); assert.equal(started.body.record.variant.status, 'running');
  await settle();
  const made = calls.find(c => c.purpose === 'variant_make').packet.items[0];
  assert.equal(made.关键一步, '用补集：1 减去蓝色的概率。', 'the reviewed sentence is the key step');
  assert.match(made.原题, /red and 3 blue/); assert.equal(made.之前出过的变式, '');
  const v = (await api('/api/state')).body.record.variant;
  assert.equal(v.status, 'ready'); assert.equal(v.items[0].status, 'open');
});

test('worked here: the answer itself is right for free, a slip is checked, hints climb to the solution, and moving on records it', async t => {
  const { api, answer, calls } = await harness(t);
  const key = await answer(1);
  await api('/api/variant', { key }); await settle();
  let item = (await api('/api/state')).body.record.variant.items[0];
  const ids = { key, round: 1, item: item.id };
  await api('/api/variant/check', { ...ids, text: '1 - 3/8 = 4/8' }); await settle();
  item = (await api('/api/state')).body.record.variant.items[0];
  assert.equal(item.attempts[0].verdict, 'slip'); assert.equal(item.passed, null);
  assert.equal(calls.find(c => c.purpose === 'variant_check').packet.参考答案, '5/8');
  for (let n = 0; n < 4; n++) await api('/api/variant/hint', ids);
  item = (await api('/api/state')).body.record.variant.items[0];
  assert.equal(item.hints, 3, 'three levels, the last one the solution');
  await api('/api/variant/check', { ...ids, text: ' 5/8 ' });
  item = (await api('/api/state')).body.record.variant.items[0];
  assert.equal(item.attempts[1].by, 'local'); assert.equal(item.passed, true);
  assert.equal(calls.filter(c => c.purpose === 'variant_check').length, 1);
  await api('/api/variant/next', ids);
  item = (await api('/api/state')).body.record.variant.items[0];
  assert.equal(item.status, 'done');
  assert.equal((await api('/api/variant/check', { ...ids, text: '5/8' })).status, 409);
});

test('on the lesson\'s last step, every key step comes back once more in yet another setting', async t => {
  const { api, answer, calls } = await harness(t);
  for (const n of [1, 2]) {
    const key = await answer(n);
    await api('/api/variant', { key }); await settle();
    const item = (await api('/api/state')).body.record.variant.items[0];
    if (n === 1) await api('/api/variant/next', { key, round: 1, item: item.id }); // skipped: missed
    else { await api('/api/variant/check', { key, round: 1, item: item.id, text: '5/8' }); await api('/api/variant/next', { key, round: 1, item: item.id }); }
  }
  assert.equal((await api('/api/state')).body.lesson_ready, false, 'the second question is not the last step');
  const last = await answer(4);
  let st = (await api('/api/state')).body;
  assert.equal(st.lesson_ready, true, 'the last step, answered, with its own variant not yet asked for');
  await api('/api/variant/lesson', { key: last }); await settle();
  const made = calls.filter(c => c.purpose === 'variant_make').at(-1).packet.items;
  assert.equal(made.length, 2);
  assert.ok(made.every(i => i.之前出过的变式.startsWith('转盘')), 'each is told the setting it already had');
  st = (await api('/api/state')).body;
  assert.equal(st.review.status, 'ready'); assert.equal(st.review.items.length, 2); assert.equal(st.lesson_ready, false);
  for (const item of st.review.items) await api('/api/variant/next', { key: last, round: 2, item: item.id });
  st = (await api('/api/state')).body;
  assert.ok(st.review.items.every(i => i.status === 'done' && i.passed === false));
});

test('the lesson round puts missed key steps first and keeps at most four', () => {
  const steps = [1, 2, 3, 4, 5].map(n => ({ key: `${TASK}-q${n}`, step: { index: n }, variant: { status: 'ready', items: [{ id: `i${n}`, status: 'done', passed: n !== 5 }] } }));
  const store = { steps: () => steps };
  const chosen = lessonItems(store, TASK, () => 0.999).map(x => x.item.id);
  assert.equal(chosen.length, 4);
  assert.ok(chosen.includes('i5'), 'the missed one is kept'); assert.ok(!chosen.includes('i4'), 'the latest passed one waits');
});
