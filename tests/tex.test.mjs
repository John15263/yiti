import test from 'node:test';
import assert from 'node:assert/strict';
import { texToMathML, splitMath, mend } from '../web/tex.js';

const count = (ml, tag) => (ml.match(new RegExp(`<${tag}[ >/]`, 'g')) || []).length;
// Every element opened is closed in order: what the page's parser would accept without guessing.
function wellFormed(ml) {
  const stack = [];
  for (const [all, close, name, , self] of ml.matchAll(/<(\/?)([a-z]+)([^<>]*?)(\/?)>/g)) {
    if (self) continue;
    if (close) { if (stack.pop() !== name) return false; } else stack.push(name);
    void all;
  }
  return stack.length === 0 && !/<[^a-z/]/.test(ml);
}
const ok = (tex, display = false) => { const ml = texToMathML(tex, display); assert.ok(ml, `should convert: ${tex}`); assert.ok(wellFormed(ml), `well formed: ${tex}\n${ml}`); return ml; };

test('a matrix becomes a table, with its brackets around it', () => {
  const b = ok('\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}');
  assert.equal(count(b, 'mtr'), 2); assert.equal(count(b, 'mtd'), 4);
  assert.match(b, /<mo>\[<\/mo><mtable[^>]*>.*<\/mtable><mo>\]<\/mo>/);
  assert.match(ok('\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}'), /<mo>\(<\/mo><mtable.*<mo>\)<\/mo>/);
  assert.match(ok('\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}'), /<mo>\|<\/mo><mtable.*<mo>\|<\/mo>/);
  assert.match(ok('\\begin{Vmatrix}1&0\\\\0&1\\end{Vmatrix}'), /<mo>‖<\/mo><mtable.*<mo>‖<\/mo>/);
  const plain = ok('\\begin{matrix}1&2\\end{matrix}');
  assert.ok(!plain.includes('<mo>'), 'no brackets for a bare matrix');
});

test('a closing row break does not leave an empty row, and cells may hold formulas', () => {
  const m = ok('\\begin{bmatrix}1&x^2\\\\\\frac{1}{2}&\\sqrt{3}\\\\\\end{bmatrix}');
  assert.equal(count(m, 'mtr'), 2);
  assert.match(m, /<msup><mi>x<\/mi><mn>2<\/mn><\/msup>/); assert.match(m, /<mfrac>/); assert.match(m, /<msqrt>/);
  assert.equal(count(ok('\\begin{bmatrix}1&0&0\\\\0&1&0\\\\0&0&1\\end{bmatrix}'), 'mtd'), 9);
  assert.equal(count(ok('\\begin{bmatrix}1\\\\2\\\\3\\end{bmatrix}'), 'mtr'), 3, 'a column vector');
});

