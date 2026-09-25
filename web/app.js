import { draw } from './math.js';
import { learnable, learnParas } from './mode.js';
import { createVoice } from './voice.js';
import { createSettings } from './settings.js';

const $ = id => document.getElementById(id);
const KIND = { tutorial: '讲解', example: '例题', question: '练习题' };
const PAGES = { quiz: '测验', review: '复习', multistep: '多步题', diagnostic: '诊断', assessment: '测评' };
let askedForKey = false, state = null, build = null, shownKey = '', drawnContext = '', drawnBlock = '', drawnLook = '', drawnSay = '', drawnExplain = '', explainOpen = false;
const asked = new Set();
const record = () => state?.record || null;

// Drafts survive a reload of this page; per viewer only, and optional.
const drafts = {
  get(k) { try { return localStorage.getItem(`yiti:${k}`) || ''; } catch { return ''; } },
  set(k, v) { try { v ? localStorage.setItem(`yiti:${k}`, v) : localStorage.removeItem(`yiti:${k}`); } catch {} },
};
const writeDraftKey = rec => `${rec.key}:${rec.progress.index}`;

// Chinese by default; the English original is one click away. Remembered per viewer, and optional.
let lang = (() => { try { return localStorage.getItem('yiti:lang') || 'zh'; } catch { return 'zh'; } })();
// What is drawn: the Chinese once it is ready for these very words, the English otherwise.
function shown(rec) {
  const t = rec.translation;
  return lang === 'zh' && t?.status === 'ready' && t.hash === rec.text_hash ? { title: t.title, sections: t.sections, zh: true } : { title: rec.title, sections: rec.sections, zh: false };
}
const shownBlock = (rec, block) => learnParas({ step: rec.step, sections: shown(rec).sections }).slice(block.start, block.end);
const look = rec => `${lang}:${shown(rec).zh}`;

function show(section) { for (const id of ['waiting', 'elsewhere', 'step']) $(id).hidden = id !== section; }
function error(message) { $('error').textContent = message || ''; $('error').hidden = !message; }

async function post(path, body) {
  error('');
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { error(data.error || '没有成功。'); return null; }
    render(data); return data;
  } catch { error('连不上本机的一题服务。'); return null; }
}
const command = (type, extra = {}) => post('/api/command', { type, key: record().key, index: record().progress.index, ...extra });

// The one main action for what is on screen, and the small ones beside it.
let primaryRun = null;
function bar({ primary = null, links = [], status = '' } = {}) {
  primaryRun = primary && !primary.disabled ? primary.run : null;
  $('primary').hidden = !primary;
  if (primary) { $('primary').textContent = primary.label; $('primary').disabled = !!primary.disabled; }
  $('links').replaceChildren(...links.map(l => {
    const b = document.createElement('button');
    b.className = 'link'; b.textContent = l.label; b.onclick = l.run; return b;
  }));
  $('work-status').textContent = status;
  $('bar').hidden = !primary && !links.length && !status;
}

function render(next) {
  state = next;
  if (build && next.build && next.build !== build) $('update-note').hidden = false;
  build ||= next.build;
  const cur = next.current, rec = next.record, onStep = !!rec && cur?.page === 'lesson';
  $('where').textContent = onStep ? `${rec.step.index + 1} / ${rec.step.total} · ${KIND[rec.step.type] || ''}` : '';
  $('lang').hidden = !onStep;
  $('lang').textContent = lang === 'zh' ? 'EN' : '中';
  $('lang').title = lang === 'zh' ? '看英文原文' : '看中文';
  // With no text key at all nothing works yet, so the settings open once by themselves.
  $('needs-key').hidden = next.gemini;
  if (!next.gemini && !askedForKey) { askedForKey = true; void settings.open(); }
  if (!cur) { show('waiting'); voice.update(); return; }
  if (!onStep) {
    show('elsewhere');
    const name = PAGES[cur.page];
    $('elsewhere-title').textContent = cur.page === 'lesson' ? '正在读这一步…' : name ? `${name}中，一题不参与。` : '现在不在一节课里。';
    $('elsewhere-note').textContent = cur.page === 'lesson' ? '' : name ? '这里测的是你自己会不会。做完回到课里，这里会跟过去。' : '打开一节课，这里会跟到你正在看的那一步。';
    voice.update(); return;
  }
  show('step');
  if (rec.key !== shownKey) { shownKey = rec.key; drawnContext = ''; drawnBlock = ''; drawnSay = ''; drawnExplain = ''; explainOpen = false; }
  const notes = [];
  translation(rec, next.gemini, notes);
  // A question's own title is only "Question 2"; the step counter already says that.
  const title = rec.step.type === 'question' ? '' : shown(rec).title;
  $('step-title').textContent = title; $('step-title').hidden = !title;
  renderContext(rec);
  for (const id of ['blocks', 'ask', 'say']) $(id).hidden = true;
  const actions = learnable(rec) ? renderLearnable(rec, next.gemini, notes) : rec.step.type === 'question' ? renderQuestion(rec) : {};
  // Waiting and errors for the whole step share one quiet line; an error can be clicked to try again.
  const retry = notes.find(n => n.retry);
  $('status-line').textContent = notes.map(n => n.text).join(' · ');
  $('status-line').hidden = !notes.length;
  $('status-line').disabled = !retry;
  $('status-line').onclick = retry ? retry.retry : null;
  bar(actions);
  voice.update();
}

