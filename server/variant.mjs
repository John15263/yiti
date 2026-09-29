import { check, fields, id, oneOf, text } from './validation.mjs';
import { textJSON, textError, textConfigured, textKeyMissing } from './llm.mjs';
import { parasText } from './capture.mjs';
import { prompt } from './teach.mjs';
import { mend } from '../web/tex.js';

// 换个样子: once a practice question is answered on Math Academy and its key step has been said in one sentence
// and reviewed, the same key step comes back in a question with another setting and other numbers, to be
// worked here. On the lesson's last step, every key step of the lesson comes back once more, shuffled.
// Only questions already answered on Math Academy are used, so nothing here helps before an answer is given.
const now = () => new Date().toISOString();
const str = { type: 'string' };
export const VARIANT_SCHEMAS = {
  'variant-make': { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['question_en', 'question_zh', 'answer', 'solution', 'hint'],
    properties: { question_en: str, question_zh: str, answer: str, solution: str, hint: str } } } } },
  'variant-check': { type: 'object', additionalProperties: false, required: ['verdict', 'note', 'fixed'],
    properties: { verdict: { type: 'string', enum: ['right', 'slip', 'wrong'] }, note: str, fixed: str } },
};
const LESSON_ROUND = 4;
const cut = (v, n) => typeof v === 'string' ? mend(v.trim()).slice(0, n) : '';
const plain = v => String(v || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/[.。]$/u, '');
export const reviewName = task => `review:${task}`;

// The key step this question comes back with: the reviewed sentence, which the review rewrites into one that
// holds (and that catches the key step, when the learner's missed it).
export function keyStep(rec) {
  const done = rec.say?.attempts?.findLast(a => a.status === 'done');
  return done ? cut(done.suggestion || done.text, 400) : '';
}
const answeredQuestion = rec => rec?.step?.type === 'question' && !!rec.sections?.result;
const source = rec => ({ 原题: parasText(rec.sections.question), ...(rec.sections.choices?.length ? { 选项: rec.sections.choices.map(c => `${c.letter}. ${parasText(c.content)}`) } : {}),
  官方讲解: parasText(rec.sections.explanation) });
// The lesson's own questions that came back once already, in the order they were met.
const firstRound = (store, task) => store.steps().filter(r => r.key.startsWith(`${task}-`) && r.variant?.status === 'ready')
  .sort((a, b) => a.step.index - b.step.index).map(r => ({ rec: r, item: r.variant.items[0] })).filter(x => x.item);

