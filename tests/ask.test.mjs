import test from 'node:test';
import assert from 'node:assert/strict';
import { clip, CLIP, askText, ACTIONS, mayAsk } from '../web/ask.js';
import { threadItems } from '../web/thread.js';

const step = type => ({ step: { type }, sections: {} });
const unansweredQuestion = { step: { type: 'question' }, sections: { question: [] } };
const answeredQuestion = { step: { type: 'question' }, sections: { result: 'Correct' } };

test('a selection is sent as a short quotation, in one of four ways', () => {
  assert.equal(askText('explain', '  the estimated number  '), '请解释这一段：「the estimated number」');
  assert.equal(askText('example', '通分'), '请举一个例子说明：「通分」');
  assert.equal(askText('why', '$\\frac{1}{2}$'), '「$\\frac{1}{2}$」为什么是这样？');
  assert.equal(askText('quote', '行乘列'), '关于「行乘列」：');
  assert.throws(() => askText('solve', 'x'), /Unknown action/);
  assert.deepEqual(ACTIONS.map(a => a[0]), ['explain', 'example', 'why', 'quote']);
  assert.ok(ACTIONS.every(([, label]) => label.length <= 4), 'short enough to sit beside a selection');
});

test('a long selection is cut, whole characters only, and blank space is tidied', () => {
  const long = '数'.repeat(CLIP + 50), cut = clip(long);
  assert.equal([...cut].length, CLIP + 1); assert.ok(cut.endsWith('…'));
  assert.equal(clip('😀'.repeat(CLIP + 5)).endsWith('…'), true);
  assert.equal(clip('a   \n\n\n\nb'), 'a\n\nb');
  assert.equal(clip(null), ''); assert.equal(clip(undefined), '');
  assert.ok(askText('explain', long).length < CLIP + 30, 'and within what the conversation accepts (1000)');
});

test('before a practice question is answered its own words get no shortcut, and everything else does', () => {
  for (const area of ['question', 'choices']) {
    assert.equal(mayAsk(unansweredQuestion, area), false, `${area} of a question not yet answered`);
    assert.equal(mayAsk(answeredQuestion, area), true, `${area} once answered`);
    assert.equal(mayAsk(step('example'), area), true);
    assert.equal(mayAsk(step('tutorial'), area), true);
  }
  for (const area of ['content', 'answer', 'prereq', 'chat']) {
    assert.equal(mayAsk(unansweredQuestion, area), true, `${area} before the answer: the list and what was said are the learner's own`);
    assert.equal(mayAsk(answeredQuestion, area), true);
  }
  assert.equal(mayAsk(null, 'chat'), false); assert.equal(mayAsk({}, 'chat'), false);
  assert.equal(mayAsk(step('example'), 'nowhere'), false, 'an area that is not on the page');
});

test('typed turns and spoken turns are one timeline, in the order they happened', () => {
  const rec = {
    chat: { messages: [{ id: 'm1', role: 'user', text: '为什么？', at: '2026-09-30T10:00:10.000Z' }, { id: 'm2', role: 'assistant', text: '因为…', at: '2026-09-30T10:00:20.000Z' },
      { id: 'm3', role: 'user', text: '再问一个', at: '2026-09-30T10:05:00.000Z' }] },
    // A call recorded when it ended at 10:03:00, after 60 seconds: so it began at 10:02:00.
    voice: [{ session_id: 's1', at: '2026-09-30T10:03:00.000Z', seconds: 60, transcript: [{ role: 'tutor', text: '这一步…' }, { role: 'user', text: '嗯' }, { role: 'tutor', text: '   ' }] }],
  };
  const items = threadItems(rec);
  assert.deepEqual(items.map(i => [i.spoken, i.role, i.text]), [[false, 'you', '为什么？'], [false, 'tutor', '因为…'], [true, 'tutor', '这一步…'], [true, 'you', '嗯'], [false, 'you', '再问一个']]);
  assert.deepEqual(items.filter(i => i.spoken).map(i => i.call), ['s1', 's1']);
  assert.equal(new Set(items.map(i => i.id)).size, items.length, 'every item has its own id');
});

test('a call on the air, or just ended, joins the timeline at the moment it began', () => {
  const rec = { chat: { messages: [{ id: 'm1', role: 'user', text: '之前问的', at: '2026-09-30T10:00:00.000Z' }] } };
  const started = Date.parse('2026-09-30T10:10:00.000Z');
  const items = threadItems(rec, [{ id: 'live', startedAt: started, lines: [{ role: 'tutor', text: '正在讲' }, { role: 'user', text: '嗯' }] }]);
  assert.deepEqual(items.map(i => i.text), ['之前问的', '正在讲', '嗯']);
  assert.equal(items[1].spoken, true); assert.equal(items[1].call, 'live');
  assert.deepEqual(threadItems(null), []); assert.deepEqual(threadItems({}), []);
  // A record with a broken time must not stop the page from drawing: it is kept, at the top.
  const odd = threadItems({ chat: { messages: [{ id: 'm', role: 'user', text: 'b', at: '2026-09-30T10:00:00.000Z' }] }, voice: [{ session_id: 'x', at: 'not a date', transcript: [{ role: 'user', text: 'a' }] }] });
  assert.deepEqual(odd.map(i => i.text), ['a', 'b']);
});

