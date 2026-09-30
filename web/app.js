import { draw, rich } from './math.js';
import { learnParas, isContent, isQuestion, answered } from './mode.js';
import { createVoice } from './voice.js';
import { createSettings } from './settings.js';
import { request, subscribe } from './backend.js';
import { newestOnly } from './order.js';

const $ = id => document.getElementById(id);
const KIND = { tutorial: '讲解', example: '例题', question: '练习题' };
const PAGES = { quiz: '测验', review: '复习', multistep: '多步题', diagnostic: '诊断', assessment: '测评' };
let askedForKey = false, state = null, build = null, shownKey = '', drawnContext = '', drawnContent = '', drawnExplain = '', explainOpen = false, prereqOpen = '', prereqMore = new Set();
const asked = new Set();
const record = () => state?.record || null;

// What was being typed survives a reload of this page; per viewer only, and optional.
const drafts = {
  get(k) { try { return localStorage.getItem(`yiti:${k}`) || ''; } catch { return ''; } },
  set(k, v) { try { v ? localStorage.setItem(`yiti:${k}`, v) : localStorage.removeItem(`yiti:${k}`); } catch {} },
};

// Chinese by default; the English original is one click away. Remembered per viewer, and optional.
let lang = (() => { try { return localStorage.getItem('yiti:lang') || 'zh'; } catch { return 'zh'; } })();
// What is drawn: the Chinese once it is ready for these very words, the English otherwise.
function shown(rec) {
  const t = rec.translation;
  return lang === 'zh' && t?.status === 'ready' && t.hash === rec.text_hash ? { title: t.title, sections: t.sections, zh: true } : { title: rec.title, sections: rec.sections, zh: false };
}
const look = rec => `${lang}:${shown(rec).zh}`;

function show(section) { for (const id of ['waiting', 'elsewhere', 'step']) $(id).hidden = id !== section; }
function error(message) { $('error').textContent = message || ''; $('error').hidden = !message; }

// A reply and a push can arrive in either order; only the newer state is drawn.
const isNewest = newestOnly();
async function post(path, body) {
  error('');
  try { const data = await request(path, body); if (isNewest(data)) render(data); return data; }
  catch (e) { error(e.message); return null; }
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
  if (rec.key !== shownKey) { shownKey = rec.key; drawnContext = ''; drawnContent = ''; drawnExplain = ''; explainOpen = false; }
  const notes = [];
  translation(rec, next.gemini, notes);
  // A question's own title is only "Question 2"; the step counter already says that.
  const title = rec.step.type === 'question' ? '' : shown(rec).title;
  $('step-title').textContent = title; $('step-title').hidden = !title;
  renderContext(rec);
  renderContent(rec);
  renderAnswer(rec);
  renderTools(rec);
  drawChat(rec);
  // Waiting and errors for the whole step share one quiet line; an error can be clicked to try again.
  const retry = notes.find(n => n.retry);
  $('status-line').textContent = notes.map(n => n.text).join(' · ');
  $('status-line').hidden = !notes.length;
  $('status-line').disabled = !retry;
  $('status-line').onclick = retry ? retry.retry : null;
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
  const choices = isQuestion(rec) ? s.choices || [] : [];
  $('choices').hidden = !choices.length;
  $('choices').replaceChildren(...choices.map((c, n) => {
    const li = document.createElement('li'); if (rec.sections.choices?.[n]?.picked) li.className = 'picked';
    const letter = document.createElement('span'); letter.className = 'letter'; letter.textContent = c.letter;
    const body = document.createElement('span'); draw(body, c.content);
    li.append(letter, body); return li;
  }));
}

// A tutorial or a worked example: what it teaches, whole, in Chinese (or the English, one click away).
function renderContent(rec) {
  $('content').hidden = !isContent(rec);
  if (!isContent(rec)) return;
  const sig = `${rec.key}:${rec.hash}:${look(rec)}`;
  if (sig === drawnContent) return;
  drawnContent = sig;
  draw($('content'), learnParas({ step: rec.step, sections: shown(rec).sections }));
}

