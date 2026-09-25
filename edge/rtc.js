// Qwen-Omni-Realtime over WebRTC, presented as the WebSocket the voice relay already speaks to.
//
// A browser socket cannot carry the API key in a header, and Model Studio accepts it nowhere else (tried
// 2026-09-26). The WebRTC handshake is an ordinary HTTPS request that can carry it, and an extension may make
// it across origins. Audio then flows on a media track both ways, and the service's events arrive on a data
// channel it opens itself, as the same JSON as over the socket.

const GATHER_MS = 1500;
const iceGathered = pc => new Promise(resolve => {
  if (pc.iceGatheringState === 'complete') return resolve();
  const done = () => { if (pc.iceGatheringState === 'complete') resolve(); };
  pc.addEventListener('icegatheringstatechange', done);
  setTimeout(resolve, GATHER_MS);
});
// The socket address the Qwen provider builds, turned into the matching WebRTC handshake address.
export const rtcEndpoint = url => url.replace(/^wss:/, 'https:').replace('/api-ws/v1/realtime', '/api/v1/webrtc/realtime');
const workspaceHost = url => /^wss:\/\/[^./]+\.[^./]+\.maas\.aliyuncs\.com\//.test(url);

export function rtcUpstream(url, options = {}) {
  const socket = new EventTarget();
  Object.assign(socket, { readyState: 0, binaryType: 'arraybuffer' });
  const emit = (type, data) => socket.dispatchEvent(type === 'message' ? new MessageEvent('message', { data }) : new Event(type));
  let closed = false, pc = null, player = null;
  const end = () => {
    if (closed) return;
    closed = true; socket.readyState = 3;
    try { pc?.close(); } catch {}
    if (player) player.srcObject = null;
    emit('close');
  };
  // The shared address has no WebRTC; say so the way the service reports errors, so the relay shows it.
  if (!workspaceHost(url)) {
    setTimeout(() => { socket.readyState = 1; emit('open'); emit('message', JSON.stringify({ type: 'error', error: { message: '插件里的百炼语音要在「设置」里填业务空间 ID' } })); }, 0);
    Object.assign(socket, { send() {}, close: end, useMicrophone() {} });
    return socket;
  }
  pc = new RTCPeerConnection({ iceServers: [] });
  player = new Audio();
  player.autoplay = true;
  pc.ontrack = e => { player.srcObject = e.streams[0] || new MediaStream([e.track]); player.play().catch(() => {}); };
  const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const deliver = async e => {
    let data = e.data;
    if (data instanceof Blob) data = await data.text();
    else if (typeof data !== 'string') data = new TextDecoder().decode(data);
    emit('message', data);
  };
  const open = () => { if (socket.readyState !== 0) return; socket.readyState = 1; emit('open'); };
  // The service answers on a channel of its own (label "txt"); ours is only a way to send if it never opens.
  let theirs = null;
  const ours = pc.createDataChannel('oai-events');
  ours.onmessage = deliver;
  ours.onopen = () => setTimeout(open, 1500);
  pc.ondatachannel = event => {
    theirs = event.channel;
    theirs.onmessage = deliver;
    if (theirs.readyState === 'open') open(); else theirs.onopen = open;
  };
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) { if (!closed) emit('error'); end(); } };
  Object.assign(socket, {
    send(text) { const ch = theirs?.readyState === 'open' ? theirs : ours; if (ch.readyState === 'open') ch.send(text); },
    close: end,
    // The page hands over the microphone once it has it; until then nothing is sent.
    useMicrophone(stream) { transceiver.sender.replaceTrack(stream?.getAudioTracks()[0] || null).catch(() => {}); },
  });
  (async () => {
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await iceGathered(pc);
      const res = await fetch(rtcEndpoint(url), { method: 'POST', headers: { Authorization: options.headers?.Authorization || '', 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    } catch { if (!closed) emit('error'); end(); }
  })();
  return socket;
}

// Does Model Studio take this key and workspace for WebRTC? A handshake is enough to tell; no audio is sent.
export async function qwenRtcCheck(cfg) {
  if (!cfg.dashscopeWorkspace) return { ok: false, message: '插件里的百炼语音要填业务空间 ID（百炼控制台右上角能看到）' };
  const url = `https://${cfg.dashscopeWorkspace}.${cfg.dashscopeRegion}.maas.aliyuncs.com/api/v1/webrtc/realtime?model=${encodeURIComponent(cfg.qwenRealtimeModel)}`;
  const pc = new RTCPeerConnection({ iceServers: [] });
  try {
    pc.addTransceiver('audio', { direction: 'sendrecv' });
    pc.createDataChannel('oai-events');
    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc);
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${cfg.dashscopeKey}`, 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp, signal: AbortSignal.timeout(10000) });
    if (res.ok) return { ok: true };
    return { ok: false, message: res.status === 401 || res.status === 403 ? 'key 不对，或者没有这个模型的权限' : res.status === 404 ? '业务空间 ID 或区域不对' : `服务返回 HTTP ${res.status}` };
  } catch { return { ok: false, message: '连不上，检查网络、区域和业务空间 ID' }; }
  finally { pc.close(); }
}
