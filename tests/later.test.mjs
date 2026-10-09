import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Board } from '../server/board.mjs';
import { Laters, laterOf } from '../server/later.mjs';
import '../server/prompts-node.mjs';

const text = v => ({ t: 'text', v });
const settle = () => new Promise(r => setTimeout(r, 20));
const tutorial = { page: 'lesson', task: '9', topic: '1', step: { id: 't1', type: 'tutorial', index: 0, total: 3 }, title: 'Quadratic Functions',
  sections: { body: [[text('A quadratic function has the form ax^2+bx+c.')]] } };
const question = answered => ({ page: 'lesson', task: '9', topic: '1', step: { id: 'q1', type: 'question', index: 1, total: 3 }, title: 'Question 1',
  sections: { question: [[text('Find the vertex of y = x^2 - 4x.')]], choices: [{ letter: 'a', content: [[text('(2, -4)')]], picked: answered }],
    ...(answered ? { result: 'Correct', explanation: [[text('Complete the square.')]] } : {}) } });
const review = answered => ({ ...question(answered), page: 'review', task: '77', step: { id: 'q5', type: 'question', index: 0, total: 0 } });
const good = {
  apply: [
    { layer: 'magic', modules: '最小二乘法', problem: '从有误差的测量里找出真实规律', real: '卫星轨道就是这样定的', distance: 'college' },
    { layer: 'near', modules: '二次函数的最值', problem: '周长固定时让面积最大', real: '用 20 米篱笆围一块最大的菜地', distance: 'soon' },
    { layer: 'near', modules: '最值', problem: '另一个身边的问题', real: '投篮', distance: 'later' },
    { layer: 'near', modules: '最值', problem: '第三个身边的问题', real: '跳远', distance: 'later' },
    { layer: 'mid', modules: '抛物线运动', problem: '算落点', real: '喷泉', distance: 'bogus' },
  ],
  higher: [{ chain: '二次函数 → 二次型', solves: '判断曲面是碗形还是马鞍形', distance: 'college' }],
};

function setup(reply, calls = []) {
  const store = new Store(':memory:'), board = new Board(store);
  const infer = async (packet, opts) => { calls.push({ packet, opts }); const r = typeof reply === 'function' ? reply(opts) : reply; if (r instanceof Error) throw r; return { model: 'fake', value: r }; };
  return { store, board, calls, laters: new Laters(board, { geminiKey: 'k' }, infer) };
}

test('the list keeps layers in order, at most two to a layer, and drops an entry with an unknown distance', () => {
  const made = laterOf(good);
  assert.deepEqual(made.apply.map(a => a.layer), ['near', 'near', 'magic'], 'a mid entry with a bad distance is gone; a third near one too');
  assert.equal(made.higher.length, 1);
  assert.equal(laterOf({ apply: [], higher: [] }), null, 'an empty list is no list');
  assert.equal(laterOf({ apply: [{ layer: 'near', modules: 'x', problem: '', real: 'y', distance: 'soon' }], higher: [] }), null);
});

test('it is one list per lesson: made from the lesson\'s tutorials and examples only, and shown again on its other steps without a call', async () => {
  const { board, laters, calls } = setup(good);
  board.capture(tutorial);
  laters.start({ key: '9-t1' }); await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].packet, { 这节课在教: ['Quadratic Functions'], 这节课的讲解摘录: ['Quadratic Functions：A quadratic function has the form ax^2+bx+c.'] },
    'nothing but what the lesson teaches: its titles and the start of each tutorial');
  assert.equal(calls[0].opts.purpose, 'later');
  assert.equal(laters.of(board.record('9-t1')).status, 'ready');
  board.capture(question(true));
  const shared = laters.start({ key: '9-q1' });
  assert.equal(shared.status, 'ready'); assert.equal(calls.length, 1, 'the lesson\'s list is reused');
  assert.ok(!JSON.stringify(calls).includes('vertex'), 'a question is never sent while the lesson has titles');
});

test('a practice question not yet answered has none, and is refused, even when the lesson has a list', async () => {
  const { board, laters, calls } = setup(good);
  board.capture(tutorial); laters.start({ key: '9-t1' }); await settle();
  board.capture(question(false));
  assert.equal(laters.of(board.record('9-q1')), null, 'nothing is handed to the page');
  assert.throws(() => laters.start({ key: '9-q1' }), e => e.status === 409);
  const item = laters.of(board.record('9-t1'))?.apply?.[0];
  assert.throws(() => laters.expand({ key: '9-q1', item: item?.id || crypto.randomUUID() }), e => e.status === 409);
  assert.equal(calls.length, 1);
});

