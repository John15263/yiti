import { check, fields } from './validation.mjs';
import { textJSON } from './llm.mjs';
import { simplerTelling, earlierTelling, staleTelling } from './retell.mjs';
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

export function simplerPacket(rec, lesson, versions, count = versions.length) {
  const context = simplerMode(rec) === 'answered' ? contextOf(rec, { mode: 'answered' }) : contextOf(rec, { mode: 'learn' }, lesson);
  return { ...context, ...(versions.length ? { 现在的讲法: versions.at(-1) } : {}), 已经变简单过几次: count };
}

export class Simplers {
  constructor(board, cfg, infer = (packet, opts) => textJSON(packet, cfg, opts)) {
    this.board = board; this.cfg = cfg; this.infer = infer;
    // A call cut off by a restart is never replayed; it is marked so it can be asked for again. (Older records kept it as status.)
    for (const rec of board.store.steps()) {
      const s = rec.simpler;
      if (s?.status === 'running') { delete s.status; s.simplifying = { status: 'running' }; }
      if (staleTelling(s, null, '服务重启，写这一段中断了，可以重试。')) board.store.putStep(rec);
    }
  }
  // The next simpler telling of the step on screen: the one already made after the one shown, else a new one (retell.mjs).
  simpler(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key), mode = simplerMode(rec);
    check(mode, '交答案之前，这道题不能讲。', 409);
    // What was written for other words, or for the step before it was answered, is not kept.
    if (!(rec.simpler?.hash === rec.text_hash && rec.simpler.mode === mode)) {
      rec.simpler = { hash: rec.text_hash, mode, versions: [], at: -1, limit: MAX_VERSIONS };
      this.board.save(rec);
    }
    const lesson = lessonTitles(this.board.store, rec);
    simplerTelling({ access: this.tellings(rec.key, rec.text_hash, mode), cfg: this.cfg, boot: this.board.boot, base: 0,
      call: (current, count) => this.infer(simplerPacket(rec, lesson, current ? [current] : [], count),
        { instructions: prompt(PROMPTS[mode]), schema: SIMPLER_SCHEMA, purpose: `simpler_${mode}`, key: rec.key, tokens: 4096, limit: 12000 }),
      parse: value => cut(value?.text, 3000) || null });
    return this.board.record(rec.key);
  }
  // Back to the telling before, from those already made.
  back(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key);
    earlierTelling({ access: this.tellings(rec.key, rec.text_hash, rec.simpler?.mode) });
    return this.board.record(rec.key);
  }
  // The step's tellings as they are kept now; none once its words, or whether it is answered, have changed.
  tellings(key, hash, mode) {
    return fn => {
      const rec = this.board.record(key), s = rec?.simpler;
      const fresh = s?.hash === hash && s.hash === rec.text_hash && s.mode === mode ? s : null;
      if (fresh) { delete fresh.status; delete fresh.error; delete fresh.id; }
      fn(fresh);
      if (rec) this.board.save(rec);
    };
  }
}
