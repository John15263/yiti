import { check, fields } from './validation.mjs';
import { textJSON, textError, textConfigured, textKeyMissing } from './llm.mjs';
import { parasText } from './capture.mjs';
import { prompt, cut } from './teach.mjs';
import { lessonTitles } from './board.mjs';

// 前置知识: before a practice question is answered, the more basic concepts, methods and formulas it rests on,
// listed for the learner to read. Math Academy schedules practice and reviews by the answers the learner gives
// alone, so this may never help solve the question: no working, no answer, no choice, and nothing the lesson
// itself is teaching (its own titles are sent along so the model can tell). Once the answer is in, the list is
// not offered any more. The design is the same as the voice tutor's "prereq" mode (voice.mjs).
const now = () => new Date().toISOString();
const KINDS = ['concept', 'method', 'formula'];
const MAX_ITEMS = 6;
export const PREREQ_SCHEMA = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['kind', 'name', 'note'],
  properties: { kind: { type: 'string', enum: KINDS }, name: { type: 'string' }, note: { type: 'string' } } } } } };

export const unanswered = rec => rec?.step?.type === 'question' && !rec.sections?.result;
const choicesOf = rec => (rec.sections.choices || []).map(c => `${c.letter}. ${parasText(c.content)}`);

// What the model is shown: the question and its choices as they are, and what the lesson teaches (its steps' titles,
// each with the sentence saying what it covered, once it has been split into blocks). Nothing else
// of this step, and there is nothing to show of an answer yet.
export const prereqPacket = (rec, lesson) => ({ 这一步: rec.title || '', ...(lesson.length ? { 这节课在教: lesson } : {}),
  题目: parasText(rec.sections.question), ...(choicesOf(rec).length ? { 选项: choicesOf(rec) } : {}) });

// The list as it is kept: known kinds only, no repeats, at most six, concepts first. An item that holds one of the
// choices as written would be an answer, so it is dropped.
export function itemsOf(raw, rec) {
  const choices = (rec.sections.choices || []).map(c => parasText(c.content).trim()).filter(t => t.length >= 5);
  const seen = new Set(), items = [];
  for (const it of Array.isArray(raw) ? raw : []) {
    if (!KINDS.includes(it?.kind)) continue;
    const name = cut(it.name, 80), note = cut(it.note, 200), same = name.toLowerCase().replace(/\s+/g, '');
    if (!name || !note || seen.has(same) || choices.some(c => name.includes(c) || note.includes(c))) continue;
    seen.add(same); items.push({ kind: it.kind, name, note });
  }
  return items.slice(0, MAX_ITEMS).sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
}

export class Prereqs {
  constructor(board, cfg, infer = (packet, opts) => textJSON(packet, cfg, opts)) {
    this.board = board; this.cfg = cfg; this.infer = infer;
    // A call cut off by a restart is never replayed; it is marked so it can be tried again.
    for (const rec of board.store.steps()) {
      if (rec.prereq?.status === 'running') { rec.prereq = { ...rec.prereq, status: 'error', error: '服务重启，整理前置知识中断了，可以重试。' }; board.store.putStep(rec); }
    }
  }
  // Asked for by the learner, for the question on screen. Every ask is counted (it is part of what the answer was),
  // and a list already made is shown again without a new call.
  start(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key);
    check(unanswered(rec), '前置知识只在交答案之前提供。', 409);
    check(rec.sections.question?.length, '还没有读到题目。', 409);
    const views = (rec.prereq?.views || 0) + 1;
    if (['running', 'ready'].includes(rec.prereq?.status)) { rec.prereq.views = views; return this.board.save(rec); }
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    const started = crypto.randomUUID();
    rec.prereq = { status: 'running', id: started, views, started_at: now() };
    this.board.save(rec);
    const packet = prereqPacket(rec, lessonTitles(this.board.store, rec, true));
    Promise.resolve().then(async () => {
      const { value, model } = await this.infer(packet, { instructions: prompt('prereq'), schema: PREREQ_SCHEMA, purpose: 'prereq', key: rec.key, tokens: 4096, limit: 8000 });
      check(value && typeof value === 'object', 'Invalid model response');
      const items = itemsOf(value.items, rec);
      check(items.length, 'Invalid model response');
      const latest = this.board.record(rec.key);
      if (latest?.prereq?.id !== started || latest.prereq.status !== 'running') return;
      latest.prereq = { ...latest.prereq, status: 'ready', model, items, finished_at: now() };
      this.board.save(latest);
    }).catch(error => {
      const latest = this.board.record(rec.key);
      if (latest?.prereq?.id === started && latest.prereq.status === 'running') { latest.prereq = { ...latest.prereq, status: 'error', error: textError(error, this.cfg) }; this.board.save(latest); }
    });
    return rec;
  }
}