test('a review question, once answered, gets a list of its own made from it', async () => {
  const { board, laters, calls } = setup(good);
  board.capture(review(false));
  assert.throws(() => laters.start({ key: '77-q5' }), e => e.status === 409);
  board.capture(review(true));
  laters.start({ key: '77-q5' }); await settle();
  assert.match(calls[0].packet.这道题, /vertex/); assert.match(calls[0].packet.官方讲解, /Complete the square/);
  assert.equal(laters.of(board.record('77-q5')).status, 'ready');
});

test('an entry opened up is shown the entry and the lesson, and is kept for the other steps', async () => {
  const { board, laters, calls } = setup(opts => opts.purpose === 'later' ? good : { explain: '篱笆长度固定……', example: '20 米篱笆，围成 5×5 的正方形，面积 25。' });
  board.capture(tutorial); laters.start({ key: '9-t1' }); await settle();
  const list = laters.of(board.record('9-t1')), item = list.apply[0];
  laters.expand({ key: '9-t1', item: item.id }); await settle();
  assert.deepEqual(Object.keys(calls[1].packet).sort(), ['条目', '这节课在教', '这节课的讲解摘录'].sort());
  assert.equal(calls[1].packet.条目.部分, '工程化与现实应用 · 身边');
  assert.equal(calls[1].opts.purpose, 'later_expand');
  board.capture(question(true));
  const seen = laters.of(board.record('9-q1')).apply[0].more;
  assert.equal(seen.status, 'ready'); assert.match(seen.versions[seen.at].example, /25/);
  laters.expand({ key: '9-q1', item: item.id });
  assert.equal(calls.length, 2, 'opened once, shown again');
});

test('a failure can be tried again, and work cut off by a restart is shown as cut off', async () => {
  const store = new Store(':memory:'), board = new Board(store), calls = [];
  const laters = new Laters(board, { geminiKey: 'k' }, async () => { calls.push(1); return new Promise(() => {}); });
  board.capture(tutorial); laters.start({ key: '9-t1' });
  assert.equal(laters.of(board.record('9-t1')).status, 'running');
  const after = new Board(store), again = new Laters(after, { geminiKey: 'k' }, async () => ({ model: 'fake', value: good }));
  assert.equal(again.of(after.record('9-t1')).status, 'error', 'the engine that was making it is gone');
  again.start({ key: '9-t1' }); await settle();
  assert.equal(again.of(after.record('9-t1')).status, 'ready');
  const none = new Laters(after, { geminiKey: '' }, async () => ({}));
  after.capture({ ...tutorial, task: '10' });
  assert.throws(() => none.start({ key: '10-t1' }), e => e.status === 503);
});

test('a list made by an earlier version is made again, and the learner can ask for it anew', async () => {
  const { store, board, laters, calls } = setup(good);
  board.capture(tutorial);
  store.set('later:task:9', { status: 'ready', apply: [], higher: [] });   // made before there was a place
  assert.equal(laters.of(board.record('9-t1')), null, 'an old list counts as none');
  laters.start({ key: '9-t1' }); await settle();
  assert.equal(calls.length, 1); assert.equal(laters.of(board.record('9-t1')).v, 2);
  laters.start({ key: '9-t1' }); assert.equal(calls.length, 1);
  laters.start({ key: '9-t1', again: true }); await settle();
  assert.equal(calls.length, 2, 'made anew on request');
  assert.throws(() => laters.start({ key: '9-t1', again: true, extra: 1 }), e => e.status === 400);
});

test('the lesson is known by the start of each tutorial and example, kept short, and never by a question', async () => {
  const { board, laters, calls } = setup(good);
  const long = 'Introduction to null spaces. '.repeat(60);
  board.capture({ ...tutorial, title: 'Introduction', sections: { body: [[text(long)]] } });
  board.capture({ ...tutorial, step: { id: 'e2', type: 'example', index: 1, total: 3 }, title: 'Example: Null Space',
    sections: { question: [[text('Is v in the null space?')]], explanation: [[text('Multiply A by v.')]] } });
  board.capture(question(true));
  laters.start({ key: '9-q1' }); await settle();
  const [first, second] = calls[0].packet.这节课的讲解摘录;
  assert.match(first, /^Introduction：Introduction to null spaces/); assert.ok(first.length < 520);
  assert.equal(second, 'Example: Null Space：Multiply A by v.');
  assert.ok(!JSON.stringify(calls[0].packet).includes('vertex'));
});