test('cases, aligned and array tables line up their columns', () => {
  const cases = ok('f(x)=\\begin{cases}x & x\\ge 0\\\\-x & x<0\\end{cases}');
  assert.match(cases, /<mo>\{<\/mo><mtable columnalign="left"/); assert.match(cases, /<mo>≥<\/mo>/); assert.match(cases, /<mo>&lt;<\/mo>/);
  assert.match(ok('\\begin{aligned}a&=b+c\\\\ &=d\\end{aligned}'), /columnalign="right left"/);
  assert.match(ok('\\begin{array}{cr|l}1&2&3\\end{array}'), /columnalign="center right left"/);
});

test('fractions, roots, scripts, Greek letters and symbols', () => {
  assert.match(ok('\\frac12'), /<mfrac><mn>1<\/mn><mn>2<\/mn><\/mfrac>/, 'a bare digit is one argument');
  assert.match(ok('\\dfrac{a+b}{c}'), /<mfrac><mrow>.*<\/mrow><mi>c<\/mi><\/mfrac>/);
  assert.match(ok('\\sqrt[3]{x}'), /<mroot><mi>x<\/mi><mn>3<\/mn><\/mroot>/);
  assert.match(ok('x_i^2'), /<msubsup><mi>x<\/mi><mi>i<\/mi><mn>2<\/mn><\/msubsup>/);
  assert.match(ok('A^{-1}'), /<msup><mi>A<\/mi><mrow><mo>−<\/mo><mn>1<\/mn><\/mrow><\/msup>/);
  assert.match(ok('A^\\top'), /<msup><mi>A<\/mi><mi>⊤<\/mi><\/msup>/);
  assert.match(ok("f'(x)"), /<msup><mi>f<\/mi><mo>′<\/mo><\/msup>/);
  assert.match(ok('\\alpha+\\beta\\cdot\\pi'), /<mi>α<\/mi>.*<mi>β<\/mi><mo>⋅<\/mo><mi>π<\/mi>/);
  assert.match(ok('\\Delta x'), /<mi mathvariant="normal">Δ<\/mi>/);
  assert.match(ok('a\\neq b\\le c\\to\\infty'), /<mo>≠<\/mo>.*<mo>≤<\/mo>.*<mo>→<\/mo><mi>∞<\/mi>/);
  assert.match(ok('3.14\\times 2'), /<mn>3\.14<\/mn><mo>×<\/mo><mn>2<\/mn>/);
  assert.match(ok('\\left(\\frac{a}{b}\\right)'), /<mrow><mo>\(<\/mo><mstyle[^>]*><mfrac>.*<\/mfrac><\/mstyle><mo>\)<\/mo><\/mrow>/);
  assert.match(ok('\\text{ if } x'), /<mtext> if <\/mtext>/);
  assert.match(ok('\\binom{n}{k}'), /linethickness="0"/);
});

test('a fraction is set at full size, except one inside another fraction or a \\tfrac', () => {
  const full = '<mstyle displaystyle="true" scriptlevel="0"><mfrac>';
  assert.ok(ok('\\frac{a}{b}').includes(full));
  assert.ok(ok('\\dfrac{a}{b}').includes(full));
  assert.ok(!ok('\\tfrac{a}{b}').includes('mstyle'));
  const nested = ok('\\frac{1}{1+\\frac{1}{x}}');
  assert.equal(count(nested, 'mstyle'), 1, 'only the outer fraction');
  assert.equal(count(nested, 'mfrac'), 2);
  assert.equal(count(ok('\\frac{1}{2}+\\frac{3}{4}'), 'mstyle'), 2, 'each fraction on its own is outer');
  assert.equal(count(ok('\\begin{bmatrix}\\frac12&0\\\\0&\\frac13\\end{bmatrix}'), 'mstyle'), 2);
});

test('a sum carries its bounds above and below only on its own line', () => {
  assert.match(ok('\\sum_{i=1}^{n} i', false), /<msubsup><mo largeop="true"/);
  assert.match(ok('\\sum_{i=1}^{n} i', true), /<munderover><mo largeop="true"/);
  assert.match(ok('\\lim_{x\\to 0} f(x)', true), /<munder><mi>lim<\/mi>/);
  assert.match(ok('\\sin^2 x'), /<msup><mi>sin<\/mi><mn>2<\/mn><\/msup><mspace/);
});

test('bold, blackboard and vector marks', () => {
  assert.match(ok('\\mathbf{v}'), /<mi>𝐯<\/mi>/);
  assert.match(ok('\\mathbf{A}x'), /<mi>𝐀<\/mi><mi>x<\/mi>/);
  assert.match(ok('x\\in\\mathbb{R}^n'), /<mi>ℝ<\/mi>/);
  assert.match(ok('\\vec{v}'), /<mover accent="true"><mi>v<\/mi><mo>→<\/mo><\/mover>/);
  assert.match(ok('\\bar{x}'), /<mover accent="true"><mi>x<\/mi><mo>¯<\/mo><\/mover>/);
});

test('anything not covered is refused, so the page shows the TeX itself', () => {
  for (const tex of ['\\unknowncommand{x}', '\\frac{1}{2', 'x}', '\\begin{bmatrix}1&2', '\\begin{bmatrix}1\\end{pmatrix}', '\\begin{nothing}1\\end{nothing}',
    'a & b', '1 \\\\ 2', '^2', 'x^2^3', 'x_1_2', '\\left( x', '\\href{u}{x}', '', '   ', 'a $ b', '\\end{bmatrix}'])
    assert.equal(texToMathML(tex), null, `should refuse: ${JSON.stringify(tex)}`);
  assert.equal(texToMathML('x'.repeat(2001)), null);
  assert.equal(texToMathML('{'.repeat(40) + 'x' + '}'.repeat(40)), null, 'nested too deep');
  assert.equal(texToMathML(null), null);
});

test('text a model wrote cannot become markup', () => {
  const ml = ok('\\text{<script>alert(1)</script>} a<b>c');
  assert.ok(!ml.includes('<script'), ml);
  assert.match(ml, /&lt;script&gt;/);
  assert.match(ml, /<mo>&lt;<\/mo><mi>b<\/mi><mo>&gt;<\/mo>/);
  assert.ok(!/<(?!\/?(math|mrow|mi|mn|mo|mtext|msup|mspace)[ >/])/.test(ml.replace(/&lt;|&gt;/g, '')), 'only math elements');
});

test('every formula in a lesson-sized corpus comes out well formed', () => {
  for (const tex of ['P(A\\cup B)=P(A)+P(B)-P(A\\cap B)', '\\frac{d}{dx}x^n=nx^{n-1}', '\\int_0^1 x^2\\,dx=\\frac13', 'A\\mathbf{x}=\\mathbf{b}',
    '\\det\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}=ad-bc', '\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}\\begin{bmatrix}5&6\\\\7&8\\end{bmatrix}=\\begin{bmatrix}19&22\\\\43&50\\end{bmatrix}',
    '\\vec{u}\\cdot\\vec{v}=|\\vec{u}||\\vec{v}|\\cos\\theta', 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}', '\\lambda_1,\\lambda_2\\in\\mathbb{C}', 'a_{ij}',
    '\\left[\\begin{array}{cc|c}1&2&3\\\\4&5&6\\end{array}\\right]', 'n!=n\\cdot(n-1)!', '{}^{2}x', '5\\%', '\\$5'])
    ok(tex);
});

