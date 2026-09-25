import { changeRows, check, fields, text } from './validation.mjs';
import { textJSON, textError, textConfigured, textKeyMissing } from './llm.mjs';
import { paraText, parasText } from './capture.mjs';
import { progress } from './board.mjs';
import { plan, apply } from './translate.mjs';
import { learnable, learnParas, blockParas } from '../web/mode.js';

const now = () => new Date().toISOString();
// The prompt texts, handed in by whoever runs this: read from prompts/ by the local server, bundled by the extension.
const PROMPTS = new Map();
export function usePrompts(texts) { for (const [name, value] of Object.entries(texts)) PROMPTS.set(name, value); }
export function prompt(name) {
  if (!PROMPTS.has(name)) throw new Error(`Prompt not loaded: ${name}`);
  return PROMPTS.get(name);
}
const str = { type: 'string' };
export const SCHEMAS = {
  prepare: { type: 'object', additionalProperties: false, required: ['summary', 'blocks'], properties: { summary: str,
    blocks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['start', 'meaning', 'focus', 'answer', 'terms', 'hints'],
      properties: { start: { type: 'integer', minimum: 0 }, meaning: str, focus: str, answer: str,
        terms: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['en', 'zh'], properties: { en: str, zh: str } } },
        hints: { type: 'array', items: str } } } } } },
  check: { type: 'object', additionalProperties: false, required: ['verdict', 'note', 'fixed'],
    properties: { verdict: { type: 'string', enum: ['pass', 'adjust'] }, note: str, fixed: str } },
  translate: { type: 'object', additionalProperties: false, required: ['title', 'paragraphs', 'phrases'], properties: { title: str,
    paragraphs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: str, text: str } } },
    phrases: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['en', 'zh'], properties: { en: str, zh: str } } } } },
  say: { type: 'object', additionalProperties: false, required: ['score', 'math', 'note', 'suggestion', 'changes'],
    properties: { score: { type: 'integer', minimum: 0, maximum: 100 }, math: { type: 'string', enum: ['right', 'partly', 'wrong'] }, note: str, suggestion: str,
      changes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['from', 'to', 'why'], properties: { from: str, to: str, why: str } } } } },
};
const cut = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';

// Blocks always cover every paragraph once and in order, whatever the starts the model gave: each block
// runs from its start to the next one's. Starts out of range or out of order are dropped.
export function blocksOf(raw, count) {
  const starts = [];
  for (const b of Array.isArray(raw) ? raw : []) {
    if (!Number.isInteger(b?.start) || b.start < 0 || b.start >= count) continue;
    if (starts.length && b.start <= starts.at(-1).start) continue;
    starts.push(b);
  }
  if (!starts.length && count) starts.push({ start: 0 });
  starts[0] = { ...starts[0], start: 0 };
  return starts.slice(0, 8).map((b, i, all) => ({
    start: b.start, end: i + 1 < all.length ? all[i + 1].start : count,
    meaning: cut(b.meaning, 600), focus: cut(b.focus, 300) || '用一句话写出这一步的结论', answer: cut(b.answer, 600),
    terms: (Array.isArray(b.terms) ? b.terms : []).filter(t => cut(t?.en, 80) && cut(t?.zh, 80)).slice(0, 4).map(t => ({ en: cut(t.en, 80), zh: cut(t.zh, 80) })),
    hints: (Array.isArray(b.hints) ? b.hints : []).map(h => cut(h, 300)).filter(Boolean).slice(0, 3),
  }));
}

// What each call is shown, built in one place so a comparison between providers sends exactly what the app sends.
export const preparePacket = rec => ({ 类型: rec.step.type === 'example' ? '例题' : '讲解', 标题: rec.title,
  ...(rec.step.type === 'example' ? { 题目: parasText(rec.sections.question) } : {}),
  段落: learnParas(rec).map((p, i) => ({ i, text: paraText(p) })) });
export const checkPacket = (rec, block, written) => ({ 这一块的原文: parasText(blockParas(rec, block)), focus: block.focus, answer: block.answer, written });
export function sayPacket(rec, sentence) {
  const s = rec.sections;
  return { 题目: parasText(s.question),
    ...(s.choices?.length ? { 选项: s.choices.map(c => `${c.letter}. ${parasText(c.content)}${c.picked ? '  ← 他选的' : ''}`) } : {}),
    ...(s.answer ? { 他填的答案: s.answer } : {}), 结果: s.result, 官方讲解: parasText(s.explanation), sentence };
}
// The size and wait each call is given.
export const LIMITS = cfg => ({ prepare: { tokens: 8192, limit: 30000, timeout: cfg.geminiPreparationTimeout },
  translate: { tokens: 8192, limit: 40000, timeout: cfg.geminiPreparationTimeout, cheap: true }, check: {}, say: {} });

// The text calls: preparing a step's blocks, translating it, checking a block written from memory, reviewing the one sentence.
export class Teach {
  constructor(board, cfg, infer = (packet, opts) => textJSON(packet, cfg, opts)) {
    this.board = board; this.cfg = cfg; this.infer = infer; this.running = new Set();
  }
  async call(name, packet, key, extra = {}) {
    const { value, model } = await this.infer(packet, { instructions: prompt(name), schema: SCHEMAS[name], purpose: name, key, ...extra });
    check(value && typeof value === 'object', 'Invalid model response');
    return { value, model };
  }
  // Everything below starts the call and returns at once; the page hears the result over the event stream.
  background(job, key, fail) {
    this.running.add(job);
    Promise.resolve().then(job).catch(error => {
      const rec = this.board.record(key);
      if (rec) { fail(rec, textError(error)); this.board.save(rec); }
    }).finally(() => this.running.delete(job));
  }

