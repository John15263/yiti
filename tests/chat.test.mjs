import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.mjs';
import { Board, pushChat, MAX_CHAT } from '../server/board.mjs';
import { Chats, chatPacket } from '../server/chat.mjs';
import { keyStep } from '../server/variant.mjs';
import { voiceMode } from '../web/mode.js';
import '../server/prompts-node.mjs';

const text = v => ({ t: 'text', v });
const settle = () => new Promise(r => setTimeout(r, 20));
const question = answered => ({ page: 'lesson', task: '9', topic: '1', step: { id: 'q1', type: 'question', index: 1, total: 3 }, title: 'Question 1',
  sections: { question: [[text('What is one half plus one third?')]], choices: [{ letter: 'a', content: [[text('five sixths')]], picked: true }, { letter: 'b', content: [[text('two fifths')]], picked: false }],
    ...(answered ? { result: 'Correct', explanation: [[text('Use a common denominator of six.')]] } : {}) } });
const KEY = '9-q1';

function setup(reply = { reply: '因为要先通分。' }, { key = 'k', calls = [] } = {}) {
  const store = new Store(':memory:'), board = new Board(store);
  const infer = async (packet, opts) => { calls.push({ packet, opts }); const r = typeof reply === 'function' ? reply(calls.length) : reply; if (r instanceof Error) throw r; return { model: 'fake', value: r }; };
  return { store, board, calls, chats: new Chats(board, { geminiKey: key }, infer) };
}
const chat = (board, key = KEY) => board.record(key).chat;

test('the learner asks and the tutor answers, turn after turn, with what was said before as context', async () => {
  const { board, chats, calls } = setup(n => ({ reply: `回答 ${n}` }));
  board.capture(question(true));
  const rec = chats.send({ key: KEY, text: '  为什么要通分？ ' });
  assert.equal(rec.chat.status, 'running');
  assert.deepEqual(rec.chat.messages.map(m => [m.role, m.text]), [['user', '为什么要通分？']]);
  await settle();
  assert.equal(chat(board).status, 'idle');
  assert.deepEqual(chat(board).messages.map(m => [m.role, m.text]), [['user', '为什么要通分？'], ['assistant', '回答 1']]);
  const first = calls[0].packet;
  assert.match(first.题目, /one half plus one third/); assert.equal(first.结果, 'Correct'); assert.match(first.官方讲解, /common denominator/);
  assert.equal(first.他现在问, '为什么要通分？'); assert.equal(first.之前的对话, undefined);
  assert.match(first.选项[0], /five sixths.*他选的/);
  assert.equal(calls[0].opts.purpose, 'chat'); assert.match(calls[0].opts.instructions, /已经交了答案/);

  chats.send({ key: KEY, text: '那分母不同就一定要通分吗？' }); await settle();
  assert.deepEqual(calls[1].packet.之前的对话, [{ 他: '为什么要通分？' }, { 陪练: '回答 1' }]);
  assert.equal(calls[1].packet.他现在问, '那分母不同就一定要通分吗？');
  assert.equal(chat(board).messages.length, 4);
});

test('only the last twelve turns before the question are sent, and only sixty are kept', async () => {
  const { board, chats, calls } = setup();
  board.capture(question(true));
  const rec = board.record(KEY);
  for (let i = 0; i < 30; i++) pushChat(rec, { role: i % 2 ? 'assistant' : 'user', text: `第${i}句` });
  board.save(rec);
  chats.send({ key: KEY, text: '现在的问题' }); await settle();
  assert.equal(calls[0].packet.之前的对话.length, 12);
  assert.deepEqual(calls[0].packet.之前的对话.at(-1), { 陪练: '第29句' });
  const many = board.record(KEY);
  for (let i = 0; i < 80; i++) pushChat(many, { role: 'user', text: `多${i}` });
  assert.equal(many.chat.messages.length, MAX_CHAT); assert.equal(many.chat.messages.at(-1).text, '多79');
});

