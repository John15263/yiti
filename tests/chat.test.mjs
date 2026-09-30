import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Board, pushChat, MAX_CHAT } from '../server/board.mjs';
import { Chats, chatPacket, chatMode } from '../server/chat.mjs';
import '../server/prompts-node.mjs';

const text = v => ({ t: 'text', v });
const settle = () => new Promise(r => setTimeout(r, 20));
const example = { page: 'lesson', task: '9', topic: '1', step: { id: 'e1', type: 'example', index: 0, total: 3 }, title: 'Example: Adding Fractions',
  sections: { question: [[text('Add one half and one third.')]], explanation: [[text('Use a common denominator of six.')], [text('So the sum is five sixths.')]] } };
const question = (answered, choices = ['five sixths', 'two fifths']) => ({ page: 'lesson', task: '9', topic: '1', step: { id: 'q1', type: 'question', index: 1, total: 3 }, title: 'Question 1',
  sections: { question: [[text('What is one half plus one third?')]], choices: choices.map((c, i) => ({ letter: 'ab'[i], content: [[text(c)]], picked: i === 0 })),
    ...(answered ? { result: 'Correct', explanation: [[text('Use a common denominator of six.')]] } : {}) } });
const QUESTION = '9-q1', EXAMPLE = '9-e1';

function setup(reply = { reply: '因为要先通分。' }, { key = 'k', calls = [] } = {}) {
  const store = new Store(':memory:'), board = new Board(store);
  const infer = async (packet, opts) => { calls.push({ packet, opts }); const r = typeof reply === 'function' ? reply(calls.length) : reply; if (r instanceof Error) throw r; return { model: 'fake', value: r }; };
  return { store, board, calls, chats: new Chats(board, { geminiKey: key }, infer) };
}
const chat = (board, key) => board.record(key).chat;

test('a worked example is talked through with its whole text, turn after turn', async () => {
  const { board, chats, calls } = setup(n => ({ reply: `回答 ${n}` }));
  board.capture(example);
  assert.equal(chatMode(board.record(EXAMPLE)), 'content');
  const rec = chats.send({ key: EXAMPLE, text: '  为什么要通分？ ' });
  assert.equal(rec.chat.status, 'running');
  assert.deepEqual(rec.chat.messages.map(m => [m.role, m.text]), [['user', '为什么要通分？']]);
  await settle();
  assert.equal(chat(board, EXAMPLE).status, 'idle');
  assert.deepEqual(chat(board, EXAMPLE).messages.map(m => [m.role, m.text]), [['user', '为什么要通分？'], ['assistant', '回答 1']]);
  const first = calls[0].packet;
  assert.match(first.例题, /one half and one third/); assert.match(first.这一步的原文, /common denominator of six[\s\S]*five sixths/);
  assert.equal(first.他现在问, '为什么要通分？'); assert.equal(first.之前的对话, undefined);
  assert.equal(calls[0].opts.purpose, 'chat'); assert.match(calls[0].opts.instructions, /读 Math Academy 上的一段英文数学讲解或例题/);
  chats.send({ key: EXAMPLE, text: '那分母不同就一定要通分吗？' }); await settle();
  assert.deepEqual(calls[1].packet.之前的对话, [{ 他: '为什么要通分？' }, { 陪练: '回答 1' }]);
  assert.equal(chat(board, EXAMPLE).messages.length, 4);
});

test('a question already answered may be talked through in full', async () => {
  const { board, chats, calls } = setup();
  board.capture(question(true));
  assert.equal(chatMode(board.record(QUESTION)), 'answered');
  chats.send({ key: QUESTION, text: '为什么选 a？' }); await settle();
  const packet = calls[0].packet;
  assert.match(packet.题目, /one half plus one third/); assert.equal(packet.结果, 'Correct'); assert.match(packet.官方讲解, /common denominator/);
  assert.match(packet.选项[0], /five sixths.*他选的/);
  assert.match(calls[0].opts.instructions, /已经交了答案/);
});

test('before the answer the tutor is never shown the question, its choices or anything of an answer', async () => {
  const { board, chats, calls } = setup();
  board.capture(example); board.capture(question(false));
  assert.equal(chatMode(board.record(QUESTION)), 'prereq');
  chats.send({ key: QUESTION, text: '通分是什么？' }); await settle();
  const first = calls[0], seen = JSON.stringify(first.packet);
  for (const secret of ['one half plus one third', 'five sixths', 'two fifths', 'Correct', 'common denominator']) assert.ok(!seen.includes(secret), `the tutor must not see: ${secret}`);
  assert.deepEqual(Object.keys(first.packet).sort(), ['他现在问', '状态', '这节课在教'].sort());
  assert.deepEqual(first.packet.这节课在教, ['Example: Adding Fractions']);
  assert.match(first.opts.instructions, /看不到他在做的题/);
  // The prerequisite list, once there is one, is what it is shown of the step; and what he types is his own.
  const rec = board.record(QUESTION);
  rec.prereq = { status: 'ready', items: [{ id: 'i1', kind: 'method', name: '通分', note: '把分母化成一样。' }] }; board.save(rec);
  chats.send({ key: QUESTION, text: 'What is one half plus one third? 选哪个？' }); await settle();
  assert.deepEqual(calls[1].packet.前置知识清单, ['基础方法：通分（把分母化成一样。）']);
  assert.equal(calls[1].packet.他现在问, 'What is one half plus one third? 选哪个？');
  assert.ok(!JSON.stringify({ ...calls[1].packet, 他现在问: '', 之前的对话: [] }).includes('one half plus one third'), 'and still nothing from the step itself');
});

