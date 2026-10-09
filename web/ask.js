// 划线提问: select some words on the page and send them to 问一问 in one click. What may be sent, and from where.
import { answered, unanswered, wrong } from './mode.js';

export const CLIP = 600;
// What is sent is a quotation, kept short: a whole page pasted in is not a question.
export function clip(text) {
  const t = String(text ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return [...t].length > CLIP ? `${[...t].slice(0, CLIP).join('')}…` : t;
}

// The buttons that appear beside a selection, and what each one says. "quote" only puts the words in the box to be
// completed by hand.
export const ACTIONS = [['explain', '解释'], ['example', '举例'], ['why', '为什么'], ['quote', '引用']];
export function askText(action, quote) {
  const q = clip(quote);
  const text = { explain: `请解释这一段：「${q}」`, example: `请举一个例子说明：「${q}」`, why: `「${q}」为什么是这样？`, quote: `关于「${q}」：` }[action];
  if (!text) throw new Error(`Unknown action: ${action}`);
  return text;
}

// After a question is answered, the questions worth asking are one click away; which ones depends on whether the answer was a
// miss and on whether the tutor has already answered something here. Nothing is asked for the learner: Math Academy shows
// its own explanation after a miss, and a call is spent only when they choose to ask.
export const WRONG_ASK = '我这道题答错了。请针对我选的（或填的）答案，讲讲我错在哪里，再讲正确的思路。';
export function ideasFor(rec) {
  if (!answered(rec)) return [];
  if ((rec.chat?.messages || []).some(m => m.role === 'assistant')) {
    return [{ label: '再讲简单一点', text: '请用更简单的话再讲一遍，可以拆成更小的步骤。' }, { label: '举个类似的例子', text: '请举一个类似、但数字不同的例子，带着我走一遍。' }];
  }
  return [...(wrong(rec) ? [{ label: '讲讲我错在哪', text: WRONG_ASK }] : []), { label: '这道题怎么做', text: '请一步一步讲讲这道题正确的做法。' }];
}

// Where on the page a selection may be taken from. A practice question not yet answered is the one thing the tutor must
// not be handed: before the answer its own words (the question and its choices) get no shortcut, so it is never
// one click away from being sent. The rest of the page, and the question once answered, do.
const AREAS = new Set(['question', 'choices', 'content', 'answer', 'simpler', 'prereq', 'later', 'place', 'chat']);
export function mayAsk(rec, area) {
  if (!rec?.step || !AREAS.has(area)) return false;
  return !(unanswered(rec) && (area === 'question' || area === 'choices'));
}
