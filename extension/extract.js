// 一题 · runs inside Math Academy's own page (the MAIN world) so it can ask MathJax for each formula's TeX.
// It reads only the step Math Academy is on now: later steps are already in the page, and stay unread.
// Quizzes, diagnostics and anything that is not a lesson or a review send nothing but their kind.
(() => {
  if (window.__yiti) return;
  const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'TABLE', 'TBODY', 'TR', 'TD', 'H1', 'H2', 'H3', 'H4', 'CENTER', 'BLOCKQUOTE']);
  const SKIP = '.helpButton,.questionWidget-helpButton,.continueButtonFrame,.questionWidget-buttonBar,.questionWidget-spinnerFrame,.stepHeader,.questionWidget-header';
  const TYPES = { t: 'tutorial', e: 'example', q: 'question' };

  const items = () => { try { return [...(window.MathJax?.startup?.document?.math || [])]; } catch { return []; } };
  const toMml = (tex, display) => { try { return window.MathJax.tex2mml(tex, { display }).replace(/>\s+</g, '><'); } catch { return ''; } };
  // Formulas come two ways: typeset ahead of time as SVG with the TeX in its <title>, or live by MathJax.
  function formula(node, live) {
    let tex = '', display = false;
    if (node.classList?.contains('mjpage')) {
      tex = node.querySelector('title')?.textContent || ''; display = node.classList.contains('mjpage__block');
    } else if (node.tagName === 'MJX-CONTAINER') {
      const item = live.find(m => m.typesetRoot === node);
      tex = item?.math || ''; display = node.getAttribute('display') === 'true' || !!item?.display;
    } else return null;
    tex = tex.trim();
    return tex ? { t: 'math', tex, display, mml: toMml(tex, display) } : { t: 'text', v: node.textContent || '' };
  }
  function paragraphs(root) {
    if (!root) return [];
    const live = items(), out = [];
    let line = [];
    const flush = () => {
      const parts = [];
      for (const p of line) {
        const last = parts.at(-1);
        if (p.t === 'text' && last?.t === 'text') last.v += p.v; else parts.push({ ...p });
      }
      if (parts[0]?.t === 'text') parts[0].v = parts[0].v.trimStart();
      if (parts.at(-1)?.t === 'text') parts.at(-1).v = parts.at(-1).v.trimEnd();
      const kept = parts.filter(p => p.t !== 'text' || p.v);
      if (kept.length) out.push(kept);
      line = [];
    };
    const walk = node => {
      if (node.nodeType === 3) { line.push({ t: 'text', v: node.nodeValue.replace(/\s+/g, ' ') }); return; }
      if (node.nodeType !== 1 || ['STYLE', 'SCRIPT', 'BUTTON', 'IMG', 'svg', 'NOSCRIPT'].includes(node.tagName)) return;
      if (node.matches(SKIP) || node.checkVisibility?.() === false) return;
      if (node.tagName === 'BR') { flush(); return; }
      const math = formula(node, live);
      if (math) {
        if (math.display) { flush(); line.push(math); flush(); } else line.push(math);
        return;
      }
      const block = BLOCK.has(node.tagName);
      if (block) flush();
      for (const child of node.childNodes) walk(child);
      if (block) flush();
    };
    walk(root); flush();
    return out;
  }
  const words = el => el?.innerText.replace(/\s+/g, ' ').trim() || '';

  // A practice question as Math Academy draws it, in a lesson or in a review.
  function questionOf(el) {
    const verdict = words(el.querySelector('.questionWidget-result'));
    const circle = row => row.querySelector('.questionWidget-choiceLetterCircle');
    return { title: words(el.querySelector('.questionWidget-title')), sections: {
      question: paragraphs(el.querySelector('.questionWidget-text')),
      choices: [...el.querySelectorAll('.questionWidget-choicesTable tr')].map(row => ({ letter: words(circle(row)), content: paragraphs(row.querySelector('.questionWidget-choiceText')), picked: !!circle(row)?.getAttribute('style') })),
      answer: [...el.querySelectorAll('input[type="text"], input:not([type]), textarea')].map(i => i.value).filter(Boolean).join(' ; '),
      // The explanation is only read once the answer is in.
      ...(verdict ? { result: verdict, explanation: paragraphs(el.querySelector('.questionWidget-explanation')) } : {}),
    } };
  }
  // A review is a run of practice questions, and the step is the one being looked at, wherever the page keeps the others
  // (below, above, off to the side: the earlier ones may still be there). Its id is made from its own words, so it stays
  // the same however often the page is read, and is another when another question comes to the screen.
  const widgetOf = t => t.closest('[id^="step-"]') || t.closest('.questionWidget') || t.parentElement?.parentElement || document.body;
  // Where a question is on the screen: its own box when there is one box per question, else just its words.
  const boxOf = t => { const w = widgetOf(t); return (w.querySelectorAll('.questionWidget-text').length === 1 ? w : t).getBoundingClientRect(); };
  const shown = box => Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0)) * Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0));
  const away = box => Math.abs((box.top + box.bottom) / 2 - innerHeight / 2) + Math.abs((box.left + box.right) / 2 - innerWidth / 2);
  // The one most on screen; when none is (its words scrolled past while its answer box is in view), the one nearest the middle.
  function looked(texts) {
    let best = null, bestShown = -1, bestAway = Infinity;
    for (const t of texts) {
      const box = boxOf(t), seen = shown(box), off = away(box);
      if (seen > bestShown || (seen === bestShown && off < bestAway)) { best = t; bestShown = seen; bestAway = off; }
    }
    return best;
  }
  function readReview(task, topic) {
    const base = { page: 'review', task, topic };
    const texts = [...document.querySelectorAll('.questionWidget-text')].filter(e => e.checkVisibility?.() !== false);
    const text = looked(texts);
    const asked = text && JSON.stringify(paragraphs(text));
    if (!text || asked === '[]') return { ...base, step: null };
    let h = 2166136261;
    for (const c of asked) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
    return { ...base, url: location.href, step: { id: `q${h >>> 0}`, type: 'question', index: 0, total: 1 }, ...questionOf(widgetOf(text)) };
  }
  // For finding out how a page is built when it is not read as expected: names and counts only, never a word of its text.
  function outline() {
    const count = sel => document.querySelectorAll(sel).length;
    const name = e => `${e.localName}${e.id ? '#' + e.id.replace(/\d+/g, 'N') : ''}${[...e.classList].slice(0, 3).map(c => '.' + c).join('')}`;
    const anchor = document.querySelector('.questionWidget-text') || document.querySelector('[class*="question" i]') || document.body;
    const chain = [];
    for (let e = anchor; e && e !== document.documentElement && chain.length < 7; e = e.parentElement) chain.unshift(name(e));
    const tree = (e, depth) => depth > 3 ? [] : [...e.children].slice(0, 12).flatMap(c => [`${'  '.repeat(depth)}${name(c)}${c.children.length ? ` (${c.children.length})` : ''}`, ...tree(c, depth + 1)]);
    const root = anchor.closest('[id^="step-"], .questionWidget') || anchor.parentElement || document.body;
    return JSON.stringify({ path: location.pathname.replace(/\d+/g, 'N'),
      found: Object.fromEntries(Object.entries({ progressButtons: '#progressBar .stepButton', steps: '[id^="step-"]', widgets: '.questionWidget', questionText: '.questionWidget-text',
        choiceRows: '.questionWidget-choicesTable tr', result: '.questionWidget-result', explanation: '.questionWidget-explanation', inputs: 'input[type="text"], textarea' }).map(([k, sel]) => [k, count(sel)])),
      questions: [...document.querySelectorAll('.questionWidget-text')].map(t => { const box = boxOf(t); return { visible: t.checkVisibility?.() !== false, top: Math.round(box.top), left: Math.round(box.left), height: Math.round(box.height), onScreen: Math.round(shown(box)), answered: !!words(widgetOf(t).querySelector('.questionWidget-result')) }; }),
      chain, tree: tree(root, 0) }, null, 1);
  }

  function read() {
    const m = location.pathname.match(/^\/tasks\/(\d+)\/topics\/(\d+)\/([a-z-]+)/i);
    if (!m) return { page: 'other' };
    const [, task, topic, kind] = m, page = kind.toLowerCase();
    // Quizzes, diagnostics and assessments measure what can be done alone: nothing of them is read. A review is read like a practice question.
    if (page === 'review') return readReview(task, topic);
    if (page !== 'lesson') return { page, task, topic };
    const buttons = [...document.querySelectorAll('#progressBar .stepButton')];
    const button = buttons.find(b => b.classList.contains('current'));
    const id = button?.id.replace(/^stepButton-/, '');
    const el = id && document.getElementById(`step-${id}`);
    if (!el) return { page, task, topic, step: null };
    const step = { id, type: TYPES[id[0]] || 'other', index: buttons.indexOf(button), total: buttons.length };
    const base = { page, task, topic, url: location.href, step };
    if (step.type === 'question') return { ...base, ...questionOf(el) };
    const title = words(el.querySelector('.stepName'));
    if (step.type === 'example') return { ...base, title, sections: {
      question: paragraphs(el.querySelector('.exampleQuestion')), explanation: paragraphs(el.querySelector('.exampleExplanation')) } };
    return { ...base, title, sections: { body: paragraphs(el) } };
  }

  let last = '', timer = null;
  function send() {
    timer = null;
    if (document.visibilityState === 'hidden') return;
    let payload;
    try { payload = read(); } catch { return; }
    const text = JSON.stringify(payload);
    if (text === last) return;
    last = text;
    window.postMessage({ source: 'yiti-extract', payload }, location.origin);
  }
  const soon = () => { if (!timer) timer = setTimeout(send, 700); };
  window.__yiti = { read, outline, send: () => { last = ''; send(); } };
  new MutationObserver(soon).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
  // Moving back and forth through a review is scrolling (or sliding), not a change of the page's words.
  addEventListener('scroll', soon, { capture: true, passive: true }); addEventListener('resize', soon);
  // Coming back to this tab makes it the one being followed again.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { last = ''; soon(); } });
  addEventListener('popstate', soon);
  // 一题 may have been started after the page: say where we are now and then, unchanged or not.
  setInterval(() => { last = ''; soon(); }, 20000);
  soon();
})();