test('the math in a text is found by dollar signs, and money is left alone', () => {
  const kinds = text => splitMath(text).map(p => p.t === 'math' ? `[${p.display ? '$$' : '$'}${p.tex}]` : p.v).join('|');
  assert.equal(kinds('乘积是 $AB$，其中 $A=1$。'), '乘积是 |[$AB]|，其中 |[$A=1]|。');
  assert.equal(kinds('结果：\n$$x^2$$\n完。'), '结果：\n|[$$x^2]|\n完。');
  assert.equal(kinds('花了 $5 和 $7，一共 $12。'), '花了 $5 和 $7，一共 $12。');
  assert.equal(kinds('花了 $5，然后 $x^2$ 是多少'), '花了 $5，然后 |[$x^2]| 是多少');
  assert.equal(kinds('价格是 \\$5，公式 $y$'), '价格是 $5，公式 |[$y]');
  assert.equal(kinds('a $ b $ c'), 'a $ b $ c', 'spaces inside the dollars: not math');
  assert.equal(kinds('$$'), '$$'); assert.equal(kinds('$ $'), '$ $'); assert.equal(kinds('只有一个 $'), '只有一个 $');
  assert.equal(kinds('没有公式'), '没有公式'); assert.equal(kinds(''), '');
  assert.equal(kinds('$a\nb$'), '$a\nb$', 'an inline formula does not run over a line break');
  assert.deepEqual(splitMath('$x$ 和 $$y$$').map(p => p.display), [false, undefined, true]);
});

test('a backslash JSON turned into a control character is put back, inside math only where that is safe', () => {
  assert.equal(mend('$A\x08egin{bmatrix}1\\\\2\\end{bmatrix}$'), '$A\\begin{bmatrix}1\\\\2\\end{bmatrix}$');
  assert.equal(mend('$\x0crac{1}{2}$ 与 $x\rightarrow 0$'), '$\\frac{1}{2}$ 与 $x\\rightarrow 0$');
  assert.equal(mend('$\theta+a\neq b$'), '$\\theta+a\\neq b$', 'tab and newline inside a formula');
  assert.equal(mend('$a\neq b$'), '$a\\neq b$', 'a newline that seems to split the formula is the start of \\neq');
  const prose = '第一步：算 1*5+2*7。\n第二步：\t写出结果。\r\n完。';
  assert.equal(mend(prose), prose.replace('\r\n', '\n'), 'newlines and tabs in prose are left alone');
  assert.equal(mend('花了 $5\n再花 $7\n'), '花了 $5\n再花 $7\n', 'money is not math');
  assert.equal(mend('plain'), 'plain'); assert.equal(mend(42), 42); assert.equal(mend(''), '');
});

