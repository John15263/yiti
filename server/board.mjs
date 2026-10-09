import { check, id } from './validation.mjs';
import { normalize, fingerprint, textFingerprint, STEP_PAGES } from './capture.mjs';

const HASH_VERSION = 2;

const now = () => new Date().toISOString();

function fresh(c, key, hash, at) {
  return { key, page: c.page, task: c.task, topic: c.topic, url: c.url, step: c.step, title: c.title, sections: c.sections, hash, text_hash: textFingerprint(c.sections),
    hash_version: HASH_VERSION, created_at: at, updated_at: at, translation: { status: 'none' }, voice: [] };
}

// The conversation about a step, kept on it (至多 MAX_CHAT 条，旧的先丢).
export const MAX_CHAT = 60;
export function pushChat(rec, ...messages) {
  const chat = rec.chat ||= { messages: [], status: 'idle' };
  for (const m of messages) chat.messages.push({ id: crypto.randomUUID(), at: now(), ...m });
  chat.messages = chat.messages.slice(-MAX_CHAT);
  return chat;
}

// What a lesson teaches, from the titles of the tutorials and examples already followed on it: new material is not
// a prerequisite. A review has no tutorials of its own; it is on a topic learned before, and when that topic's lesson
// was followed here (the same topic number, another task), that lesson is what it teaches. own tells the two apart.
const content = r => ['tutorial', 'example'].includes(r.step?.type) && r.title;
export function lessonOf(store, rec) {
  const steps = store.steps(), titlesOf = task => steps.filter(r => r.task === task && content(r)).sort((a, b) => a.step.index - b.step.index).map(r => r.title);
  const titles = titlesOf(rec.task);
  if (titles.length || !rec.topic) return { task: rec.task, titles, own: true };
  // The most recent lesson on the topic, if it was done more than once.
  const lesson = steps.find(r => r.topic === rec.topic && r.task !== rec.task && content(r));
  return lesson ? { task: lesson.task, titles: titlesOf(lesson.task), own: false } : { task: rec.task, titles, own: true };
}
export const lessonTitles = (store, rec) => lessonOf(store, rec).titles;

// Follows whichever Math Academy step was read last, and keeps what was done on each step.
export class Board {
  constructor(store, publish = () => {}) {
    this.store = store; this.publish = publish;
    // Every state handed out is numbered in the order it was taken, so the page can tell an older one from a newer
    // one (web/order.js). The count restarts with the engine, hence the boot id beside it.
    this.boot = crypto.randomUUID(); this.seq = 0;
    // Calls cut off by a restart are never replayed (avoids surprise charges); they are marked so they can be retried.
    // Records made by older versions also hold blocks, attempts and variants; those are simply left where they are.
    for (const rec of store.steps()) {
      let touched = false;
      if (!rec.text_hash) { rec.text_hash = textFingerprint(rec.sections); rec.translation ||= { status: 'none' }; touched = true; }
      // Fingerprints moved from SHA-256 to a hash the browser can compute; what was made from the same text still is.
      if (rec.hash_version !== HASH_VERSION) {
        const hash = fingerprint(rec.sections), text = textFingerprint(rec.sections);
        if (rec.translation?.hash === rec.text_hash) rec.translation.hash = text;
        Object.assign(rec, { hash, text_hash: text, hash_version: HASH_VERSION }); touched = true;
      }
      if (rec.translation?.status === 'running') { rec.translation = { status: 'error', error: '服务重启，翻译中断了，可以重试。' }; touched = true; }
      if (touched) store.putStep(rec);
    }
  }
  current() { return this.store.get('current'); }
  record(key) { return this.store.step(key); }
  state() {
    const current = this.current(), record = current?.key ? this.store.step(current.key) : null;
    return { current, record, boot: this.boot, seq: ++this.seq };
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
    const key = STEP_PAGES.includes(c.page) && c.step ? `${c.task}-${c.step.id}` : null;
    const before = this.current();
    let changed = !before || before.key !== key || before.page !== c.page || before.task !== c.task;
    this.store.set('current', { page: c.page, task: c.task, topic: c.topic, key, at });
    if (key) {
      const hash = fingerprint(c.sections);
      let rec = this.store.step(key);
      if (!rec) { rec = fresh(c, key, hash, at); changed = true; }
      else if (rec.hash !== hash || rec.step.index !== c.step.index) {
        Object.assign(rec, { page: c.page, sections: c.sections, hash, step: c.step, title: c.title || rec.title, url: c.url || rec.url, text_hash: textFingerprint(c.sections) });
        // New words (a question's explanation, once answered) are translated again; a click on a choice is not new words.
        if (rec.translation?.hash !== rec.text_hash && rec.translation?.status !== 'none') rec.translation = { status: 'none' };
        changed = true;
      }
      if (changed) { rec.updated_at = at; this.store.putStep(rec); }
    }
    // Math Academy's own prerequisites, kept per topic for whenever that topic comes up.
    for (const { topic, prereqs } of c.official || []) {
      if (JSON.stringify(this.store.get(`official:${topic}`)?.prereqs) === JSON.stringify(prereqs)) continue;
      this.store.set(`official:${topic}`, { prereqs, at });
      if (topic === c.topic) changed = true;
    }
    if (changed) this.publish();
    return { key };
  }
}
