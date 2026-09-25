// The side panel cannot always ask for the microphone itself; a tab of the extension can, and the permission
// then holds for the side panel too.
const status = document.getElementById('status');
try {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
  status.textContent = '✓ 已经允许了。回到侧边栏按 ⌘ ] 就能说话，这个标签页可以关掉。';
} catch {
  status.textContent = '没有允许。点地址栏左边的图标，把麦克风改成「允许」，再刷新这一页。';
}
