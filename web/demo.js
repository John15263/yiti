// A worked example written for 一题 itself — not Math Academy's — so anyone can try every part (translation,
// blocks, checking, voice) without a Math Academy account: new users, store reviewers, screenshots.
// It arrives exactly as a captured step would.
const inline = (tex, mml) => ({ t: 'math', tex, display: false, mml: `<math>${mml}</math>` });
const block = (tex, mml) => ({ t: 'math', tex, display: true, mml: `<math display="block">${mml}</math>` });
const text = v => ({ t: 'text', v });
const P = (inside) => `<mi>P</mi><mo stretchy="false">(</mo>${inside}<mo stretchy="false">)</mo>`;

export const DEMO = {
  page: 'lesson', task: '0', topic: '0', url: '',
  step: { id: 'e1', type: 'example', index: 0, total: 1 },
  title: 'Example (demo): Using the Complement Rule',
  sections: {
    question: [[text('A fair six-sided die is rolled once. What is the probability of '), text('not'), text(' rolling a '), inline('6', '<mn>6</mn>'), text('?')]],
    explanation: [
      [text('The complement of an event '), inline('A', '<mi>A</mi>'), text(' is the event that '), inline('A', '<mi>A</mi>'), text(' does not happen. Since one of the two must happen, their probabilities add up to '), inline('1', '<mn>1</mn>'), text(':')],
      [block('P(\\text{not } A) = 1 - P(A)', `${P('<mtext>not </mtext><mi>A</mi>')}<mo>=</mo><mn>1</mn><mo>&#x2212;</mo>${P('<mi>A</mi>')}`)],
      [text('A fair die has '), inline('6', '<mn>6</mn>'), text(' equally likely outcomes, and exactly one of them is a '), inline('6', '<mn>6</mn>'), text(', so')],
      [block('P(6) = \\dfrac{1}{6}', `${P('<mn>6</mn>')}<mo>=</mo><mfrac><mn>1</mn><mn>6</mn></mfrac>`)],
      [text('Substituting into the complement rule, the probability of not rolling a '), inline('6', '<mn>6</mn>'), text(' is')],
      [block('P(\\text{not } 6) = 1 - \\dfrac{1}{6} = \\dfrac{5}{6}.', `${P('<mtext>not </mtext><mn>6</mn>')}<mo>=</mo><mn>1</mn><mo>&#x2212;</mo><mfrac><mn>1</mn><mn>6</mn></mfrac><mo>=</mo><mfrac><mn>5</mn><mn>6</mn></mfrac><mo>.</mo>`)],
    ],
  },
};
