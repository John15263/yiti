// What one Math Academy step is, and what 一题 does with it, read from its record alone. The server builds the
// voice tutor's prompt from it and the page decides when to end a call from it, so both sides agree.
//
// A step is a tutorial or a worked example (content: read it, ask about it), or a practice question:
//   learn    — a tutorial or worked example: the whole step is on screen to be understood.
//   prereq   — a question not yet answered: only the more basic knowledge it rests on may be helped with, with
//              examples of its own, never this question's working — Math Academy is measuring what can be done
//              alone, and schedules reviews by it.
//   answered — a question answered on Math Academy: from here it can be talked through in full.

export const isContent = rec => ['tutorial', 'example'].includes(rec?.step?.type);
export const isQuestion = rec => rec?.step?.type === 'question';
export const answered = rec => isQuestion(rec) && !!rec.sections?.result;
export const unanswered = rec => isQuestion(rec) && !rec.sections?.result;
// The paragraphs of a tutorial or example that carry what it teaches (an example's question is shown apart).
export const learnParas = rec => rec?.step?.type === 'example' ? rec.sections?.explanation || [] : rec?.sections?.body || [];

export function voiceMode(rec) {
  if (!rec?.step) return null;
  if (unanswered(rec)) return { mode: 'prereq', key: `prereq:${rec.key}` };
  if (answered(rec)) return { mode: 'answered', key: `answered:${rec.key}` };
  if (isContent(rec)) return { mode: 'learn', key: `learn:${rec.key}` };
  return null;
}