// Offered on the lesson's last step once that step's own work is done, and only when an earlier question came
// back once already: missed ones first, at most four, shuffled so the order gives nothing away.
export function lessonReady(store, rec) {
  if (!rec?.step || rec.step.index + 1 !== rec.step.total) return false;
  if (rec.step.type === 'question' && (!answeredQuestion(rec) || ['running', 'open'].includes(roundState(rec.variant)))) return false;
  return firstRound(store, rec.task).some(x => x.item.status === 'done');
}
const roundState = v => !v ? 'none' : v.status === 'running' ? 'running' : v.status === 'ready' && v.items.some(i => i.status === 'open') ? 'open' : v.status;
export function lessonItems(store, task, random = Math.random) {
  const chosen = firstRound(store, task).map((x, i) => ({ ...x, i }))
    .sort((a, b) => (b.item.passed === false) - (a.item.passed === false) || a.i - b.i).slice(0, LESSON_ROUND);
  for (let i = chosen.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
  return chosen;
}

const HINT_LEVELS = 3;
export class Variants {
  constructor(board, cfg, infer = (packet, opts) => textJSON(packet, cfg, opts), random = Math.random) {
    this.board = board; this.cfg = cfg; this.infer = infer; this.random = random; this.running = new Set();
    // Calls cut off by a restart are never replayed; they are marked so they can be retried.
    const store = board.store;
    for (const rec of store.steps()) {
      let touched = false;
      if (rec.variant?.status === 'running') { rec.variant = { status: 'error', error: '服务重启，出题中断了，可以重试。' }; touched = true; }
      for (const item of rec.variant?.items || []) for (const a of item.attempts) if (a.status === 'running') {
        Object.assign(a, { status: 'error', error: '服务重启，这次检查中断了，可以重试。' }); touched = true;
      }
      if (touched) store.putStep(rec);
    }
  }
  // Whether the page may offer the lesson's round on this step.
  offered(rec) { try { return !!rec && !this.board.store.get(reviewName(rec.task)) && lessonReady(this.board.store, rec); } catch { return false; } }
  async call(name, packet, key, extra = {}) {
    const { value, model } = await this.infer(packet, { instructions: prompt(name), schema: VARIANT_SCHEMAS[name], purpose: name.replace('-', '_'), key, ...extra });
    check(value && typeof value === 'object', 'Invalid model response');
    return { value, model };
  }
  background(job, fail) {
    this.running.add(job);
    Promise.resolve().then(job).catch(error => fail(textError(error, this.cfg))).finally(() => this.running.delete(job));
  }
  // Writing questions: one per source, each told the setting it already had, if any.
  async make(sources, key) {
    const packet = { items: sources.map(s => ({ ...source(s.rec), 关键一步: s.key_step, 之前出过的变式: s.earlier || '' })) };
    const { value, model } = await this.call('variant-make', packet, key, { tokens: 8192, limit: 30000, timeout: this.cfg.geminiPreparationTimeout });
    check(Array.isArray(value.items) && value.items.length === sources.length, 'Invalid model response');
    const items = value.items.map((m, i) => {
      const item = { question_en: cut(m?.question_en, 1500), question_zh: cut(m?.question_zh, 1500), answer: cut(m?.answer, 300), solution: cut(m?.solution, 2000), hint: cut(m?.hint, 300) };
      check(item.question_zh && item.question_en && item.answer && item.solution, 'Invalid model response');
      check(!sources[i].earlier || plain(item.question_zh) !== plain(sources[i].earlier), 'Invalid model response');
      return { id: crypto.randomUUID(), source_key: sources[i].rec.key, key_step: sources[i].key_step, ...item, ...(sources[i].first ? { first_id: sources[i].first } : {}),
        status: 'open', hints: 0, attempts: [], passed: null };
    });
    return { items, model };
  }

  // Round one, for the question on screen, once its key step has been reviewed.
  start(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key);
    check(answeredQuestion(rec), '先在 Math Academy 交了答案，再来做变式。', 409);
    const step = keyStep(rec);
    check(step, '先用一句话说出关键一步，点评之后再做变式。', 409);
    if (rec.variant && rec.variant.status !== 'error') return rec;
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    const started = crypto.randomUUID();
    rec.variant = { status: 'running', id: started, round: 1, started_at: now() };
    this.board.save(rec);
    this.background(async () => {
      const { items, model } = await this.make([{ rec, key_step: step }], rec.key);
      const latest = this.board.record(rec.key);
      if (latest?.variant?.id !== started || latest.variant.status !== 'running') return;
      latest.variant = { status: 'ready', id: started, round: 1, index: 0, model, items, finished_at: now() };
      this.board.save(latest);
    }, message => {
      const latest = this.board.record(rec.key);
      if (latest?.variant?.id === started && latest.variant.status === 'running') { latest.variant = { status: 'error', error: message }; this.board.save(latest); }
    });
    return rec;
  }
  // Round two, for the lesson, asked for from its last step.
  lesson(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key), store = this.board.store, name = reviewName(rec.task);
    const saved = store.get(name);
    if (saved && saved.status !== 'error') return rec;
    check(lessonReady(store, rec), '这节课还没到回顾的时候。', 409);
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    const chosen = lessonItems(store, rec.task, this.random), started = crypto.randomUUID();
    store.set(name, { status: 'running', id: started, round: 2, task: rec.task, started_at: now() }); this.board.publish();
    this.background(async () => {
      const { items, model } = await this.make(chosen.map(x => ({ rec: x.rec, key_step: x.item.key_step, earlier: x.item.question_zh, first: x.item.id })), rec.key);
      if (store.get(name)?.id !== started) return;
      store.set(name, { status: 'ready', id: started, round: 2, task: rec.task, index: 0, model, items, finished_at: now() }); this.board.publish();
    }, message => {
      if (store.get(name)?.id !== started) return;
      store.set(name, { status: 'error', error: message, task: rec.task }); this.board.publish();
    });
    return rec;
  }

  // The item on screen, in the step's round or the lesson's; only the step being followed can be changed.
  target(body, extra = []) {
    fields(body, ['key', 'round', 'item', ...extra], ['key', 'round', 'item', ...extra]); id(body.item); oneOf(body.round, [1, 2]);
    const rec = this.board.active(body.key), store = this.board.store;
    const set = body.round === 1 ? rec.variant : store.get(reviewName(rec.task));
    const item = set?.status === 'ready' ? set.items[set.index] : null;
    check(item?.id === body.item, '这道变式已经过去了，页面会刷新。', 409);
    const save = () => { if (body.round === 1) this.board.save(rec); else { store.set(reviewName(rec.task), set); this.board.publish(); } };
    return { rec, set, item, save };
  }
  check(body) {
    const { rec, set, item, save } = this.target(body, ['text']);
    text(body.text, 2000);
    check(item.status === 'open', '这道变式已经做完了。', 409);
    check(!item.attempts.some(a => a.status === 'running'), '正在检查，稍等。', 409);
    const attempt = { id: crypto.randomUUID(), text: body.text.trim(), at: now(), status: 'running', hints: item.hints };
    item.attempts.push(attempt);
    // Written as the answer itself: right, here and for free.
    if (plain(attempt.text) === plain(item.answer)) {
      Object.assign(attempt, { status: 'done', verdict: 'right', note: '', fixed: attempt.text, by: 'local' }); item.passed = true;
      save(); return rec;
    }
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    save();
    const packet = { 题目: item.question_zh, 题目英文: item.question_en, 关键一步: item.key_step, 参考答案: item.answer, 参考解法: item.solution, written: attempt.text };
    // The check comes back to whatever is saved by then; an item since left behind still keeps it.
    const settle = change => {
      const store = this.board.store, r = this.board.record(rec.key), latest = body.round === 1 ? r?.variant : store.get(reviewName(rec.task));
      const it = latest?.id === set.id ? latest.items.find(x => x.id === item.id) : null, a = it?.attempts.find(x => x.id === attempt.id);
      if (!a) return;
      Object.assign(a, change);
      if (change.verdict === 'right') it.passed = true;
      if (body.round === 1) this.board.save(r); else { store.set(reviewName(rec.task), latest); this.board.publish(); }
    };
    this.background(async () => {
      const { value, model } = await this.call('variant-check', packet, rec.key);
      check(['right', 'slip', 'wrong'].includes(value.verdict) && typeof value.note === 'string', 'Invalid model response');
      settle({ status: 'done', verdict: value.verdict, note: cut(value.note, 1000), fixed: cut(value.fixed, 1000), model });
    }, message => settle({ status: 'error', error: message }));
    return rec;
  }
  // Three levels, none of them a call: the key step said for the question it came from, where it falls in
  // this one, then the worked solution.
  hint(body) {
    const { rec, item, save } = this.target(body);
    check(item.status === 'open', '这道变式已经做完了。', 409);
    item.hints = Math.min(HINT_LEVELS, item.hints + 1);
    save(); return rec;
  }
  // On to the next one (or done with it): a question left unsolved is recorded as missed.
  next(body) {
    const { rec, set, item, save } = this.target(body);
    check(!item.attempts.some(a => a.status === 'running'), '正在检查，稍等。', 409);
    if (item.status === 'open') { item.status = 'done'; if (item.passed !== true) item.passed = false; }
    if (set.index + 1 < set.items.length) set.index++;
    save(); return rec;
  }
}
