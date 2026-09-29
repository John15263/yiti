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
    if (opts.purpose === 'chat') return { model: 'fake', value: { reply: '好的，接着说。' } };
    if (opts.purpose === 'prereq_expand') return { model: 'fake', value: { explain: '概率是可能性的大小。', example: '抛硬币，正面的概率是 1/2。', pitfall: '' } };
    if (opts.purpose === 'prereq') return { model: 'fake', value: { items: [{ kind: 'concept', name: '概率', note: '事件发生的可能性有多大。' }] } };
    if (opts.purpose === 'say') return { model: 'fake', value: { score: 88, math: 'right', note: '成立', suggestion: 'Multiply 50 by 3/5.', changes: [{ from: 'multiple', to: 'multiply', why: '动词' }] } };
    throw new Error('unexpected');
  };
}
const settle = () => new Promise(r => setTimeout(r, 20));

async function harness(t, infer) {
  const calls = [];
  const app = createServer({ store: new Store(':memory:'), cfg: { geminiKey: 'test', geminiModel: 'fake', voiceMaxSeconds: 60, voiceIdleSeconds: 30 }, webRoot: new URL('../web', import.meta.url).pathname, token: 't'.repeat(64), infer: infer || fakeInfer(calls) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => { app.closeStreams(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const capture = (payload, origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop') =>
    fetch(`${base}/api/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(payload) });
  const api = async (path, body) => {
    const res = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${'t'.repeat(64)}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { app, calls, capture, api, base };
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

test('a question written where the key step goes is answered in the conversation, and is neither scored nor the key step', async t => {
  const infer = async (packet, opts) => {
    if (opts.purpose === 'say') return { model: 'fake', value: packet.sentence.includes('？')
      ? { intent: 'question', score: 0, math: 'partly', note: '因为要先通分，分母一样才能直接加。弄懂之后可以再写一句关键一步。', suggestion: '', changes: [] }
      : { intent: 'key_step', score: 92, math: 'right', note: '抓住了。', suggestion: 'Multiply 50 by 3/5.', changes: [] } };
    if (opts.purpose === 'variant_make') return { model: 'fake', value: { items: [{ question_en: 'q', question_zh: '题', answer: '1', solution: '解', hint: '提示' }] } };
    if (opts.purpose === 'chat') return { model: 'fake', value: { reply: '接着说。' } };
    throw new Error('unexpected ' + opts.purpose);
  };
  const { capture, api } = await harness(t, infer);
  await capture(question(true));
  const key = '13061309-q360462';
  await api('/api/say', { key, text: '为什么要通分？' }); await settle();
  let rec = (await api('/api/state')).body.record;
  const asked = rec.say.attempts[0];
  assert.equal(asked.status, 'done'); assert.equal(asked.intent, 'question'); assert.equal(asked.suggestion, '');
  assert.deepEqual(rec.chat.messages.map(m => [m.role, m.role === 'user' ? m.text : m.text.slice(0, 6)]), [['user', '为什么要通分？'], ['assistant', '因为要先通分']]);
  assert.equal(voiceMode(rec).key, `say:${key}:open`, 'still waiting for the key step');
  const early = await api('/api/variant', { key });
  assert.equal(early.status, 409, 'a question does not start a variant'); assert.match(early.body.error, /关键一步/);
  // The key step, written afterwards, is scored as before, and the conversation goes on.
  await api('/api/say', { key, text: 'Multiply 50 by 3/5 to get the number of quarters.' }); await settle();
  rec = (await api('/api/state')).body.record;
  assert.equal(rec.say.attempts[1].intent, 'key_step'); assert.equal(rec.say.attempts[1].score, 92);
  assert.equal(rec.chat.messages.length, 2, 'a key step is not put into the conversation');
  assert.equal((await api('/api/variant', { key })).status, 200);
  const sent = await api('/api/chat', { key, text: '还有别的办法吗？' });
  assert.equal(sent.status, 200); assert.equal(sent.body.record.chat.status, 'running');
  await settle();
  assert.deepEqual((await api('/api/state')).body.record.chat.messages.slice(-2).map(m => m.text), ['还有别的办法吗？', '接着说。']);
  assert.equal((await api('/api/chat/retry', { key })).status, 409, 'nothing failed');
});

test('the conversation is only for an answered question', async t => {
  const { capture, api } = await harness(t);
  await capture(question(false));
  assert.equal((await api('/api/chat', { key: '13061309-q360462', text: '答案是什么？' })).status, 409);
  await capture(example);
  assert.equal((await api('/api/chat', { key: '13061309-e24956', text: '这一步是什么意思？' })).status, 409, 'not for an example');
  assert.equal((await api('/api/state')).body.record.chat, undefined);
});

test('the list of prerequisites is offered over HTTP only before a question is answered', async t => {
  const { capture, api } = await harness(t);
  await capture(question(false));
  const asked = await api('/api/prereq', { key: '13061309-q360462' });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.record.prereq.status, 'running');
  await settle();
  const list = (await api('/api/state')).body.record.prereq;
  assert.equal(list.status, 'ready'); assert.equal(list.items[0].name, '概率'); assert.equal(list.views, 1);
  const opened = await api('/api/prereq/expand', { key: '13061309-q360462', item: list.items[0].id });
  assert.equal(opened.status, 200); assert.equal(opened.body.record.prereq.items[0].more.status, 'running');
  await settle();
  assert.equal((await api('/api/state')).body.record.prereq.items[0].more.example, '抛硬币，正面的概率是 1/2。');
  await capture(question(true));
  assert.equal((await api('/api/prereq', { key: '13061309-q360462' })).status, 409, 'once the answer is in');
  assert.equal((await api('/api/prereq/expand', { key: '13061309-q360462', item: list.items[0].id })).status, 409, 'nor an item of it');
  await capture(example);
  assert.equal((await api('/api/prereq', { key: '13061309-e24956' })).status, 409, 'not for an example');
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

test('a reply is numbered lower than the push that follows it, however fast the model answers', async t => {
  const { capture, api, base } = await harness(t);
  await capture(example);
  const events = new AbortController();
  try {
    const stream = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${'t'.repeat(64)}` }, signal: events.signal });
    const reader = stream.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    // The next state pushed over the event stream.
    const pushed = async () => {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end < 0) { const { value, done } = await reader.read(); assert.ok(!done, 'the event stream ended'); buffer += decoder.decode(value, { stream: true }); continue; }
        const chunk = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = chunk.startsWith('event: state') && chunk.split('\n').find(line => line.startsWith('data: '));
        if (data) return JSON.parse(data.slice(6));
      }
    };
    const first = await pushed();
    assert.equal(typeof first.boot, 'string');
    // The fake model answers at once: the reply below is taken before the job runs and says "running";
    // the push that says "ready" is taken after it, so it must carry the higher number.
    const reply = await api('/api/prepare', { key: '13061309-e24956' });
    assert.equal(reply.body.record.prep.status, 'running');
    let last;
    do { last = await pushed(); } while (last.record.prep.status !== 'ready');
    assert.equal(reply.body.boot, first.boot);
    assert.equal(last.boot, first.boot);
    assert.ok(first.seq < reply.body.seq, 'a later state has the higher number');
    assert.ok(reply.body.seq < last.seq, 'the old reply is numbered below the push that finished the work');
    assert.ok((await api('/api/state')).body.seq > last.seq);
  } finally { events.abort(); }
});

