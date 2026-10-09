import { check } from './validation.mjs';
import { textError, textConfigured, textKeyMissing } from './llm.mjs';

// 更简单的解释, the one way 一题 has of it. Something already told (a tutorial or an official explanation, an item of
// 前置知识 opened up, an entry of 学这个有什么用) is told again for someone who knows less, and again, up to a limit. Every
// telling is kept, and the learner can go back and forth between them.
//
// A thing's tellings: { versions: [telling…], at, limit, simplifying?: { status: 'running' | 'error', id, boot, error } }.
// versions[at] is the one on screen (at is -1 while there is none: a step's own words are its first telling and are not
// kept here). What is told, how the model is asked and where it is kept differ from place to place; they are handed in:
//   access(fn)           runs fn on the tellings as they are kept now (null when they are gone) and keeps what fn changed;
//                        fn may throw to refuse, and then nothing is kept.
//   call(current, count) asks the model for the next telling, given the one it follows (null if none) and how many times
//                        it has been made simpler already. What the model is shown is decided there, and only there.
//   parse(value)         the telling out of the reply, or null.
//   base                 how many tellings are not simplifications (an opened item: 1, its first telling; a step: 0).
//   show(t)              after the telling on screen changed, for a holder that mirrors it where the page reads it.
//   before(t)            first, on every ask (to count asks made before an answer).
export const SIMPLEST = '已经是最简单的一版了。还不明白的话，问问陪练。';

export function simplerTelling({ access, cfg, boot, call, parse, base = 1, show = () => {}, before = () => {} }) {
  let started = null, current = null, count = 0;
  access(t => {
    check(t, '先把这一项展开。', 409);
    before(t);
    // One already made after the one on screen is shown again without a call.
    if (t.at < t.versions.length - 1) { t.at++; show(t); return; }
    if (t.simplifying?.status === 'running') return;
    check(t.versions.length < t.limit, SIMPLEST, 409);
    check(textConfigured(cfg), textKeyMissing(cfg), 503);
    started = crypto.randomUUID(); current = t.versions.at(-1) ?? null; count = Math.max(0, t.versions.length - base);
    t.simplifying = { status: 'running', id: started, boot };
  });
  if (!started) return;
  Promise.resolve().then(() => call(current, count)).then(({ value, model }) => {
    const next = parse(value);
    check(next, 'Invalid model response');
    access(t => {
      if (t?.simplifying?.id !== started) return;
      // The new telling is shown at once unless the learner has gone back to an earlier one meanwhile.
      const shown = t.at === t.versions.length - 1;
      t.versions = [...t.versions, next];
      if (shown) { t.at = t.versions.length - 1; show(t); }
      t.model = model; delete t.simplifying;
    });
  }).catch(error => access(t => { if (t?.simplifying?.id === started) t.simplifying = { status: 'error', error: textError(error, cfg) }; }));
}

// Back to the telling before, from those already made.
export function earlierTelling({ access, show = () => {} }) {
  access(t => { check(t && t.at > 0 && t.versions[t.at - 1] !== undefined, '已经是第一种讲法了。', 409); t.at--; show(t); });
}

// A telling being made when the engine stopped is never replayed: it is marked as cut off, to be asked for again.
export function staleTelling(t, boot, error = '重新讲解中断了，可以重试。') {
  if (t?.simplifying?.status !== 'running' || (boot && t.simplifying.boot === boot)) return false;
  t.simplifying = { status: 'error', error };
  return true;
}
