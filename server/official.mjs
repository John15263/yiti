import { check, fields } from './validation.mjs';
import { textJSON, textConfigured, textKeyMissing } from './llm.mjs';
import { prompt, cut } from './teach.mjs';
import { unanswered } from '../web/mode.js';

// Math Academy's own prerequisites of the topic on screen (kept by the board from the pages that list them), shown at the
// top of 前置知识 with their names in Chinese and a link to each one's page on Math Academy.
//
// Not on a review question still to be answered: the names of what a topic builds on tell which topic it is, and so
// which method the question wants.
export const OFFICIAL_SCHEMA = { type: 'object', additionalProperties: false, required: ['names'], properties: { names: { type: 'array', items: { type: 'string' } } } };
const ZH = 'official-zh';

// The names handed to the model as reference (Chinese with the English when there is one), under the same rule as what is
// shown: none for a review question still to be answered, whose topic they would give away.
export function officialNames(store, rec) {
  if (!rec?.topic || (rec.page === 'review' && unanswered(rec))) return [];
  const zh = store.get(ZH) || {};
  return (store.get(`official:${rec.topic}`)?.prereqs || []).map(p => zh[p.name] ? `${zh[p.name]}（${p.name}）` : p.name);
}

export class Officials {
  constructor(board, cfg, infer = (packet, opts) => textJSON(packet, cfg, opts)) {
    this.board = board; this.cfg = cfg; this.infer = infer; this.making = new Set();
  }
  // What the page is given: the list, each with its Chinese name once there is one; nothing where none is kept or shown.
  of(rec) {
    if (!rec?.topic || (rec.page === 'review' && unanswered(rec))) return null;
    const kept = this.board.store.get(`official:${rec.topic}`);
    if (!kept?.prereqs?.length) return null;
    const zh = this.board.store.get(ZH) || {};
    return { prereqs: kept.prereqs.map(p => ({ ...p, ...(zh[p.name] ? { zh: zh[p.name] } : {}) })) };
  }
  // The names not yet in Chinese, put into Chinese (one cheap call; every name is kept once for all topics).
  translate(body) {
    fields(body, ['key'], ['key']);
    const rec = this.board.active(body.key), list = this.of(rec);
    check(list, '这里没有 Math Academy 的前置知识点。', 409);
    const names = list.prereqs.filter(p => !p.zh).map(p => p.name).filter(n => !this.making.has(n));
    if (!names.length) return rec;
    check(textConfigured(this.cfg), textKeyMissing(this.cfg), 503);
    for (const n of names) this.making.add(n);
    Promise.resolve().then(async () => {
      const { value } = await this.infer({ 知识点名称: names }, { instructions: prompt('official-zh'), schema: OFFICIAL_SCHEMA, purpose: 'official_zh', key: rec.key, tokens: 2048, limit: 8000, cheap: true });
      const out = Array.isArray(value?.names) ? value.names : [];
      check(out.length === names.length, 'Invalid model response');
      const zh = { ...(this.board.store.get(ZH) || {}) };
      names.forEach((n, i) => { const t = cut(out[i], 60); if (t) zh[n] = t; });
      this.board.store.set(ZH, zh);
      this.board.publish();
    }).catch(() => {}).finally(() => { for (const n of names) this.making.delete(n); });
    return rec;
  }
}
