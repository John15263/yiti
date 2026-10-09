import { draw, rich } from './math.js';
import { learnParas, isContent, isQuestion, answered, correct } from './mode.js';
import { createVoice, headingOf } from './voice.js';
import { createDock } from './dock.js';
import { createPick } from './pick.js';
import { askText, ideasFor } from './ask.js';
import { threadItems } from './thread.js';
import { sizeOf, stepSize, percent, SIZES } from './size.js';
import { formulaReport } from './report.js';
import { createSettings } from './settings.js';
import { tellingBar } from './retell.js';
import { request, subscribe } from './backend.js';
import { newestOnly } from './order.js';

const $ = id => document.getElementById(id);
const KIND = { tutorial: '讲解', example: '例题', question: '练习题' };
const PAGES = { quiz: '测验', multistep: '多步题', diagnostic: '诊断', assessment: '测评' };
const STEP_PAGES = ['lesson', 'review', 'answers', 'topic'];
let askedForKey = false, state = null, build = null, shownKey = '', drawnContext = '', drawnContent = '', drawnExplain = '', explainOpen = false, prereqOpen = '', prereqMore = new Set(), laterOpen = false;
const laterMore = new Set(), laterUses = new Set();
const asked = new Set();
const record = () => state?.record || null;

// What was being typed survives a reload of this page; per viewer only, and optional.
const drafts = {
  get(k) { try { return localStorage.getItem(`yiti:${k}`) || ''; } catch { return ''; } },
  set(k, v) { try { v ? localStorage.setItem(`yiti:${k}`, v) : localStorage.removeItem(`yiti:${k}`); } catch {} },
};

// Text size, for the whole page: kept per viewer, and optional.
let fs = (() => { try { return sizeOf(localStorage.getItem('yiti:fs')); } catch { return 1; } })();
function applySize(next) {
  fs = next;
  document.documentElement.style.setProperty('--fs', String(fs));
  try { localStorage.setItem('yiti:fs', String(fs)); } catch {}
  $('fs-down').disabled = fs <= SIZES[0]; $('fs-up').disabled = fs >= SIZES.at(-1);
  $('fs').title = `字号 ${percent(fs)}（⌘ + 放大，⌘ − 缩小，⌘ 0 还原）`;
  grow();
}
applySize(fs);
$('fs-down').onclick = () => applySize(stepSize(fs, -1));
$('fs-up').onclick = () => applySize(stepSize(fs, 1));

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
  const cur = next.current, rec = next.record, onStep = !!rec && STEP_PAGES.includes(cur?.page);
  dock.show(onStep);
  syncPill(rec);
  $('where').textContent = !onStep ? '' : cur.page === 'review' ? '复习 · 练习题' : cur.page === 'answers' ? `做过的题 · ${rec.step.index + 1} / ${rec.step.total}` : cur.page === 'topic' ? `知识点讲义 · ${rec.step.index + 1} / ${rec.step.total} · ${KIND[rec.step.type] || ''}` : `${rec.step.index + 1} / ${rec.step.total} · ${KIND[rec.step.type] || ''}`;
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
    $('elsewhere-title').textContent = STEP_PAGES.includes(cur.page) ? (cur.page === 'review' ? '复习中，正在读这道题…' : cur.page === 'answers' ? '正在读做过的题…' : '正在读这一步…')
      : name ? `${name}中，一题不参与。` : cur.page === 'learn' ? '这里是学习主页。' : '现在不在一节课里。';
    $('elsewhere-note').textContent = STEP_PAGES.includes(cur.page) ? '' : name ? '这里测的是你自己会不会。做完回到课里，这里会跟过去。'
      : cur.page === 'learn' ? '点开一个做完的任务看它的题目和解答，或者开始一节课，这里会跟过去。' : '打开一节课，这里会跟到你正在看的那一步。';
    voice.update(); return;
  }
  show('step');
  if (rec.key !== shownKey) { shownKey = rec.key; drawnContext = ''; drawnContent = ''; drawnExplain = ''; explainOpen = false; }
  const notes = [];
  translation(rec, next.gemini, notes);
  // A question's own title is only "Question 2"; the step counter already says that.
  const title = rec.step.type === 'question' ? '' : shown(rec).title;
  $('step-title').textContent = title; $('step-title').hidden = !title;
  renderPlace(rec, next.place);
  renderContext(rec);
  renderContent(rec);
  renderAnswer(rec);
  renderSimpler(rec);
  renderTools(rec);
  renderLater(rec, next.later);
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

