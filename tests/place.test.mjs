import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Board } from '../server/board.mjs';
import { Places, placeOf } from '../server/place.mjs';
import { Prereqs } from '../server/prereq.mjs';
import { Laters } from '../server/later.mjs';
import '../server/prompts-node.mjs';

const text = v => ({ t: 'text', v });
const settle = () => new Promise(r => setTimeout(r, 30));
const tutorial = { page: 'lesson', task: '9', topic: '1', step: { id: 't1', type: 'tutorial', index: 0, total: 3 }, title: 'Quadratic Functions',
  sections: { body: [[text('A quadratic function has the form ax^2+bx+c.')]] } };
const question = answered => ({ page: 'lesson', task: '9', topic: '1', step: { id: 'q1', type: 'question', index: 1, total: 3 }, title: 'Question 1',
  sections: { question: [[text('Find the vertex of y = x^2 - 4x.')]], choices: [{ letter: 'a', content: [[text('(2, -4)')]], picked: answered }],
    ...(answered ? { result: 'Correct', explanation: [[text('Complete the square.')]] } : {}) } });
const review = answered => ({ ...question(answered), page: 'review', task: '77', step: { id: 'q5', type: 'question', index: 0, total: 0 } });
const PLACE = { subject: '代数', module: '二次函数（Quadratic Functions）', stage: 'high', summary: '把二次函数写成顶点式，读出最高点或最低点。', module_note: '研究最简单的弯曲变化。', before: ['一次函数', '一次函数', '因式分解'] };
const ITEMS = { items: [{ kind: 'concept', name: '函数', note: '一个输入对应一个输出。' }] };
const LATER = { apply: [{ layer: 'near', modules: '最值', problem: '周长固定时面积最大', real: '围菜地', distance: 'soon' }], higher: [] };

function setup(place = PLACE) {
  const store = new Store(':memory:'), board = new Board(store), calls = [];
  const infer = async (packet, opts) => {
    calls.push({ packet, opts }); await new Promise(r => setTimeout(r, 5));
    const value = { place, prereq: ITEMS, later: LATER }[opts.purpose];
    if (value instanceof Error) throw value;
    return { model: 'fake', value };
  };
  const cfg = { geminiKey: 'k' }, places = new Places(board, cfg, infer);
  return { store, board, calls, places, prereqs: new Prereqs(board, cfg, infer, places), laters: new Laters(board, cfg, infer, places) };
}
const of = (calls, purpose) => calls.filter(c => c.opts.purpose === purpose);

test('a place keeps known stages only, no repeated earlier modules, and needs a subject, a module and a summary', () => {
  assert.deepEqual(placeOf(PLACE).before, ['一次函数', '因式分解']);
  assert.equal(placeOf({ ...PLACE, stage: 'kindergarten' }).stage, '');
  assert.equal(placeOf({ ...PLACE, summary: '' }), null);
});

test('the place is made first, from the lesson\'s titles only, once, and handed to both lists', async () => {
  const { board, calls, places, prereqs, laters } = setup();
  board.capture(tutorial); board.capture(question(false));
  assert.deepEqual(places.of(board.record('9-q1')), { status: 'none' }, 'offered on a lesson question, made from titles');
  prereqs.start({ key: '9-q1' }); await settle();
  assert.deepEqual(calls.map(c => c.opts.purpose), ['place', 'prereq']);
  assert.deepEqual(Object.keys(of(calls, 'place')[0].packet).sort(), ['这节课在教', '这节课的讲解摘录'].sort());
  assert.ok(!JSON.stringify(of(calls, 'place')[0].packet).includes('vertex'), 'never the question');
  assert.equal(of(calls, 'prereq')[0].packet.这节课的定位.模块, '二次函数（Quadratic Functions）');
  assert.equal(of(calls, 'prereq')[0].packet.这节课的定位.学段, '高中');
  assert.equal(of(calls, 'prereq')[0].packet.复习题, undefined, 'a lesson\'s question is not a review');
  assert.equal(places.of(board.record('9-q1')).status, 'ready');
  board.capture(question(true));
  laters.start({ key: '9-q1' }); await settle();
  assert.equal(of(calls, 'place').length, 1, 'made once for the lesson');
  const packet = of(calls, 'later')[0].packet;
  assert.equal(packet.这节课的定位.科目, '代数');
  assert.deepEqual(packet.前置知识参考, ['函数'], 'the lesson\'s 前置知识 so far, by name');
});

test('two lists asked for at once wait for the same place', async () => {
  const { board, calls, prereqs, laters } = setup();
  board.capture(tutorial);
  prereqs.start({ key: '9-t1' }); laters.start({ key: '9-t1' }); await settle();
  assert.equal(of(calls, 'place').length, 1);
  assert.ok(of(calls, 'prereq')[0].packet.这节课的定位 && of(calls, 'later')[0].packet.这节课的定位);
  assert.deepEqual(of(calls, 'later')[0].packet.前置知识参考 ?? [], [], 'a list not yet made is not waited for');
});

test('a review question has no place before it is answered: its 前置知识 is made without one', async () => {
  const { board, calls, places, prereqs } = setup();
  board.capture(review(false));
  assert.equal(places.of(board.record('77-q5')), null);
  assert.throws(() => places.start({ key: '77-q5' }), e => e.status === 409);
  prereqs.start({ key: '77-q5' }); await settle();
  assert.deepEqual(calls.map(c => c.opts.purpose), ['prereq']);
  assert.equal(calls[0].packet.这节课的定位, undefined);
  board.capture(review(true));
  places.start({ key: '77-q5' }); await settle();
  assert.match(of(calls, 'place')[0].packet.这道题, /vertex/);
  assert.equal(places.of(board.record('77-q5')).status, 'ready');
});

