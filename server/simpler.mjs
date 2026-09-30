import { check, fields } from './validation.mjs';
import { textJSON, textError, textConfigured, textKeyMissing } from './llm.mjs';
import { prompt, cut } from './teach.mjs';
import { lessonTitles } from './board.mjs';
import { contextOf } from './voice.mjs';
import { isContent, answered } from '../web/mode.js';

// 更简单的解释: what Math Academy wrote, told again for someone who knows less, and again, and again. The tutorial or
// example on screen, or, once a practice question is answered, its official explanation. The model is shown what the
// conversation is shown for that kind of step (see chat.mjs) and the telling so far; the learner's own copy of Math
// Academy's words is never replaced, this is written beside it.
//
// A practice question NOT yet answered has none: its own words are the one thing the tutor must not be handed before
// the answer, however it is asked, so this is refused here from the record, not left to the page.
const MAX_VERSIONS = 3;
const PROMPTS = { step: 'simpler-step', answered: 'simpler-answered' };
export const SIMPLER_SCHEMA = { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } };
export const simplerMode = rec => isContent(rec) ? 'step' : answered(rec) ? 'answered' : null;

export function simplerPacket(rec, lesson, versions) {
  const context = simplerMode(rec) === 'answered' ? contextOf(rec, { mode: 'answered' }) : contextOf(rec, { mode: 'learn' }, lesson);
  return { ...context, ...(versions.length ? { 现在的讲法: versions.at(-1) } : {}), 已经变简单过几次: versions.length };
}

export class Simplers {
  constructor(board, cfg, infer = (packet, opts) => textJSON(packet, cfg, opts)) {
    this.board = board; this.cfg = cfg; this.infer = infer;
    // A call cut off by a restart is never replayed; it is marked so it can be asked for again.
    for (const rec of board.store.steps()) {
      if (rec.simpler?.status === 'running') { rec.simpler = { ...rec.simpler, status: 'error', error: '服务重启，写这一段中断了，可以重试。' }; board.store.putStep(rec); }
    }
  }
  // The next simpler telling of the step on screen: the one already made after the one shown, else a new one.
  simpler(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key), mode = simplerMode(rec);
    check(mode, '交答案之前，这道题不能讲。', 409);
    // What was written for other words, or for the step before it was answered, is not kept.
    let s = rec.simpler;
    if (!s || s.hash !== rec.text_hash || s.mode !== mode) s = rec.simpler = { hash: rec.text_hash, mode, versions: [], at: -1, status: 'idle', limit: MAX_VERSIONS };
    if (s.status === 'running') return this.board.save(rec);
    if (s.at < s.versions.length - 1) { s.at++; return this.board.save(rec); }
    check(s.versions.length < MAX_VERSIONS, '已经是最简单的一版了。还不明白的话，问问陪练。', 409);
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    const started = crypto.randomUUID();
    Object.assign(s, { status: 'running', id: started, error: undefined });
    this.board.save(rec);
    const packet = simplerPacket(rec, lessonTitles(this.board.store, rec), s.versions);
    Promise.resolve().then(async () => {
      const { value, model } = await this.infer(packet, { instructions: prompt(PROMPTS[mode]), schema: SIMPLER_SCHEMA, purpose: `simpler_${mode}`, key: rec.key, tokens: 4096, limit: 12000 });
      const text = cut(value?.text, 3000);
      check(text, 'Invalid model response');
      const latest = this.board.record(rec.key), held = latest?.simpler;
      if (held?.id !== started || held.status !== 'running') return;
      // The new telling is shown at once unless the learner has gone back to an earlier one meanwhile.
      const shown = held.at === held.versions.length - 1;
      latest.simpler = { ...held, versions: [...held.versions, text], at: shown ? held.versions.length : held.at, status: 'idle', id: undefined, model };
      this.board.save(latest);
    }).catch(error => {
      const latest = this.board.record(rec.key);
      if (latest?.simpler?.id === started && latest.simpler.status === 'running') { latest.simpler = { ...latest.simpler, status: 'error', error: textError(error, this.cfg), id: undefined }; this.board.save(latest); }
    });
    return rec;
  }
  // Back to the telling before, from those already made.
  back(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key), s = rec.simpler;
    check(s?.hash === rec.text_hash && s.at > 0, '已经是第一种讲法了。', 409);
    s.at--;
    return this.board.save(rec);
  }
}
