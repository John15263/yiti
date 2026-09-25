import { check, fields, id, oneOf } from './validation.mjs';
import { normalize, fingerprint, textFingerprint } from './capture.mjs';

const HASH_VERSION = 2;
import { learnable } from '../web/mode.js';

const now = () => new Date().toISOString();
export const progress = count => ({ index: 0, phase: 'learn', inputs: Array.from({ length: count }, () => ({ hints: 0, peeks: 0, skipped: false, passed: false, attempts: [] })) });

function fresh(c, key, hash, at) {
  return { key, task: c.task, topic: c.topic, url: c.url, step: c.step, title: c.title, sections: c.sections, hash, text_hash: textFingerprint(c.sections),
    hash_version: HASH_VERSION, created_at: at, updated_at: at, prep: { status: 'none' }, translation: { status: 'none' }, progress: progress(0), say: { attempts: [] }, voice: [] };
}

// Follows whichever Math Academy step was read last, and keeps what was done on each step.
export class Board {
  constructor(store, publish = () => {}) {
    this.store = store; this.publish = publish;
    // Calls cut off by a restart are never replayed (avoids surprise charges); they are marked so they can be retried.
    for (const rec of store.steps()) {
      let touched = false;
      if (!rec.text_hash) { rec.text_hash = textFingerprint(rec.sections); rec.translation ||= { status: 'none' }; touched = true; }
      // Fingerprints moved from SHA-256 to a hash the browser can compute; what was made from the same text still is.
      if (rec.hash_version !== HASH_VERSION) {
        const hash = fingerprint(rec.sections), text = textFingerprint(rec.sections);
        if (rec.prep.hash === rec.hash) rec.prep.hash = hash;
        if (rec.translation?.hash === rec.text_hash) rec.translation.hash = text;
        Object.assign(rec, { hash, text_hash: text, hash_version: HASH_VERSION }); touched = true;
      }
      if (rec.prep.status === 'running') { rec.prep = { status: 'error', error: '服务重启，拆块中断了，可以重试。' }; touched = true; }
      if (rec.translation?.status === 'running') { rec.translation = { status: 'error', error: '服务重启，翻译中断了，可以重试。' }; touched = true; }
      for (const a of [...rec.progress.inputs.flatMap(i => i.attempts), ...rec.say.attempts]) if (a.status === 'running') {
        Object.assign(a, { status: 'error', error: '服务重启，这次检查中断了，可以重试。' }); touched = true;
      }
      if (touched) store.putStep(rec);
    }
  }
  current() { return this.store.get('current'); }
  record(key) { return this.store.step(key); }
  state() {
    const current = this.current();
    return { current, record: current?.key ? this.store.step(current.key) : null };
  }
  // Only the step being followed can be changed, so a page left on an old step never writes over it.
  active(key) {
    id(key);
    const current = this.current(), rec = current?.key === key ? this.store.step(key) : null;
    check(rec, 'Math Academy 已经换到别的步骤了，页面会跟过去。', 409);
    return rec;
  }
  save(rec) {
    rec.updated_at = now(); this.store.putStep(rec);
    if (this.current()?.key === rec.key) this.publish();
    return rec;
  }

  capture(input) {
    const c = normalize(input), at = now();
    const key = c.page === 'lesson' && c.step ? `${c.task}-${c.step.id}` : null;
    const before = this.current();
    let changed = !before || before.key !== key || before.page !== c.page || before.task !== c.task;
    this.store.set('current', { page: c.page, task: c.task, topic: c.topic, key, at });
    if (key) {
      const hash = fingerprint(c.sections);
      let rec = this.store.step(key);
      if (!rec) { rec = fresh(c, key, hash, at); changed = true; }
      else if (rec.hash !== hash || rec.step.index !== c.step.index) {
        Object.assign(rec, { sections: c.sections, hash, step: c.step, title: c.title || rec.title, url: c.url || rec.url, text_hash: textFingerprint(c.sections) });
        // New words (a question's explanation, once answered) are translated again; a click on a choice is not new words.
        if (rec.translation?.hash !== rec.text_hash && rec.translation?.status !== 'none') rec.translation = { status: 'none' };
        // Text that changed under a finished preparation is prepared again; a question just gained its verdict.
        if (learnable(rec) && rec.prep.status !== 'none' && rec.prep.hash !== hash) { rec.prep = { status: 'none' }; rec.progress = progress(0); }
        changed = true;
      }
      if (changed) { rec.updated_at = at; this.store.putStep(rec); }
    }
    if (changed) this.publish();
    return { key };
  }

  command(body) {
    fields(body, ['type', 'key', 'index'], ['type', 'key']);
    const type = oneOf(body.type, ['write', 'peek', 'hint', 'next', 'restart']);
    const rec = this.active(body.key), p = rec.progress;
    if (type === 'restart') {
      check(rec.prep.status === 'ready', '这一步还没有拆好。', 409);
      (rec.past ||= []).push(p); rec.progress = progress(rec.prep.blocks.length);
      return this.save(rec);
    }
    // The index names the block the page is showing, so a second window cannot act on a block already left.
    check(body.index === p.index && p.phase !== 'done', '这一块已经过去了，页面会刷新。', 409);
    const input = p.inputs[p.index];
    if (type === 'write') { check(p.phase === 'learn', '现在不是看讲解的时候。', 409); p.phase = 'write'; }
    else if (type === 'peek') {
      // Looking again before writing is allowed, and counted.
      check(p.phase === 'write', '现在没有在默写。', 409); input.peeks++; p.phase = 'learn';
    } else if (type === 'hint') {
      check(['write', 'checked'].includes(p.phase), '现在没有在默写。', 409);
      input.hints = Math.min(3, input.hints + 1);
    } else if (type === 'next') {
      check(['write', 'checked'].includes(p.phase), '先遮住讲解，自己写一遍。', 409);
      check(!input.attempts.some(a => a.status === 'running'), '正在检查，稍等。', 409);
      if (!input.passed) input.skipped = true;
      if (p.index + 1 < p.inputs.length) { p.index++; p.phase = 'learn'; } else p.phase = 'done';
    }
    return this.save(rec);
  }
}