// 定位: where the lesson sits in mathematics, one line under the title, opened for a few more. Made once per lesson, on
// request here or along with the first 前置知识 or 学这个有什么用.
const STAGE = { primary: '小学', middle: '初中', high: '高中', college: '大学' };
let placeOpen = false, drawnPlace = '';
function renderPlace(rec, place) {
  $('place').hidden = !place;
  if (!place) return;
  const sig = JSON.stringify([rec.key, place, placeOpen]);
  if (sig === drawnPlace) return;
  drawnPlace = sig;
  const line = $('place-line'), more = $('place-more');
  const link = (text, act) => { const b = document.createElement('button'); b.className = 'link'; b.textContent = text; b.onclick = act; return b; };
  const ask = () => void post('/api/place', { key: rec.key });
  line.replaceChildren(); more.hidden = true;
  if (place.status === 'none') { line.append(Object.assign(link('这节课在数学里的位置', ask), { className: 'pill' })); return; }
  if (place.status === 'running') { line.textContent = '正在给这节课定位…'; return; }
  if (place.status === 'error') { line.append(place.error || '', link('重试', ask)); return; }
  const where = document.createElement('b');
  where.textContent = [place.subject, place.module, place.stage ? `${STAGE[place.stage]}阶段` : ''].filter(Boolean).join(' · ');
  line.append('定位：', where, link(placeOpen ? '收起' : '展开', () => { placeOpen = !placeOpen; render(state); }));
  if (!placeOpen) return;
  more.hidden = false;
  more.replaceChildren(...[['这节课：', place.summary], ['这个模块：', place.module_note], ['建立在：', place.before?.join('、')]].filter(([, t]) => t).map(([label, text]) => {
    const p = document.createElement('p'), tag = document.createElement('b'), body = document.createElement('span');
    tag.textContent = label; rich(body, text); p.append(tag, body); return p;
  }));
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
  const s = rec.sections, right = correct(rec);
  $('answer-result').textContent = lang === 'zh' ? (right ? '✓ 答对了' : '✗ 答错了') : `${right ? '✓ ' : '✗ '}${s.result}`;
  $('answer-result').className = right ? 'pass' : 'adjust';
  $('answer-explain').textContent = explainOpen ? '收起讲解' : '看讲解';
  $('answer-explanation').hidden = !explainOpen;
  if (explainOpen && drawnExplain !== `${rec.key}:${rec.hash}:${look(rec)}`) { draw($('answer-explanation'), shown(rec).sections.explanation); drawnExplain = `${rec.key}:${rec.hash}:${look(rec)}`; }
  // Help asked for before answering is part of what the answer was.
  const prior = rec.voice.filter(v => v.mode === 'prereq').length + (rec.prereq?.views || 0) + (rec.prereq?.expands || 0);
  $('answer-prior').textContent = prior ? `交答案前问过前置知识 ${prior} 次` : '';
}

