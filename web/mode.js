// What one Math Academy step asks of 一题 right now, read from its record alone. The server builds the voice
// tutor's prompt from it and the page decides when to end a call from it, so both sides agree.
//
//   learn  — a block of a tutorial or worked example is on screen to be understood.
//   write  — the block is hidden and being written from memory; the tutor never sees the block here.
//   check  — a written block came back checked, with the original beside it.
//   say    — a question is answered on Math Academy; its key step is being said in one sentence.
//   prereq — a question not yet answered: the tutor may only fill in more basic knowledge it rests on,
//            with examples of its own, never this question's working — Math Academy is measuring what
//            can be done alone, and schedules reviews by it.

export const learnable = rec => ['tutorial', 'example'].includes(rec?.step?.type);
export const learnParas = rec => rec?.step?.type === 'example' ? rec.sections?.explanation || [] : rec?.sections?.body || [];
export const blockParas = (rec, block) => learnParas(rec).slice(block.start, block.end);

export function voiceMode(rec) {
  if (!rec?.step) return null;
  if (rec.step.type === 'question') {
    if (!rec.sections?.result) return { mode: 'prereq', key: `prereq:${rec.key}` };
    const done = rec.say?.attempts?.findLast(a => a.status === 'done');
    return { mode: 'say', key: `say:${rec.key}:${done?.id || 'open'}` };
  }
  if (!learnable(rec) || rec.prep?.status !== 'ready') return null;
  const p = rec.progress, i = p.index;
  if (p.phase === 'learn') return { mode: 'learn', index: i, key: `learn:${rec.key}:${i}` };
  if (p.phase === 'write') return { mode: 'write', index: i, key: `write:${rec.key}:${i}` };
  if (p.phase === 'checked') {
    const a = p.inputs[i].attempts.findLast(x => x.status === 'done');
    return { mode: 'check', index: i, key: `check:${rec.key}:${i}:${a?.id}` };
  }
  return null;
}
