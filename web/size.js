// Text size: one setting for the whole page (the header's A− A+, or ⌘ + and ⌘ −), kept per viewer. The side panel has no
// browser zoom of its own, so the page scales its own text: every font size in app.css is its size times --fs.
export const SIZES = [0.85, 1, 1.15, 1.3, 1.5, 1.75];
export const sizeOf = saved => { const size = Number(saved); return SIZES.includes(size) ? size : 1; };
// One step larger (+1) or smaller (-1), stopping at the ends; 0 is back to the normal size.
export function stepSize(current, direction) {
  if (!direction) return 1;
  const at = SIZES.indexOf(sizeOf(current));
  return SIZES[Math.min(SIZES.length - 1, Math.max(0, at + (direction > 0 ? 1 : -1)))];
}
export const percent = size => `${Math.round(size * 100)}%`;