// 更简单的解释: what Math Academy wrote (a tutorial, an example, or the official explanation once a question is answered),
// told again for someone who knows less, and again. The official words stay as they are; the model's go in a box below.
// A question not yet answered has none: the engine refuses it, and here there is nothing to press.
let drawnSimpler = '';
const simplerOpen = new Set();
function renderSimpler(rec) {
  const on = isContent(rec) || answered(rec);
  $('simpler').hidden = !on;
  if (!on) return;
  const s = rec.simpler?.hash === rec.text_hash ? rec.simpler : null, open = simplerOpen.has(rec.key);
  const sig = JSON.stringify([rec.key, s, open]);
  if (sig === drawnSimpler) return;
  drawnSimpler = sig;
  const versions = s?.versions || [], at = s?.at ?? -1, running = s?.simplifying?.status === 'running', bar = $('simpler-bar'), box = $('simpler-box');
  const link = (text, act) => { const b = document.createElement('button'); b.className = 'link'; b.textContent = text; b.onclick = act; return b; };
  const ask = () => { simplerOpen.add(rec.key); void post('/api/simpler', { key: rec.key }); render(state); };
  bar.replaceChildren(); box.hidden = true;
  if (!open) { bar.append(Object.assign(link(versions.length ? `更简单的解释（已写过 ${versions.length} 种）` : '更简单的解释', () => { if (versions.length) { simplerOpen.add(rec.key); render(state); } else ask(); }), { className: 'pill' })); return; }
  // What is on screen: the telling asked for, or that one is being written.
  box.hidden = false;
  box.replaceChildren(...(at >= 0 ? versions[at].split(/\n{2,}/).map(t => t.trim()).filter(Boolean).map(t => { const p = document.createElement('p'); rich(p, t); return p; })
    : [Object.assign(document.createElement('p'), { className: 'wait', textContent: running ? '正在写一个更简单的讲法…' : '' })]));
  bar.append(...tellingBar(s, path => path === 'back' ? void post('/api/simpler/back', { key: rec.key }) : ask(), { working: at >= 0 ? '正在写更简单的讲法…' : '' }));
  bar.append(link('收起', () => { simplerOpen.delete(rec.key); render(state); }));
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
  drawOfficial(rec, state.official);
}
// Math Academy's own prerequisites of this topic, in Chinese (the English on hover), each a link to its page there.
let drawnOfficial = '';
function drawOfficial(rec, official) {
  const line = $('prereq-official'), sig = JSON.stringify([rec.key, official]);
  line.hidden = !official;
  if (!official || sig === drawnOfficial) return;
  drawnOfficial = sig;
  if (official.prereqs.some(p => !p.zh) && !asked.has(`o:${rec.key}`)) { asked.add(`o:${rec.key}`); void post('/api/official', { key: rec.key }); }
  const label = document.createElement('b');
  label.textContent = 'Math Academy 官方前置：';
  line.replaceChildren(label, ...official.prereqs.flatMap((p, n) => {
    const a = document.createElement('a');
    a.href = `https://www.mathacademy.com${p.href}`; a.target = '_blank'; a.rel = 'noreferrer';
    a.textContent = p.zh || p.name; a.title = p.zh ? `${p.name}（在 Math Academy 打开讲义）` : '在 Math Academy 打开讲义';
    return n ? [document.createTextNode(' · '), a] : [a];
  }));
}
let drawnPrereq = '';
function drawPrereq(rec) {
  const p = rec.prereq, ready = p?.status === 'ready';
  // Words selected in the list would be lost if it were drawn again for nothing.
  const sig = JSON.stringify([rec.key, p, [...prereqMore]]);
  if (sig === drawnPrereq) return;
  drawnPrereq = sig;
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
// Under an opened item: which telling this is, and the way to a simpler one (or back to the one before).
function tellings(rec, item, m) {
  const bar = document.createElement('p');
  bar.className = 'prereq-tellings';
  bar.append(...tellingBar({ versions: m.versions || [m], at: m.at ?? 0, limit: m.limit || 4, simplifying: m.simplifying },
    path => void post(`/api/prereq/${path}`, { key: rec.key, item: item.id })));
  return bar;
}
// One item of the list, with a link that opens it up (what it is, an example of its own, where it is easy to go wrong).
function prereqItem(rec, i) {
  const li = document.createElement('li'), name = document.createElement('b'), note = document.createElement('span'), toggle = document.createElement('button');
  rich(name, i.name); rich(note, i.note);
  const open = prereqMore.has(i.id), ask = () => void post('/api/prereq/expand', { key: rec.key, item: i.id });
  toggle.className = open ? 'link' : 'pill'; toggle.textContent = open ? '收起' : '进一步展开';
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
      box.append(tellings(rec, i, m));
    }
    li.append(box);
  }
  return li;
}

