import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Board } from '../server/board.mjs';
import { Prereqs, itemsOf, moreOf } from '../server/prereq.mjs';
import { unanswered } from '../web/mode.js';
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

test('it is offered on every kind of step, and only an ask made before the answer is counted', async () => {
  const { board, prereqs, calls } = setup({ items: good });
  board.capture(example); board.capture(question(false));
  prereqs.start({ key: KEY }); await settle();
  assert.equal(status(board).views, 1);
  board.capture(question(true));                       // the answer goes in on Math Academy
  prereqs.start({ key: KEY });                         // the list is shown again, and that is not an ask made before the answer
  assert.equal(status(board).views, 1); assert.equal(calls.length, 1);
  assert.equal(unanswered(board.record(KEY)), false);
  // A worked example: made from its own text, with the lesson's other steps, and there is nothing to count.
  board.capture({ ...example, step: { ...example.step, index: 2 }, title: 'Example: Adding Thirds' });
  prereqs.start({ key: '9-e1' }); await settle();
  const own = calls.at(-1);
  assert.deepEqual(Object.keys(own.packet).sort(), ['内容', '类型', '这一步', '题目'].sort());
  assert.equal(own.packet.类型, '例题'); assert.match(own.packet.内容, /common denominator/); assert.match(own.packet.题目, /one half and one third/);
  assert.match(own.opts.instructions, /读 Math Academy 上的一段英文数学讲解或例题/);
  assert.equal(status(board, '9-e1').status, 'ready'); assert.equal(status(board, '9-e1').views, 0);
  assert.throws(() => prereqs.start({ key: 'nothing-here' }), e => e.status === 409, 'only the step being followed');
});

