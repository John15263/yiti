// The conversation about a step, as one timeline: what was typed and what was said aloud, in the order it happened.
// Typed turns are kept on the step (rec.chat), spoken ones as the transcript of each call (rec.voice); a call still on
// the air, or one just ended and not yet recorded, is handed in as `pending`. A call sits where it began, as one block.
// Each item is { id, t, role: 'you' | 'tutor', text, spoken, call?, mode? }.
const time = value => { const t = Date.parse(value); return Number.isFinite(t) ? t : 0; };

export function threadItems(rec, pending = []) {
  const items = [];
  for (const m of rec?.chat?.messages || []) items.push({ id: m.id, t: time(m.at), role: m.role === 'user' ? 'you' : 'tutor', text: m.text, spoken: false });
  // A call is recorded when it ends, so it began that many seconds before; its lines follow one another from there.
  const spoken = (call, mode, start, lines) => (lines || []).forEach((line, i) => {
    if (line?.text?.trim()) items.push({ id: `${call}:${i}`, t: start + i, role: line.role === 'tutor' ? 'tutor' : 'you', text: line.text, spoken: true, call, mode });
  });
  for (const v of rec?.voice || []) spoken(v.session_id, v.mode, time(v.at) - (v.seconds || 0) * 1000, v.transcript);
  for (const p of pending) spoken(p.id, p.mode, p.startedAt, p.lines);
  return items.sort((a, b) => a.t - b.t);
}
