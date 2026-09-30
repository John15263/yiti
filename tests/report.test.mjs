import test from 'node:test';
import assert from 'node:assert/strict';
import { mathParts, formulaReport } from '../web/report.js';

const text = v => ({ t: 'text', v });
const math = (tex, mml = '', display = false) => ({ t: 'math', tex, display, mml });
const table = '<math><mrow><mo>[</mo><mtable><mtr><mtd><mn>1</mn></mtd></mtr></mtable><mo>]</mo></mrow></math>';
const rec = { step: { type: 'tutorial' }, sections: {
  body: [[text('Words that must not be in the report.'), math('x^2', '<math><msup><mi>x</mi><mn>2</mn></msup></math>')],
    [math('\\begin{bmatrix}1\\end{bmatrix}', table, true)], [math('\\begin{bmatrix}1\\end{bmatrix}', table, true)]],
  choices: [{ letter: 'a', content: [[math('\\left[\\begin{array}{c}1\\end{array}\\right]', '<math><mn>1</mn></math>')]] }] } };

test('every formula in a step is found wherever it is nested', () => {
  assert.deepEqual(mathParts(rec.sections).map(p => p.tex), ['x^2', '\\begin{bmatrix}1\\end{bmatrix}', '\\begin{bmatrix}1\\end{bmatrix}', '\\left[\\begin{array}{c}1\\end{array}\\right]']);
  assert.deepEqual(mathParts(null), []); assert.deepEqual(mathParts('x'), []); assert.deepEqual(mathParts({ body: 3 }), []);
});

test('the report has the formulas as they came and as they were drawn, tables first, and none of the words', () => {
  const report = formulaReport(rec, { agent: 'UA', version: '0.5.0', drawn: tex => tex.startsWith('\\begin') ? '<math data-tex="drawn"/>' : '' });
  assert.equal(report.agent, 'UA'); assert.equal(report.version, '0.5.0'); assert.equal(report.step, 'tutorial'); assert.equal(report.formulas, 4);
  assert.deepEqual(report.shown.map(f => f.tex), ['\\begin{bmatrix}1\\end{bmatrix}', '\\left[\\begin{array}{c}1\\end{array}\\right]', 'x^2'], 'no repeats; matrices before the rest');
  assert.equal(report.shown[0].mmlHasTable, true); assert.equal(report.shown[0].display, true); assert.equal(report.shown[0].drawn, '<math data-tex="drawn"/>');
  assert.equal(report.shown[1].mmlHasTable, false, 'an array whose MathML has no table is what to look for');
  assert.equal(report.shown[2].drawn, '');
  assert.ok(!JSON.stringify(report).includes('must not be in the report'));
});

test('a report is short, and a step with no record or no formulas gives an empty one', () => {
  const many = { step: { type: 'example' }, sections: { body: [Array.from({ length: 30 }, (_, i) => math(`x_{${i}}`, 'm'.repeat(5000)))] } };
  const report = formulaReport(many);
  assert.equal(report.shown.length, 8); assert.equal(report.formulas, 30);
  assert.ok(report.shown.every(f => f.mml.length === 3000));
  assert.deepEqual(formulaReport(null).shown, []); assert.equal(formulaReport({ step: { type: 'tutorial' }, sections: {} }).formulas, 0);
});
