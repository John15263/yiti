import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, apply } from '../server/translate.mjs';

const text = v => ({ t: 'text', v });
const sections = {
  question: [[text('A bag contains '), { t: 'math', tex: '4', display: false, mml: '<math><mn>4</mn></math>' }, text(' red marbles.')]],
  explanation: [[{ t: 'math', tex: 'P(\\text{red or blue}) = \\dfrac{9}{12}', display: true, mml: '<math display="block"><mi>P</mi><mo>(</mo><mtext>red or blue</mtext><mo>)</mo></math>' }]],
  choices: [{ letter: 'a', content: [[{ t: 'math', tex: '30', display: false }]], picked: true }],
};

test('formulas go out as markers and words inside formulas as phrases', () => {
  const packet = plan('Question 1', sections);
  assert.deepEqual(packet.paragraphs, [{ id: 'question.0', text: 'A bag contains ⟦1⟧ red marbles.' }]);
  assert.deepEqual(packet.phrases, ['red or blue']);
});

test('the Chinese keeps every formula, with its words translated', () => {
  const out = apply('Question 1', sections, { title: '第 1 题',
    paragraphs: [{ id: 'question.0', text: '袋子里有 ⟦1⟧ 个红色弹珠。' }], phrases: [{ en: 'red or blue', zh: '红色或蓝色' }] });
  assert.equal(out.title, '第 1 题');
  assert.deepEqual(out.sections.question[0].map(p => p.t === 'text' ? p.v : p.tex), ['袋子里有 ', '4', ' 个红色弹珠。']);
  const formula = out.sections.explanation[0][0];
  assert.match(formula.tex, /\\text\{红色或蓝色\}/);
  assert.match(formula.mml, /<mtext>红色或蓝色<\/mtext>/);
  assert.equal(out.sections.choices[0].picked, true);
  assert.equal(out.missing, 0);
});

test('a full stop written inside a formula gives way to the Chinese one', () => {
  const para = { question: [[text('numbered 1 to '), { t: 'math', tex: '12.', display: false, mml: '<math><mn>12.</mn></math>' }, text(' It spins.')]] };
  const out = apply('Q', para, { title: '', paragraphs: [{ id: 'question.0', text: '标有 1 到 ⟦1⟧。转动它。' }], phrases: [] });
  const formula = out.sections.question[0][1];
  assert.equal(formula.tex, '12');
  assert.equal(formula.mml, '<math><mn>12</mn></math>');
});

test('a paragraph that lost or doubled a formula stays in English', () => {
  for (const bad of ['袋子里有红色弹珠。', '袋子里有 ⟦1⟧⟦1⟧ 个。', '袋子里有 ⟦0⟧ 个。']) {
    const out = apply('Q', sections, { title: '', paragraphs: [{ id: 'question.0', text: bad }], phrases: [] });
    assert.equal(out.sections.question[0][0].v, 'A bag contains ', bad);
  }
  assert.equal(apply('Q', sections, { title: '', paragraphs: [], phrases: [] }).missing, 1);
});
