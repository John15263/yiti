import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Board } from '../server/board.mjs';
import { Officials } from '../server/official.mjs';
import { officialOf } from '../server/capture.mjs';
import '../server/prompts-node.mjs';

const text = v => ({ t: 'text', v });
const settle = () => new Promise(r => setTimeout(r, 20));
const LIST = [{ topic: '620', prereqs: [{ name: 'The Derivative', href: '/topics/the-derivative-12', topic: '12' }, { name: 'The Chain Rule', href: '/topics/the-chain-rule-13', topic: '13' }] }];
const tutorial = { page: 'topic', task: '620', topic: '620', step: { id: 't0', type: 'tutorial', index: 0, total: 1 }, title: 'Introduction', sections: { body: [[text('Rates.')]] }, official: LIST };
const review = answered => ({ page: 'review', task: '77', topic: '620', step: { id: 'q5', type: 'question', index: 0, total: 1 }, title: 'Question 1',
  sections: { question: [[text('Find the rate.')]], ...(answered ? { result: 'Correct', explanation: [[text('Differentiate.')]] } : {}) } });

function setup(reply = { names: ['导数', '链式法则'] }) {
  const store = new Store(':memory:'), board = new Board(store), calls = [];
  const infer = async (packet, opts) => { calls.push({ packet, opts }); return { model: 'fake', value: reply }; };
  return { store, board, calls, officials: new Officials(board, { geminiKey: 'k' }, infer) };
}

test('only names with a link to a topic page are kept, a bounded number of them', () => {
  assert.deepEqual(officialOf([{ topic: '1', prereqs: [{ name: ' A  b ', href: '/topics/a-2' }, { name: 'x', href: 'https://evil.example/' }, { name: '', href: '/topics/c-3' }] }]),
    [{ topic: '1', prereqs: [{ name: 'A b', href: '/topics/a-2', topic: null }] }]);
  assert.deepEqual(officialOf([{ topic: 'x', prereqs: [{ name: 'A', href: '/topics/a-2' }] }]), []);
  assert.deepEqual(officialOf('nonsense'), []);
});

test('a topic\'s official prerequisites are kept for it, shown in Chinese once translated (one cheap call), and linked', async () => {
  const { board, officials, calls } = setup();
  board.capture(tutorial);
  const shown = officials.of(board.record('620-t0'));
  assert.deepEqual(shown.prereqs.map(p => p.name), ['The Derivative', 'The Chain Rule']);
  assert.equal(shown.prereqs[0].zh, undefined);
  officials.translate({ key: '620-t0' }); await settle();
  assert.deepEqual(calls[0].packet, { 知识点名称: ['The Derivative', 'The Chain Rule'] });
  assert.equal(calls[0].opts.cheap, true); assert.equal(calls[0].opts.purpose, 'official_zh');
  assert.deepEqual(officials.of(board.record('620-t0')).prereqs.map(p => [p.zh, p.href]), [['导数', '/topics/the-derivative-12'], ['链式法则', '/topics/the-chain-rule-13']]);
  officials.translate({ key: '620-t0' }); assert.equal(calls.length, 1, 'names already in Chinese are not asked again');
});

test('a review of the topic shows them only once answered: before, they would say which topic it is', async () => {
  const { board, officials } = setup();
  board.capture(tutorial);
  board.capture(review(false));
  assert.equal(officials.of(board.record('77-q5')), null);
  assert.throws(() => officials.translate({ key: '77-q5' }), e => e.status === 409);
  board.capture(review(true));
  assert.equal(officials.of(board.record('77-q5')).prereqs.length, 2);
});

test('the /learn page can bring the lists of many topics at once, without a step', () => {
  const { board, store } = setup();
  board.capture({ page: 'learn', official: [...LIST, { topic: '700', prereqs: [{ name: 'Limits', href: '/topics/limits-9' }] }] });
  assert.equal(store.get('official:700').prereqs[0].name, 'Limits');
  assert.equal(store.get('official:620').prereqs.length, 2);
});

test('the model is handed them as reference for 前置知识, the place and the list, but not for a review not yet answered', async () => {
  const { Prereqs } = await import('../server/prereq.mjs');
  const { Places } = await import('../server/place.mjs');
  const { Laters } = await import('../server/later.mjs');
  const store = new Store(':memory:'), board = new Board(store), calls = [];
  const replies = { official_zh: { names: ['导数', '链式法则'] }, place: { subject: '微积分', module: '导数的应用', stage: 'high', summary: '用导数解释变化。', module_note: '研究变化。', before: ['导数'] },
    prereq: { items: [{ kind: 'concept', name: '函数', note: '输入对应输出。' }] }, later: { apply: [{ layer: 'near', modules: 'x', problem: 'y', real: 'z', distance: 'soon' }], higher: [] } };
  const infer = async (packet, opts) => { calls.push({ packet, opts }); return { model: 'fake', value: replies[opts.purpose] }; };
  const cfg = { geminiKey: 'k' }, places = new Places(board, cfg, infer), officials = new Officials(board, cfg, infer);
  const prereqs = new Prereqs(board, cfg, infer, places), laters = new Laters(board, cfg, infer, places);
  const of = purpose => calls.filter(c => c.opts.purpose === purpose).at(-1)?.packet;
  board.capture(tutorial); officials.translate({ key: '620-t0' }); await settle();
  prereqs.start({ key: '620-t0' }); await settle();
  assert.deepEqual(of('prereq')['Math Academy 官方前置'], ['导数（The Derivative）', '链式法则（The Chain Rule）']);
  assert.deepEqual(of('place')['Math Academy 官方前置'], ['导数（The Derivative）', '链式法则（The Chain Rule）']);
  laters.start({ key: '620-t0' }); await settle();
  assert.equal(of('later')['Math Academy 官方前置'].length, 2);
  board.capture(review(false)); prereqs.start({ key: '77-q5' }); await settle();
  assert.equal(of('prereq')['Math Academy 官方前置'], undefined, 'a review still to be answered is not given them');
});
