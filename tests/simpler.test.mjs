import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Board } from '../server/board.mjs';
import { Simplers, simplerMode } from '../server/simpler.mjs';
import '../server/prompts-node.mjs';

const text = v => ({ t: 'text', v });
const settle = () => new Promise(r => setTimeout(r, 20));
const tutorial = { page: 'lesson', task: '9', topic: '1', step: { id: 't1', type: 'tutorial', index: 0, total: 4 }, title: 'Complements',
  sections: { body: [[text('The complement of an event is the event that it does not happen.')], [text('So P(not A) = 1 - P(A).')]] } };
const example = { page: 'lesson', task: '9', topic: '1', step: { id: 'e1', type: 'example', index: 1, total: 4 }, title: 'Example: A Die',
  sections: { question: [[text('A die is rolled. What is the chance of not rolling a 6?')]], explanation: [[text('The complement of rolling a 6 has probability 5/6.')]] } };
const question = (result, extra = {}) => ({ page: 'lesson', task: '9', topic: '1', step: { id: 'q1', type: 'question', index: 2, total: 4 }, title: 'Question 1',
  sections: { question: [[text('What is one half plus one third?')]], choices: [{ letter: 'a', content: [[text('one fifth')]], picked: true }, { letter: 'b', content: [[text('five sixths')]], picked: false }],
    ...(result ? { result, explanation: [[text('Use a common denominator: five sixths.')]] } : {}), ...extra } });
const simple = n => `更简单的讲法 ${n}\n\n第二段 $\\frac{1}{2}$`;

function setup(reply, { key = 'k', calls = [] } = {}) {
  const store = new Store(':memory:'), board = new Board(store);
  const infer = async (packet, opts) => { calls.push({ packet, opts }); const r = typeof reply === 'function' ? reply(calls.length) : reply; if (r instanceof Error) throw r; return { model: 'fake', value: { text: r } }; };
  return { store, board, calls, simplers: new Simplers(board, { geminiKey: key }, infer) };
}
const held = (board, key) => board.record(key).simpler;

test('which steps can be told more simply is read from the record: not a question before its answer', () => {
  const { board } = setup(simple);
  for (const c of [tutorial, example, question(''), question('Correct')]) board.capture(c);
  assert.equal(simplerMode(board.record('9-t1')), 'step'); assert.equal(simplerMode(board.record('9-e1')), 'step');
  assert.equal(simplerMode(board.record('9-q1')), 'answered');
  board.capture({ ...question(''), step: { id: 'q2', type: 'question', index: 3, total: 4 } });
  assert.equal(simplerMode(board.record('9-q2')), null);
  assert.equal(simplerMode(null), null);
});

test('a question not yet answered is refused, and the model is never called', async () => {
  const { board, simplers, calls } = setup(simple);
  board.capture(question(''));
  assert.throws(() => simplers.simpler({ key: '9-q1' }), e => e.status === 409);
  assert.throws(() => simplers.back({ key: '9-q1' }), e => e.status === 409);
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(board.record('9-q1').simpler, undefined);
  board.capture(tutorial);   // another step is on screen now: the question is not the one asked about
  assert.throws(() => simplers.simpler({ key: '9-q1' }), e => e.status === 409);
});

test('a tutorial is told again from its own text, and the next telling starts from the one just read', async () => {
  const { board, simplers, calls } = setup(simple);
  board.capture(tutorial);
  simplers.simpler({ key: '9-t1' });
  assert.equal(held(board, '9-t1').status, 'running');
  await settle();
  const first = calls[0];
  assert.match(first.packet.这一步的原文, /complement of an event/);
  assert.equal(first.packet.现在的讲法, undefined); assert.equal(first.packet.已经变简单过几次, 0);
  assert.equal(first.opts.purpose, 'simpler_step');
  assert.match(first.opts.instructions, /相关基础知识更少的人/);
  assert.deepEqual(held(board, '9-t1').versions, [simple(1)]); assert.equal(held(board, '9-t1').at, 0); assert.equal(held(board, '9-t1').status, 'idle');
  simplers.simpler({ key: '9-t1' }); await settle();
  assert.equal(calls[1].packet.现在的讲法, simple(1)); assert.equal(calls[1].packet.已经变简单过几次, 1);
  assert.equal(held(board, '9-t1').at, 1); assert.equal(held(board, '9-t1').versions.length, 2);
});