test('it is only for an answered question, one reply at a time, and a refusal adds nothing', async () => {
  const { board, chats, calls } = setup();
  board.capture(question(false));
  assert.throws(() => chats.send({ key: KEY, text: '能告诉我答案吗' }), e => e.status === 409, 'before the answer');
  assert.equal(board.record(KEY).chat, undefined);
  board.capture(question(true));
  assert.throws(() => chats.send({ key: KEY, text: '' }), 'empty');
  assert.throws(() => chats.send({ key: KEY, text: 'x'.repeat(1001) }), 'too long');
  assert.throws(() => chats.send({ key: KEY, text: 'hi', extra: 1 }));
  assert.throws(() => chats.send({ key: 'other-step', text: 'hi' }), e => e.status === 409, 'only the step being followed');
  chats.send({ key: KEY, text: '第一个问题' });
  assert.throws(() => chats.send({ key: KEY, text: '第二个问题' }), e => e.status === 409, 'the reply is still being made');
  await settle();
  assert.deepEqual(chat(board).messages.map(m => m.text), ['第一个问题', '因为要先通分。']);
  assert.equal(calls.length, 1);
});

test('a failed reply keeps the question and can be asked for again', async () => {
  const { board, chats, calls } = setup(n => n === 1 ? new Error('Gemini HTTP 429') : { reply: '好的，再讲一遍。' });
  board.capture(question(true));
  assert.throws(() => chats.retry({ key: KEY }), e => e.status === 409, 'nothing to retry yet');
  chats.send({ key: KEY, text: '讲一遍' }); await settle();
  assert.equal(chat(board).status, 'error'); assert.match(chat(board).error, /Gemini/);
  assert.deepEqual(chat(board).messages.map(m => m.role), ['user']);
  chats.retry({ key: KEY }); await settle();
  assert.equal(chat(board).status, 'idle'); assert.equal(calls.length, 2);
  assert.deepEqual(chat(board).messages.map(m => m.text), ['讲一遍', '好的，再讲一遍。']);
  assert.throws(() => chats.retry({ key: KEY }), e => e.status === 409, 'the last word is the tutor\'s');
});

test('TeX in a reply has its backslashes put back, an empty reply is an error, and a restart marks a reply being made', async () => {
  const { store, board, chats } = setup({ reply: '通分：$\frac{1}{2}+\frac{1}{3}=\frac{5}{6}$，其中 $a\neq 0$' });
  board.capture(question(true)); chats.send({ key: KEY, text: '怎么算' }); await settle();
  assert.equal(chat(board).messages[1].text, '通分：$\\frac{1}{2}+\\frac{1}{3}=\\frac{5}{6}$，其中 $a\\neq 0$');
  const empty = setup({ reply: '   ' });
  empty.board.capture(question(true)); empty.chats.send({ key: KEY, text: '怎么算' }); await settle();
  assert.equal(chat(empty.board).status, 'error');
  const rec = board.record(KEY); rec.chat.status = 'running'; store.putStep(rec);
  new Chats(board, { geminiKey: 'k' }, async () => { throw new Error('never'); });
  assert.equal(chat(board).status, 'error'); assert.match(chat(board).error, /重启/);
});

test('nothing is asked without a text key, and a question routed from the key-step box counts as the learner\'s first turn', () => {
  const bare = setup({ reply: 'x' }, { key: '' });
  bare.board.capture(question(true));
  assert.throws(() => bare.chats.send({ key: KEY, text: '你好' }), e => e.status === 503);
  assert.equal(bare.board.record(KEY).chat, undefined);
  assert.equal(bare.calls.length, 0);
});

test('a question is not the key step: the context, the voice mode and the variant ignore it', () => {
  const { board } = setup();
  board.capture(question(true));
  const rec = board.record(KEY);
  rec.say.attempts.push({ id: 'k1', text: '通分再相加', status: 'done', intent: 'key_step', score: 90, math: 'right', note: 'ok', suggestion: '先通分，再把分子相加。', changes: [] },
    { id: 'q1', text: '为什么要通分？', status: 'done', intent: 'question', score: 0, math: 'partly', note: '因为…', suggestion: '', changes: [] });
  pushChat(rec, { role: 'user', text: '为什么要通分？' });
  assert.equal(chatPacket(rec).他写的句子, '通分再相加', 'the context holds the key step, not the question');
  assert.equal(keyStep(rec), '先通分，再把分子相加。');
  assert.equal(voiceMode(rec).key, 'say:9-q1:k1', 'a question does not change the voice call\'s key');
  const onlyQuestion = { ...rec, say: { attempts: [rec.say.attempts[1]] } };
  assert.equal(keyStep(onlyQuestion), '', 'no key step yet, so no variant question');
  assert.equal(voiceMode(onlyQuestion).key, 'say:9-q1:open');
});
