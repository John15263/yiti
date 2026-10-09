import { check, fields, id } from './validation.mjs';
import { textJSON, textError, textConfigured, textKeyMissing } from './llm.mjs';
import { lessonPacket, placeText } from './place.mjs';
import { officialNames } from './official.mjs';
import { simplerTelling, earlierTelling, staleTelling } from './retell.mjs';
import { prompt, cut } from './teach.mjs';
import { lessonOf } from './board.mjs';
import { isContent, answered } from '../web/mode.js';

// 学这个有什么用: where what a lesson teaches leads. Two parts: what it is used for once a few more modules are learned
// (an everyday use, a big engineering one, and a "black magic" one that is hard to believe is mathematics), and the
// higher mathematics it grows into, with what that mathematics can do.
//
// It belongs to the lesson, not the step: one list per lesson, made once and shown again on every step of it. The model
// is shown only the lesson's tutorials and examples (titles and the start of each), never a question. When there are none (a review page),
// it is made for that one question, and only once it is answered. A practice question not yet answered has none at all:
// the learner is working on it then, and this is for after.
const now = () => new Date().toISOString();
export const LAYERS = ['near', 'mid', 'magic'];
export const DISTANCES = ['soon', 'later', 'college'];
const PER_LAYER = 2, MAX_HIGHER = 3;
// Lists made by an earlier version (from the titles alone, before there was a place) are made again when next asked for.
const VERSION = 2;
const DISTANCE = { type: 'string', enum: DISTANCES };
export const LATER_SCHEMA = { type: 'object', additionalProperties: false, required: ['apply', 'higher'], properties: {
  apply: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['layer', 'modules', 'problem', 'real', 'distance'],
    properties: { layer: { type: 'string', enum: LAYERS }, modules: { type: 'string' }, problem: { type: 'string' }, real: { type: 'string' }, distance: DISTANCE } } },
  higher: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['chain', 'solves', 'distance'],
    properties: { chain: { type: 'string' }, solves: { type: 'string' }, distance: DISTANCE } } } } };
// One entry opened up: how the road from this lesson to there goes, and one example to feel it by.
export const LATER_MORE_SCHEMA = { type: 'object', additionalProperties: false, required: ['explain', 'example'],
  properties: { explain: { type: 'string' }, example: { type: 'string' } } };
export const laterOffered = rec => isContent(rec) || answered(rec);

// Which list a step shares: its lesson's, when the lesson's titles are known; else its own.
export function laterScope(rec, lesson) { return lesson.titles.length ? `later:task:${lesson.task}` : `later:step:${rec.key}`; }
// What the list is made from: what the lesson is known by, its place (when there is one) and, for reference, the 前置知识
// already listed on its steps: where it comes from, so the model knows where to go on from.
export function laterPacket(store, rec, titles, place = null, prior = []) {
  return { ...lessonPacket(store, rec, titles), ...(place ? { 这节课的定位: placeText(place) } : {}), ...(prior.length ? { 前置知识参考: prior } : {}) };
}

// The list as it is kept: known layers and distances only, every field filled, at most two to a layer (in layer order),
// at most three ways up, no repeats.
export function laterOf(value) {
  const seen = new Set(), fresh = text => { const k = text.toLowerCase().replace(/\s+/g, ''); if (seen.has(k)) return false; seen.add(k); return true; };
  const apply = [], higher = [];
  for (const layer of LAYERS) {
    for (const it of (Array.isArray(value?.apply) ? value.apply : []).filter(i => i?.layer === layer)) {
      const modules = cut(it.modules, 60), problem = cut(it.problem, 120), real = cut(it.real, 160);
      if (!modules || !problem || !real || !DISTANCES.includes(it.distance) || !fresh(problem)) continue;
      if (apply.filter(a => a.layer === layer).length < PER_LAYER) apply.push({ id: crypto.randomUUID(), layer, modules, problem, real, distance: it.distance });
    }
  }
  for (const it of Array.isArray(value?.higher) ? value.higher : []) {
    const chain = cut(it?.chain, 120), solves = cut(it?.solves, 160);
    if (!chain || !solves || !DISTANCES.includes(it.distance) || !fresh(chain) || higher.length >= MAX_HIGHER) continue;
    higher.push({ id: crypto.randomUUID(), chain, solves, distance: it.distance });
  }
  return apply.length || higher.length ? { apply, higher } : null;
}
export function laterMoreOf(value) {
  // The limits only guard against a runaway reply: the prompt asks for far less, and formulas (a matrix's TeX is long) count here.
  const more = { explain: cut(value?.explain, 2500), example: cut(value?.example, 2500) };
  return more.explain ? more : null;
}
// 那一层有什么用: for a way up into higher mathematics, what that mathematics is used for. One level only: a use is not
// itself opened into more uses, so the learner stays within sight of this lesson.
export const USES_SCHEMA = { type: 'object', additionalProperties: false, required: ['uses'], properties: { uses: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['what', 'how'], properties: { what: { type: 'string' }, how: { type: 'string' } } } } } };
export function usesOf(value) {
  const uses = (Array.isArray(value?.uses) ? value.uses : []).map(u => ({ what: cut(u?.what, 400), how: cut(u?.how, 600) })).filter(u => u.what && u.how).slice(0, 3);
  return uses.length ? { uses } : null;
}
// What can be made for an entry, each kept on it as tellings (retell.mjs) that can be told more simply: "more" opens any
// entry up, "uses" is for a way up only.
const MAX_TELLINGS = 4;
const PARTS = {
  more: { prompt: 'later-expand', schema: LATER_MORE_SCHEMA, purpose: 'later_expand', parse: laterMoreOf, name: '具体怎么用上', fits: () => true },
  uses: { prompt: 'later-uses', schema: USES_SCHEMA, purpose: 'later_uses', parse: usesOf, name: '那一层有什么用', fits: item => !item.layer },
};
const entryOf = (list, item) => list.apply.find(i => i.id === item) || list.higher.find(i => i.id === item);
const entryText = item => item.layer ? { 部分: PART[item.layer], 还要学的模块: item.modules, 能解决的工程问题: item.problem, 现实里的对应: item.real }
  : { 部分: '高级数学衔接', 怎么往上走: item.chain, 那一层能解决的问题: item.solves };