test('a place that fails does not hold up the list, and can be asked for again; one cut off by a restart says so', async () => {
  const { store, board, calls, places, prereqs } = setup(new Error('boom'));
  board.capture(tutorial);
  prereqs.start({ key: '9-t1' }); await settle();
  assert.equal(board.record('9-t1').prereq.status, 'ready');
  assert.equal(of(calls, 'prereq')[0].packet.这节课的定位, undefined);
  assert.equal(places.of(board.record('9-t1')).status, 'error');
  const hung = new Places(board, { geminiKey: 'k' }, () => new Promise(() => {}));
  hung.start({ key: '9-t1' });
  assert.equal(hung.of(board.record('9-t1')).status, 'running');
  const after = new Board(store);
  assert.equal(new Places(after, { geminiKey: 'k' }).of(after.record('9-t1')).status, 'error');
});

test('a review borrows its topic\'s lesson: as 这节课在教 for 前置知识 before the answer, and its place and list only after', async () => {
  const { board, calls, places, prereqs, laters } = setup();
  board.capture(tutorial);                                          // the lesson on topic 1, task 9, followed earlier
  const onTopic = answered => ({ ...review(answered), topic: '1' }); // a review of the same topic, task 77
  board.capture(onTopic(false));
  assert.equal(places.of(board.record('77-q5')), null, 'before the answer the module is not named');
  assert.equal(laters.of(board.record('77-q5')), null);
  prereqs.start({ key: '77-q5' }); await settle();
  assert.deepEqual(calls.map(c => c.opts.purpose), ['prereq'], 'no place is made for it before the answer');
  assert.deepEqual(of(calls, 'prereq')[0].packet.这节课在教, ['Quadratic Functions'], 'what the topic taught is not a prerequisite');
  assert.equal(of(calls, 'prereq')[0].packet.复习题, true, 'the model is told it is a review');
  board.capture(onTopic(true));
  laters.start({ key: '77-q5' }); await settle();
  assert.deepEqual(of(calls, 'place')[0].packet.这节课在教, ['Quadratic Functions'], 'the place is the lesson\'s, made from its titles');
  assert.ok(!JSON.stringify(of(calls, 'later')[0].packet).includes('vertex'), 'not from the question');
  assert.equal(places.of(board.record('77-q5')).status, 'ready');
  // The lesson and the review share one list.
  board.capture(tutorial);
  assert.equal(laters.of(board.record('9-t1')).status, 'ready');
  laters.start({ key: '9-t1' }); assert.equal(of(calls, 'later').length, 1);
});

test('the answers of a task already done are followed like a question answered, and can borrow their topic\'s lesson', async () => {
  const { board, places, laters } = setup();
  board.capture(tutorial);
  const answers = { page: 'answers', task: '55', topic: '1', step: { id: 'q123', type: 'question', index: 2, total: 5 }, title: '3',
    sections: { question: [[text('Find the vertex of y = x^2 - 4x.')]], choices: [], answer: '(2, -4)', result: 'Correct', explanation: [[text('Complete the square.')]] } };
  assert.equal(board.capture(answers).key, '55-q123');
  assert.equal(board.record('55-q123').page, 'answers');
  assert.equal(places.of(board.record('55-q123')).status, 'none', 'answered, so its lesson\'s place is offered');
  assert.equal(laters.of(board.record('55-q123')), null, 'not made yet');
  assert.equal(board.capture({ ...answers, step: { id: 't9', type: 'tutorial', index: 0, total: 1 } }).key, null, 'only questions come from there');
  assert.equal(board.capture({ page: 'learn' }).key, null);
  assert.equal(board.current().page, 'learn');
});

test('a topic\'s own page is followed like a lesson\'s tutorials and examples, and a later review of it can borrow it', async () => {
  const { board, places, laters, calls } = setup();
  const page = (id, type, index, title, sections) => ({ page: 'topic', task: '620', topic: '620', step: { id, type, index, total: 2 }, title, sections });
  assert.equal(board.capture(page('t0', 'tutorial', 0, 'Introduction', { body: [[text('The derivative is a rate of change.')]] })).key, '620-t0');
  assert.equal(board.capture(page('e1', 'example', 1, 'Example: Rates', { question: [[text('A tank fills...')]], explanation: [[text('Differentiate.')]] })).key, '620-e1');
  assert.equal(board.capture(page('q2', 'question', 2, 'Question', { question: [[text('?')]] })).key, null, 'no questions come from there');
  board.capture(page('e1', 'example', 1, 'Example: Rates', { question: [[text('A tank fills...')]], explanation: [[text('Differentiate.')]] }));
  assert.deepEqual(places.of(board.record('620-e1')), { status: 'none' });
  laters.start({ key: '620-e1' }); await settle();
  assert.deepEqual(of(calls, 'later')[0].packet.这节课在教, ['Introduction', 'Example: Rates']);
  board.capture({ ...review(true), topic: '620' });
  assert.equal(laters.of(board.record('77-q5')).status, 'ready', 'a review of the topic, once answered, shares the list');
});
