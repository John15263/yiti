import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Board } from '../server/board.mjs';
import { Prereqs, itemsOf, unanswered } from '../server/prereq.mjs';
import '../server/prompts-node.mjs';

const text = v => ({ t: 'text', v });
const settle = () => new Promise(r => setTimeout(r, 20));
const example = { page: 'lesson', task: '9', topic: '1', step: { id: 'e1', type: 'example', index: 0, total: 3 }, title: 'Example: Adding Fractions',
  sections: { question: [[text('Add one half and one third.')]], explanation: [[text('Use a common denominator.')]] } };
const question = (answered, choices = []) => ({ page: 'lesson', task: '9', topic: '1', step: { id: 'q1', type: 'question', index: 1, total: 3 }, title: 'Question 1',
  sections: { question: [[text('What is one half plus one third?')]], choices: choices.map((c, i) => ({ letter: 'abcd'[i], content: [[text(c)]], picked: false })),
    ...(answered ? { result: 'Correct', explanation: [[text('Five sixths.')]] } : {}) } });
const KEY = '9-q1';
const good = [{ kind: 'formula', name: '面积 $S=ab$', note: '长方形面积。' }, { kind: 'concept', name: '分数', note: '把整体分成相等的份。' }, { kind: 'method', name: '通分', note: '把分母化成一样。' }];

function setup(reply, { key = 'k', calls = [] } = {}) {
  const store = new Store(':memory:'), board = new Board(store);
  const infer = async (packet, opts) => { calls.push({ packet, opts }); const r = typeof reply === 'function' ? reply(calls.length) : reply; if (r instanceof Error) throw r; return { model: 'fake', value: r }; };
  return { store, board, calls, prereqs: new Prereqs(board, { geminiKey: key }, infer) };
}
const status = (board, key = KEY) => board.record(key).prereq;

test('the basic knowledge a question rests on comes back grouped, concepts first, with the lesson\'s own titles sent along', async () => {
  const { board, prereqs, calls } = setup({ items: good });
  board.capture(example); board.capture(question(false, ['one fifth', 'five sixths']));
  const rec = prereqs.start({ key: KEY });
  assert.equal(rec.prereq.status, 'running');
  await settle();
  const list = status(board);
  assert.equal(list.status, 'ready');
  assert.deepEqual(list.items.map(i => i.kind), ['concept', 'method', 'formula']);
  assert.equal(list.items[2].name, '面积 $S=ab$');
  const { packet, opts } = calls[0];
  assert.deepEqual(packet.这节课在教, ['Example: Adding Fractions'], 'what the lesson teaches is not a prerequisite');
  assert.match(packet.题目, /one half plus one third/);
  assert.deepEqual(packet.选项, ['a. one fifth', 'b. five sixths']);
  assert.equal(opts.purpose, 'prereq');
  assert.match(opts.instructions, /绝不能帮他解这道题/);
});

test('a lesson step already split into blocks says what it covered, so the model can tell what is new', async () => {
  const { board, store, prereqs, calls } = setup({ items: good });
  board.capture(example);
  const e = board.record('9-e1'); e.prep = { status: 'ready', hash: e.hash, summary: '用通分把两个分数相加', blocks: [] }; store.putStep(e);
  board.capture(question(false)); prereqs.start({ key: KEY }); await settle();
  assert.deepEqual(calls[0].packet.这节课在教, ['Example: Adding Fractions：用通分把两个分数相加']);
});

test('nothing but the question, its choices and the lesson\'s titles is shown to the model', async () => {
  const { board, prereqs, calls } = setup({ items: good });
  board.capture(question(false, ['x', 'y'])); prereqs.start({ key: KEY }); await settle();
  assert.deepEqual(Object.keys(calls[0].packet).sort(), ['这一步', '选项', '题目'].sort());
  assert.ok(!JSON.stringify(calls[0].packet).includes('Correct'));
});

test('a list already made is shown again without another call, and every ask is counted', async () => {
  const { board, prereqs, calls } = setup({ items: good });
  board.capture(question(false)); prereqs.start({ key: KEY }); await settle();
  prereqs.start({ key: KEY }); prereqs.start({ key: KEY });
  assert.equal(calls.length, 1);
  assert.equal(status(board).views, 3);
  assert.equal(status(board).items.length, 3);
});