test('an arrow with its label, as between two matrices in a row operation', () => {
  assert.match(ok('A \\xrightarrow{R_2-2R_1} B'), /<mover><mo>→<\/mo><mrow>.*<\/mrow><\/mover>/);
  assert.match(ok('A \\xrightarrow[k]{R_2} B'), /<munderover><mo>→<\/mo><mi>k<\/mi>/);
  assert.match(ok('A\\xleftarrow{f}B'), /<mo>←<\/mo>/);
  assert.match(ok('A \\xrightarrow B'), /<mover><mo>→<\/mo><mi>B<\/mi><\/mover>/, 'a single character is a whole argument, as in TeX');
  assert.equal(texToMathML('A \\xrightarrow'), null, 'the label is missing');
  assert.equal(texToMathML('A \\xrightarrow{R_2'), null, 'the label is not closed');
  assert.match(ok('a\\longrightarrow b\\Longrightarrow c'), /⟶.*⟹/);
});

test('LaTeX written without dollar signs is still drawn, as one formula when it runs on, and nothing else is disturbed', () => {
  const kinds = text => splitMath(text).map(p => p.t === 'math' ? `[${p.tex}]` : p.v).join('|');
  const chain = '\\begin{bmatrix}1&2\\\\2&4\\end{bmatrix} \\xrightarrow{R_2-2R_1} \\begin{bmatrix}1&2\\\\0&0\\end{bmatrix}';
  assert.equal(kinds(`初等行变换： ${chain} 第二行是 $0=2$。`), `初等行变换： |[${chain}]| 第二行是 |[0=2]|。`);
  assert.equal(kinds('分数 \\frac{1}{2} 和 \\frac{3}{4} 相加'), '分数 |[\\frac{1}{2}]| 和 |[\\frac{3}{4}]| 相加', 'two with words between are two formulas');
  assert.equal(kinds('文件在 C:\\Users\\me 下'), '文件在 C:\\Users\\me 下', 'a backslash that is not TeX stays');
  assert.equal(kinds('命令 \\frac 需要两个参数'), '命令 \\frac 需要两个参数', 'what cannot be drawn stays as written');
  assert.equal(kinds('价格 \\$5，公式 $x$'), '价格 $5，公式 |[x]', 'money and dollar-signed math as before');
  assert.equal(kinds('$\\frac{1}{2}$'), '[\\frac{1}{2}]', 'inside dollars nothing is taken twice');
  assert.equal(kinds('没有公式的一句话'), '没有公式的一句话');
});

test('a brace under a matrix, with its label beneath, as in "x times a column (a1) plus ..."', () => {
  const out = texToMathML('x_1\\underbrace{\\begin{bmatrix} 1 \\\\ -2 \\end{bmatrix}}_{a_1} + x_2\\underbrace{\\begin{bmatrix} -1 \\\\ 3 \\end{bmatrix}}_{a_2}', true);
  assert.ok(out, 'drawn, not shown as TeX');
  assert.equal((out.match(/<mtable/g) || []).length, 2, 'both columns stay tables');
  assert.equal((out.match(/<mo>⏟<\/mo>/g) || []).length, 2);
  assert.match(out, /<munder><munder><mrow>|<munder><munder>/, 'the label goes under the brace, even inline');
  assert.equal(texToMathML('\\underbrace{a+b}_{2}', false).includes('<munder><munder>'), true, 'also inline');
  assert.match(texToMathML('\\overbrace{a+b}^{n}', false), /<mover><mover>.*⏞.*<\/mover>.*<mi>n<\/mi><\/mover>/);
  assert.match(texToMathML('\\underbrace{a+b}', true), /⏟/, 'a brace with no label');
});
