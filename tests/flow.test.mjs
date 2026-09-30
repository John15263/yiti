import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Board } from '../server/board.mjs';
import { createServer } from '../server/http.mjs';
import { normalize, paraText, fingerprint, textFingerprint } from '../server/capture.mjs';
import { voiceMode } from '../web/mode.js';
import '../server/prompts-node.mjs';

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
const tutorial = { page: 'lesson', task: '13061309', topic: '7222', step: { id: 't10001', type: 'tutorial', index: 0, total: 26 }, title: 'Expected Counts',
  sections: { body: [[text('The expected count is the number of trials times the probability.')], [math('n \\cdot P', true)]] } };
const question = answered => ({
  page: 'lesson', task: '13061309', topic: '7222', step: { id: 'q360462', type: 'question', index: 2, total: 26 }, title: 'Question 1',
  sections: { question: [[text('A pocket contains 4 quarters…')]], choices: [{ letter: 'a', content: [[text('thirty coins in all')]], picked: true }],
    ...(answered ? { result: 'Correct', explanation: [[text('Multiply 50 by 3/5.')]] } : {}) },
});
const QUESTION_KEY = '13061309-q360462', EXAMPLE_KEY = '13061309-e24956';

function fakeInfer(calls) {
  return async (packet, opts) => {
    calls.push({ purpose: opts.purpose, packet, opts });
    if (opts.purpose === 'chat') return { model: 'fake', value: { reply: '好的，接着说。' } };
    if (opts.purpose === 'prereq_expand') return { model: 'fake', value: { explain: '概率是可能性的大小。', example: '抛硬币，正面的概率是 1/2。', pitfall: '' } };
    if (opts.purpose === 'prereq') return { model: 'fake', value: { items: [{ kind: 'concept', name: '概率', note: '事件发生的可能性有多大。' }] } };
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
  const record = async () => (await api('/api/state')).body.record;
  return { app, calls, capture, api, base, record };
}

test('captures are accepted only from the extension or Math Academy itself', async t => {
  const { capture, api } = await harness(t);
  assert.equal((await capture(example, 'https://evil.example')).status, 403);
  assert.equal((await capture(example, 'https://www.mathacademy.com')).status, 200);
  assert.equal((await capture(example)).status, 200);
  const { body } = await api('/api/state');
  assert.equal(body.record.key, EXAMPLE_KEY);
  assert.equal(body.record.step.type, 'example');
});

test('non-lesson pages keep no content', () => {
  assert.deepEqual(normalize({ page: 'quiz', task: '1', topic: '2', sections: { body: [[text('secret')]] } }), { page: 'quiz', task: '1', topic: '2' });
  assert.equal(paraText([text('a '), math('x^2'), text(' b')]), 'a $x^2$ b');
});

test('each kind of step is one of three: something to read, a question to answer, a question answered', async t => {
  const { capture, record } = await harness(t);
  const modeOf = async payload => { await capture(payload); return voiceMode(await record()); };
  assert.equal((await modeOf(tutorial)).mode, 'learn');
  assert.equal((await modeOf(example)).mode, 'learn');
  assert.equal((await modeOf(question(false))).mode, 'prereq', 'only the more basic knowledge, before the answer');
  const done = await modeOf(question(true));
  assert.equal(done.mode, 'answered'); assert.equal(done.key, `answered:${QUESTION_KEY}`);
  assert.equal(voiceMode(null), null);
});

test('what was taken out is gone: blocks, hiding and writing, the key step, the variants', async t => {
  const { capture, api } = await harness(t);
  await capture(question(true));
  for (const path of ['/api/prepare', '/api/command', '/api/check', '/api/say', '/api/variant', '/api/variant/lesson', '/api/variant/check', '/api/variant/hint', '/api/variant/next']) {
    assert.equal((await api(path, { key: QUESTION_KEY })).status, 404, path);
  }
  const rec = await record(api);
  assert.equal(rec.prep, undefined); assert.equal(rec.progress, undefined); assert.equal(rec.say, undefined);
});
async function record(api) { return (await api('/api/state')).body.record; }

test('only the step being followed can be changed', async t => {
  const { capture, api, record } = await harness(t);
  await capture(example);
  await capture(question(false));
  assert.equal((await api('/api/prereq', { key: EXAMPLE_KEY })).status, 409);
  assert.equal((await api('/api/chat', { key: EXAMPLE_KEY, text: '这一步是什么意思？' })).status, 409);
  assert.equal((await api('/api/translate', { key: EXAMPLE_KEY })).status, 409);
  await capture({ page: 'quiz', task: '99', topic: '1' });
  const { body } = await api('/api/state');
  assert.equal(body.current.page, 'quiz');
  assert.equal(body.record, null);
  void record;
});

test('records made by older versions keep their translation, and what else they held is left where it was', () => {
  const store = new Store(':memory:');
  const sections = { explanation: [[text('Multiply.')]] };
  store.putStep({ key: '1-e2', task: '1', step: { id: 'e2', type: 'example', index: 0, total: 1 }, title: 'E', sections, hash: 'oldsha', text_hash: 'oldtext',
    updated_at: 'x', prep: { status: 'running', hash: 'oldsha' }, translation: { status: 'ready', hash: 'oldtext' },
    progress: { index: 0, phase: 'learn', inputs: [] }, say: { attempts: [] }, voice: [] });
  const rec = new Board(store).record('1-e2');
  assert.equal(rec.hash, fingerprint(sections));
  assert.equal(rec.translation.hash, textFingerprint(sections));
  assert.equal(rec.translation.status, 'ready');
  assert.equal(rec.prep.status, 'running', 'no longer looked at, and not touched');
});

test('the built-in example can be tried without Math Academy', async t => {
  const { api } = await harness(t);
  const { body } = await api('/api/demo', {});
  assert.equal(body.current.key, '0-e1');
  assert.equal(body.record.step.type, 'example');
  assert.equal(body.record.sections.explanation.length, 6);
  assert.ok(body.record.sections.explanation.flat().filter(p => p.t === 'math').every(p => p.mml.startsWith('<math')));
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
    const reply = await api('/api/prereq', { key: EXAMPLE_KEY });
    assert.equal(reply.body.record.prereq.status, 'running');
    let last;
    do { last = await pushed(); } while (last.record.prereq?.status !== 'ready');
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

test('TeX a model wrote with its backslashes eaten by JSON is put back in the list and the conversation', async t => {
  // What arrives when a model writes \frac, \neq and \theta with one backslash each and the reply parses.
  const eaten = tex => tex.replace(/\\frac/g, '\frac').replace(/\\neq/g, '\neq').replace(/\\theta/g, '\theta');
  const infer = async (packet, opts) => {
    if (opts.purpose === 'prereq') return { model: 'fake', value: { items: [{ kind: 'formula', name: eaten('分式 $\\frac{a}{b}$'), note: eaten('当 $a\\neq b$，角 $\\theta$') }] } };
    if (opts.purpose === 'chat') return { model: 'fake', value: { reply: eaten('这里 $\\frac{1}{2}\\neq 0$') } };
    throw new Error('unexpected');
  };
  const { capture, api, record } = await harness(t, infer);
  await capture(example);
  await api('/api/prereq', { key: EXAMPLE_KEY }); await settle();
  const item = (await record()).prereq.items[0];
  assert.equal(item.name, '分式 $\\frac{a}{b}$'); assert.equal(item.note, '当 $a\\neq b$，角 $\\theta$');
  await api('/api/chat', { key: EXAMPLE_KEY, text: '为什么？' }); await settle();
  assert.equal((await record()).chat.messages[1].text, '这里 $\\frac{1}{2}\\neq 0$');
});

test('the list of prerequisites is offered on every kind of step, and counted only before an answer', async t => {
  const { capture, api, record, calls } = await harness(t);
  await capture(question(false));
  const asked = await api('/api/prereq', { key: QUESTION_KEY });
  assert.equal(asked.status, 200); assert.equal(asked.body.record.prereq.status, 'running');
  await settle();
  const list = (await record()).prereq;
  assert.equal(list.status, 'ready'); assert.equal(list.items[0].name, '概率'); assert.equal(list.views, 1);
  assert.match(calls[0].packet.题目, /pocket contains 4 quarters/, 'a question: the question and its choices');
  assert.equal(calls[0].packet.内容, undefined);
  const opened = await api('/api/prereq/expand', { key: QUESTION_KEY, item: list.items[0].id });
  assert.equal(opened.status, 200); assert.equal(opened.body.record.prereq.items[0].more.status, 'running');
  await settle();
  assert.equal((await record()).prereq.items[0].more.example, '抛硬币，正面的概率是 1/2。');
  assert.deepEqual(Object.keys(calls.at(-1).packet).sort(), ['知识点'], 'an item opened up before the answer is shown nothing of the question');
  assert.equal((await record()).prereq.expands, 1);
  // The answer goes in on Math Academy: the list is still there, and asking again is no longer counted.
  await capture(question(true));
  assert.equal((await api('/api/prereq', { key: QUESTION_KEY })).status, 200);
  assert.equal((await api('/api/prereq/expand', { key: QUESTION_KEY, item: list.items[0].id })).status, 200);
  const after = (await record()).prereq;
  assert.equal(after.views, 1); assert.equal(after.expands, 1);
  // A tutorial or a worked example has one too, made from its own text.
  await capture(example);
  assert.equal((await api('/api/prereq', { key: EXAMPLE_KEY })).status, 200); await settle();
  const own = calls.filter(c => c.purpose === 'prereq').at(-1);
  assert.match(own.packet.内容, /product of trials and probability/); assert.equal(own.packet.类型, '例题');
  assert.match(own.opts.instructions, /读 Math Academy 上的一段英文数学讲解或例题/);
  assert.equal((await record()).prereq.views ?? 0, 0, 'nothing to count on a step that is not a question');
  await capture(tutorial);
  assert.equal((await api('/api/prereq', { key: '13061309-t10001' })).status, 200);
});

test('the conversation is offered on every kind of step, and before an answer the tutor never sees the question', async t => {
  const { capture, api, record, calls } = await harness(t);
  const sent = async (key, text) => { const r = await api('/api/chat', { key, text }); await settle(); return r; };
  // A worked example: its whole text.
  await capture(example);
  assert.equal((await sent(EXAMPLE_KEY, '这一步为什么要乘？')).status, 200);
  let asked = calls.filter(c => c.purpose === 'chat').at(-1);
  assert.match(asked.packet.这一步的原文, /product of trials and probability/); assert.match(asked.packet.例题, /bag contains/);
  assert.match(asked.opts.instructions, /读 Math Academy 上的一段英文数学讲解或例题/);
  // A question not yet answered: not the question, not the choices, and nothing of an answer; only what is basic.
  await capture(question(false));
  await api('/api/prereq', { key: QUESTION_KEY }); await settle();
  assert.equal((await sent(QUESTION_KEY, '概率是什么意思？')).status, 200);
  asked = calls.filter(c => c.purpose === 'chat').at(-1);
  const seen = JSON.stringify(asked.packet);
  assert.ok(!seen.includes('pocket contains') && !seen.includes('thirty coins') && !seen.includes('Multiply 50'), 'the tutor is shown nothing of the question');
  assert.deepEqual(Object.keys(asked.packet).sort(), ['他现在问', '前置知识清单', '状态'].sort().concat(asked.packet.这节课在教 ? ['这节课在教'] : []).sort());
  assert.match(asked.packet.前置知识清单[0], /概率/);
  assert.match(asked.opts.instructions, /看不到他在做的题/);
  // Even when he pastes the question and asks for the answer, the tutor was built not to know it.
  await sent(QUESTION_KEY, 'A pocket contains 4 quarters… 选哪个？');
  assert.equal((await record()).chat.messages.length, 4);
  // Answered: from here the working may be talked through.
  await capture(question(true));
  assert.equal((await sent(QUESTION_KEY, '为什么是乘 3/5？')).status, 200);
  asked = calls.filter(c => c.purpose === 'chat').at(-1);
  assert.equal(asked.packet.结果, 'Correct'); assert.match(asked.packet.官方讲解, /Multiply 50 by 3\/5/); assert.match(asked.packet.题目, /pocket contains 4 quarters/);
  assert.equal(asked.packet.之前的对话.length, 4, 'what was said before the answer is still there');
  assert.match(asked.opts.instructions, /已经交了答案/);
  assert.equal((await api('/api/chat/retry', { key: QUESTION_KEY })).status, 409, 'nothing failed');
});

// A review page as the extension sends it: the practice question being asked, and nothing else of the page.
const review = answered => ({ page: 'review', task: '4455', topic: '7222', url: 'https://www.mathacademy.com/tasks/4455/topics/7222/review',
  step: { id: 'q987654', type: 'question', index: 0, total: 1 }, title: 'Question 1',
  sections: { question: [[text('A pocket contains 4 quarters…')]], choices: [{ letter: 'a', content: [[text('thirty coins in all')]], picked: true }],
    ...(answered ? { result: 'Correct', explanation: [[text('Multiply 50 by 3/5.')]] } : {}) } });
const REVIEW_KEY = '4455-q987654';

test('quizzes, diagnostics and assessments are not read at all', async t => {
  const { capture, api } = await harness(t);
  for (const page of ['quiz', 'diagnostic', 'assessment', 'multistep', 'other-kind']) {
    await capture({ page, task: '9', topic: '9', step: { id: 'q1', type: 'question', index: 0, total: 1 }, title: 'secret title',
      sections: { question: [[text('secret question')]], choices: [{ letter: 'a', content: [[text('secret choice')]], picked: true }], result: 'Correct' } });
    const { body } = await api('/api/state');
    assert.equal(body.current.page, page); assert.equal(body.current.key, null); assert.equal(body.record, null, page);
    assert.ok(!JSON.stringify(body).includes('secret'), `nothing of a ${page} page is kept`);
  }
  assert.deepEqual(normalize({ page: 'quiz', task: '1', topic: '2', step: { id: 'q1' }, sections: { question: [[text('x')]] } }), { page: 'quiz', task: '1', topic: '2' });
});

test('a review is read like a practice question, and only ever as one', async t => {
  const { capture, api, record } = await harness(t);
  assert.equal((await capture(review(false))).status, 200);
  const { body } = await api('/api/state');
  assert.equal(body.current.page, 'review'); assert.equal(body.current.key, REVIEW_KEY);
  assert.equal(body.record.step.type, 'question'); assert.match(body.record.sections.question[0][0].v, /pocket contains/);
  assert.equal(voiceMode(await record()).mode, 'prereq', 'not answered yet: only the more basic knowledge');
  // A review page that shows anything but a practice question yields no step.
  await capture({ ...review(false), step: { id: 'e5', type: 'example', index: 0, total: 1 } });
  const other = (await api('/api/state')).body;
  assert.equal(other.current.page, 'review'); assert.equal(other.current.key, null); assert.equal(other.record, null);
  await capture({ ...review(false), step: null });
  assert.equal((await api('/api/state')).body.record, null, 'a review still loading has no step yet');
  assert.throws(() => normalize({ page: 'review', topic: '2', step: { id: 'q1', type: 'question' }, sections: {} }), 'a review without its task is refused');
});

test('in a review the same line holds: before the answer only basic knowledge, after it the whole question', async t => {
  const { capture, api, record, calls } = await harness(t);
  await capture(review(false));
  assert.equal((await api('/api/prereq', { key: REVIEW_KEY })).status, 200); await settle();
  const list = (await record()).prereq;
  assert.equal(list.status, 'ready'); assert.equal(list.views, 1, 'an ask made before the answer is counted, in a review too');
  assert.match(calls.find(c => c.purpose === 'prereq').packet.题目, /pocket contains 4 quarters/);
  assert.equal((await api('/api/prereq/expand', { key: REVIEW_KEY, item: list.items[0].id })).status, 200); await settle();
  assert.deepEqual(Object.keys(calls.findLast(c => c.purpose === 'prereq_expand').packet).sort(), ['知识点'], 'an item opened up is shown nothing of the question');
  assert.equal((await api('/api/chat', { key: REVIEW_KEY, text: '概率是什么意思？' })).status, 200); await settle();
  const before = JSON.stringify(calls.findLast(c => c.purpose === 'chat').packet);
  assert.ok(!before.includes('pocket contains') && !before.includes('thirty coins') && !before.includes('Multiply 50'), 'the tutor is shown nothing of the question');
  await capture(review(true));
  assert.equal(voiceMode(await record()).mode, 'answered');
  assert.equal((await api('/api/chat', { key: REVIEW_KEY, text: '为什么乘 3/5？' })).status, 200); await settle();
  const after = calls.findLast(c => c.purpose === 'chat').packet;
  assert.equal(after.结果, 'Correct'); assert.match(after.官方讲解, /Multiply 50 by 3\/5/); assert.match(after.题目, /pocket contains 4 quarters/);
  // The next question is another step, on its own.
  await capture({ ...review(false), step: { id: 'q987655', type: 'question', index: 0, total: 1 }, sections: { question: [[text('A second review question.')]] } });
  assert.equal((await record()).key, '4455-q987655'); assert.equal((await record()).chat, undefined);
});

