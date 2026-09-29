import test from 'node:test';
import assert from 'node:assert/strict';
import { newestOnly } from '../web/order.js';

const at = (seq, boot = 'a') => ({ boot, seq });

test('a state older than one already taken is set aside', () => {
  const take = newestOnly();
  assert.equal(take(at(5)), true);
  assert.equal(take(at(3)), false, 'the reply that arrives after the push that overtook it');
  assert.equal(take(at(5)), false, 'the same state twice');
  assert.equal(take(at(6)), true);
  assert.equal(take(at(7)), true);
});

test('a restarted engine starts a new count', () => {
  const take = newestOnly();
  assert.equal(take(at(40, 'before')), true);
  assert.equal(take(at(1, 'after')), true, 'the count began again, so 1 is newer than 40 here');
  assert.equal(take(at(0, 'after')), false);
  assert.equal(take(at(2, 'after')), true);
});

test('a state without a count is always taken and changes nothing', () => {
  const take = newestOnly();
  assert.equal(take(at(5)), true);
  assert.equal(take({ current: null }), true);
  assert.equal(take(null), true);
  assert.equal(take(at(4)), false);
});