test('every page script is served by the local server', async t => {
  const { base } = await harness(t);
  const { readdirSync } = await import('node:fs');
  for (const file of readdirSync(new URL('../web', import.meta.url)).filter(f => f.endsWith('.js'))) {
    const res = await fetch(`${base}/${file}`);
    assert.equal(res.status, 200, `${file} is missing from the files list in server/http.mjs`);
    assert.match(res.headers.get('content-type'), /javascript/);
    await res.arrayBuffer();
  }
});

test('TeX a model wrote with its backslashes eaten by JSON is put back in blocks and reviews', async t => {
  // What arrives when a model writes \begin, \frac, \neq and \theta with one backslash each and the reply parses.
  const eaten = tex => tex.replace(/\\begin/g, '\begin').replace(/\\frac/g, '\frac').replace(/\\neq/g, '\neq').replace(/\\theta/g, '\theta');
  const infer = async (packet, opts) => {
    if (opts.purpose === 'prepare') return { model: 'fake', value: { summary: 's', blocks: [{ start: 0, meaning: eaten('见 $\\frac{1}{2}$'), focus: 'f',
      answer: 'a', terms: [], hints: [eaten('$\\begin{bmatrix}1&2\\end{bmatrix}$'), eaten('当 $a\\neq b$，角 $\\theta$'), 'h3'] }] } };
    if (opts.purpose === 'say') return { model: 'fake', value: { score: 90, math: 'right', note: eaten('$\\frac{a}{b}$ 不能为 $b=0$'), suggestion: eaten('取 $\\theta$'), changes: [] } };
    throw new Error('unexpected');
  };
  const { capture, api } = await harness(t, infer);
  await capture(example);
  await api('/api/prepare', { key: '13061309-e24956' }); await settle();
  const block = (await api('/api/state')).body.record.prep.blocks[0];
  assert.equal(block.meaning, '见 $\\frac{1}{2}$');
  assert.deepEqual(block.hints, ['$\\begin{bmatrix}1&2\\end{bmatrix}$', '当 $a\\neq b$，角 $\\theta$', 'h3']);
  await capture(question(true));
  await api('/api/say', { key: '13061309-q360462', text: 'Take theta.' }); await settle();
  const said = (await api('/api/state')).body.record.say.attempts[0];
  assert.equal(said.note, '$\\frac{a}{b}$ 不能为 $b=0$'); assert.equal(said.suggestion, '取 $\\theta$');
});

test('the built-in example can be tried without Math Academy', async t => {
  const { api } = await harness(t);
  const { body } = await api('/api/demo', {});
  assert.equal(body.current.key, '0-e1');
  assert.equal(body.record.step.type, 'example');
  assert.equal(body.record.sections.explanation.length, 6);
  assert.ok(body.record.sections.explanation.flat().filter(p => p.t === 'math').every(p => p.mml.startsWith('<math')));
});
