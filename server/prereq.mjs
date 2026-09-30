import { check, fields, id } from './validation.mjs';
import { textJSON, textError, textConfigured, textKeyMissing } from './llm.mjs';
import { parasText } from './capture.mjs';
import { prompt, cut } from './teach.mjs';
import { lessonTitles } from './board.mjs';
import { isContent, isQuestion, unanswered, learnParas } from '../web/mode.js';

// 前置知识: the more basic concepts, methods and formulas a step rests on, listed for the learner to read, and each
// item opened up on request. It is offered on every step of a lesson.
//
// On a practice question not yet answered it may never help solve the question, because Math Academy schedules
// practice and reviews by the answers the learner gives alone: no working, no answer, no choice, and nothing the
// lesson itself is teaching (its step titles are sent along so the model can tell). An item opened up there is
// shown only the item, never the question. On a tutorial or a worked example, or a question already answered,
// there is nothing to hold back. Asks made before the answer are counted (they are part of what the answer was).
// The design is the same as the voice tutor's "prereq" mode (voice.mjs).
const now = () => new Date().toISOString();
const KINDS = ['concept', 'method', 'formula'];
const MAX_ITEMS = 6;
export const PREREQ_SCHEMA = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['kind', 'name', 'note'],
  properties: { kind: { type: 'string', enum: KINDS }, name: { type: 'string' }, note: { type: 'string' } } } } } };
// One item of the list, opened up: what it is, a small example of its own, and where it is easy to go wrong.
export const EXPAND_SCHEMA = { type: 'object', additionalProperties: false, required: ['explain', 'example', 'pitfall'],
  properties: { explain: { type: 'string' }, example: { type: 'string' }, pitfall: { type: 'string' } } };
const KIND_NAMES = { concept: '基础概念', method: '基础方法', formula: '基础公式' };
export function moreOf(value) {
  const more = { explain: cut(value?.explain, 700), example: cut(value?.example, 500), pitfall: cut(value?.pitfall, 400) };
  return more.explain ? more : null;
}

const choicesOf = rec => (rec.sections.choices || []).map(c => `${c.letter}. ${parasText(c.content)}`);
// Whether there is anything on the step to list the prerequisites of.
const hasContent = rec => isQuestion(rec) ? !!rec.sections.question?.length : isContent(rec) && !!(learnParas(rec).length || rec.sections.question?.length);

// What the model is shown. A question: the question and its choices as they are (nothing of an answer, there is none
// yet in what is kept here), and what the lesson teaches. A tutorial or example: its own text, and the lesson's
// other steps.
export function prereqPacket(rec, lesson) {
  if (isQuestion(rec)) return { 这一步: rec.title || '', ...(lesson.length ? { 这节课在教: lesson } : {}), 题目: parasText(rec.sections.question), ...(choicesOf(rec).length ? { 选项: choicesOf(rec) } : {}) };
  const others = lesson.filter(t => t !== rec.title);
  return { 这一步: rec.title || '', 类型: rec.step.type === 'example' ? '例题' : '讲解',
    ...(rec.step.type === 'example' ? { 题目: parasText(rec.sections.question) } : {}), 内容: parasText(learnParas(rec)), ...(others.length ? { 这节课的其他步骤: others } : {}) };
}

// The list as it is kept: known kinds only, no repeats, at most six, concepts first. An item that holds one of the
// choices as written would be an answer, so it is dropped.
export function itemsOf(raw, rec) {
  const choices = (rec.sections.choices || []).map(c => parasText(c.content).trim()).filter(t => t.length >= 5);
  const seen = new Set(), items = [];
  for (const it of Array.isArray(raw) ? raw : []) {
    if (!KINDS.includes(it?.kind)) continue;
    const name = cut(it.name, 80), note = cut(it.note, 200), same = name.toLowerCase().replace(/\s+/g, '');
    if (!name || !note || seen.has(same) || choices.some(c => name.includes(c) || note.includes(c))) continue;
    seen.add(same); items.push({ id: crypto.randomUUID(), kind: it.kind, name, note });
  }
  return items.slice(0, MAX_ITEMS).sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
}