  prepare(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key);
    check(learnable(rec), '这一步没有讲解可以拆。', 409);
    if (['running', 'ready'].includes(rec.prep.status)) return rec;
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    const paras = learnParas(rec);
    check(paras.length, '这一步还没有读到讲解内容。', 409);
    const hash = rec.hash;
    rec.prep = { status: 'running', hash, started_at: now() };
    this.board.save(rec);
    const packet = preparePacket(rec);
    this.background(async () => {
      const { value, model } = await this.call('prepare', packet, rec.key, LIMITS(this.cfg).prepare);
      const blocks = blocksOf(value.blocks, paras.length);
      check(blocks.length, 'Invalid model response');
      const latest = this.board.record(rec.key);
      // The text moved on while this was being made: this preparation is for text no longer there.
      if (!latest || latest.hash !== hash || latest.prep.status !== 'running') return;
      latest.prep = { status: 'ready', hash, model, summary: cut(value.summary, 400), blocks, finished_at: now() };
      latest.progress = progress(blocks.length);
      this.board.save(latest);
    }, rec.key, (latest, message) => { if (latest.prep.status === 'running') latest.prep = { status: 'error', error: message }; });
    return rec;
  }

  // The step in Chinese. It only changes how the words read, so a question not yet answered is translated too.
  translate(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key), hash = rec.text_hash, t = rec.translation || { status: 'none' };
    if (t.hash === hash && ['running', 'ready'].includes(t.status)) return rec;
    if (t.status === 'running') return rec;
    const packet = plan(rec.title, rec.sections);
    if (!packet.paragraphs.length && !packet.phrases.length) {
      rec.translation = { status: 'ready', hash, title: rec.title, sections: rec.sections, missing: 0 };
      return this.board.save(rec);
    }
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    rec.translation = { status: 'running', hash, started_at: now() };
    this.board.save(rec);
    this.background(async () => {
      const { value, model } = await this.call('translate', packet, rec.key, LIMITS(this.cfg).translate);
      const latest = this.board.record(rec.key);
      // The words moved on while this was being made: it is for words no longer there.
      if (!latest || latest.text_hash !== hash || latest.translation?.status !== 'running' || latest.translation.hash !== hash) return;
      latest.translation = { status: 'ready', hash, model, ...apply(latest.title, latest.sections, value), finished_at: now() };
      this.board.save(latest);
    }, rec.key, (latest, message) => { if (latest.translation?.status === 'running') latest.translation = { status: 'error', hash, error: message }; });
    return rec;
  }

  check(body) {
    fields(body, ['key', 'index', 'text'], ['key', 'index', 'text']);
    text(body.text, 2000);
    const rec = this.board.active(body.key), p = rec.progress;
    check(body.index === p.index && ['write', 'checked'].includes(p.phase), '这一块已经过去了，页面会刷新。', 409);
    const input = p.inputs[p.index], block = rec.prep.blocks[p.index];
    check(!input.attempts.some(a => a.status === 'running'), '正在检查，稍等。', 409);
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    const attempt = { id: crypto.randomUUID(), text: body.text.trim(), at: now(), status: 'running', hints: input.hints, peeks: input.peeks };
    input.attempts.push(attempt); p.phase = 'write';
    this.board.save(rec);
    const packet = checkPacket(rec, block, attempt.text);
    const settle = (latest, change) => {
      const a = latest.progress.inputs[p.index]?.attempts.find(x => x.id === attempt.id);
      if (!a) return null;
      Object.assign(a, change);
      return a;
    };
    this.background(async () => {
      const { value, model } = await this.call('check', packet, rec.key);
      check(['pass', 'adjust'].includes(value.verdict) && typeof value.note === 'string', 'Invalid model response');
      const latest = this.board.record(rec.key);
      if (!latest) return;
      const a = settle(latest, { status: 'done', verdict: value.verdict, note: cut(value.note, 1000), fixed: cut(value.fixed, 1000), model });
      if (!a) return;
      const lp = latest.progress;
      // Only the block still being worked on moves to its checked view.
      if (lp.index === p.index && lp.phase === 'write') lp.phase = 'checked';
      if (value.verdict === 'pass') lp.inputs[p.index].passed = true;
      this.board.save(latest);
    }, rec.key, (latest, message) => settle(latest, { status: 'error', error: message }));
    return rec;
  }

  say(body) {
    fields(body, ['key', 'text'], ['key', 'text']);
    text(body.text, 1000);
    const rec = this.board.active(body.key);
    check(rec.step.type === 'question' && rec.sections.result, '先在 Math Academy 交了答案，再来说这一句。', 409);
    check(!rec.say.attempts.some(a => a.status === 'running'), '正在点评，稍等。', 409);
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    const attempt = { id: crypto.randomUUID(), text: body.text.trim(), at: now(), status: 'running' };
    rec.say.attempts.push(attempt);
    this.board.save(rec);
    const packet = sayPacket(rec, attempt.text);
    const settle = (latest, change) => { const a = latest.say.attempts.find(x => x.id === attempt.id); if (a) Object.assign(a, change); };
    this.background(async () => {
      const { value, model } = await this.call('say', packet, rec.key);
      check(Number.isInteger(value.score) && value.score >= 0 && value.score <= 100 && typeof value.note === 'string', 'Invalid model response');
      const latest = this.board.record(rec.key);
      if (!latest) return;
      settle(latest, { status: 'done', score: value.score, math: ['right', 'partly', 'wrong'].includes(value.math) ? value.math : 'partly',
        note: cut(value.note, 3000), suggestion: cut(value.suggestion, 1000), changes: changeRows(value.changes), model });
      this.board.save(latest);
    }, rec.key, (latest, message) => settle(latest, { status: 'error', error: message }));
    return rec;
  }
}
