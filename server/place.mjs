import { check, fields } from './validation.mjs';
import { textJSON, textError, textConfigured, textKeyMissing } from './llm.mjs';
import { prompt, cut } from './teach.mjs';
import { lessonOf } from './board.mjs';
import { parasText } from './capture.mjs';
import { officialNames } from './official.mjs';
import { answered, learnParas } from '../web/mode.js';

// 定位: where a lesson sits in mathematics: the subject, the module, the stage it is usually learned at, what the lesson
// is about, what the module is for, and the earlier modules it builds on. Shown under the step's title, and handed to
// the model as the ground both 前置知识 and 学这个有什么用 are made from, so the two agree with each other.
//
// Like 学这个有什么用 it belongs to the lesson and is made once, from the titles of its tutorials and examples only. A
// review has no titles; there it would have to be read off the question, and naming a question's module before it is
// answered can be a hint, so a review question has none until it is answered (its 前置知识 is made without one).
const now = () => new Date().toISOString();
export const STAGES = ['primary', 'middle', 'high', 'college'];
const STAGE_NAMES = { primary: '小学', middle: '初中', high: '高中', college: '大学' };
export const PLACE_SCHEMA = { type: 'object', additionalProperties: false, required: ['subject', 'module', 'stage', 'summary', 'module_note', 'before'], properties: {
  subject: { type: 'string' }, module: { type: 'string' }, stage: { type: 'string', enum: STAGES }, summary: { type: 'string' },
  module_note: { type: 'string' }, before: { type: 'array', items: { type: 'string' } } } };

// What a lesson is known by, for the place and for 学这个有什么用: the titles of its tutorials and examples, and the start
// of what each says (a title alone is often just "Introduction"); on a review, which has none, the answered question and
// its explanation. Never a question of the lesson: its tutorials and examples are what it teaches, in the open.
const EXCERPT = 500, EXCERPTS = 2400;
export function lessonPacket(store, rec, titles) {
  if (!titles.length) return { 这道题: parasText(rec.sections.question), ...(rec.sections.explanation?.length ? { 官方讲解: parasText(rec.sections.explanation) } : {}) };
  let room = EXCERPTS;
  const { task } = lessonOf(store, rec);
  const excerpts = store.steps().filter(r => r.task === task && ['tutorial', 'example'].includes(r.step.type)).sort((a, b) => a.step.index - b.step.index)
    .flatMap(r => {
      const said = cut(parasText(learnParas(r)), Math.min(EXCERPT, room));
      if (!said || room <= 0) return [];
      room -= said.length;
      return [`${r.title || '（无标题）'}：${said}`];
    });
  return { 这节课在教: titles, ...(excerpts.length ? { 这节课的讲解摘录: excerpts } : {}) };
}

export function placeOf(value) {
  const place = { subject: cut(value?.subject, 30), module: cut(value?.module, 60), stage: STAGES.includes(value?.stage) ? value.stage : '',
    summary: cut(value?.summary, 300), module_note: cut(value?.module_note, 200),
    before: [...new Set((Array.isArray(value?.before) ? value.before : []).map(b => cut(b, 40)).filter(Boolean))].slice(0, 4) };
  return place.subject && place.module && place.summary ? place : null;
}
// What the other lists are handed: the place in words, with the stage named.
export const placeText = p => ({ 科目: p.subject, 模块: p.module, ...(p.stage ? { 学段: STAGE_NAMES[p.stage] } : {}), 这节课讲什么: p.summary,
  这个模块是做什么的: p.module_note, ...(p.before.length ? { 建立在这些更早的模块上: p.before } : {}) });

export class Places {
  constructor(board, cfg, infer = (packet, opts) => textJSON(packet, cfg, opts)) {
    this.board = board; this.cfg = cfg; this.infer = infer;
    // The place being made, per scope, so a list asked for meanwhile waits for the same call.
    this.making = new Map();
  }
  // Which place a step has: its lesson's when the lesson's titles are known; on a review, the answered question's own;
  // none otherwise.
  // A review borrows the place of its topic's lesson, but only once it is answered: before, naming the module would tell
  // which method the question wants.
  where(rec) {
    const { task, titles, own } = lessonOf(this.board.store, rec);
    if (titles.length && (own || answered(rec))) return { titles, scope: `place:task:${task}` };
    if (answered(rec) && rec.sections.question?.length) return { titles, scope: `place:step:${rec.key}` };
    return null;
  }
  load(scope) {
    const place = this.board.store.get(scope);
    if (place?.status === 'running' && place.boot !== this.board.boot) {
      const cut = { ...place, status: 'error', error: '定位中断了，可以重试。' };
      this.board.store.set(scope, cut); return cut;
    }
    return place;
  }
  // What the page is given: the place, { status: 'none' } where one may be made, nothing where none is offered.
  of(rec) {
    const at = rec?.step ? this.where(rec) : null;
    return at ? this.load(at.scope) || { status: 'none' } : null;
  }
  // The place of a step, made if need be: resolves to it, or to null when there is none (not offered, no key, or the
  // call failed; the lists are then made without it).
  ensure(rec) {
    const at = this.where(rec);
    if (!at) return Promise.resolve(null);
    const place = this.load(at.scope);
    if (place?.status === 'ready') return Promise.resolve(place);
    if (this.making.has(at.scope)) return this.making.get(at.scope);
    if (!textConfigured(this.cfg)) return Promise.resolve(null);
    const started = crypto.randomUUID();
    const put = value => { this.board.store.set(at.scope, value); this.board.publish(); };
    put({ status: 'running', id: started, boot: this.board.boot, started_at: now() });
    const made = Promise.resolve().then(async () => {
      const { value, model } = await this.infer(this.packet(rec, at.titles), { instructions: prompt('place'), schema: PLACE_SCHEMA, purpose: 'place', key: rec.key, tokens: 2048, limit: 8000 });
      const place = placeOf(value);
      check(place, 'Invalid model response');
      const ready = { status: 'ready', model, ...place, finished_at: now() };
      if (this.board.store.get(at.scope)?.id === started) put(ready);
      return ready;
    }).catch(error => {
      if (this.board.store.get(at.scope)?.id === started) put({ status: 'error', error: textError(error, this.cfg) });
      return null;
    }).finally(() => this.making.delete(at.scope));
    this.making.set(at.scope, made);
    return made;
  }
  // What the place is made from: what the lesson is known by, and Math Academy's own prerequisites of the topic.
  packet(rec, titles) {
    const official = officialNames(this.board.store, rec);
    return { ...lessonPacket(this.board.store, rec, titles), ...(official.length ? { 'Math Academy 官方前置': official } : {}) };
  }
  // Asked for from the line under the step's title.
  start(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key);
    check(this.where(rec), '交了答案之后再看这个。', 409);
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    void this.ensure(rec);
    return rec;
  }
}
