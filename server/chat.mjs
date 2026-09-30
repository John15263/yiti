import { check, fields, text } from './validation.mjs';
import { textJSON, textError, textConfigured, textKeyMissing } from './llm.mjs';
import { prompt, cut } from './teach.mjs';
import { pushChat, lessonTitles } from './board.mjs';
import { contextOf } from './voice.mjs';
import { isContent, answered, unanswered } from '../web/mode.js';

// 问一问: the learner may ask about the step on screen at any time, in words, as many turns as they like. Nothing
// here is scored. What the tutor is shown, and told, depends on the step, and is decided here from the record, never
// by the page:
//   content  — a tutorial or a worked example: its whole text; anything about it may be explained in full.
//   answered — a practice question already answered on Math Academy: the question, the choices, the result and the
//              official explanation; from here its working may be talked through in full, because the answer is in
//              and Math Academy already has what it needs from the learner alone.
//   prereq   — a practice question NOT yet answered: the tutor is not shown the question at all, only the
//              prerequisite list (if there is one) and what the lesson teaches, so it can explain basic knowledge
//              and cannot lean towards this question's working, however it is asked.
const HISTORY = 12;
export const CHAT_SCHEMA = { type: 'object', additionalProperties: false, required: ['reply'], properties: { reply: { type: 'string' } } };
export const chatMode = rec => isContent(rec) ? 'content' : answered(rec) ? 'answered' : unanswered(rec) ? 'prereq' : null;
const PROMPTS = { content: 'chat-step', answered: 'chat', prereq: 'chat-prereq' };
const KIND_NAMES = { concept: '基础概念', method: '基础方法', formula: '基础公式' };

// What the model is shown: the context for this kind of step, the last turns of the conversation so far, and what
// was just said.
export function chatPacket(rec, lesson = []) {
  const messages = rec.chat.messages, last = messages.at(-1), mode = chatMode(rec);
  const before = messages.slice(0, -1).slice(-HISTORY).map(m => ({ [m.role === 'user' ? '他' : '陪练']: m.text }));
  const items = rec.prereq?.status === 'ready' ? rec.prereq.items.map(i => `${KIND_NAMES[i.kind]}：${i.name}（${i.note}）`) : [];
  const context = mode === 'prereq' ? { 状态: '他还没交答案；你看不到他在做的题', ...(items.length ? { 前置知识清单: items } : {}), ...(lesson.length ? { 这节课在教: lesson } : {}) }
    : mode === 'answered' ? contextOf(rec, { mode: 'answered' })
    : contextOf(rec, { mode: 'learn' }, lesson);
  return { ...context, ...(before.length ? { 之前的对话: before } : {}), 他现在问: last.text };
}

export class Chats {
  constructor(board, cfg, infer = (packet, opts) => textJSON(packet, cfg, opts)) {
    this.board = board; this.cfg = cfg; this.infer = infer;
    // A reply cut off by a restart is never replayed; it is marked so it can be asked for again.
    for (const rec of board.store.steps()) {
      if (rec.chat?.status === 'running') { rec.chat = { ...rec.chat, status: 'error', error: '服务重启，回答中断了，可以重试。' }; board.store.putStep(rec); }
    }
  }
  send(body) {
    fields(body, ['key', 'text'], ['key', 'text']); text(body.text, 1000);
    const rec = this.board.active(body.key);
    check(chatMode(rec), '这一步现在不能问。', 409);
    check(rec.chat?.status !== 'running', '正在回答上一个问题，稍等。', 409);
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    pushChat(rec, { role: 'user', text: body.text.trim() });
    return this.reply(rec);
  }
  // The last thing the learner said, asked again after the reply failed.
  retry(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key);
    check(chatMode(rec), '这一步现在不能问。', 409);
    check(rec.chat?.status === 'error' && rec.chat.messages.at(-1)?.role === 'user', '没有需要重试的问题。', 409);
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    return this.reply(rec);
  }
  reply(rec) {
    const started = crypto.randomUUID(), mode = chatMode(rec);
    rec.chat = { ...rec.chat, status: 'running', reply_id: started, error: undefined };
    this.board.save(rec);
    const packet = chatPacket(rec, lessonTitles(this.board.store, rec));
    Promise.resolve().then(async () => {
      const { value, model } = await this.infer(packet, { instructions: prompt(PROMPTS[mode]), schema: CHAT_SCHEMA, purpose: 'chat', key: rec.key, tokens: 4096, limit: 12000 });
      const reply = cut(value?.reply, 3000);
      check(reply, 'Invalid model response');
      const latest = this.board.record(rec.key);
      if (latest?.chat?.reply_id !== started || latest.chat.status !== 'running') return;
      pushChat(latest, { role: 'assistant', text: reply, model });
      latest.chat = { ...latest.chat, status: 'idle', reply_id: undefined };
      this.board.save(latest);
    }).catch(error => {
      const latest = this.board.record(rec.key);
      if (latest?.chat?.reply_id === started && latest.chat.status === 'running') {
        latest.chat = { ...latest.chat, status: 'error', error: textError(error, this.cfg), reply_id: undefined };
        this.board.save(latest);
      }
    });
    return rec;
  }
}
