// 划线提问, the page's side of it: when words are selected in a place that may be asked about, a small bar of buttons
// appears beside them; one click sends the words to 问一问. What may be sent, and what is said, is ask.js.
import { ACTIONS, clip, mayAsk } from './ask.js';

const BLOCKS = new Set(['P', 'LI', 'DIV', 'H4', 'TR']);
// The words as they were written: a formula comes as its TeX between dollar signs, a paragraph as a line. A link that
// only does something (进一步展开) is not part of the words.
export function flatten(node) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType === 11) return [...node.childNodes].map(flatten).join('');
  if (node.nodeType !== 1) return '';
  const tex = node.localName === 'math' && node.getAttribute('data-tex');
  if (tex) return node.getAttribute('display') === 'block' ? `$$${tex}$$` : `$${tex}$`;
  if (node.localName === 'button') return '';
  const inner = [...node.childNodes].map(flatten).join('');
  return BLOCKS.has(node.nodeName) ? `${inner}\n` : inner;
}
const elementOf = node => node.nodeType === 1 ? node : node.parentElement;
export function selectedText(range) {
  // Words chosen from inside a formula are the whole formula: a piece of MathML is nothing to ask about.
  const math = elementOf(range.commonAncestorContainer)?.closest('math[data-tex]');
  return flatten(math || range.cloneContents());
}
// Which place on the page (see data-ask in index.html) the whole selection lies in; none when it crosses places.
export const areaOf = range => elementOf(range.commonAncestorContainer)?.closest('[data-ask]')?.dataset.ask || null;

export function createPick({ getRecord, onAsk }) {
  const pop = document.createElement('div');
  pop.id = 'ask-pop'; pop.hidden = true; pop.setAttribute('role', 'toolbar'); pop.setAttribute('aria-label', '把选中的话问一问');
  for (const [action, label] of ACTIONS) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.action = action; button.textContent = label;
    pop.append(button);
  }
  document.body.append(pop);
  let quote = '', pressing = false, timer = 0;

  const hide = () => { pop.hidden = true; quote = ''; };
  function check() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hide();
    const range = sel.getRangeAt(0), area = areaOf(range), text = area ? clip(selectedText(range)) : '';
    if (!text || !mayAsk(getRecord(), area)) return hide();
    quote = text;
    const at = range.getBoundingClientRect();
    pop.hidden = false;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.min(innerWidth - w - 6, Math.max(6, at.left + at.width / 2 - w / 2));
    const top = at.top - h - 8 >= 6 ? at.top - h - 8 : Math.min(innerHeight - h - 6, at.bottom + 8);
    pop.style.left = `${Math.round(left)}px`; pop.style.top = `${Math.round(top)}px`;
  }

  // Not while the pointer is still dragging out the selection: the bar would be in the way.
  document.addEventListener('pointerdown', event => { if (!pop.contains(event.target)) { pressing = true; hide(); } });
  document.addEventListener('pointerup', () => { pressing = false; setTimeout(check, 0); });
  document.addEventListener('pointercancel', () => { pressing = false; });
  document.addEventListener('selectionchange', () => { if (pressing) return; clearTimeout(timer); timer = setTimeout(check, 250); });
  document.addEventListener('keyup', event => { if (event.key === 'Escape') hide(); else if (event.shiftKey || event.key.startsWith('Arrow')) check(); });
  addEventListener('scroll', hide, true); addEventListener('resize', hide);
  // Clicking a button must not take the selection away before it is read.
  pop.addEventListener('mousedown', event => event.preventDefault());
  pop.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !quote) return;
    const words = quote;
    hide(); getSelection()?.removeAllRanges();
    onAsk(button.dataset.action, words);
  });
  return { hide };
}