// Translating costs a call, so it starts when this page is showing the step in Chinese, once per wording.
function translation(rec, gemini, notes) {
  if (lang !== 'zh') return;
  const t = rec.translation || {}, fresh = t.hash === rec.text_hash, ask = `t:${rec.key}:${rec.text_hash}`;
  if (!gemini) notes.push({ text: '要看中文，先点右上角「设置」填 API key。', retry: () => void settings.open() });
  else if (fresh && t.status === 'error') notes.push({ text: `翻译没成功，点这里重试。`, retry: () => { asked.delete(ask); void post('/api/translate', { key: rec.key }); } });
  else if (fresh && t.status === 'ready') { if (t.missing) notes.push({ text: `有 ${t.missing} 段没翻好，显示的是原文。` }); }
  else notes.push({ text: '正在翻成中文…' });
  if (gemini && !(fresh && ['running', 'ready', 'error'].includes(t.status)) && !asked.has(ask)) { asked.add(ask); void post('/api/translate', { key: rec.key }); }
}

// The question of an example, or of a practice question, stays on top as context.
function renderContext(rec) {
  const s = shown(rec).sections, sig = `${rec.key}:${rec.hash}:${look(rec)}`;
  if (sig === drawnContext) return;
  drawnContext = sig;
  draw($('context'), rec.step.type === 'tutorial' ? [] : s.question || []);
  const choices = rec.step.type === 'question' ? s.choices || [] : [];
  $('choices').hidden = !choices.length;
  $('choices').replaceChildren(...choices.map((c, n) => {
    const li = document.createElement('li'); if (rec.sections.choices?.[n]?.picked) li.className = 'picked';
    const letter = document.createElement('span'); letter.className = 'letter'; letter.textContent = c.letter;
    const body = document.createElement('span'); draw(body, c.content);
    li.append(letter, body); return li;
  }));
}