const PART = { near: '工程化与现实应用 · 身边', mid: '工程化与现实应用 · 大工程', magic: '工程化与现实应用 · 黑魔法' };

export class Laters {
  constructor(board, cfg, infer = (packet, opts) => textJSON(packet, cfg, opts), places = null) {
    this.board = board; this.cfg = cfg; this.infer = infer; this.places = places;
  }
  // The 前置知识 already listed for the lesson (or, on a review, for this question), by name: it is not waited for.
  prior(rec, titles) {
    const task = lessonOf(this.board.store, rec).task, recs = titles.length ? this.board.store.steps().filter(r => r.task === task) : [this.board.record(rec.key)];
    return [...new Set(recs.flatMap(r => r?.prereq?.status === 'ready' ? r.prereq.items.map(i => i.name) : []))].slice(0, 10);
  }
  // The list a step shares, as it stands. Work begun by an engine that has since stopped is never replayed; it is shown
  // as cut off, to be asked for again.
  load(rec) {
    // A review, once answered, shares the list of its topic's lesson when that lesson was followed here.
    const lesson = lessonOf(this.board.store, rec), titles = lesson.titles, scope = laterScope(rec, lesson);
    let list = this.board.store.get(scope);
    if (list?.status === 'ready' && list.v !== VERSION) list = null;
    if (list) {
      let touched = false;
      if (list.status === 'running' && list.boot !== this.board.boot) { list = { ...list, status: 'error', error: '整理中断了，可以重试。' }; touched = true; }
      for (const item of [...(list.apply || []), ...(list.higher || [])]) {
        for (const part of Object.keys(PARTS)) {
          const made = item[part];
          if (made?.status === 'running' && made.boot !== this.board.boot) { item[part] = { status: 'error', error: '中断了，可以重试。' }; touched = true; }
          // Opened before there were more tellings: the one there is the first.
          if (made?.status === 'ready' && !made.versions) { item[part] = { status: 'ready', model: made.model, versions: [{ explain: made.explain, example: made.example }], at: 0, limit: MAX_TELLINGS }; touched = true; }
          if (staleTelling(item[part], this.board.boot)) touched = true;
        }
      }
      if (touched) this.board.store.set(scope, list);
    }
    return { titles, scope, list };
  }
  // What the page is given for the step on screen: the shared list, or nothing where none is offered.
  of(rec) { return rec && laterOffered(rec) ? this.load(rec).list : null; }
  put(scope, list) { this.board.store.set(scope, list); this.board.publish(); }
  // Asked for by the learner, for the step on screen. A list already made (on any step of the lesson) is shown again
  // without a new call.
  // With again, a list already made is made anew (the learner found it off the mark).
  start(body) {
    fields(body, ['key', 'again'], ['key']);
    const rec = this.board.active(body.key);
    check(laterOffered(rec), '交了答案之后再看这个。', 409);
    const { titles, scope, list } = this.load(rec);
    check(titles.length || rec.sections.question?.length, '这一步还没有读到内容。', 409);
    if (list?.status === 'running' || (list?.status === 'ready' && body.again !== true)) return list;
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    const started = crypto.randomUUID();
    this.put(scope, { status: 'running', id: started, boot: this.board.boot, started_at: now(), ...(titles.length ? { titles } : {}) });
    const settle = change => {
      const latest = this.board.store.get(scope);
      if (latest?.id !== started || latest.status !== 'running') return;
      this.put(scope, { ...latest, ...change });
    };
    Promise.resolve().then(async () => {
      // The place comes first: the list goes on from it.
      const place = await this.places?.ensure(rec);
      const official = officialNames(this.board.store, rec);
      const packet = { ...laterPacket(this.board.store, rec, titles, place, this.prior(rec, titles)), ...(official.length ? { 'Math Academy 官方前置': official } : {}) };
      const { value, model } = await this.infer(packet, { instructions: prompt('later'), schema: LATER_SCHEMA, purpose: 'later', key: rec.key, tokens: 6144, limit: 8000 });
      const made = laterOf(value);
      check(made, 'Invalid model response');
      settle({ status: 'ready', v: VERSION, model, ...made, finished_at: now() });
    }).catch(error => settle({ status: 'error', error: textError(error, this.cfg) }));
    return this.board.store.get(scope);
  }
  // One entry opened up ("more"), or, for a way up, what that mathematics is used for ("uses"). The model is shown the
  // entry, what the lesson teaches (or, on a review, the answered question it was made for) and the lesson's place.
  // Something already made is shown again without a call.
  expand(body) {
    fields(body, ['key', 'item', 'part'], ['key', 'item']); id(body.item);
    const part = body.part ?? 'more', how = PARTS[part];
    check(how, 'Unknown part');
    const { rec, titles, scope, list, item } = this.entry(body);
    check(how.fits(item), 'Unknown part');
    if (['running', 'ready'].includes(item[part]?.status)) return list;
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    const started = crypto.randomUUID();
    item[part] = { status: 'running', id: started, boot: this.board.boot };
    this.put(scope, list);
    const packet = { ...laterPacket(this.board.store, rec, titles, this.placeOf(rec)), 条目: entryText(item) };
    const settle = change => {
      const latest = this.board.store.get(scope), held = latest?.status === 'ready' ? entryOf(latest, item.id) : null;
      if (held?.[part]?.id !== started || held[part].status !== 'running') return;
      held[part] = change;
      this.put(scope, latest);
    };
    Promise.resolve().then(async () => {
      const { value, model } = await this.infer(packet, { instructions: prompt(how.prompt), schema: how.schema, purpose: how.purpose, key: rec.key, tokens: 4096, limit: 8000 });
      const made = how.parse(value);
      check(made, 'Invalid model response');
      settle({ status: 'ready', model, versions: [made], at: 0, limit: MAX_TELLINGS });
    }).catch(error => settle({ status: 'error', error: textError(error, this.cfg) }));
    return this.board.store.get(scope);
  }
  // What was made for an entry, told again more simply (retell.mjs). The model is shown the entry, the lesson's place and
  // the telling so far.
  simpler(body) {
    const { rec, scope, item, part } = this.made(body), how = PARTS[part], place = this.placeOf(rec);
    simplerTelling({ access: this.tellings(scope, item.id, part), cfg: this.cfg, boot: this.board.boot,
      call: (current, count) => this.infer({ 讲的是什么: { 这部分: how.name, 条目: entryText(item), ...(place ? { 这节课的定位: placeText(place) } : {}) }, 现在的讲法: current, 已经变简单过几次: count },
        { instructions: prompt('retell'), schema: how.schema, purpose: 'later_simpler', key: rec.key, tokens: 4096, limit: 8000 }),
      parse: how.parse });
    return this.board.store.get(scope);
  }
  back(body) {
    const { scope, item, part } = this.made(body);
    earlierTelling({ access: this.tellings(scope, item.id, part) });
    return this.board.store.get(scope);
  }
  // The entry of the list on screen a request is about.
  entry(body) {
    const rec = this.board.active(body.key);
    check(laterOffered(rec), '交了答案之后再看这个。', 409);
    const { titles, scope, list } = this.load(rec), item = list?.status === 'ready' ? entryOf(list, body.item) : null;
    check(item, '这份清单已经变了，页面会刷新。', 409);
    return { rec, titles, scope, list, item };
  }
  made(body) {
    fields(body, ['key', 'item', 'part'], ['key', 'item']); id(body.item);
    const part = body.part ?? 'more';
    check(PARTS[part], 'Unknown part');
    const found = this.entry(body);
    check(found.item[part]?.status === 'ready', '先把这一项展开。', 409);
    return { ...found, part };
  }
  placeOf(rec) { const place = this.places?.of(rec); return place?.status === 'ready' ? place : null; }
  // What was made for an entry, as it is kept now.
  tellings(scope, itemId, part) {
    return fn => {
      const list = this.board.store.get(scope), item = list?.status === 'ready' ? entryOf(list, itemId) : null;
      fn(item?.[part]?.status === 'ready' ? item[part] : null);
      if (item) this.put(scope, list);
    };
  }
}
