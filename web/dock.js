// The conversation pane: docked under the step, so the prerequisites and the question stay in view while you ask; a column
// on the right when the page is wide. Its size, and whether it is folded, are remembered per viewer (and are optional).
const WIDE = '(min-width: 980px)';
const STORE = 'yiti:dock';
const STEP = 24;

// The pane keeps room for the step above it (or beside it): never so big that the step is gone, never so small it is a sliver.
export function clampSize(size, wide, view) {
  const [min, max] = wide ? [300, Math.max(300, Math.round(view.width * 0.6))] : [150, Math.max(150, view.height - 58 - 150)];
  return Math.min(max, Math.max(min, Math.round(size)));
}

const load = () => { try { const v = JSON.parse(localStorage.getItem(STORE)); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const save = v => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch {} };

export function createDock({ dock, grip, fold }) {
  const view = matchMedia(WIDE);
  const saved = load();
  const port = () => ({ width: innerWidth, height: innerHeight });
  function apply() {
    const wide = view.matches, folded = !!saved.folded && !wide;
    dock.classList.toggle('folded', folded);
    fold.textContent = folded ? '展开' : '收起'; fold.setAttribute('aria-expanded', String(!folded));
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
  function setFolded(folded) { saved.folded = folded; save(saved); apply(); }

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
  fold.onclick = () => setFolded(!saved.folded);
  addEventListener('resize', apply); view.addEventListener('change', apply);
  apply();
  return {
    // Only a step has a conversation.
    show(on) { dock.hidden = !on; },
    unfold() { if (saved.folded) setFolded(false); },
  };
}