test('a call knows which kind it was, so the page can head it', () => {
  const rec = { voice: [{ session_id: 's1', mode: 'prereq', at: '2026-09-30T10:03:00.000Z', seconds: 10, transcript: [{ role: 'user', text: '嗯' }] }] };
  assert.equal(threadItems(rec)[0].mode, 'prereq');
  assert.equal(threadItems({}, [{ id: 'live', mode: 'learn', startedAt: 5, lines: [{ role: 'user', text: 'x' }] }])[0].mode, 'learn');
});

// A selection is read from the page as a tree of nodes; these stand in for the parts of it that matter.
const text = value => ({ nodeType: 3, nodeValue: value });
const el = (name, kids = [], attrs = {}) => ({ nodeType: 1, localName: name, nodeName: name.toUpperCase(), childNodes: kids, getAttribute: k => attrs[k] ?? null });
const pieces = kids => ({ nodeType: 11, childNodes: kids });

test('words selected on the page are quoted as they were written: formulas as TeX, paragraphs as lines, links left out', async () => {
  const { flatten } = await import('../web/pick.js');
  const inline = el('math', [el('mi', [text('x')])], { 'data-tex': 'x^2' }), shown = el('math', [el('mi', [text('y')])], { 'data-tex': '\\frac{a}{b}', display: 'block' });
  assert.equal(flatten(pieces([text('求 '), inline, text(' 的值')])), '求 $x^2$ 的值');
  assert.equal(flatten(pieces([el('p', [text('第一段')]), el('p', [shown])])), '第一段\n$$\\frac{a}{b}$$\n');
  assert.equal(flatten(el('li', [el('b', [text('通分')]), el('span', [text('：化成同分母')]), el('button', [text('进一步展开')])])), '通分：化成同分母\n');
  assert.equal(flatten(el('math', [el('mi', [text('z')])])), 'z', 'a formula that came without its TeX is its text');
});

test('the pane keeps room for the step, and is never a sliver', async () => {
  const { clampSize } = await import('../web/dock.js');
  const view = { width: 1200, height: 800 };
  assert.equal(clampSize(10, false, view), 150); assert.equal(clampSize(5000, false, view), 800 - 58 - 150);
  assert.equal(clampSize(400.4, false, view), 400);
  assert.equal(clampSize(10, true, view), 300); assert.equal(clampSize(5000, true, view), 720);
  assert.equal(clampSize(200, false, { width: 400, height: 300 }), 150, 'a very short window: the minimum wins over the room left');
});

test('a selection belongs to one place on the page, and one that crosses places belongs to none', async () => {
  const { areaOf } = await import('../web/pick.js');
  const inside = ask => ({ commonAncestorContainer: { nodeType: 1, closest: sel => sel === '[data-ask]' && ask ? { dataset: { ask } } : null } });
  assert.equal(areaOf(inside('prereq')), 'prereq');
  // Words inside a paragraph: the range starts in a text node, whose place is its parent's.
  assert.equal(areaOf({ commonAncestorContainer: { nodeType: 3, parentElement: inside('chat').commonAncestorContainer } }), 'chat');
  // Across the question and the list, the common ancestor is the page around both, which is no place at all.
  assert.equal(areaOf(inside(null)), null);
});

const question = (result, messages = []) => ({ key: 'k1', step: { type: 'question' }, sections: result ? { result } : {}, chat: { messages } });

test('what is right or wrong is what Math Academy said', async () => {
  const { correct, wrong } = await import('../web/mode.js');
  assert.equal(correct(question('Correct')), true); assert.equal(wrong(question('Correct')), false);
  assert.equal(correct(question('correct!')), true);
  for (const said of ['Incorrect', 'Partially correct', 'Wrong']) assert.equal(wrong(question(said)), true, said);
  assert.equal(correct(question('')), false); assert.equal(wrong(question('')), false, 'not answered is not wrong');
  assert.equal(wrong({ step: { type: 'example' }, sections: { result: 'Incorrect' } }), false);
});

test('what is offered after the answer depends on the answer and on whether anything was explained yet', async () => {
  const { ideasFor, WRONG_ASK } = await import('../web/ask.js');
  assert.deepEqual(ideasFor(question('')), [], 'nothing before the answer');
  assert.deepEqual(ideasFor(step('example')), []);
  assert.deepEqual(ideasFor(question('Incorrect')).map(i => i.label), ['讲讲我错在哪', '这道题怎么做']);
  assert.equal(ideasFor(question('Incorrect'))[0].text, WRONG_ASK);
  assert.deepEqual(ideasFor(question('Correct')).map(i => i.label), ['这道题怎么做']);
  const talked = ideasFor(question('Incorrect', [{ role: 'user', text: 'x' }, { role: 'assistant', text: 'y' }]));
  assert.deepEqual(talked.map(i => i.label), ['再讲简单一点', '举个类似的例子']);
  assert.ok([...ideasFor(question('Incorrect')), ...talked].every(i => i.text.length > 0 && i.text.length <= 1000));
});

test('the pane is closed until it is opened, and stays open for someone who had unfolded it', async () => {
  const { isOpen } = await import('../web/dock.js');
  assert.equal(isOpen({}), false); assert.equal(isOpen(null), false); assert.equal(isOpen(undefined), false);
  assert.equal(isOpen({ h: 300 }), false, 'a size alone is not a choice to open');
  assert.equal(isOpen({ open: true }), true); assert.equal(isOpen({ open: false }), false);
  assert.equal(isOpen({ folded: false }), true, 'unfolded before it could be closed'); assert.equal(isOpen({ folded: true }), false);
  assert.equal(isOpen({ open: false, folded: false }), false, 'the newer choice wins');
});
