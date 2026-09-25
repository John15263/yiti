// 一题 · runs inside Math Academy's own page (the MAIN world) so it can ask MathJax for each formula's TeX.
// It reads only the step Math Academy is on now: later steps are already in the page, and stay unread.
// Quizzes, reviews and anything that is not a lesson send nothing but their kind.
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

  function read() {
    const m = location.pathname.match(/^\/tasks\/(\d+)\/topics\/(\d+)\/([a-z-]+)/i);
    if (!m) return { page: 'other' };
    const [, task, topic, kind] = m, page = kind.toLowerCase();
    if (page !== 'lesson') return { page, task, topic };
    const buttons = [...document.querySelectorAll('#progressBar .stepButton')];
    const button = buttons.find(b => b.classList.contains('current'));
    const id = button?.id.replace(/^stepButton-/, '');
    const el = id && document.getElementById(`step-${id}`);
    if (!el) return { page, task, topic, step: null };
    const step = { id, type: TYPES[id[0]] || 'other', index: buttons.indexOf(button), total: buttons.length };
    const base = { page, task, topic, url: location.href, step };
    if (step.type === 'question') {
      const verdict = words(el.querySelector('.questionWidget-result'));
      const circle = row => row.querySelector('.questionWidget-choiceLetterCircle');
      return { ...base, title: words(el.querySelector('.questionWidget-title')), sections: {
        question: paragraphs(el.querySelector('.questionWidget-text')),
        choices: [...el.querySelectorAll('.questionWidget-choicesTable tr')].map(row => ({ letter: words(circle(row)),
          content: paragraphs(row.querySelector('.questionWidget-choiceText')), picked: !!circle(row)?.getAttribute('style') })),
        answer: [...el.querySelectorAll('input[type="text"], input:not([type]), textarea')].map(i => i.value).filter(Boolean).join(' ; '),
        // The explanation is only read once the answer is in.
        ...(verdict ? { result: verdict, explanation: paragraphs(el.querySelector('.questionWidget-explanation')) } : {}),
      } };
    }
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
  window.__yiti = { read, send: () => { last = ''; send(); } };
  new MutationObserver(soon).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  // Coming back to this tab makes it the one being followed again.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { last = ''; soon(); } });
  addEventListener('popstate', soon);
  // 一题 may have been started after the page: say where we are now and then, unchanged or not.
  setInterval(() => { last = ''; soon(); }, 20000);
  soon();
})();