const told = n => ({ explain: `更简单的讲法 ${n}`, example: `例子 ${n}` });
function kit() {
  return setup((opts, n) => opts.purpose === 'later' ? good : opts.purpose === 'later_uses' ? { uses: [{ what: '判断曲面形状', how: '从顶点式一路推广' }, { what: '', how: 'x' }] }
    : opts.purpose === 'later_simpler' ? (opts.schema.required.includes('uses') ? { uses: [{ what: '更简单的用途', how: '更简单的联系' }] } : told(Math.random())) : { explain: '讲法 1', example: '例 1' });
}

test('an opened entry can be told more simply, up to three times, and walked back, all through the shared engine', async () => {
  const { board, laters, calls } = kit();
  board.capture(tutorial); laters.start({ key: '9-t1' }); await settle();
  const item = laters.of(board.record('9-t1')).apply[0], at = () => laters.of(board.record('9-t1')).apply[0].more;
  assert.throws(() => laters.simpler({ key: '9-t1', item: item.id }), e => e.status === 409, 'not opened yet');
  laters.expand({ key: '9-t1', item: item.id }); await settle();
  assert.deepEqual(at().versions, [{ explain: '讲法 1', example: '例 1' }]);
  laters.simpler({ key: '9-t1', item: item.id });
  assert.equal(at().simplifying.status, 'running');
  await settle();
  const ask = calls.at(-1);
  assert.equal(ask.opts.purpose, 'later_simpler'); assert.match(ask.opts.instructions, /基础更少/);
  assert.deepEqual(ask.packet.现在的讲法, { explain: '讲法 1', example: '例 1' }); assert.equal(ask.packet.已经变简单过几次, 0);
  assert.equal(ask.packet.讲的是什么.条目.部分, '工程化与现实应用 · 身边');
  assert.equal(at().at, 1); assert.equal(at().versions.length, 2); assert.equal(at().simplifying, undefined);
  for (let i = 0; i < 2; i++) { laters.simpler({ key: '9-t1', item: item.id }); await settle(); }
  assert.throws(() => laters.simpler({ key: '9-t1', item: item.id }), e => e.status === 409 && /最简单/.test(e.message));
  laters.back({ key: '9-t1', item: item.id }); assert.equal(at().at, 2);
  laters.simpler({ key: '9-t1', item: item.id }); assert.equal(at().at, 3, 'one already made is shown again without a call');
  assert.equal(calls.filter(c => c.opts.purpose === 'later_simpler').length, 3);
});

test('a way up says what that mathematics is used for, one level only, and that can be told more simply too', async () => {
  const { board, laters, calls } = kit();
  board.capture(tutorial); laters.start({ key: '9-t1' }); await settle();
  const list = laters.of(board.record('9-t1')), up = list.higher[0], near = list.apply[0];
  assert.throws(() => laters.expand({ key: '9-t1', item: near.id, part: 'uses' }), e => e.status === 400, 'only a way up has uses');
  assert.throws(() => laters.expand({ key: '9-t1', item: up.id, part: 'nonsense' }), e => e.status === 400);
  laters.expand({ key: '9-t1', item: up.id, part: 'uses' }); await settle();
  const ask = calls.find(c => c.opts.purpose === 'later_uses');
  assert.equal(ask.packet.条目.怎么往上走, '二次函数 → 二次型'); assert.match(ask.opts.instructions, /只写一层/);
  const uses = () => laters.of(board.record('9-t1')).higher[0].uses;
  assert.deepEqual(uses().versions[0], { uses: [{ what: '判断曲面形状', how: '从顶点式一路推广' }] }, 'an empty use is dropped');
  laters.simpler({ key: '9-t1', item: up.id, part: 'uses' }); await settle();
  assert.deepEqual(uses().versions[1], { uses: [{ what: '更简单的用途', how: '更简单的联系' }] });
  assert.equal(laters.of(board.record('9-t1')).higher[0].more, undefined, 'opening uses does not open the entry');
});

test('an entry opened by the earlier version keeps its telling as the first, and work cut off by a restart is marked', async () => {
  const { store, board, laters } = kit();
  board.capture(tutorial); laters.start({ key: '9-t1' }); await settle();
  const list = store.get('later:task:9');
  list.apply[0].more = { status: 'ready', model: 'old', explain: '旧的讲法', example: '旧的例子' };
  list.higher[0].more = { status: 'ready', versions: [told(1)], at: 0, limit: 4, simplifying: { status: 'running', id: 'x', boot: 'gone' } };
  store.set('later:task:9', list);
  const seen = laters.of(board.record('9-t1'));
  assert.deepEqual(seen.apply[0].more.versions, [{ explain: '旧的讲法', example: '旧的例子' }]); assert.equal(seen.apply[0].more.at, 0);
  assert.equal(seen.higher[0].more.simplifying.status, 'error');
});
