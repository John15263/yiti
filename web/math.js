// Paragraphs from Math Academy, drawn here: text as text, formulas as MathML (the browser draws it natively).
// The MathML was made by Math Academy's own MathJax; it is still rebuilt element by element from an
// allowlist, so nothing but math markup ever reaches the page.
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
  for (const child of node.childNodes) { const c = rebuild(child); if (c) out.append(c); }
  return out;
}
export function formula(part) {
  if (part.mml) {
    const parsed = new DOMParser().parseFromString(part.mml, 'text/html').body.firstElementChild;
    const math = parsed && rebuild(parsed);
    if (math) { if (part.display) math.setAttribute('display', 'block'); return math; }
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