// 学这个有什么用: where the lesson leads, one list per lesson, shared by its steps. Not on a question still to be answered:
// the learner is working on it then. Open or closed is kept across the steps of the lesson.
const LATER_LAYERS = { near: '身边', mid: '大工程', magic: '黑魔法' };
const LATER_FAR = { soon: '很快会学到', later: '再往后几年', college: '大学或以后' };
const laterOn = rec => isContent(rec) || answered(rec);
let drawnLater = '';
function renderLater(rec, list) {
  const on = laterOn(rec), open = on && laterOpen;
  $('later-toggle').hidden = !on;
  $('later-toggle').textContent = open ? '收起「学这个有什么用」' : '学这个有什么用';
  $('later').hidden = !open;
  if (!open) return;
  // Left open, it follows the learner into the next lesson, whose list is asked for once.
  if (!list && !asked.has(`l:${rec.key}`)) { asked.add(`l:${rec.key}`); void post('/api/later', { key: rec.key }); }
  const ready = list?.status === 'ready', sig = JSON.stringify([rec.key, list, [...laterMore], [...laterUses]]);
  if (sig === drawnLater) return;
  drawnLater = sig;
  const status = $('later-status');
  status.hidden = ready;
  status.textContent = !list || list.status === 'running' ? '正在整理这节课以后通向哪里…' : list.error || '';
  if (list?.status === 'error') {
    const retry = document.createElement('button');
    retry.className = 'link'; retry.textContent = '重新整理'; retry.onclick = () => void post('/api/later', { key: rec.key });
    status.append(' ', retry);
  }
  const part = (title, items) => {
    if (!items.length) return [];
    const heading = document.createElement('h4'), ul = document.createElement('ul');
    heading.textContent = title; ul.className = 'later-items';
    ul.append(...items.map(i => laterItem(rec, i)));
    return [heading, ul];
  };
  const again = document.createElement('p');
  if (ready) {
    const redo = document.createElement('button');
    redo.className = 'link'; redo.textContent = '不太对？重新整理'; redo.onclick = () => void post('/api/later', { key: rec.key, again: true });
    again.className = 'later-again'; again.append(redo);
  }
  $('later-list').replaceChildren(...(ready ? [...part('一、工程化与现实应用', list.apply), ...part('二、高级数学衔接', list.higher), again] : []));
}
function laterItem(rec, i) {
  const li = document.createElement('li'), main = document.createElement('span'), far = document.createElement('span'), toggle = document.createElement('button');
  if (i.layer) {
    const tag = document.createElement('span'); tag.className = 'later-tag'; tag.textContent = LATER_LAYERS[i.layer];
    const real = document.createElement('span'); real.className = 'later-real'; rich(real, i.real);
    rich(main, `再学「${i.modules}」→ ${i.problem}`);
    li.append(tag, main, far, toggle, real);
  } else {
    const solves = document.createElement('span'); solves.className = 'later-real'; rich(solves, i.solves);
    rich(main, i.chain);
    li.append(main, far, toggle, solves);
  }
  far.className = 'later-far'; far.textContent = LATER_FAR[i.distance] || '';
  const open = laterMore.has(i.id);
  toggle.className = open ? 'link' : 'pill'; toggle.textContent = open ? '收起' : '具体怎么用上';
  toggle.onclick = () => { if (open) laterMore.delete(i.id); else { laterMore.add(i.id); void post('/api/later/expand', { key: rec.key, item: i.id }); } render(state); };
  if (open) li.append(laterBox(rec, i, 'more'));
  // A way up: what that mathematics is used for, one level only.
  if (!i.layer) {
    const usesOpen = laterUses.has(i.id), uses = document.createElement('button');
    uses.className = usesOpen ? 'link' : 'pill'; uses.textContent = usesOpen ? '收起「那一层有什么用」' : '那一层有什么用';
    uses.onclick = () => { if (usesOpen) laterUses.delete(i.id); else { laterUses.add(i.id); void post('/api/later/expand', { key: rec.key, item: i.id, part: 'uses' }); } render(state); };
    toggle.after(uses);
    if (usesOpen) li.append(laterBox(rec, i, 'uses'));
  }
  return li;
}
// What was made for an entry ("more": how it is used; "uses": what a higher mathematics is for), the telling on screen,
// and the bar to tell it more simply.
function laterBox(rec, i, part) {
  const box = document.createElement('div'), m = i[part], body = { key: rec.key, item: i.id, part };
  box.className = 'prereq-more';
  if (!m || m.status === 'running') { box.textContent = '正在写…'; return box; }
  if (m.status === 'error') {
    const retry = document.createElement('button');
    retry.className = 'link'; retry.textContent = '重试'; retry.onclick = () => void post('/api/later/expand', body);
    box.append(`${m.error} `, retry); return box;
  }
  const t = m.versions[m.at], para = (label, text) => {
    const p = document.createElement('p'), span = document.createElement('span');
    if (label) { const tag = document.createElement('b'); tag.textContent = label; p.append(tag); }
    rich(span, text); p.append(span); return p;
  };
  if (part === 'more') box.append(...[['', t.explain], ['例：', t.example]].filter(([, text]) => text).map(([label, text]) => para(label, text)));
  else box.append(...t.uses.flatMap((u, n) => [para(`${n + 1}.`, u.what), Object.assign(para('', u.how), { className: 'later-how' })]));
  const bar = document.createElement('p');
  bar.className = 'prereq-tellings';
  bar.append(...tellingBar(m, path => void post(`/api/later/${path}`, body)));
  box.append(bar);
  return box;
}

