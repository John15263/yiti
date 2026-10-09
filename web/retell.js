// 更简单的解释 on the page: the one bar every telling has under it (the engine's side is server/retell.mjs). Which telling
// this is, the way back to the one before, and the way to a simpler one, or why there is none.
export const SIMPLEST = '已经是最简单的一版了。还不明白的话，问问陪练。';

// t: { versions, at, limit, simplifying }; act(path) asks the engine (path is 'simpler' or 'back').
export function tellingBar(t, act, { working = '正在换一种更简单的讲法…' } = {}) {
  const count = t?.versions?.length || 0, at = t?.at ?? -1, simplifying = t?.simplifying, nodes = [];
  const say = text => { const span = document.createElement('span'); span.className = 'muted'; span.textContent = text; return span; };
  const link = (text, path, cls = 'link') => { const b = document.createElement('button'); b.className = cls; b.textContent = text; b.onclick = () => act(path); return b; };
  if (count > 1) nodes.push(say(`第 ${at + 1} / ${count} 种讲法`));
  if (at > 0) nodes.push(link('上一种讲法', 'back'));
  if (simplifying?.status === 'running') nodes.push(say(working));
  else if (simplifying?.status === 'error') nodes.push(say(simplifying.error || ''), link('重试', 'simpler'));
  else if (at < count - 1 || count < (t?.limit || 3)) nodes.push(link('更简单的解释', 'simpler', 'pill'));
  else nodes.push(say(SIMPLEST));
  return nodes;
}
