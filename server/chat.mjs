import { check, fields, text } from './validation.mjs';
import { textJSON, textError, textConfigured, textKeyMissing } from './llm.mjs';
import { prompt, cut } from './teach.mjs';
import { pushChat } from './board.mjs';
import { contextOf } from './voice.mjs';

// 追问: once a question is answered on Math Academy, the learner may go on asking about it in words, as many
// turns as they like. Nothing here is scored, and this is the one place a question's working may be talked
// through in full: the answer is in, so Math Academy already has what it needs from the learner alone. Before
// the answer, only the prerequisite list is offered (prereq.mjs). A question typed where the key step is meant
// to go lands here too (teach.mjs, "intent"). The design is the same as the voice tutor's "say" mode.
const now = () => new Date().toISOString();
const HISTORY = 12;
export const CHAT_SCHEMA = { type: 'object', additionalProperties: false, required: ['reply'], properties: { reply: { type: 'string' } } };
export const answered = rec => rec?.step?.type === 'question' && !!rec.sections?.result;

// What the model is shown: the same context the voice tutor gets after an answer, the last turns of the
// conversation so far, and what was just said.
export function chatPacket(rec) {
  const messages = rec.chat.messages, last = messages.at(-1);
  const before = messages.slice(0, -1).slice(-HISTORY).map(m => ({ [m.role === 'user' ? '他' : '陪练']: m.text }));
  return { ...contextOf(rec, { mode: 'say' }), ...(before.length ? { 之前的对话: before } : {}), 他现在问: last.text };
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
    check(answered(rec), '交了答案之后才能追问。', 409);
    check(rec.chat?.status !== 'running', '正在回答上一个问题，稍等。', 409);
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    pushChat(rec, { role: 'user', text: body.text.trim() });
    return this.reply(rec);
  }
  // The last thing the learner said, asked again after the reply failed.
  retry(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key);
    check(answered(rec), '交了答案之后才能追问。', 409);
    check(rec.chat?.status === 'error' && rec.chat.messages.at(-1)?.role === 'user', '没有需要重试的问题。', 409);
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    return this.reply(rec);
  }
  reply(rec) {
    const started = crypto.randomUUID();
    rec.chat = { ...rec.chat, status: 'running', reply_id: started, error: undefined };
    this.board.save(rec);
    const packet = chatPacket(rec);
    Promise.resolve().then(async () => {
      const { value, model } = await this.infer(packet, { instructions: prompt('chat'), schema: CHAT_SCHEMA, purpose: 'chat', key: rec.key, tokens: 4096, limit: 12000 });
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