test('it is only offered before the answer, and only for a question', async () => {
  const { board, prereqs, calls } = setup({ items: good });
  board.capture(question(true));
  assert.throws(() => prereqs.start({ key: KEY }), e => e.status === 409, 'answered');
  board.capture(example);
  assert.throws(() => prereqs.start({ key: '9-e1' }), e => e.status === 409, 'an example is not a question');
  board.capture(question(false)); prereqs.start({ key: KEY }); await settle();
  board.capture(question(true));                       // the answer goes in on Math Academy
  assert.throws(() => prereqs.start({ key: KEY }), e => e.status === 409, 'the list is not offered again once answered');
  assert.equal(calls.length, 1);
  assert.equal(unanswered(board.record(KEY)), false);
  assert.throws(() => prereqs.start({ key: 'nothing-here' }), e => e.status === 409, 'only the step being followed');
});

test('an item that holds a choice as written, a repeat, or something malformed is left out', () => {
  const rec = { sections: { question: [[text('q')]], choices: [{ letter: 'a', content: [[text('five sixths')]] }, { letter: 'b', content: [[text('1')]] }] } };
  const kept = itemsOf([
    { kind: 'concept', name: '分数', note: '整体的一部分。' },
    { kind: 'concept', name: ' 分 数 ', note: '重复的一条。' },
    { kind: 'method', name: '通分', note: '结果是 five sixths。' },
    { kind: 'trick', name: '不认识的类别', note: '丢掉。' },
    { kind: 'method', name: '', note: '没有名字。' },
    { kind: 'method', name: '没有说明', note: '   ' },
    { kind: 'method', name: '约分', note: '选项 b 只有一个字符，不算泄露 1。' },
    null, 'text', { name: 'no kind' },
  ], rec);
  assert.deepEqual(kept.map(i => i.name), ['分数', '约分']);
  assert.deepEqual(itemsOf('not a list', rec), []);
});

test('the list is trimmed to six, and TeX whose backslashes JSON ate is put back', () => {
  const rec = { sections: { question: [[text('q')]] } };
  const many = Array.from({ length: 9 }, (_, i) => ({ kind: 'concept', name: `概念${i}`, note: '说明。' }));
  assert.equal(itemsOf(many, rec).length, 6);
  assert.equal(itemsOf([{ kind: 'formula', name: '分式 $\frac{a}{b}$', note: '$a\neq 0$' }], rec)[0].name, '分式 $\\frac{a}{b}$');
  assert.equal(itemsOf([{ kind: 'formula', name: '分式 $\frac{a}{b}$', note: '$a\neq 0$' }], rec)[0].note, '$a\\neq 0$');
});

test('a failed call ends as an error that can be tried again, and is not counted twice', async () => {
  const { board, prereqs, calls } = setup(n => n === 1 ? new Error('Gemini HTTP 429') : { items: good });
  board.capture(question(false)); prereqs.start({ key: KEY }); await settle();
  assert.equal(status(board).status, 'error');
  assert.match(status(board).error, /Gemini/);
  prereqs.start({ key: KEY }); await settle();
  assert.equal(calls.length, 2);
  assert.equal(status(board).status, 'ready');
  assert.equal(status(board).views, 2);
});

test('a reply with nothing usable is an error, not an empty list', async () => {
  const { board, prereqs } = setup({ items: [{ kind: 'concept', name: '', note: '' }] });
  board.capture(question(false)); prereqs.start({ key: KEY }); await settle();
  assert.equal(status(board).status, 'error');
  assert.equal(status(board).items, undefined);
});

test('a restart marks a list that was being made, and nothing is asked without a text key', async () => {
  const store = new Store(':memory:'), board = new Board(store);
  board.capture(question(false));
  const rec = board.record(KEY); rec.prereq = { status: 'running', id: 'x', views: 1 }; store.putStep(rec);
  new Prereqs(board, { geminiKey: 'k' }, async () => { throw new Error('never'); });
  assert.equal(board.record(KEY).prereq.status, 'error');
  assert.match(board.record(KEY).prereq.error, /重启/);
  const bare = setup({ items: good }, { key: '' });
  bare.board.capture(question(false));
  assert.throws(() => bare.prereqs.start({ key: KEY }), e => e.status === 503);
  assert.equal(bare.calls.length, 0);
});