export class Prereqs {
  constructor(board, cfg, infer = (packet, opts) => textJSON(packet, cfg, opts)) {
    this.board = board; this.cfg = cfg; this.infer = infer;
    // A call cut off by a restart is never replayed; it is marked so it can be tried again.
    for (const rec of board.store.steps()) {
      let touched = false;
      if (rec.prereq?.status === 'running') { rec.prereq = { ...rec.prereq, status: 'error', error: '服务重启，整理前置知识中断了，可以重试。' }; touched = true; }
      for (const item of rec.prereq?.items || []) if (item.more?.status === 'running') { item.more = { ...item.more, status: 'error', error: '服务重启，展开中断了，可以重试。' }; touched = true; }
      if (touched) board.store.putStep(rec);
    }
  }
  // Asked for by the learner, for the step on screen. An ask made before the answer is counted, and a list already
  // made is shown again without a new call.
  start(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key);
    check(hasContent(rec), '这一步还没有读到内容。', 409);
    const views = (rec.prereq?.views || 0) + (unanswered(rec) ? 1 : 0);
    if (['running', 'ready'].includes(rec.prereq?.status)) { rec.prereq.views = views; return this.board.save(rec); }
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    const started = crypto.randomUUID();
    rec.prereq = { ...(rec.prereq || {}), status: 'running', id: started, views, started_at: now(), items: undefined, error: undefined };
    this.board.save(rec);
    const packet = prereqPacket(rec, lessonTitles(this.board.store, rec));
    Promise.resolve().then(async () => {
      const { value, model } = await this.infer(packet, { instructions: prompt(isQuestion(rec) ? 'prereq' : 'prereq-step'), schema: PREREQ_SCHEMA, purpose: 'prereq', key: rec.key, tokens: 4096, limit: 8000 });
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
  // One item opened up, asked for by the learner. The model is shown the item and what the lesson teaches, and
  // never the step's text or question: on a question not yet answered it cannot lean towards the question's working
  // when it does not know the question. An item already opened is shown again without a new call.
  expand(body) {
    fields(body, ['key', 'item'], ['key', 'item']); id(body.item);
    const rec = this.board.active(body.key);
    const list = rec.prereq, item = list?.status === 'ready' ? list.items.find(i => i.id === body.item) : null;
    check(item, '这份前置知识清单已经变了，页面会刷新。', 409);
    if (unanswered(rec)) list.expands = (list.expands || 0) + 1;
    if (['running', 'ready'].includes(item.more?.status)) return this.board.save(rec);
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    const started = crypto.randomUUID(), lesson = lessonTitles(this.board.store, rec);
    item.more = { status: 'running', id: started, started_at: now() };
    this.board.save(rec);
    const packet = { 知识点: { 类别: KIND_NAMES[item.kind], 名称: item.name, 说明: item.note }, ...(lesson.length ? { 这节课在教: lesson } : {}) };
    const settle = change => {
      const latest = this.board.record(rec.key), at = latest?.prereq?.items?.find(i => i.id === item.id);
      if (at?.more?.id !== started || at.more.status !== 'running') return;
      at.more = { ...at.more, ...change };
      this.board.save(latest);
    };
    Promise.resolve().then(async () => {
      const { value, model } = await this.infer(packet, { instructions: prompt('prereq-expand'), schema: EXPAND_SCHEMA, purpose: 'prereq_expand', key: rec.key, tokens: 4096, limit: 8000 });
      const more = moreOf(value);
      check(more, 'Invalid model response');
      settle({ status: 'ready', model, ...more, finished_at: now() });
    }).catch(error => settle({ status: 'error', error: textError(error, this.cfg) }));
    return rec;
  }
}