// 问一问: the conversation about this step, typed and spoken in one thread, and the box to go on with it. What the tutor
// is shown depends on the step and is decided by the engine: before a question is answered it is not shown the question at all.
const scopeOf = rec => isQuestion(rec) && !answered(rec)
  ? { scope: '只问基础知识', about: '交答案之前只能问基础知识：这里看不到你在做的题，也就不会帮你解它。交了答案之后，什么都可以问。', hint: '问基础概念、基础方法…' }
  : answered(rec) ? { scope: '什么都可以问', about: '交了答案之后，什么都可以问，包括这道题怎么做。也可以直接划线，一点就问。', hint: '问这道题的任何问题…' }
  : { scope: '随时可以问', about: '随时可以问，不打分。看到不懂的话，直接划线，点「解释」就问。', hint: '问这一步的任何内容…' };
let drawnThread = '', threadKey = '', chatKey = '';
function drawChat(rec) {
  const chat = rec.chat || { messages: [], status: 'idle' }, box = $('chat-text'), scope = scopeOf(rec);
  $('chat-scope').textContent = scope.scope; $('chat-scope').title = scope.about; box.placeholder = scope.hint;
  if (chatKey !== rec.key) { chatKey = rec.key; box.value = drafts.get(`${rec.key}:chat`) || ''; }
  grow();
  drawThread(rec);
  const running = chat.status === 'running', status = $('chat-status');
  drawIdeas(rec, running);
  $('chat-send').disabled = running;
  status.replaceChildren();
  if (running) status.textContent = '正在想…';
  else if (chat.status === 'error') {
    const retry = document.createElement('button');
    retry.className = 'link'; retry.textContent = '重试'; retry.onclick = () => void post('/api/chat/retry', { key: rec.key });
    status.append(`${chat.error} `, retry);
  }
}
// After the answer, a few questions worth asking are one click away (not while a reply is being written).
let drawnIdeas = '';
function drawIdeas(rec, running) {
  const ideas = running ? [] : ideasFor(rec), sig = `${rec.key}:${ideas.map(i => i.label).join()}`;
  if (sig === drawnIdeas) return;
  drawnIdeas = sig;
  $('chat-ideas').hidden = !ideas.length;
  $('chat-ideas').replaceChildren(...ideas.map(idea => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = idea.label; button.onclick = () => void sendChat(idea.text);
    return button;
  }));
}
// The corner pill, while the pane is closed: it says when an answer is being written, and marks one that came while it was
// closed (per step: what was there when the pane was last open is not new).
const seen = new Map();
function syncPill(rec = record()) {
  if (!rec) return;
  const tutors = threadItems(rec, voice.pending()).filter(i => i.role === 'tutor').length;
  if (dock.isOpen() || !seen.has(rec.key)) seen.set(rec.key, tutors);
  const running = rec.chat?.status === 'running';
  $('pill-ask').textContent = running ? '正在想…' : '问一问';
  $('pill-ask').classList.toggle('fresh', !running && tutors > seen.get(rec.key));
}
// What the voice says of itself (it started, it stopped, why it could not) cannot be left in a pane that is closed: it
// comes up beside the pill for a few seconds. What it says while on the air is in the timer.
let noted = '', noteTimer = 0;
function voiceNote({ line, live } = {}) {
  const text = live ? '' : line || '';
  if (text === noted) return;
  noted = text;
  clearTimeout(noteTimer);
  $('pill-note').textContent = text; $('pill-note').hidden = !text || dock.isOpen();
  if (text) noteTimer = setTimeout(() => { $('pill-note').hidden = true; }, 9000);
}
// What was typed and what was said, in order. Drawn again only when something in it changed (a call on the air asks for
// this every second), so words selected in it stay selected, and the reader is not pulled down while reading up.
function drawThread(rec) {
  if (!rec) return;
  const list = $('chat-thread'), items = threadItems(rec, voice.pending()), scope = scopeOf(rec);
  const sig = [rec.key, items.length ? '' : scope.about, items.length, items.reduce((n, i) => n + i.text.length, 0)].join('\n');
  if (sig === drawnThread) return;
  const following = list.scrollHeight - list.scrollTop - list.clientHeight < 48, fresh = threadKey !== rec.key;
  drawnThread = sig; threadKey = rec.key;
  const rows = [];
  if (!items.length) { const p = document.createElement('p'); p.className = 'muted chat-empty'; p.textContent = scope.about; rows.push(p); }
  let call = null;
  for (const item of items) {
    if (item.spoken && item.call !== call) { const h = document.createElement('p'); h.className = 'chat-call'; h.textContent = `语音 · ${headingOf(item.mode)}`; rows.push(h); }
    call = item.spoken ? item.call : null;
    const row = document.createElement('div'), who = document.createElement('b'), body = document.createElement('span');
    row.className = `chat-msg ${item.role}${item.spoken ? ' spoken' : ''}`; who.textContent = item.role === 'you' ? '你' : '陪练';
    // What was said aloud is plain words; what a model typed may carry formulas.
    if (item.spoken) body.textContent = item.text; else rich(body, item.text);
    row.append(who, body); rows.push(row);
  }
  list.replaceChildren(...rows);
  const last = items.at(-1), row = rows.at(-1);
  if (fresh || following || (last && !last.spoken && last.role === 'you')) {
    list.scrollTop = list.scrollHeight;
    // A long reply is read from its first line, not its last.
    if (last && !last.spoken && last.role === 'tutor' && row.offsetHeight > list.clientHeight - 24) list.scrollTop = row.offsetTop - list.offsetTop - 4;
  }
}
// The box is one line until more is written, then grows to a few.
function grow() {
  const box = $('chat-text');
  box.style.height = '';
  if (box.scrollHeight > box.clientHeight) box.style.height = `${Math.min(box.scrollHeight + 2, 112)}px`;
}
// From the box, what was typed is sent (and given back if it fails); from a selection the words are sent as they are.
function sendChat(direct) {
  const rec = record(), box = $('chat-text'), typed = direct === undefined, text = (typed ? box.value : direct).trim();
  if (!rec || !text || rec.chat?.status === 'running') return false;
  if (typed) { box.value = ''; drafts.set(`${rec.key}:chat`, ''); grow(); }
  void post('/api/chat', { key: rec.key, text }).then(data => { if (!data && typed) { box.value = text; drafts.set(`${rec.key}:chat`, text); } });
  return true;
}
// A selection sent to 问一问: asked at once, or, for 引用 (or while the last question is still being answered), put in the
// box to be finished by hand.
function askAbout(action, quote) {
  const rec = record();
  if (!rec) return;
  dock.open();
  const text = askText(action, quote), box = $('chat-text');
  if (action !== 'quote' && sendChat(text)) return;
  box.value = box.value.trim() ? `${box.value.trimEnd()}\n${text}` : text;
  drafts.set(`${rec.key}:chat`, box.value);
  grow(); box.focus(); box.setSelectionRange(box.value.length, box.value.length);
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
$('later-toggle').onclick = () => {
  const rec = record();
  if (!rec) return;
  // Opening it asks for the list (renderLater), unless the lesson has one already.
  laterOpen = !laterOpen;
  if (laterOpen) asked.delete(`l:${rec.key}`);
  render(state);
};
$('chat-send').onclick = () => void sendChat();
addEventListener('resize', grow);
$('chat-text').addEventListener('input', () => { const rec = record(); if (rec) drafts.set(`${rec.key}:chat`, $('chat-text').value); grow(); });

addEventListener('keydown', event => {
  const mod = event.metaKey || event.ctrlKey, rec = record();
  // The usual zoom keys, since the side panel has no zoom of its own.
  if (mod && !event.altKey && !event.isComposing) {
    const direction = ['=', '+'].includes(event.key) || ['Equal', 'NumpadAdd'].includes(event.code) ? 1
      : ['-', '_'].includes(event.key) || ['Minus', 'NumpadSubtract'].includes(event.code) ? -1 : event.key === '0' || event.code === 'Digit0' ? 0 : null;
    if (direction !== null) { event.preventDefault(); applySize(stepSize(fs, direction)); return; }
  }
  if (!mod || event.isComposing || !rec) return;
  // By physical key too, so another keyboard layout still has it.
  const key = event.code === 'BracketRight' ? ']' : event.key;
  if (key === ']') { event.preventDefault(); voice.toggle(); return; }
  if (key === '/') { event.preventDefault(); if (dock.isOpen()) dock.close(); else { dock.open(); $('chat-text').focus(); } return; }
  if (event.key === 'Enter' && event.target === $('chat-text')) { event.preventDefault(); sendChat(); }
});

// For finding out why a formula is drawn wrongly: the step's formulas, as they came and as they were drawn, to the clipboard.
$('formula-copy').onclick = async () => {
  const rec = record(), note = $('formula-copied'), box = $('formula-text');
  box.hidden = true;
  if (!rec) { note.textContent = ' 现在没有在看的一步。'; return; }
  const made = new Map([...document.querySelectorAll('math[data-tex]')].map(m => [m.getAttribute('data-tex'), m.outerHTML]));
  const text = JSON.stringify(formulaReport(rec, { agent: navigator.userAgent, version: globalThis.chrome?.runtime?.getManifest?.().version || state?.build || '', drawn: tex => made.get(tex) }), null, 1);
  try { await navigator.clipboard.writeText(text); note.textContent = ' 已复制，粘贴给开发者就行。'; }
  catch { box.value = text; box.hidden = false; box.select(); note.textContent = ' 不能自动复制：下面的文字全选复制就行。'; }
};

const settings = createSettings();
$('settings-open').onclick = () => void settings.open();
// Opened, the pane shows the newest turn and has nothing new to point at; closed, only the corner pill is there.
const dock = createDock({ dock: $('dock'), grip: $('dock-grip'), close: $('dock-fold'), pill: $('pill'), onToggle: opened => {
  if (opened) { $('pill-note').hidden = true; grow(); $('chat-thread').scrollTop = $('chat-thread').scrollHeight; }
  syncPill();
} });
const voice = createVoice({ getRecord: record, available: () => state?.voice !== false,
  onChange: status => { drawThread(record()); syncPill(); voiceNote(status); } });
createPick({ getRecord: record, onAsk: askAbout });
$('pill-ask').onclick = () => { dock.open(); $('chat-text').focus(); };

subscribe(value => { $('connection').hidden = true; if (isNewest(value)) render(value); },
  () => { $('connection').textContent = '和一题断开了，正在重连…'; $('connection').hidden = false; });
