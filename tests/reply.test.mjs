import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReply } from '../server/validation.mjs';
import { textJSON } from '../server/llm.mjs';

test('a reply with single backslashes before TeX commands is read, and valid JSON is left as it is', () => {
  assert.deepEqual(parseReply('{"a":"$\\cdot x$"}'), { a: '$\\cdot x$' }, '\\c is not a JSON escape');
  assert.deepEqual(parseReply('{"a":"$\\sqrt{2}+\\alpha+\\pi$"}'), { a: '$\\sqrt{2}+\\alpha+\\pi$' });
  assert.deepEqual(parseReply('{"a":"$\\underline{x}$"}'), { a: '$\\underline{x}$' }, '\\u without four hex digits');
  assert.deepEqual(parseReply('{"a":"$\\\\cdot x$"}'), { a: '$\\cdot x$' }, 'a doubled backslash stays one');
  assert.deepEqual(parseReply('{"a":"\\"quoted\\" \\\\ \\/ \\u00e9 \\n"}'), { a: '"quoted" \\ / é \n' }, 'every valid escape survives');
  assert.deepEqual(parseReply('{"a":"\\\\cdot \\cdot"}'), { a: '\\cdot \\cdot' }, 'a doubled one next to a single one');
  assert.throws(() => parseReply('{"a":'), SyntaxError, 'what is not JSON at all still fails');
  assert.throws(() => parseReply('not json'));
});

test('a DeepSeek reply that writes TeX with single backslashes is accepted', async () => {
  const cfg = { textProvider: 'deepseek', deepseekKey: 'k', deepseekModel: 'm', geminiTimeout: 1000 };
  const request = async () => ({ ok: true, json: async () => ({ model: 'm', usage: {},
    choices: [{ finish_reason: 'stop', message: { content: '{"hint":"用 $\\cdot$ 和 $\\sqrt{x}$"}' } }] }) });
  const { value } = await textJSON({}, cfg, { instructions: 'x', schema: { type: 'object', properties: { hint: { type: 'string' } } } }, request);
  assert.equal(value.hint, '用 $\\cdot$ 和 $\\sqrt{x}$');
});
