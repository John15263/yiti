// 复制这一步的公式: when a formula is drawn wrongly, what is needed to see why is the formula as it came from Math Academy's
// page (its TeX and its MathML) and as it was drawn here. Formulas only, none of the step's words; it goes to the clipboard,
// and the learner pastes it where they choose.
const MATRIXISH = /matrix|array|cases|align|mtable|underbrace/;
const LIMIT = 3000, MAX = 8;

// Every formula part anywhere in a step's sections (they nest: paragraphs of parts, choices holding paragraphs).
export function mathParts(node, out = []) {
  if (Array.isArray(node)) for (const child of node) mathParts(child, out);
  else if (node && typeof node === 'object') {
    if (node.t === 'math') out.push(node);
    else for (const value of Object.values(node)) mathParts(value, out);
  }
  return out;
}
// `drawn` gives the MathML the page ended up with for a formula (by its TeX), or nothing.
export function formulaReport(rec, { agent = '', version = '', drawn = () => '' } = {}) {
  const parts = mathParts(rec?.sections), seen = new Set();
  const unique = parts.filter(p => typeof p.tex === 'string' && !seen.has(p.tex) && seen.add(p.tex));
  // Tables first: that is what goes wrong.
  const chosen = [...unique.filter(p => MATRIXISH.test(p.tex) || MATRIXISH.test(p.mml || '')), ...unique.filter(p => !(MATRIXISH.test(p.tex) || MATRIXISH.test(p.mml || '')))].slice(0, MAX);
  return { agent, version, step: rec?.step?.type || null, formulas: parts.length, shown: chosen.map(p => ({
    tex: p.tex.slice(0, LIMIT), display: !!p.display, hasMml: !!p.mml, mmlHasTable: /<mtable/.test(p.mml || ''),
    mml: (p.mml || '').slice(0, LIMIT), drawn: String(drawn(p.tex) || '').slice(0, LIMIT) })) };
}