function renderLearnable(rec, gemini, notes) {
  const prep = rec.prep;
  if (prep.status !== 'ready') {
    const ask = `${rec.key}:${rec.hash}`, paras = learnParas(rec).length;
    // Preparing costs a call, so it starts when this page is actually showing the step, once.
    if (prep.status === 'none' && gemini && paras && !asked.has(ask)) { asked.add(ask); void post('/api/prepare', { key: rec.key }); }
    if (!gemini) notes.push({ text: '要拆块，先点右上角「设置」填 API key。', retry: () => void settings.open() });
    else if (prep.status === 'error') notes.push({ text: '拆块没成功，点这里重试。', retry: () => { asked.add(ask); void post('/api/prepare', { key: rec.key }); } });
    else notes.push({ text: paras ? '正在拆成几块…' : '还没有读到讲解内容。' });
    return {};
  }
  $('blocks').hidden = false;
  const p = rec.progress, blocks = prep.blocks, i = p.index;
  $('dots').replaceChildren(...blocks.map((_, n) => {
    const li = document.createElement('li'), input = p.inputs[n];
    li.className = n === i && p.phase !== 'done' ? 'now' : input.passed ? 'passed' : input.skipped ? 'skipped' : '';
    li.title = `第 ${n + 1} / ${blocks.length} 块`; return li;
  }));
  for (const id of ['learn', 'write', 'done']) $(id).hidden = true;
  const restart = { label: '从第一块再来', run: () => void post('/api/command', { type: 'restart', key: rec.key }) };
  if (p.phase === 'done') {
    $('done').hidden = false;
    $('done').textContent = `学完了：${blocks.length} 块里自己写对了 ${p.inputs.filter(x => x.passed).length} 块。回 Math Academy 点 Continue。`;
    return { links: [restart] };
  }
  const block = blocks[i], input = p.inputs[i], sig = `${rec.key}:${i}:${p.phase}`;
  if (p.phase === 'learn') {
    $('learn').hidden = false;
    if (sig !== drawnBlock || drawnLook !== look(rec)) {
      drawnLook = look(rec);
      draw($('learn-original'), shownBlock(rec, block));
      $('learn-meaning').textContent = block.meaning;
      $('learn-terms').replaceChildren(...block.terms.map(t => {
        const li = document.createElement('li'), b = document.createElement('b');
        b.textContent = t.en; li.append(b, t.zh); return li;
      }));
    }
    // The English phrases are for reading the English; in Chinese they are clutter.
    $('learn-terms').hidden = lang === 'zh' || !block.terms.length;
    drawnBlock = sig;
    return { primary: { label: '遮住，自己写  ⌘↵', run: toWrite } };
  }
  // Writing, and seeing the check: the same box stays, so the text written is never lost.
  $('write').hidden = false;
  $('write-focus').textContent = block.focus;
  const box = $('write-text');
  if (!drawnBlock.startsWith(`${rec.key}:${i}:`) || drawnBlock.endsWith(':learn')) {
    box.value = drafts.get(writeDraftKey(rec)) || input.attempts.at(-1)?.text || '';
    requestAnimationFrame(() => box.focus());
  }
  drawnBlock = sig;
  $('hints').replaceChildren(...block.hints.slice(0, input.hints).map(h => { const li = document.createElement('li'); li.textContent = h; return li; }));
  const last = input.attempts.at(-1), running = last?.status === 'running', done = input.attempts.findLast(a => a.status === 'done');
  $('checked').hidden = p.phase !== 'checked' || !done;
  if (p.phase === 'checked' && done) {
    $('checked-verdict').textContent = done.verdict === 'pass' ? '✓ 对了' : '还差一点';
    $('checked-verdict').className = done.verdict;
    $('checked-note').textContent = done.note;
    $('checked-fixed').hidden = !done.fixed || done.fixed === done.text;
    $('checked-fixed').textContent = done.fixed;
    draw($('checked-original'), shownBlock(rec, block));
  }
  const links = [];
  if (input.hints < block.hints.length) links.push({ label: '提示 ⌘[', run: () => void command('hint') });
  if (p.phase === 'write') links.push({ label: '再看一眼', run: () => void command('peek') }, { label: '跳过', run: skip });
  return { primary: { label: writeLabel(rec), run: checkOrNext, disabled: running }, links,
    status: running ? '正在检查…' : last?.status === 'error' ? last.error : '' };
}
// After a check, the same key moves on, unless the text was changed: then it checks again.
function nextAfterCheck(rec) {
  const p = rec.progress, done = p.inputs[p.index].attempts.findLast(a => a.status === 'done');
  return p.phase === 'checked' && done && $('write-text').value.trim() === done.text;
}
function writeLabel(rec) {
  if (!nextAfterCheck(rec)) return '检查  ⌘↵';
  return rec.progress.index + 1 < rec.prep.blocks.length ? '下一块  ⌘↵' : '完成  ⌘↵';
}

