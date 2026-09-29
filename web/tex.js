// The math a model writes into its explanations, hints and corrections is TeX between dollar signs. This turns it
// into MathML for the browser to draw. It covers what these lessons use (matrices, fractions, roots, scripts,
// Greek letters, the usual symbols) and gives up with null on anything else, so the page shows the TeX as it
// was written instead of a wrong picture. It only makes MathML text: math.js still rebuilds that element by
// element from an allowlist, so nothing a model wrote reaches the page unchecked. No DOM in here, so the tests
// run it in Node, and the engine can use splitMath and mend too.

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι',
  kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω' };
const UPPER = { Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
// Symbols that stand for a value or a mark rather than an operation.
const IDENT = { infty: '∞', partial: '∂', nabla: '∇', emptyset: '∅', varnothing: '∅', ell: 'ℓ', hbar: 'ℏ', top: '⊤', ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', prime: '′', degree: '°' };
const SYMBOL = { cdot: '⋅', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡',
  sim: '∼', simeq: '≃', propto: '∝', in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹', iff: '⟺', mapsto: '↦',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨', oplus: '⊕', otimes: '⊗', circ: '∘', bullet: '∙', ast: '∗', star: '⋆',
  perp: '⊥', parallel: '∥', angle: '∠', triangle: '△', mid: '∣', ll: '≪', gg: '≫', setminus: '∖', dagger: '†',
  langle: '⟨', rangle: '⟩', lbrace: '{', rbrace: '}', lvert: '|', rvert: '|', vert: '|', lVert: '‖', rVert: '‖', Vert: '‖', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉' };
const BIGOP = { sum: ['∑', true], prod: ['∏', true], coprod: ['∐', true], bigcup: ['⋃', true], bigcap: ['⋂', true], int: ['∫', false], iint: ['∬', false], oint: ['∮', false] };
const FUNC = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'log', 'ln', 'exp', 'det', 'dim', 'ker', 'gcd', 'deg', 'arg', 'Pr']);
const LIMFUNC = new Set(['lim', 'max', 'min', 'sup', 'inf', 'limsup', 'liminf']);
const ACCENT = { vec: '→', overrightarrow: '→', hat: 'ˆ', widehat: 'ˆ', bar: '¯', overline: '¯', tilde: '˜', widetilde: '˜', dot: '˙', ddot: '¨' };
const SPACE = { ',': '0.17em', ':': '0.22em', ';': '0.28em', ' ': '0.28em', quad: '1em', qquad: '2em' };
const BIG = new Set(['big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'Biggl', 'Biggr']);
const IGNORED = new Set(['displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits']);
// The environments: what fences a table, and how its columns line up.
const ENVIRONMENTS = { matrix: ['', ''], smallmatrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'],
  cases: ['{', ''], aligned: ['', '', 'alt'], align: ['', '', 'alt'], 'align*': ['', '', 'alt'], split: ['', '', 'alt'], gathered: ['', ''], array: ['', ''] };

// The letters TeX's \mathbf, \mathbb and \mathcal ask for, as the Unicode letters that look that way.
const STYLES = {
  bold: (c, cp) => /[A-Z]/.test(c) ? cp + 0x1D400 - 65 : /[a-z]/.test(c) ? cp + 0x1D41A - 97 : /[0-9]/.test(c) ? cp + 0x1D7CE - 48 : 0,
  double: (c, cp) => ({ C: 0x2102, H: 0x210D, N: 0x2115, P: 0x2119, Q: 0x211A, R: 0x211D, Z: 0x2124 })[c]
    || (/[A-Z]/.test(c) ? cp + 0x1D538 - 65 : /[a-z]/.test(c) ? cp + 0x1D552 - 97 : /[0-9]/.test(c) ? cp + 0x1D7D8 - 48 : 0),
  script: (c, cp) => ({ B: 0x212C, E: 0x2130, F: 0x2131, H: 0x210B, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211B })[c] || (/[A-Z]/.test(c) ? cp + 0x1D49C - 65 : 0),
};
const LOOK = { mathbf: 'bold', boldsymbol: 'bold', bm: 'bold', mathbb: 'double', mathcal: 'script', mathscr: 'script' };
const styled = (ml, kind) => ml.replace(/<(mi|mn)>([^<]*)<\/\1>/g, (all, tag, text) =>
  `<${tag}>${[...text].map(c => { const cp = c.codePointAt(0), to = STYLES[kind](c, cp); return to ? String.fromCodePoint(to) : c; }).join('')}</${tag}>`);

const mrow = nodes => { const parts = nodes.filter(n => n.ml); return parts.length === 1 ? parts[0].ml : `<mrow>${parts.map(n => n.ml).join('')}</mrow>`; };
const space = width => `<mspace width="${width}"/>`;

class Parser {
  constructor(src, display) { this.s = src; this.i = 0; this.display = display; this.depth = 0; this.fractions = 0; }
  fail(why) { throw new Error(why); }
  skip() { while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++; }
  at(text) { return this.s.startsWith(text, this.i); }
  expect(c) { this.skip(); if (this.s[this.i] !== c) this.fail(`expected ${c}`); this.i++; }
  run() {
    const nodes = this.row(new Set());
    if (this.i < this.s.length) this.fail('trailing text');
    return `<math${this.display ? ' display="block"' : ''}>${mrow(nodes)}</math>`;
  }
  // Items up to a stop: a closing brace, a cell or row break, \end or \right. The stop itself is left unread.
  row(stops) {
    if (++this.depth > 24) this.fail('nested too deep');
    const out = [];
    for (;;) {
      this.skip();
      if (this.i >= this.s.length) break;
      const c = this.s[this.i];
      if (c === '}') { if (stops.has('}')) break; this.fail('unbalanced brace'); }
      if (c === '&') { if (stops.has('&')) break; this.fail('stray &'); }
      if (c === '\\') {
        if (this.s[this.i + 1] === '\\') { if (stops.has('\\\\')) break; this.fail('stray line break'); }
        const name = /^\\([A-Za-z]+)/.exec(this.s.slice(this.i, this.i + 24))?.[1];
        if (name === 'end' || name === 'right') { if (stops.has(name)) break; this.fail(`stray ${name}`); }
      }
      const node = this.atom();
      if (node) { const done = this.scripts(node); out.push(done); if (done.tail) out.push({ ml: done.tail }); }
    }
    this.depth--;
    return out;
  }
  // One thing: a number, a letter, a symbol, a {group} or a \command; null for what draws nothing.
  atom() {
    const s = this.s, c = String.fromCodePoint(s.codePointAt(this.i));
    if (c === '{') { this.i++; const nodes = this.row(new Set(['}'])); this.expect('}'); return { ml: mrow(nodes) }; }
    if (c === '\\') return this.command();
    this.i += c.length;
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[this.i] || ''))) {
      let n = c;
      for (;;) {
        const d = s[this.i];
        if (d !== undefined && (/[0-9]/.test(d) || (d === '.' && /[0-9]/.test(s[this.i + 1] || '')))) { n += d; this.i++; } else break;
      }
      return { ml: `<mn>${n}</mn>` };
    }
    if (/[A-Za-z]/.test(c)) return { ml: `<mi>${c}</mi>` };
    if ('^_$#%`'.includes(c)) this.fail(`unexpected ${c}`);
    if (c === '~') return { ml: space('0.28em') };
    if (c === "'") return { ml: '<mo>′</mo>' };
    if (c === '-') return { ml: '<mo>−</mo>' };
    if (c === '*') return { ml: '<mo>∗</mo>' };
    if (/\p{L}/u.test(c)) return { ml: `<mi>${esc(c)}</mi>` };
    return { ml: `<mo>${esc(c)}</mo>` };
  }
  // What one argument stands for: a {group}, a single digit, or a single thing.
  arg() {
    this.skip();
    const c = this.s[this.i];
    if (c === undefined || '}&^_'.includes(c)) this.fail('missing argument');
    if (c === '{') { this.i++; const nodes = this.row(new Set(['}'])); this.expect('}'); return mrow(nodes); }
    if (/[0-9]/.test(c)) { this.i++; return `<mn>${c}</mn>`; }
    const node = this.atom();
    if (!node?.ml) this.fail('empty argument');
    return node.ml;
  }
  // The text between braces, read as it is (for \text).
  raw() {
    this.skip();
    if (this.s[this.i] !== '{') this.fail('expected {');
    let depth = 0;
    const start = ++this.i;
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i];
      if (c === '{') depth++;
      else if (c === '}') { if (!depth) break; depth--; }
    }
    if (this.i >= this.s.length) this.fail('unterminated group');
    return this.s.slice(start, this.i++);
  }
  scripts(base) {
    let sub = null, sup = null, prime = '';
    for (;;) {
      this.skip();
      const c = this.s[this.i];
      if (c === '^') { if (sup !== null) this.fail('two superscripts'); this.i++; sup = this.arg(); }
      else if (c === '_') { if (sub !== null) this.fail('two subscripts'); this.i++; sub = this.arg(); }
      else if (c === "'") { this.i++; prime += '<mo>′</mo>'; }
      else break;
    }
    if (prime) sup = sup === null ? prime : `<mrow>${prime}${sup}</mrow>`;
    if (sub === null && sup === null) return base;
    // A sum or a limit carries its bounds above and below when it stands on its own line.
    const over = base.limits && this.display;
    const tag = sub !== null && sup !== null ? (over ? 'munderover' : 'msubsup') : sub !== null ? (over ? 'munder' : 'msub') : (over ? 'mover' : 'msup');
    return { ml: `<${tag}>${base.ml}${sub ?? ''}${sup ?? ''}</${tag}>`, tail: base.tail };
  }
  delimiter() {
    this.skip();
    const c = this.s[this.i];
    if (c === undefined) this.fail('missing delimiter');
    if (c === '.') { this.i++; return ''; }
    if ('()[]|<>/'.includes(c)) { this.i++; return c; }
    if (c === '\\') {
      const next = this.s[this.i + 1];
      if (next === '{' || next === '}') { this.i += 2; return next; }
      if (next === '|') { this.i += 2; return '‖'; }
      const name = /^\\([A-Za-z]+)/.exec(this.s.slice(this.i, this.i + 24))?.[1];
      if (name && SYMBOL[name]) { this.i += 1 + name.length; return SYMBOL[name]; }
    }
    return this.fail('unknown delimiter');
  }
  command() {
    const s = this.s;
    this.i++;
    const named = /^[A-Za-z]+/.exec(s.slice(this.i, this.i + 40));
    if (!named) {
      const c = s[this.i++];
      if (c === undefined) this.fail('dangling backslash');
      if (SPACE[c]) return { ml: space(SPACE[c]) };
      if (c === '!') return null;
      if ('{}%$&#_'.includes(c)) return { ml: `<mo>${c}</mo>` };
      if (c === '|') return { ml: '<mo>‖</mo>' };
      return this.fail(`unknown \\${c}`);
    }
    const name = named[0];
    this.i += name.length;
    if (GREEK[name]) return { ml: `<mi>${GREEK[name]}</mi>` };
    if (UPPER[name]) return { ml: `<mi mathvariant="normal">${UPPER[name]}</mi>` };
    if (IDENT[name]) return { ml: `<mi>${IDENT[name]}</mi>` };
    if (SYMBOL[name]) return { ml: `<mo>${SYMBOL[name]}</mo>` };
    if (BIGOP[name]) return { ml: `<mo largeop="true" movablelimits="true">${BIGOP[name][0]}</mo>`, limits: BIGOP[name][1] };
    if (FUNC.has(name)) return { ml: `<mi>${name}</mi>`, tail: space('0.17em') };
    if (LIMFUNC.has(name)) return { ml: `<mi>${name}</mi>`, limits: true, tail: space('0.17em') };
    if (SPACE[name]) return { ml: space(SPACE[name]) };
    if (IGNORED.has(name)) return null;
    if (BIG.has(name)) { const d = this.delimiter(); return { ml: d ? `<mo>${esc(d)}</mo>` : '' }; }
    if (ACCENT[name]) return { ml: `<mover accent="true">${this.arg()}<mo>${ACCENT[name]}</mo></mover>` };
    if (LOOK[name]) return { ml: styled(this.arg(), LOOK[name]) };
    switch (name) {
      case 'frac': case 'dfrac': case 'tfrac': case 'cfrac': {
        // TeX shrinks a fraction inside a line of text, which is too small to read here: the outermost one is set
        // at full size (\tfrac keeps the small one), and a fraction inside a fraction shrinks as usual.
        const outer = name !== 'tfrac' && this.fractions === 0;
        this.fractions++;
        const top = this.arg(), bottom = this.arg();
        this.fractions--;
        const fraction = `<mfrac>${top}${bottom}</mfrac>`;
        return { ml: outer ? `<mstyle displaystyle="true" scriptlevel="0">${fraction}</mstyle>` : fraction };
      }
      case 'binom': case 'dbinom': return { ml: `<mrow><mo>(</mo><mfrac linethickness="0">${this.arg()}${this.arg()}</mfrac><mo>)</mo></mrow>` };
      case 'sqrt': {
        this.skip();
        if (s[this.i] === '[') {
          const end = s.indexOf(']', this.i);
          if (end < 0) this.fail('unterminated root index');
          const index = new Parser(s.slice(this.i + 1, end), false).run().slice('<math>'.length, -'</math>'.length);
          this.i = end + 1;
          return { ml: `<mroot>${this.arg()}${index}</mroot>` };
        }
        return { ml: `<msqrt>${this.arg()}</msqrt>` };
      }
      case 'text': case 'textbf': case 'textit': case 'mbox': case 'textrm': {
        const words = this.raw().replace(/\\([%$&#_{}])/g, '$1').replace(/^ /, ' ').replace(/ $/, ' ');
        return { ml: `<mtext>${esc(words)}</mtext>` };
      }
      case 'mathrm': case 'operatorname': case 'mathit': case 'mathsf': case 'mathtt': case 'underline': case 'boxed': {
        const inner = this.arg();
        return { ml: name === 'mathrm' || name === 'operatorname' ? inner.replace(/<mi>/g, '<mi mathvariant="normal">') : inner };
      }
      case 'overset': { const over = this.arg(); return { ml: `<mover>${this.arg()}${over}</mover>` }; }
      case 'underset': { const under = this.arg(); return { ml: `<munder>${this.arg()}${under}</munder>` }; }
      case 'left': {
        const open = this.delimiter(), nodes = this.row(new Set(['right']));
        if (!this.at('\\right')) this.fail('missing \\right');
        this.i += '\\right'.length;
        const close = this.delimiter();
        return { ml: `<mrow>${open ? `<mo>${esc(open)}</mo>` : ''}${mrow(nodes)}${close ? `<mo>${esc(close)}</mo>` : ''}</mrow>` };
      }
      case 'begin': return this.environment();
      default: return this.fail(`unknown \\${name}`);
    }
  }
  environment() {
    const name = this.raw().trim(), spec = ENVIRONMENTS[name];
    if (!spec) this.fail(`unknown environment ${name}`);
    const columns = name === 'array' ? [...this.raw().replace(/[^lcr]/g, '')].map(c => ({ l: 'left', c: 'center', r: 'right' })[c]) : null;
    const rows = [[]];
    for (;;) {
      rows.at(-1).push(this.row(new Set(['&', '\\\\', 'end'])));
      this.skip();
      if (this.at('&')) { this.i++; continue; }
      if (this.at('\\\\')) {
        this.i += 2;
        const gap = /^\[-?[\d.]+(pt|em|ex|mm|cm)\]/.exec(this.s.slice(this.i));
        if (gap) this.i += gap[0].length;
        rows.push([]);
        continue;
      }
      if (this.at('\\end')) { this.i += 4; if (this.raw().trim() !== name) this.fail('mismatched \\end'); break; }
      this.fail('unterminated environment');
    }
    // A closing \\ leaves an empty last row.
    if (rows.length > 1 && rows.at(-1).length === 1 && !rows.at(-1)[0].length) rows.pop();
    const width = Math.max(...rows.map(r => r.length));
    const align = spec[2] === 'alt' ? Array.from({ length: width }, (_, k) => k % 2 ? 'left' : 'right').join(' ')
      : name === 'cases' ? 'left' : columns?.length ? columns.join(' ') : null;
    const table = `<mtable${align ? ` columnalign="${align}"` : ''} columnspacing="${spec[2] === 'alt' ? '0em' : '1em'}" rowspacing="4pt">`
      + rows.map(r => `<mtr>${r.map(cell => `<mtd>${mrow(cell)}</mtd>`).join('')}</mtr>`).join('') + '</mtable>';
    return { ml: spec[0] || spec[1] ? `<mrow>${spec[0] ? `<mo>${spec[0]}</mo>` : ''}${table}${spec[1] ? `<mo>${spec[1]}</mo>` : ''}</mrow>` : table };
  }
}

// MathML for the TeX, or null when it is empty, too long, or uses something not covered here.
export function texToMathML(tex, display = false) {
  if (typeof tex !== 'string' || !tex.trim() || tex.length > 2000) return null;
  try { return new Parser(tex, display).run(); } catch { return null; }
}

// Where the math is in a text: $…$ inline, $$…$$ on its own line, \$ for a dollar sign. The usual rule tells
// math from money: the opening $ is followed by something other than a space, the closing one is not preceded
// by a space and not followed by a digit, and the next $ decides it, so "costs $5 and $7" stays as it is and
// "$5, then $x^2$" still finds its formula.
const INLINE_MAX = 400;
// A tab or a newline is not blank when the text is being mended: it may be what became of \t or \n.
const blank = (c, mending) => mending ? c === ' ' : /\s/.test(c);
function spanEnd(text, from, display, mending) {
  for (let j = from; j < text.length && (mending || display || j - from <= INLINE_MAX); j++) {
    const c = text[j];
    if (c === '\\') { j++; continue; }
    if (c === '\n' && !mending && !display) return -1;
    if (c !== '$') continue;
    if (display) { if (text[j + 1] === '$' && !blank(text[j - 1] || ' ', mending)) return j; continue; }
    return !blank(text[j - 1], mending) && !/\d/.test(text[j + 1] || '') ? j : -1;
  }
  return -1;
}
// Every span, with where its TeX lies (from, to) in the text.
function scan(text, mending = false) {
  const spans = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] !== '$') continue;
    const display = text[i + 1] === '$', open = display ? 2 : 1;
    if (!display && (text[i + 1] === undefined || blank(text[i + 1], mending))) continue;
    const end = spanEnd(text, i + open, display, mending);
    if (end < 0 || !text.slice(i + open, end).trim()) continue;
    spans.push({ from: i + open, to: end, display });
    i = end + (display ? 1 : 0);
  }
  return spans;
}
export function splitMath(text) {
  const parts = [];
  let at = 0;
  const plain = (a, b) => { const v = text.slice(a, b).replace(/\\\$/g, '$'); if (v) parts.push({ t: 'text', v }); };
  for (const { from, to, display } of scan(text)) {
    const open = display ? 2 : 1;
    plain(at, from - open);
    parts.push({ t: 'math', tex: text.slice(from, to).trim(), display });
    at = to + open;
  }
  plain(at, text.length);
  return parts;
}

// JSON turns a single backslash in front of b, f, r, t, n into a control character, so a model that wrote \begin,
// \frac, \right, \theta or \neq without doubling the backslash hands over a backspace, form feed, ... where the
// command should be. They are put back: \b \f \v \r wherever they are (nobody writes those on purpose), tab and
// newline only inside a $…$ (where the newline is allowed to have split it), and nothing else is touched.
export function mend(text) {
  if (typeof text !== 'string' || !/[\b\f\v\r\t\n]/.test(text)) return text;
  const back = { '\b': '\\b', '\f': '\\f', '\v': '\\v', '\r': '\\r', '\t': '\\t', '\n': '\\n' };
  const fixed = text.replace(/\r\n/g, '\n').replace(/[\b\f\v\r]/g, c => back[c]);
  let out = '', at = 0;
  for (const { from, to } of scan(fixed, true)) { out += fixed.slice(at, from) + fixed.slice(from, to).replace(/[\t\n]/g, c => back[c]); at = to; }
  return out + fixed.slice(at);
}
