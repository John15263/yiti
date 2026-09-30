import { check, fields } from './validation.mjs';
import { textJSON, textError, textConfigured, textKeyMissing } from './llm.mjs';
import { plan, apply } from './translate.mjs';
import { mend } from '../web/tex.js';

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
  translate: { type: 'object', additionalProperties: false, required: ['title', 'paragraphs', 'phrases'], properties: { title: str,
    paragraphs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: str, text: str } } },
    phrases: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['en', 'zh'], properties: { en: str, zh: str } } } } },
};
// Text a model wrote may have math in it ($…$); mend puts back the backslashes JSON turned into control characters.
// A cut never lands inside a formula: cutting `$a=\\frac{b}{c}$` in the middle would leave a `$` that opens nothing, and the page
// would show the rest as raw TeX. A formula the cut falls in is kept whole if it ends soon after the limit, else left out.
const SLACK = 300;
export function cutMath(text, n) {
  if (text.length <= n) return text;
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] !== '$') { i++; continue; }
    const mark = text.startsWith('$$', i) ? '$$' : '$';
    let end = i + mark.length;
    for (; end < text.length && !text.startsWith(mark, end); end += text[end] === '\\' ? 2 : 1);
    // No closing mark: a dollar sign that is only a dollar sign (money).
    if (end >= text.length) { i += mark.length; continue; }
    end += mark.length;
    if (i >= n) break;
    if (end > n) return end <= n + SLACK ? text.slice(0, end) : text.slice(0, i).trimEnd();
    i = end;
  }
  return text.slice(0, n);
}
export const cut = (v, n) => typeof v === 'string' ? cutMath(mend(v.trim()), n) : '';

// The size and wait each call is given.
export const LIMITS = cfg => ({ translate: { tokens: 8192, limit: 40000, timeout: cfg.geminiPreparationTimeout, cheap: true } });

// The step in Chinese. The other text calls (the prerequisite list, the conversation) have their own modules.
export class Teach {
  constructor(board, cfg, infer = (packet, opts) => textJSON(packet, cfg, opts)) {
    this.board = board; this.cfg = cfg; this.infer = infer; this.running = new Set();
  }
  async call(name, packet, key, extra = {}) {
    const { value, model } = await this.infer(packet, { instructions: prompt(name), schema: SCHEMAS[name], purpose: name, key, ...extra });
    check(value && typeof value === 'object', 'Invalid model response');
    return { value, model };
  }
  // Starts the call and returns at once; the page hears the result over the event stream.
  background(job, key, fail) {
    this.running.add(job);
    Promise.resolve().then(job).catch(error => {
      const rec = this.board.record(key);
      if (rec) { fail(rec, textError(error, this.cfg)); this.board.save(rec); }
    }).finally(() => this.running.delete(job));
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
}
