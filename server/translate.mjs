// Chinese for a step's English. Formulas are never rewritten: each is sent as a marker ⟦k⟧ and put back
// as it was, only the words inside it (\text{…}, <mtext>) swapped for their translation. Paragraphs keep
// their count and order, so blocks prepared from the English still point at the same paragraphs.
const MARK = /⟦(\d+)⟧/g;
const MTEXT = /<mtext([^>]*)>([^<&]*)<\/mtext>/g;
const worded = v => /[A-Za-z]{2}/.test(v);
const escape = v => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function* paragraphsOf(sections) {
  for (const name of ['question', 'explanation', 'body']) for (const [i, para] of (sections[name] || []).entries()) yield [`${name}.${i}`, para];
  for (const [c, choice] of (sections.choices || []).entries()) for (const [i, para] of choice.content.entries()) yield [`choices.${c}.${i}`, para];
}
const marked = para => para.map((p, k) => p.t === 'text' ? p.v : `⟦${k}⟧`).join('').replace(/\s+/g, ' ').trim();

export function plan(title, sections) {
  const paragraphs = [], phrases = new Set();
  for (const [id, para] of paragraphsOf(sections)) {
    if (para.some(p => p.t === 'text' && worded(p.v))) paragraphs.push({ id, text: marked(para) });
    for (const p of para) if (p.t === 'math') for (const [, , words] of (p.mml || '').matchAll(MTEXT)) if (worded(words)) phrases.add(words.trim());
  }
  return { title, paragraphs, phrases: [...phrases] };
}

// A formula with its words translated; the TeX and the MathML carry the same words.
function formula(part, dict) {
  if (!dict.size) return part;
  let { tex, mml } = part;
  for (const [en, zh] of dict) tex = tex.split(`\\text{${en}}`).join(`\\text{${zh}}`);
  if (mml) mml = mml.replace(MTEXT, (all, attrs, words) => dict.has(words.trim()) ? `<mtext${attrs}>${escape(dict.get(words.trim()))}</mtext>` : all);
  return { ...part, tex, ...(mml ? { mml } : {}) };
}
// Math Academy often writes the sentence's full stop inside an inline formula ("12."). A Chinese sentence
// brings its own punctuation, so the formula's is dropped when Chinese punctuation follows it.
function unstop(part) {
  if (part.display || !/[.,]$/.test(part.tex)) return part;
  const mml = part.mml?.replace(/<mo>[.,]<\/mo>(<\/math>)$/, '$1').replace(/<mn>([^<]*?)[.,]<\/mn>(<\/math>)$/, '<mn>$1</mn>$2');
  return { ...part, tex: part.tex.replace(/[.,]$/, '').trimEnd(), ...(mml ? { mml } : {}) };
}

// The translated text split back at its markers. Every formula must come back exactly once, or the
// paragraph is kept in English rather than shown with a formula missing or doubled.
function rebuild(para, text, dict) {
  const maths = new Map(para.map((p, k) => [k, p]).filter(([, p]) => p.t === 'math'));
  const out = [], used = new Set();
  let at = 0;
  for (const m of text.matchAll(MARK)) {
    const k = Number(m[1]);
    if (!maths.has(k) || used.has(k)) return null;
    if (m.index > at) out.push({ t: 'text', v: text.slice(at, m.index) });
    out.push(formula(maths.get(k), dict)); used.add(k); at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ t: 'text', v: text.slice(at) });
  for (const [j, part] of out.entries()) if (part.t === 'math' && /^\s*[。，、；：？！]/.test(out[j + 1]?.v || '')) out[j] = unstop(part);
  return used.size === maths.size ? out : null;
}

export function apply(title, sections, value) {
  const texts = new Map((Array.isArray(value?.paragraphs) ? value.paragraphs : [])
    .filter(p => typeof p?.id === 'string' && typeof p.text === 'string' && p.text.trim()).map(p => [p.id, p.text.trim().slice(0, 6000)]));
  const dict = new Map((Array.isArray(value?.phrases) ? value.phrases : [])
    .filter(p => typeof p?.en === 'string' && typeof p.zh === 'string' && p.zh.trim()).map(p => [p.en.trim(), p.zh.trim().slice(0, 200)]));
  const one = (id, para) => (texts.has(id) && rebuild(para, texts.get(id), dict)) || para.map(p => p.t === 'math' ? formula(p, dict) : p);
  const out = {};
  for (const name of ['question', 'explanation', 'body']) if (sections[name]) out[name] = sections[name].map((para, i) => one(`${name}.${i}`, para));
  if (sections.choices) out.choices = sections.choices.map((c, ci) => ({ ...c, content: c.content.map((para, i) => one(`choices.${ci}.${i}`, para)) }));
  const missing = [...paragraphsOf(sections)].filter(([id, para]) => para.some(p => p.t === 'text' && worded(p.v)) && !texts.has(id)).length;
  return { title: typeof value?.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 200) : title, sections: out, missing };
}
