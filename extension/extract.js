// 一题 · runs inside Math Academy's own page (the MAIN world) so it can ask MathJax for each formula's TeX.
// It reads only the step Math Academy is on now: later steps are already in the page, and stay unread.
// Quizzes, diagnostics and anything that is not a lesson or a review send nothing but their kind.
(() => {
  if (window.__yiti) return;
  const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'TABLE', 'TBODY', 'TR', 'TD', 'H1', 'H2', 'H3', 'H4', 'CENTER', 'BLOCKQUOTE']);
  const SKIP = '.helpButton,.questionWidget-helpButton,.continueButtonFrame,.questionWidget-buttonBar,.questionWidget-spinnerFrame,.stepHeader,.questionWidget-header';
  const TYPES = { t: 'tutorial', e: 'example', q: 'question' };
  const ANSWER_BOX = '.matheditor-wrapper-answer, .mq-editable-field, math-field, input, textarea, [contenteditable=""], [contenteditable="true"]';

  const items = () => { try { return [...(window.MathJax?.startup?.document?.math || [])]; } catch { return []; } };
  // A formula MathJax could not read comes back as an error message, not a formula: it is left to be drawn from its TeX.
  const toMml = (tex, display) => { try { const mml = window.MathJax.tex2mml(tex, { display }).replace(/>\s+</g, '><'); return /<merror/.test(mml) ? '' : mml; } catch { return ''; } };

  // Formulas Math Academy typeset ahead of time keep their TeX in the SVG's <title>, but a matrix, a system or a fraction
  // made by one of its own macros sits there already typeset (an <mjx-container> with its MathML for screen readers), and
  // its plain text is the digits run together ("A=[2613]"). Such a piece is turned back into TeX from that MathML.
  const DELIMS = { '[': '[', ']': ']', '(': '(', ')': ')', '{': '\\{', '}': '\\}', '|': '|', '‖': '\\|', '⟨': '\\langle', '⟩': '\\rangle', '': '.' };
  const SYMBOLS = { '−': '-', '×': '\\times ', '⋅': '\\cdot ', '·': '\\cdot ', '≠': '\\ne ', '≤': '\\le ', '≥': '\\ge ', '∈': '\\in ', '∉': '\\notin ', '∼': '\\sim ',
    '→': '\\to ', '←': '\\leftarrow ', '⇒': '\\Rightarrow ', '⟹': '\\implies ', '±': '\\pm ', '∞': '\\infty ', '…': '\\ldots ', '⋯': '\\cdots ', '⋮': '\\vdots ', '⋱': '\\ddots ',
    '∑': '\\sum ', '∫': '\\int ', '∏': '\\prod ', '√': '\\surd ', '≈': '\\approx ', '≡': '\\equiv ', '⊂': '\\subset ', '⊆': '\\subseteq ', '∪': '\\cup ', '∩': '\\cap ',
    '∅': '\\emptyset ', '∀': '\\forall ', '∃': '\\exists ', '°': '^\\circ ', '✓': '\\checkmark ', '∘': '\\circ ', '⊥': '\\perp ', '∥': '\\parallel ', '{': '\\{', '}': '\\}' };
  const GREEK = { 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ϵ': 'epsilon', 'θ': 'theta', 'λ': 'lambda', 'μ': 'mu', 'π': 'pi', 'σ': 'sigma', 'τ': 'tau', 'φ': 'phi', 'ϕ': 'phi', 'ω': 'omega', 'Δ': 'Delta', 'Σ': 'Sigma', 'Ω': 'Omega', 'Θ': 'Theta', 'Λ': 'Lambda', 'Π': 'Pi', 'Φ': 'Phi' };
  const symbols = text => [...text].map(c => SYMBOLS[c] ?? (GREEK[c] ? `\\${GREEK[c]} ` : c)).join('');
  const kids = el => [...el.children];
  function mmlTex(el) {
    if (!el) return '';
    const all = () => kids(el).map(mmlTex).join('');
    const arg = i => `{${mmlTex(kids(el)[i])}}`;
    const text = (el.textContent || '').trim();
    switch (el.localName) {
      case 'mi': {
        const v = el.getAttribute('mathvariant'), t = symbols(text);
        return v === 'bold' ? `\\mathbf{${t}}` : v === 'double-struck' ? `\\mathbb{${t}}` : v === 'normal' && text.length > 1 ? `\\mathrm{${t}}` : t;
      }
      case 'mn': return text;
      case 'mo': return symbols(text);
      case 'mtext': return text ? `\\text{${text}}` : ' ';
      case 'mspace': return '\\ ';
      case 'mfrac': return `\\frac${arg(0)}${arg(1)}`;
      case 'msqrt': return `\\sqrt{${all()}}`;
      case 'mroot': return `\\sqrt[${mmlTex(kids(el)[1])}]${arg(0)}`;
      case 'msub': return `${arg(0)}_${arg(1)}`;
      case 'msup': return `${arg(0)}^${arg(1)}`;
      case 'msubsup': return `${arg(0)}_${arg(1)}^${arg(2)}`;
      case 'munder': return `\\underset${arg(1)}${arg(0)}`;
      case 'mover': return `\\overset${arg(1)}${arg(0)}`;
      case 'munderover': return `\\overset${arg(2)}{\\underset${arg(1)}${arg(0)}}`;
      case 'mstyle': { const color = el.getAttribute('mathcolor'); return color ? `{\\color{${color}}${all()}}` : all(); }
      case 'mtable': {
        const left = (el.getAttribute('columnalign') || '').startsWith('left');
        const rows = kids(el).filter(r => r.localName === 'mtr' || r.localName === 'mlabeledtr').map(r => kids(r).filter(c => c.localName === 'mtd').map(c => kids(c).map(mmlTex).join('')).join(' & ')).join(' \\\\ ');
        const width = Math.max(1, ...kids(el).map(r => kids(r).filter(c => c.localName === 'mtd').length));
        return left ? `\\begin{array}{${'l'.repeat(width)}} ${rows} \\end{array}` : `\\begin{matrix} ${rows} \\end{matrix}`;
      }
      case 'mrow': case 'math': case 'semantics': case 'mpadded': case 'menclose': case 'mphantom': {
        const parts = el.localName === 'semantics' ? kids(el).slice(0, 1) : kids(el);
        // A bracket around a table is a matrix (or a system, with a brace on the left only).
        const open = parts[0]?.localName === 'mo' && parts[0].getAttribute('data-mjx-texclass') === 'OPEN' ? parts[0].textContent.trim() : null;
        const close = parts.at(-1)?.localName === 'mo' && parts.at(-1).getAttribute('data-mjx-texclass') === 'CLOSE' ? parts.at(-1).textContent.trim() : null;
        const inner = parts.slice(open !== null ? 1 : 0, close !== null ? -1 : undefined);
        if (open !== null && inner.length === 1 && inner[0].localName === 'mtable') {
          const rows = mmlTex(inner[0]).replace(/^\\begin\{(?:matrix|array\}\{l+)\} | \\end\{(?:matrix|array)\}$/g, '');
          const env = { '[]': 'bmatrix', '()': 'pmatrix', '||': 'vmatrix', '‖‖': 'Vmatrix', '{': 'cases' }[`${open}${close ?? ''}`];
          if (env) return `\\begin{${env}} ${rows} \\end{${env}}`;
        }
        if (open !== null || close !== null) return `\\left${DELIMS[open ?? ''] ?? '.'}${inner.map(mmlTex).join('')}\\right${DELIMS[close ?? ''] ?? '.'}`;
        return parts.map(mmlTex).join('');
      }
      default: return all();
    }
  }
  // The TeX of a <title>: its own text, with every already-typeset piece turned back into TeX.
  function titleTex(node) {
    return [...node.childNodes].map(c => {
      if (c.nodeType === 3) return c.nodeValue;
      if (c.nodeType !== 1) return '';
      const math = c.localName === 'mjx-container' ? c.querySelector('mjx-assistive-mml math') : null;
      return math ? `{${mmlTex(math)}}` : titleTex(c);
    }).join('');
  }
  // 沉浸式翻译 (Immersive Translate) writes its Chinese into the page, each paragraph's in one of these, and copies the
  // formulas into it: a typeset SVG without its .mjpage around it, a live one as an <mjx-container> MathJax never made.
  const TRANSLATED = '.immersive-translate-target-wrapper';
  const COPIED = '[data-immersive-translate-translation-element-mark]';
  const isFormula = el => el.matches('.mjpage, mjx-container');
  // Beside the English (its bilingual mode) the Chinese is passed by, and Math Academy's own words are read. In place of
  // the English (translation only) the Chinese is all there is: what is left beside it is display formulas at most.
  const beside = node => [...node.parentNode.childNodes].some(c => c !== node && (c.nodeType === 3 ? c.nodeValue.trim()
    : c.nodeType === 1 && !c.matches(TRANSLATED) && !isFormula(c) && c.textContent.trim()));

  // Formulas come two ways: typeset ahead of time as SVG with the TeX in its <title>, or live by MathJax.
  function formula(node, live) {
    let tex = '', display = false;
    const copied = node.tagName === 'svg' && !node.closest('.mjpage') && node.closest(COPIED) && node.querySelector('title');
    if (node.classList?.contains('mjpage') || copied) {
      const title = node.querySelector('title');
      // Never let an odd formula stop the whole step from being read: its plain text is better than nothing.
      try { tex = title ? titleTex(title) : ''; } catch { tex = title?.textContent || ''; }
      display = node.classList.contains('mjpage__block');
    } else if (node.tagName === 'MJX-CONTAINER') {
      const item = live.find(m => m.typesetRoot === node);
      // A copy has no item of its own; its TeX comes back from the MathML it carries for screen readers.
      const mml = item ? null : node.querySelector('mjx-assistive-mml math');
      try { tex = item?.math || (mml ? mmlTex(mml) : ''); } catch { tex = ''; }
      display = node.getAttribute('display') === 'true' || !!item?.display;
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
      if (node.nodeType !== 1 || ['STYLE', 'SCRIPT', 'BUTTON', 'IMG', 'NOSCRIPT'].includes(node.tagName)) return;
      if (node.matches(SKIP) || node.checkVisibility?.() === false) return;
      if (node.matches(TRANSLATED) && beside(node)) return;
      if (node.tagName === 'svg') { const math = formula(node, live); if (math) line.push(math); return; }
      if (node.tagName === 'BR') { flush(); return; }
      // An answer box (MathQuill, as Math Academy uses it, or any other field) is a blank in the question: what is typed
      // into it is not the question's words, and must not make it look like another question.
      if (node.matches(ANSWER_BOX)) { line.push({ t: 'text', v: '____' }); return; }
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

  // What was typed into a MathQuill box, as TeX when MathQuill will say, else as it shows.
  const typed = field => { try { const tex = window.MathQuill?.getInterface?.(2)?.(field)?.latex?.(); if (tex) return tex; } catch {} return field.querySelector('.mq-root-block')?.textContent?.trim() || ''; };
  // A practice question as Math Academy draws it, in a lesson or in a review.
  function questionOf(el) {
    const verdict = words(el.querySelector('.questionWidget-result'));
    const circle = row => row.querySelector('.questionWidget-choiceLetterCircle');
    return { title: words(el.querySelector('.questionWidget-title')), sections: {
      question: paragraphs(el.querySelector('.questionWidget-text')),
      choices: [...el.querySelectorAll('.questionWidget-choicesTable tr')].map(row => ({ letter: words(circle(row)), content: paragraphs(row.querySelector('.questionWidget-choiceText')), picked: !!circle(row)?.getAttribute('style') })),
      answer: [...[...el.querySelectorAll('input[type="text"], input:not([type]), textarea')].map(i => i.value), ...[...el.querySelectorAll('.mq-editable-field')].map(typed)].filter(Boolean).join(' ; '),
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

  // A topic's number from a link to its page: /topics/<name>-<number> (or /topics/<number>).
  const topicOf = href => (href || '').match(/\/topics\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/)?.[1] || null;
  // Math Academy's own prerequisites, wherever a page lists them: a topic's page has them in its sidebar, the /learn page
  // under each task (next to the link to that task's topic). Names and links only.
  const prereqLinks = root => [...root.querySelectorAll('.prerequisiteLink, .taskPrerequisiteLink')].map(e => {
    const a = e.closest('a') || e.querySelector('a') || e, href = (a.getAttribute('href') || '').replace(/^https:\/\/(www\.)?mathacademy\.com/, '').split(/[?#]/)[0];
    return { name: words(e), href, topic: topicOf(href) };
  }).filter(p => p.name && p.href);
  function learnOfficial() {
    return [...document.querySelectorAll('.taskPrerequisites')].flatMap(list => {
      let e = list.parentElement, link = null;
      for (let up = 0; e && up < 6 && !link; up++, e = e.parentElement) link = e.querySelector('.taskTopicLink, .taskTopicLinkExpanded');
      const own = link && topicOf(link.getAttribute('href') || link.querySelector('a')?.getAttribute('href'));
      const prereqs = prereqLinks(list);
      return own && prereqs.length ? [{ topic: own, prereqs }] : [];
    });
  }
  // A topic's own page (/topics/<name>-<number>): its tutorials and worked examples, all of them on one page, and no
  // practice questions. The step is the one most on screen.
  function readTopic(topic) {
    const sidebar = document.querySelector('#sidebar, .sidebarFrame'), official = sidebar ? [{ topic, prereqs: prereqLinks(sidebar) }] : [];
    const base = { page: 'topic', task: topic, topic, official };
    const steps = [...document.querySelectorAll('.step')].filter(e => e.checkVisibility?.() !== false && e.querySelector('.stepName'));
    let best = null, bestShown = -1, bestAway = Infinity;
    for (const e of steps) {
      const box = e.getBoundingClientRect(), seen = shown(box), off = away(box);
      if (seen > bestShown || (seen === bestShown && off < bestAway)) { best = e; bestShown = seen; bestAway = off; }
    }
    if (!best) return { ...base, step: null };
    const index = steps.indexOf(best), example = !!best.querySelector('.exampleQuestion');
    const step = { id: `${example ? 'e' : 't'}${index}`, type: example ? 'example' : 'tutorial', index, total: steps.length };
    const title = words(best.querySelector('.stepName'));
    if (example) return { ...base, url: location.href, step, title, sections: {
      question: paragraphs(best.querySelector('.exampleQuestion')), explanation: paragraphs(best.querySelector('.exampleExplanation')) } };
    return { ...base, url: location.href, step, title, sections: { body: paragraphs(best) } };
  }

  // A task already done, opened on the /learn page: its questions, each with the answer given, the verdict and the
  // explanation. Everything there is answered. The step is the question most on screen.
  function readAnswers() {
    const frame = [...document.querySelectorAll('.taskAnswers')].find(e => e.checkVisibility?.() !== false);
    const task = frame?.id.match(/(\d+)$/)?.[1] || new URLSearchParams(location.search).get('taskId');
    const official = learnOfficial();
    if (!frame || !task) return { page: 'learn', official };
    const link = document.querySelector('.taskTopicLinkExpanded'), href = link?.getAttribute('href') || link?.querySelector('a')?.getAttribute('href') || '';
    const base = { page: 'answers', task, topic: topicOf(href), official };
    const questions = [...frame.querySelectorAll('.question')].filter(q => q.checkVisibility?.() !== false && q.querySelector('.questionText'));
    let best = null, bestShown = -1, bestAway = Infinity;
    for (const q of questions) {
      const box = q.getBoundingClientRect(), seen = shown(box), off = away(box);
      if (seen > bestShown || (seen === bestShown && off < bestAway)) { best = q; bestShown = seen; bestAway = off; }
    }
    if (!best) return { ...base, step: null };
    let n = best.id.match(/(\d+)$/)?.[1] || '';
    if (n.length > 12) { let h = 2166136261; for (const c of n) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } n = String(h >>> 0); }
    if (!n) return { ...base, step: null };
    return { ...base, url: location.href, step: { id: `q${n}`, type: 'question', index: questions.indexOf(best), total: questions.length },
      title: words(best.querySelector('.questionNumber')), sections: {
        question: paragraphs(best.querySelector('.questionText')), choices: [],
        answer: words(best.querySelector('.studentAnswer')),
        result: words(best.querySelector('.answerResult')) || 'Answered',
        explanation: paragraphs(best.querySelector('.questionExplanation')) } };
  }

  function read() {
    const m = location.pathname.match(/^\/tasks\/(\d+)\/topics\/(\d+)\/([a-z-]+)/i);
    if (location.pathname === '/learn') return readAnswers();
    const own = location.pathname.startsWith('/topics/') && topicOf(location.pathname);
    if (own) return readTopic(own);
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
  window.__yiti = { read, outline, titleTex, paragraphs, send: () => { last = ''; send(); } };
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