test('what was said before the answer stays in the conversation once it is answered', async () => {
  const { board, chats, calls } = setup();
  board.capture(question(false));
  chats.send({ key: QUESTION, text: '通分是什么？' }); await settle();
  board.capture(question(true));
  assert.equal(chatMode(board.record(QUESTION)), 'answered');
  chats.send({ key: QUESTION, text: '这道题为什么乘 3/5？' }); await settle();
  assert.deepEqual(calls[1].packet.之前的对话, [{ 他: '通分是什么？' }, { 陪练: '因为要先通分。' }]);
  assert.match(calls[1].opts.instructions, /已经交了答案/);
});

test('only the last twelve turns before the question are sent, and only sixty are kept', async () => {
  const { board, chats, calls } = setup();
  board.capture(example);
  const rec = board.record(EXAMPLE);
  for (let i = 0; i < 30; i++) pushChat(rec, { role: i % 2 ? 'assistant' : 'user', text: `第${i}句` });
  board.save(rec);
  chats.send({ key: EXAMPLE, text: '现在的问题' }); await settle();
  assert.equal(calls[0].packet.之前的对话.length, 12);
  assert.deepEqual(calls[0].packet.之前的对话.at(-1), { 陪练: '第29句' });
  const many = board.record(EXAMPLE);
  for (let i = 0; i < 80; i++) pushChat(many, { role: 'user', text: `多${i}` });
  assert.equal(many.chat.messages.length, MAX_CHAT); assert.equal(many.chat.messages.at(-1).text, '多79');
});

test('one reply at a time, only the step being followed, and a refusal adds nothing', async () => {
  const { board, chats, calls } = setup();
  board.capture(example);
  assert.throws(() => chats.send({ key: EXAMPLE, text: '' }), 'empty');
  assert.throws(() => chats.send({ key: EXAMPLE, text: 'x'.repeat(1001) }), 'too long');
  assert.throws(() => chats.send({ key: EXAMPLE, text: 'hi', extra: 1 }));
  assert.throws(() => chats.send({ key: 'other-step', text: 'hi' }), e => e.status === 409, 'only the step being followed');
  chats.send({ key: EXAMPLE, text: '第一个问题' });
  assert.throws(() => chats.send({ key: EXAMPLE, text: '第二个问题' }), e => e.status === 409, 'the reply is still being made');
  await settle();
  assert.deepEqual(chat(board, EXAMPLE).messages.map(m => m.text), ['第一个问题', '因为要先通分。']);
  assert.equal(calls.length, 1);
  assert.equal(chatMode({ step: { type: 'other' }, sections: {} }), null, 'a step of no known kind has no conversation');
});

test('a failed reply keeps the question and can be asked for again', async () => {
  const { board, chats, calls } = setup(n => n === 1 ? new Error('Gemini HTTP 429') : { reply: '好的，再讲一遍。' });
  board.capture(question(true));
  assert.throws(() => chats.retry({ key: QUESTION }), e => e.status === 409, 'nothing to retry yet');
  chats.send({ key: QUESTION, text: '讲一遍' }); await settle();
  assert.equal(chat(board, QUESTION).status, 'error'); assert.match(chat(board, QUESTION).error, /Gemini/);
  assert.deepEqual(chat(board, QUESTION).messages.map(m => m.role), ['user']);
  chats.retry({ key: QUESTION }); await settle();
  assert.equal(chat(board, QUESTION).status, 'idle'); assert.equal(calls.length, 2);
  assert.deepEqual(chat(board, QUESTION).messages.map(m => m.text), ['讲一遍', '好的，再讲一遍。']);
  assert.throws(() => chats.retry({ key: QUESTION }), e => e.status === 409, 'the last word is the tutor\'s');
});

test('TeX in a reply has its backslashes put back, an empty reply is an error, and a restart marks a reply being made', async () => {
  const { store, board, chats } = setup({ reply: '通分：$\frac{1}{2}+\frac{1}{3}=\frac{5}{6}$，其中 $a\neq 0$' });
  board.capture(example); chats.send({ key: EXAMPLE, text: '怎么算' }); await settle();
  assert.equal(chat(board, EXAMPLE).messages[1].text, '通分：$\\frac{1}{2}+\\frac{1}{3}=\\frac{5}{6}$，其中 $a\\neq 0$');
  const empty = setup({ reply: '   ' });
  empty.board.capture(example); empty.chats.send({ key: EXAMPLE, text: '怎么算' }); await settle();
  assert.equal(chat(empty.board, EXAMPLE).status, 'error');
  const rec = board.record(EXAMPLE); rec.chat.status = 'running'; store.putStep(rec);
  new Chats(board, { geminiKey: 'k' }, async () => { throw new Error('never'); });
  assert.equal(chat(board, EXAMPLE).status, 'error'); assert.match(chat(board, EXAMPLE).error, /重启/);
});

test('nothing is asked without a text key, and then nothing is added either', () => {
  const bare = setup({ reply: 'x' }, { key: '' });
  bare.board.capture(example);
  assert.throws(() => bare.chats.send({ key: EXAMPLE, text: '你好' }), e => e.status === 503);
  assert.equal(bare.board.record(EXAMPLE).chat, undefined);
  assert.equal(bare.calls.length, 0);
  void chatPacket;
});
