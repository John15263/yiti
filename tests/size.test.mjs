import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIZES, sizeOf, stepSize, percent } from '../web/size.js';

test('the text size goes up and down a step at a time, stops at both ends, and 0 is back to normal', () => {
  assert.equal(stepSize(1, 1), 1.15); assert.equal(stepSize(1, -1), 0.85);
  assert.equal(stepSize(1.75, 1), 1.75); assert.equal(stepSize(0.85, -1), 0.85);
  assert.equal(stepSize(1.5, 0), 1); assert.equal(stepSize(0.85, 0), 1);
  let size = 1; for (let i = 0; i < 10; i++) size = stepSize(size, 1);
  assert.equal(size, SIZES.at(-1));
  assert.ok(SIZES.every((s, i) => i === 0 || s > SIZES[i - 1]) && SIZES.includes(1));
});

test('a remembered size that is not one of the sizes is the normal size', () => {
  assert.equal(sizeOf('1.3'), 1.3); assert.equal(sizeOf(1.5), 1.5);
  for (const bad of [null, undefined, '', 'big', '2', '0', -1, NaN, '1.31']) assert.equal(sizeOf(bad), 1, String(bad));
  assert.equal(stepSize('nonsense', 1), 1.15);
  assert.equal(percent(1.15), '115%'); assert.equal(percent(0.85), '85%');
});

test('every font size in the stylesheet scales with the setting, so nothing stays small when the text is enlarged', () => {
  const css = readFileSync(new URL('../web/app.css', import.meta.url), 'utf8');
  assert.match(css, /:root\{--fs:1;/);
  const plain = css.match(/font-size:\d+(\.\d+)?px/g) || [];
  assert.deepEqual(plain, [], `these do not scale: ${plain.join(', ')}`);
  assert.ok((css.match(/font-size:calc\(\d+(\.\d+)?px\*var\(--fs\)\)/g) || []).length >= 40);
});
