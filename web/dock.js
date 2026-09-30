// The conversation pane, 问一问: out of the way until asked for. Closed, it is only a small pill in the corner (问一问 and
// 语音); opened, it is docked under the step, so the prerequisites and the question stay in view while you ask, or a column
// on the right when the page is wide. Whether it is open, and its size, are remembered per viewer (and are optional).
const WIDE = '(min-width: 980px)';
const STORE = 'yiti:dock';
const STEP = 24;

// The pane keeps room for the step above it (or beside it): never so big that the step is gone, never so small it is a sliver.
export function clampSize(size, wide, view) {
  const [min, max] = wide ? [300, Math.max(300, Math.round(view.width * 0.6))] : [150, Math.max(150, view.height - 58 - 150)];
  return Math.min(max, Math.max(min, Math.round(size)));
}
// Closed until opened. (Before it could be closed it was folded; someone who had unfolded it keeps it open.)
export const isOpen = saved => typeof saved?.open === 'boolean' ? saved.open : saved?.folded === false;

const load = () => { try { const v = JSON.parse(localStorage.getItem(STORE)); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const save = v => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch {} };

export function createDock({ dock, grip, close, pill, onToggle = () => {} }) {
  const view = matchMedia(WIDE);
  const saved = load();
  let onStep = false;
  const open = () => isOpen(saved);
  const port = () => ({ width: innerWidth, height: innerHeight });
  function apply() {
    const wide = view.matches;
    dock.hidden = !(onStep && open()); pill.hidden = !(onStep && !open());
    for (const [name, size, on] of [['--dock-h', saved.h, !wide], ['--dock-w', saved.w, wide]]) {
      if (Number.isFinite(size) && on) dock.style.setProperty(name, `${clampSize(size, wide, port())}px`); else dock.style.removeProperty(name);
    }
    grip.setAttribute('aria-orientation', wide ? 'vertical' : 'horizontal');
    grip.title = wide ? '拖动调整宽度' : '拖动调整高度';
  }
  function resize(size) {
    const wide = view.matches;
    saved[wide ? 'w' : 'h'] = clampSize(size, wide, port());
    apply();
  }
  const current = () => { const box = dock.getBoundingClientRect(); return view.matches ? box.width : box.height; };
  function set(next) {
    if (next === open()) return;
    saved.open = next; delete saved.folded; save(saved);
    apply(); onToggle(next);
  }

  let dragging = false;
  grip.addEventListener('pointerdown', event => { dragging = true; grip.setPointerCapture(event.pointerId); event.preventDefault(); });
  grip.addEventListener('pointermove', event => { if (dragging) resize(view.matches ? innerWidth - event.clientX : innerHeight - event.clientY); });
  const end = () => { if (dragging) { dragging = false; save(saved); } };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  grip.addEventListener('keydown', event => {
    const wide = view.matches, more = wide ? 'ArrowLeft' : 'ArrowUp', less = wide ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== more && event.key !== less) return;
    event.preventDefault(); resize(current() + (event.key === more ? STEP : -STEP)); save(saved);
  });
  close.onclick = () => set(false);
  addEventListener('resize', apply); view.addEventListener('change', apply);
  apply();
  return {
    // Only a step has a conversation.
    show(on) { onStep = on; apply(); },
    open: () => set(true), close: () => set(false), toggle: () => set(!open()), isOpen: open,
  };
}