function renderQuestion(rec) {
  const s = rec.sections;
  if (!s.result) { $('ask').hidden = false; return {}; }
  $('say').hidden = false;
  const correct = /^correct/i.test(s.result);
  $('say-result').textContent = lang === 'zh' ? (correct ? '✓ 答对了' : '✗ 答错了') : `${correct ? '✓ ' : '✗ '}${s.result}`;
  $('say-result').className = correct ? 'pass' : 'adjust';
  $('say-explain').textContent = explainOpen ? '收起讲解' : '看讲解';
  $('say-explanation').hidden = !explainOpen;
  if (explainOpen && drawnExplain !== `${rec.key}:${rec.hash}:${look(rec)}`) { draw($('say-explanation'), shown(rec).sections.explanation); drawnExplain = `${rec.key}:${rec.hash}:${look(rec)}`; }
  // Help asked for before answering is part of what the answer was.
  const prior = rec.voice.filter(v => v.mode === 'prereq').length;
  $('say-prior').textContent = prior ? `交答案前问过前置知识 ${prior} 次` : '';
  if (drawnSay !== `${rec.key}:${rec.hash}`) {
    $('say-text').value = drafts.get(`${rec.key}:say`) || rec.say.attempts.at(-1)?.text || '';
    drawnSay = `${rec.key}:${rec.hash}`;
  }
  const last = rec.say.attempts.at(-1), done = rec.say.attempts.findLast(a => a.status === 'done');
  $('say-review').hidden = !done;
  if (done) {
    $('say-score').textContent = `${done.score} 分 · ${{ right: '抓住了关键', partly: '方向对，还不完整', wrong: '没抓住关键' }[done.math]}`;
    $('say-score').className = done.score >= 85 ? 'pass' : 'adjust';
    $('say-note').textContent = done.note;
    $('say-suggestion').textContent = done.suggestion;
    $('say-suggestion').hidden = !done.suggestion || done.suggestion === done.text;
    $('say-changes').replaceChildren(...done.changes.map(c => {
      const li = document.createElement('li'), del = document.createElement('del'), ins = document.createElement('ins'), why = document.createElement('span');
      del.textContent = c.from; ins.textContent = c.to; why.className = 'why'; why.textContent = c.why;
      li.append(del, ' → ', ins, why); return li;
    }));
  }
  const running = last?.status === 'running';
  return { primary: { label: done ? '再交一次  ⌘↵' : '提交  ⌘↵', run: submitSay, disabled: running },
    status: running ? '正在点评…' : last?.status === 'error' ? last.error : '' };
}

// ── actions ──
function toWrite() { void command('write'); }
function skip() { drafts.set(writeDraftKey(record()), ''); void command('next'); }
function checkOrNext() {
  const rec = record();
  if (nextAfterCheck(rec)) { drafts.set(writeDraftKey(rec), ''); void command('next'); return; }
  const text = $('write-text').value.trim();
  if (!text) { error('先写点什么，再检查。'); return; }
  void post('/api/check', { key: rec.key, index: rec.progress.index, text });
}
function submitSay() {
  const rec = record(), text = $('say-text').value.trim();
  if (!text) { error('先写一句。'); return; }
  if (text === rec.say.attempts.findLast(a => a.status === 'done')?.text) { error('改一改再交，或者直接回 Math Academy 继续。'); return; }
  void post('/api/say', { key: rec.key, text });
}
$('primary').onclick = () => primaryRun?.();
$('update-note').onclick = () => location.reload();
$('say-explain').onclick = () => { explainOpen = !explainOpen; if (state) render(state); };
$('lang').onclick = () => {
  lang = lang === 'zh' ? 'en' : 'zh';
  try { localStorage.setItem('yiti:lang', lang); } catch {}
  if (state) render(state);
};
$('write-text').addEventListener('input', () => {
  const rec = record(); if (!rec) return;
  drafts.set(writeDraftKey(rec), $('write-text').value);
  if (!$('primary').hidden) $('primary').textContent = writeLabel(rec);
});
$('say-text').addEventListener('input', () => { const rec = record(); if (rec) drafts.set(`${rec.key}:say`, $('say-text').value); });

addEventListener('keydown', event => {
  const mod = event.metaKey || event.ctrlKey, rec = record();
  if (!mod || event.isComposing || !rec) return;
  // By physical key too, so another keyboard layout still has them.
  const key = event.code === 'BracketRight' ? ']' : event.code === 'BracketLeft' ? '[' : event.key;
  if (key === ']') { event.preventDefault(); voice.toggle(); return; }
  if (key === '[') {
    const p = rec.progress, block = rec.prep?.blocks?.[p?.index];
    if (learnable(rec) && ['write', 'checked'].includes(p.phase) && p.inputs[p.index].hints < block.hints.length) { event.preventDefault(); void command('hint'); }
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();
  primaryRun?.();
});

const settings = createSettings();
$('settings-open').onclick = () => void settings.open();
const voice = createVoice({ getRecord: record, draftOf: () => $('write-text').value, available: () => state?.voice !== false });

function connect() {
  const events = new EventSource('/api/events');
  events.addEventListener('state', e => { $('connection').hidden = true; render(JSON.parse(e.data)); });
  events.onerror = () => { $('connection').textContent = '和本机断开了，正在重连…'; $('connection').hidden = false; };
}
connect();