test('a tutorial\'s list is made from its text, and the lesson\'s other steps are named apart', async () => {
  const { board, prereqs, calls } = setup({ items: good });
  board.capture(example);
  board.capture({ page: 'lesson', task: '9', topic: '1', step: { id: 't1', type: 'tutorial', index: 1, total: 3 }, title: 'Common Denominators', sections: { body: [[text('Fractions with the same denominator add directly.')]] } });
  prereqs.start({ key: '9-t1' }); await settle();
  const { packet } = calls[0];
  assert.equal(packet.类型, '讲解'); assert.equal(packet.题目, undefined); assert.match(packet.内容, /same denominator add directly/);
  assert.deepEqual(packet.这节课的其他步骤, ['Example: Adding Fractions'], 'not its own title, which is what it teaches');
  assert.equal(status(board, '9-t1').status, 'ready');
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

// Opening up one item of the list.
const more = { explain: '把整体分成相等的份，取其中几份。', example: '一块饼分成 4 份，吃 1 份就是 $\\frac{1}{4}$。', pitfall: '分母越大，每一份越小。' };
async function listed(extra = {}) {
  const calls = [];
  const kit = setup(n => n === 1 ? { items: good } : more, { calls, ...extra });
  kit.board.capture(example); kit.board.capture(question(false, ['one fifth', 'five sixths']));
  kit.prereqs.start({ key: KEY }); await settle();
  return { ...kit, item: status(kit.board).items[0] };
}

test('an item opened up shows the model the item and what the lesson teaches, never the question', async () => {
  const { board, prereqs, calls, item } = await listed();
  assert.ok(item.id && item.kind === 'concept');
  prereqs.expand({ key: KEY, item: item.id }); assert.equal(status(board).items[0].more.status, 'running');
  await settle();
  const { packet, opts } = calls[1];
  assert.deepEqual(Object.keys(packet).sort(), ['知识点', '这节课在教'].sort());
  assert.deepEqual(packet.知识点, { 类别: '基础概念', 名称: '分数', 说明: '把整体分成相等的份。' });
  assert.ok(!JSON.stringify(packet).includes('one half') && !JSON.stringify(packet).includes('one fifth'), 'nothing of the question or its choices');
  assert.equal(opts.purpose, 'prereq_expand');
  assert.match(opts.instructions, /不讲任何具体的题怎么做/);
  const opened = status(board).items[0].more;
  assert.equal(opened.status, 'ready'); assert.equal(opened.example, more.example); assert.equal(opened.pitfall, more.pitfall);
});

test('an item already opened is shown again without another call, and every ask is counted', async () => {
  const { board, prereqs, calls, item } = await listed();
  prereqs.expand({ key: KEY, item: item.id }); await settle();
  prereqs.expand({ key: KEY, item: item.id }); prereqs.expand({ key: KEY, item: item.id });
  assert.equal(calls.length, 2, 'the list, and the one item');
  assert.equal(status(board).expands, 3);
  assert.equal(status(board).items[1].more, undefined, 'other items are untouched');
});

test('an item can only be opened from the list on screen, and after the answer it still can, uncounted', async () => {
  const { board, prereqs, item } = await listed();
  assert.throws(() => prereqs.expand({ key: KEY, item: 'not-in-the-list' }), e => e.status === 409);
  assert.throws(() => prereqs.expand({ key: KEY, item: item.id, extra: 1 }));
  prereqs.expand({ key: KEY, item: item.id }); await settle();       // before the answer: counted
  assert.equal(status(board).expands, 1);
  board.capture(question(true));                                      // the answer goes in on Math Academy
  prereqs.expand({ key: KEY, item: item.id });                        // shown again; no longer an ask made before the answer
  assert.equal(status(board).expands, 1);
  assert.equal(status(board).items[0].more.status, 'ready');
  const fresh = setup({ items: good });
  fresh.board.capture(question(false));
  assert.throws(() => fresh.prereqs.expand({ key: KEY, item: 'x' }), e => e.status === 409, 'no list yet');
});

test('a failed opening can be tried again, and a reply with no explanation is an error', async () => {
  const calls = [];
  const kit = setup(n => n === 1 ? { items: good } : n === 2 ? new Error('Gemini HTTP 429') : n === 3 ? { explain: '', example: 'x', pitfall: '' } : more, { calls });
  kit.board.capture(question(false)); kit.prereqs.start({ key: KEY }); await settle();
  const id = status(kit.board).items[0].id, first = () => status(kit.board).items[0].more;
  kit.prereqs.expand({ key: KEY, item: id }); await settle();
  assert.equal(first().status, 'error'); assert.match(first().error, /Gemini/);
  kit.prereqs.expand({ key: KEY, item: id }); await settle();
  assert.equal(first().status, 'error', 'nothing usable');
  kit.prereqs.expand({ key: KEY, item: id }); await settle();
  assert.equal(first().status, 'ready'); assert.equal(calls.length, 4);
  assert.deepEqual(moreOf({ explain: ' a ', example: 5, pitfall: null }), { explain: 'a', example: '', pitfall: '' });
  assert.equal(moreOf(null), null);
});

test('TeX in an opened item has its backslashes put back, and a restart marks one being made', async () => {
  const { store, board, prereqs, item } = await listed();
  const tex = { explain: '$\frac{a}{b}$ 是分数', example: '$1\neq 2$', pitfall: '' };
  const kit = setup(n => n === 1 ? { items: good } : tex);
  kit.board.capture(question(false)); kit.prereqs.start({ key: KEY }); await settle();
  kit.prereqs.expand({ key: KEY, item: status(kit.board).items[0].id }); await settle();
  assert.equal(status(kit.board).items[0].more.explain, '$\\frac{a}{b}$ 是分数');
  assert.equal(status(kit.board).items[0].more.example, '$1\\neq 2$');
  const rec = board.record(KEY); rec.prereq.items[0].more = { status: 'running', id: 'x' }; store.putStep(rec);
  new Prereqs(board, { geminiKey: 'k' }, async () => { throw new Error('never'); });
  assert.equal(board.record(KEY).prereq.items[0].more.status, 'error');
  assert.match(board.record(KEY).prereq.items[0].more.error, /重启/);
  void prereqs; void item;
});