// A practice question: told to answer it on Math Academy first; once it is answered, the result and the official explanation.
function renderAnswer(rec) {
  $('ask').hidden = !isQuestion(rec) || answered(rec);
  $('answer').hidden = !answered(rec);
  if (!answered(rec)) return;
  const s = rec.sections, correct = /^correct/i.test(s.result);
  $('answer-result').textContent = lang === 'zh' ? (correct ? '✓ 答对了' : '✗ 答错了') : `${correct ? '✓ ' : '✗ '}${s.result}`;
  $('answer-result').className = correct ? 'pass' : 'adjust';
  $('answer-explain').textContent = explainOpen ? '收起讲解' : '看讲解';
  $('answer-explanation').hidden = !explainOpen;
  if (explainOpen && drawnExplain !== `${rec.key}:${rec.hash}:${look(rec)}`) { draw($('answer-explanation'), shown(rec).sections.explanation); drawnExplain = `${rec.key}:${rec.hash}:${look(rec)}`; }
  // Help asked for before answering is part of what the answer was.
  const prior = rec.voice.filter(v => v.mode === 'prereq').length + (rec.prereq?.views || 0) + (rec.prereq?.expands || 0);
  $('answer-prior').textContent = prior ? `交答案前问过前置知识 ${prior} 次` : '';
}

// 前置知识: what the step rests on, in three kinds, the model's own reference. Each item can be opened up.
const PREREQ_KINDS = { concept: '基础概念', method: '基础方法', formula: '基础公式' };
function renderTools(rec) {
  const open = prereqOpen === rec.key;
  $('prereq-toggle').textContent = open ? '收起前置知识' : '前置知识';
  $('prereq').hidden = !open;
  if (!open) return;
  $('prereq-title').textContent = isQuestion(rec) ? '做这道题要用到的前置知识' : '读懂这一步要用到的前置知识';
  $('prereq-note').textContent = isQuestion(rec) && !answered(rec)
    ? '这是模型整理的参考，不是 Math Academy 的官方清单。只列更基础的知识，不涉及这道题怎么做，也不含这节课新教的内容。'
    : '这是模型整理的参考，不是 Math Academy 的官方清单。';
  drawPrereq(rec);
}
function drawPrereq(rec) {
  const p = rec.prereq, ready = p?.status === 'ready';
  $('prereq-status').hidden = ready;
  $('prereq-status').textContent = !p || p.status === 'running' ? '正在整理前置知识…' : p.error || '';
  if (p?.status === 'error') {
    const retry = document.createElement('button');
    retry.className = 'link'; retry.textContent = '重新整理'; retry.onclick = () => void post('/api/prereq', { key: rec.key });
    $('prereq-status').append(' ', retry);
  }
  $('prereq-list').replaceChildren(...(ready ? Object.entries(PREREQ_KINDS).flatMap(([kind, title]) => {
    const items = p.items.filter(i => i.kind === kind);
    if (!items.length) return [];
    const heading = document.createElement('h4'), list = document.createElement('ul');
    heading.textContent = title; list.className = 'prereq-items';
    list.append(...items.map(i => prereqItem(rec, i)));
    return [heading, list];
  }) : []));
}
// One item of the list, with a link that opens it up (what it is, an example of its own, where it is easy to go wrong).
function prereqItem(rec, i) {
  const li = document.createElement('li'), name = document.createElement('b'), note = document.createElement('span'), toggle = document.createElement('button');
  rich(name, i.name); rich(note, i.note);
  const open = prereqMore.has(i.id), ask = () => void post('/api/prereq/expand', { key: rec.key, item: i.id });
  toggle.className = 'link'; toggle.textContent = open ? '收起' : '进一步展开';
  toggle.onclick = () => { if (open) prereqMore.delete(i.id); else { prereqMore.add(i.id); ask(); } render(state); };
  li.append(name, note, toggle);
  if (open) {
    const box = document.createElement('div'), m = i.more;
    box.className = 'prereq-more';
    if (!m || m.status === 'running') box.textContent = '正在展开…';
    else if (m.status === 'error') {
      const retry = document.createElement('button');
      retry.className = 'link'; retry.textContent = '重试'; retry.onclick = ask;
      box.append(`${m.error} `, retry);
    } else {
      for (const [label, text] of [['', m.explain], ['例：', m.example], ['容易错：', m.pitfall]]) {
        if (!text) continue;
        const p = document.createElement('p'), body = document.createElement('span');
        if (label) { const tag = document.createElement('b'); tag.textContent = label; p.append(tag); }
        rich(body, text); p.append(body); box.append(p);
      }
    }
    li.append(box);
  }
  return li;
}

