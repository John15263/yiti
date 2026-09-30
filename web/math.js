// Paragraphs from Math Academy, drawn here: text as text, formulas as MathML (the browser draws it natively).
// The MathML was made by Math Academy's own MathJax; it is still rebuilt element by element from an
// allowlist, so nothing but math markup ever reaches the page. The same goes for what a model writes with math
// in it ($…$, see rich below): tex.js makes the MathML, and it takes the same way in.
import { texToMathML, splitMath } from './tex.js';
const NS = 'http://www.w3.org/1998/Math/MathML';
const TAGS = new Set(['math', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot',
  'mstyle', 'mpadded', 'mphantom', 'menclose', 'mtable', 'mtr', 'mtd', 'mlabeledtr', 'munder', 'mover', 'munderover', 'mmultiscripts',
  'mprescripts', 'none', 'semantics', 'merror']);
const ATTRS = new Set(['display', 'mathvariant', 'stretchy', 'fence', 'separator', 'form', 'lspace', 'rspace', 'width', 'height', 'depth',
  'columnalign', 'rowspacing', 'columnspacing', 'rowalign', 'columnlines', 'rowlines', 'frame', 'accent', 'accentunder', 'linethickness',
  'displaystyle', 'scriptlevel', 'minsize', 'maxsize', 'movablelimits', 'largeop', 'symmetric', 'notation', 'align']);

function rebuild(node) {
  if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
  if (node.nodeType !== 1) return null;
  const tag = node.localName;
  if (!TAGS.has(tag)) return null;
  const out = document.createElementNS(NS, tag);
  for (const a of node.attributes) if (ATTRS.has(a.name)) out.setAttribute(a.name, a.value);
  if (tag === 'mtable') align(out);
  for (const child of node.childNodes) { const c = rebuild(child); if (c) out.append(c); }
  if (tag === 'mrow') fence(out);
  return out;
}

// The browser does not stretch a bracket to the height of a matrix, and the table's own columnalign is not
// honoured either, so both are drawn by the stylesheet, from two marks set here (never copied from the input).
const FENCES = { '[': ['bracket', ']'], '(': ['paren', ')'], '|': ['bar', '|'], '‖': ['dbar', '‖'], '∥': ['dbar', '∥'], '{': ['brace', '}'] };
// [ table ] becomes the table alone, marked with which fence to draw around it.
function fence(row) {
  const kids = [...row.children];
  if (kids.length < 2 || kids.length > 3) return;
  const [open, table, close] = kids;
  if (open.localName !== 'mo' || table.localName !== 'mtable') return;
  const kind = FENCES[open.textContent.trim()];
  if (!kind) return;
  const closing = kids.length === 3 ? (close.localName === 'mo' ? close.textContent.trim() : null) : '';
  if (closing === null) return;
  // A pair around the table, or a brace with nothing to close it (cases: a system of equations).
  const mark = closing === kind[1] ? kind[0] : closing === '' && kind[0] === 'brace' ? 'cases' : null;
  if (!mark) return;
  table.setAttribute('data-fence', mark);
  row.replaceChildren(table);
}
function align(table) {
  const columns = (table.getAttribute('columnalign') || '').split(/\s+/).filter(Boolean);
  if (columns.length && columns.every(c => c === 'left')) table.setAttribute('data-align', 'left');
  else if (columns.length && columns.every(c => c === 'right')) table.setAttribute('data-align', 'right');
  else if (columns[0] === 'right' && columns[1] === 'left') table.setAttribute('data-align', 'alt');
}
export function formula(part) {
  // Math Academy's own MathML when it came with the formula; else what tex.js can make of the TeX.
  const mml = part.mml || texToMathML(part.tex, part.display);
  if (mml) {
    const parsed = new DOMParser().parseFromString(mml, 'text/html').body.firstElementChild;
    const math = parsed && rebuild(parsed);
    if (math) {
      if (part.display) math.setAttribute('display', 'block');
      // What was written, kept beside what is drawn, so words selected across a formula can be quoted as the formula.
      if (part.tex) math.setAttribute('data-tex', part.tex);
      return math;
    }
  }
  const code = document.createElement('code');
  code.className = 'tex'; code.textContent = part.tex;
  return code;
}
export function paragraph(parts) {
  const p = document.createElement('p');
  if (parts.length === 1 && parts[0].t === 'math' && parts[0].display) p.className = 'display';
  for (const part of parts) p.append(part.t === 'math' ? formula(part) : document.createTextNode(part.v));
  return p;
}
export function draw(target, paras) {
  target.replaceChildren(...(paras || []).map(paragraph));
}
// Text a model wrote, with its math between dollar signs; a formula that cannot be drawn shows as its TeX.
export function rich(target, value) {
  const parts = splitMath(typeof value === 'string' ? value : '');
  // A formula on its own line is already a block: the line breaks around it are not blank lines as well.
  const nodes = parts.map((part, k) => {
    if (part.t === 'math') return formula({ t: 'math', tex: part.tex, display: part.display, mml: texToMathML(part.tex, part.display) || '' });
    const v = part.v.replace(parts[k - 1]?.display ? /^\n/ : /^(?!)/, '').replace(parts[k + 1]?.display ? /\n$/ : /(?!)$/, '');
    return v ? document.createTextNode(v) : null;
  });
  target.replaceChildren(...nodes.filter(Boolean));
}