test('an example brings its question, and an answered question its choices, result and official explanation', async () => {
  const { board, simplers, calls } = setup(simple);
  board.capture(example); simplers.simpler({ key: '9-e1' }); await settle();
  assert.match(calls[0].packet.例题, /not rolling a 6/); assert.match(calls[0].packet.这一步的原文, /5\/6/);
  board.capture(question('Incorrect')); simplers.simpler({ key: '9-q1' }); await settle();
  const { packet, opts } = calls[1];
  assert.equal(opts.purpose, 'simpler_answered'); assert.match(opts.instructions, /官方讲解/);
  assert.match(packet.题目, /one half plus one third/); assert.match(packet.选项[0], /他选的/); assert.equal(packet.结果, 'Incorrect');
  assert.match(packet.官方讲解, /common denominator/);
});

test('the tellings can be walked back and forth without a call, and there are three at most', async () => {
  const { board, simplers, calls } = setup(simple);
  board.capture(tutorial);
  for (let i = 0; i < 3; i++) { simplers.simpler({ key: '9-t1' }); await settle(); }
  assert.equal(calls.length, 3); assert.equal(held(board, '9-t1').limit, 3);
  assert.throws(() => simplers.simpler({ key: '9-t1' }), e => e.status === 409 && /最简单/.test(e.message));
  simplers.back({ key: '9-t1' }); simplers.back({ key: '9-t1' }); assert.equal(held(board, '9-t1').at, 0);
  assert.throws(() => simplers.back({ key: '9-t1' }), e => e.status === 409);
  simplers.simpler({ key: '9-t1' }); assert.equal(held(board, '9-t1').at, 1);
  assert.equal(calls.length, 3, 'tellings already made are shown again, not made again');
});

test('a failed telling keeps the ones made and can be asked for again; nothing is asked twice at once; a key is needed', async () => {
  const { board, simplers, calls } = setup(n => n === 2 ? new Error('Gemini HTTP 429') : simple(n));
  board.capture(tutorial);
  simplers.simpler({ key: '9-t1' }); simplers.simpler({ key: '9-t1' }); await settle();
  assert.equal(calls.length, 1, 'a second ask while one is being written is not another call');
  simplers.simpler({ key: '9-t1' }); await settle();
  assert.equal(held(board, '9-t1').status, 'error'); assert.match(held(board, '9-t1').error, /Gemini/);
  assert.equal(held(board, '9-t1').versions.length, 1);
  simplers.simpler({ key: '9-t1' }); await settle();
  assert.equal(held(board, '9-t1').status, 'idle'); assert.equal(held(board, '9-t1').versions.length, 2);
  const bare = setup(simple, { key: '' }); bare.board.capture(tutorial);
  assert.throws(() => bare.simplers.simpler({ key: '9-t1' }), e => e.status === 503);
  assert.throws(() => simplers.simpler({ key: '9-t1', extra: 1 }));
});

test('tellings written for other words are not kept, TeX is put back, and a restart marks one being written', async () => {
  const { store, board, simplers, calls } = setup(n => n === 1 ? 'x $\frac{a}{b}$ y' : simple(n));
  board.capture(tutorial); simplers.simpler({ key: '9-t1' }); await settle();
  assert.equal(held(board, '9-t1').versions[0], 'x $\\frac{a}{b}$ y', 'a backslash JSON turned into a control character is put back');
  board.capture({ ...tutorial, sections: { body: [[text('A different text altogether.')]] } });
  simplers.simpler({ key: '9-t1' }); await settle();
  assert.deepEqual(held(board, '9-t1').versions, [simple(2)], 'the old telling belonged to the old words');
  assert.equal(calls[1].packet.现在的讲法, undefined);
  const rec = board.record('9-t1'); rec.simpler = { ...rec.simpler, status: 'running', id: 'x' }; store.putStep(rec);
  new Simplers(board, { geminiKey: 'k' }, async () => { throw new Error('unused'); });
  assert.equal(held(board, '9-t1').status, 'error'); assert.match(held(board, '9-t1').error, /重启/);
});