// 问一问: the conversation about this step, and the box to go on with it. What the tutor is shown depends on the step
// and is decided by the engine: before a question is answered it is not shown the question at all.
let drawnChat = '', chatKey = '';
function drawChat(rec) {
  const chat = rec.chat || { messages: [], status: 'idle' }, box = $('chat-text');
  const [about, hint] = isQuestion(rec) && !answered(rec)
    ? ['交答案之前只能问基础知识：这里看不到你在做的题，也就不会帮你解它。交了答案之后，什么都可以问。', '问一个基础概念、基础方法…  ⌘↵ 发送']
    : answered(rec) ? ['交了答案之后，什么都可以问，包括这道题怎么做。', '问这道题的任何问题…  ⌘↵ 发送']
    : ['随时可以问，不打分。', '问这一步的任何内容…  ⌘↵ 发送'];
  $('chat-about').textContent = about; box.placeholder = hint;
  if (chatKey !== rec.key) { chatKey = rec.key; box.value = drafts.get(`${rec.key}:chat`) || ''; }
  $('chat-thread').replaceChildren(...chat.messages.map(m => {
    const row = document.createElement('div'), who = document.createElement('b'), body = document.createElement('span');
    row.className = `chat-msg ${m.role === 'user' ? 'you' : 'tutor'}`; who.textContent = m.role === 'user' ? '你' : '陪练';
    rich(body, m.text); row.append(who, body); return row;
  }));
  const running = chat.status === 'running', status = $('chat-status');
  $('chat-send').disabled = running;
  status.replaceChildren();
  if (running) status.textContent = '正在想…';
  else if (chat.status === 'error') {
    const retry = document.createElement('button');
    retry.className = 'link'; retry.textContent = '重试'; retry.onclick = () => void post('/api/chat/retry', { key: rec.key });
    status.append(`${chat.error} `, retry);
  }
  // The newest turn comes into view when one was added.
  const sig = `${rec.key}:${chat.messages.length}:${chat.status}`;
  if (sig !== drawnChat) { drawnChat = sig; $('chat-thread').lastElementChild?.scrollIntoView({ block: 'nearest' }); }
}
function sendChat() {
  const rec = record(), box = $('chat-text'), text = box.value.trim();
  if (!rec || !text || rec.chat?.status === 'running') return;
  box.value = ''; drafts.set(`${rec.key}:chat`, '');
  void post('/api/chat', { key: rec.key, text }).then(data => { if (!data) { box.value = text; drafts.set(`${rec.key}:chat`, text); } });
}

$('update-note').onclick = () => location.reload();
$('demo-open').onclick = () => void post('/api/demo', {});
$('answer-explain').onclick = () => { explainOpen = !explainOpen; if (state) render(state); };
$('lang').onclick = () => {
  lang = lang === 'zh' ? 'en' : 'zh';
  try { localStorage.setItem('yiti:lang', lang); } catch {}
  if (state) render(state);
};
$('prereq-toggle').onclick = () => {
  const rec = record();
  if (!rec) return;
  const open = prereqOpen === rec.key;
  prereqOpen = open ? '' : rec.key;
  render(state);
  if (!open) void post('/api/prereq', { key: rec.key });
};
$('chat-send').onclick = sendChat;
$('chat-text').addEventListener('input', () => { const rec = record(); if (rec) drafts.set(`${rec.key}:chat`, $('chat-text').value); });

addEventListener('keydown', event => {
  const mod = event.metaKey || event.ctrlKey, rec = record();
  if (!mod || event.isComposing || !rec) return;
  // By physical key too, so another keyboard layout still has it.
  const key = event.code === 'BracketRight' ? ']' : event.key;
  if (key === ']') { event.preventDefault(); voice.toggle(); return; }
  if (event.key === 'Enter' && event.target === $('chat-text')) { event.preventDefault(); sendChat(); }
});

const settings = createSettings();
$('settings-open').onclick = () => void settings.open();
const voice = createVoice({ getRecord: record, available: () => state?.voice !== false });

subscribe(value => { $('connection').hidden = true; if (isNewest(value)) render(value); },
  () => { $('connection').textContent = '和一题断开了，正在重连…'; $('connection').hidden = false; });
