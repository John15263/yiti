import { createHash } from 'node:crypto';
import { check } from './validation.mjs';

// What the extension reads off Math Academy, checked and trimmed before anything keeps it.
//
// A step's text is a list of paragraphs; a paragraph is a list of parts: plain text, or one formula
// with its TeX source (and the MathML Math Academy's own MathJax made from it, for display here).
//
//   { page: 'lesson', task, topic, url, step: { id, type, index, total }, title,
//     sections: { body | question | explanation: Paragraphs, choices: [{ letter, content, picked }], result, answer } }
//
// Pages other than a lesson (quiz, review, diagnostic…) arrive as { page, task?, topic? } with no content.

const TYPES = { t: 'tutorial', e: 'example', q: 'question' };
const MAX_PARAS = 80, MAX_PARTS = 80, MAX_TEXT = 4000, MAX_TEX = 2000, MAX_MML = 30000;

function parts(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list.slice(0, MAX_PARTS)) {
    if (p?.t === 'text' && typeof p.v === 'string' && p.v.trim()) out.push({ t: 'text', v: p.v.slice(0, MAX_TEXT) });
    else if (p?.t === 'math' && typeof p.tex === 'string' && p.tex.trim()) {
      out.push({ t: 'math', tex: p.tex.trim().slice(0, MAX_TEX), display: p.display === true,
        ...(typeof p.mml === 'string' && p.mml.length <= MAX_MML && p.mml.startsWith('<math') ? { mml: p.mml } : {}) });
    }
  }
  return out;
}
export function paragraphs(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_PARAS).map(parts).filter(p => p.length);
}

export function normalize(input) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'Expected an object');
  const page = typeof input.page === 'string' && /^[a-z-]{1,30}$/.test(input.page) ? input.page : 'other';
  const digits = v => typeof v === 'string' && /^\d{1,20}$/.test(v) ? v : null;
  const task = digits(input.task), topic = digits(input.topic);
  if (page !== 'lesson') return { page, task, topic };
  check(task, 'Invalid task');
  const s = input.step;
  if (!s) return { page, task, topic, step: null };
  check(typeof s.id === 'string' && /^[a-z]\d{1,12}$/.test(s.id), 'Invalid step');
  const step = { id: s.id, type: TYPES[s.id[0]] || 'other',
    index: Number.isInteger(s.index) && s.index >= 0 ? s.index : 0, total: Number.isInteger(s.total) && s.total > 0 ? s.total : 0 };
  const sec = input.sections && typeof input.sections === 'object' ? input.sections : {};
  const sections = {};
  for (const name of ['body', 'question', 'explanation']) if (sec[name]) sections[name] = paragraphs(sec[name]);
  if (Array.isArray(sec.choices)) sections.choices = sec.choices.slice(0, 12).map(c => ({
    letter: typeof c?.letter === 'string' ? c.letter.slice(0, 4) : '', content: paragraphs(c?.content), picked: c?.picked === true }));
  if (typeof sec.result === 'string' && sec.result.trim()) sections.result = sec.result.trim().slice(0, 40);
  if (typeof sec.answer === 'string' && sec.answer.trim()) sections.answer = sec.answer.trim().slice(0, 400);
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 200) : '';
  const url = typeof input.url === 'string' && /^https:\/\/(www\.)?mathacademy\.com\//.test(input.url) ? input.url.slice(0, 300) : '';
  return { page, task, topic, url, step, title, sections };
}

// A question counts as answered once Math Academy shows its verdict.
export const answered = sections => !!sections?.result;

// The content a preparation was made from; the MathML is only how it looks, so it is left out.
export function fingerprint(sections) {
  const plain = JSON.stringify(sections, (k, v) => k === 'mml' ? undefined : v);
  return createHash('sha256').update(plain).digest('hex').slice(0, 16);
}

// Only the words that get translated: picking a choice or getting the verdict changes nothing here.
export function textFingerprint(sections) {
  const words = { question: sections?.question, explanation: sections?.explanation, body: sections?.body, choices: sections?.choices?.map(c => c.content) };
  return fingerprint(words);
}

// Paragraphs as text for a prompt, formulas kept as TeX.
export const paraText = para => para.map(p => p.t === 'text' ? p.v : p.display ? `$$${p.tex}$$` : `$${p.tex}$`).join('').replace(/\s+/g, ' ').trim();
export const parasText = paras => (paras || []).map(paraText).join('\n');
