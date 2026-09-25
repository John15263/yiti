import { createHash } from 'node:crypto';

// A minimal RFC 6455 server for one loopback client; no extensions, no compression.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const LIMIT = 4 * 1024 * 1024;

export function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (req.headers['sec-websocket-version'] !== '13' || !key) { socket.destroy(); return null; }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${createHash('sha1').update(key + GUID).digest('base64')}\r\n\r\n`);
  socket.setNoDelay(true);
  return new Connection(socket);
}

function frame(opcode, payload) {
  const length = payload.length;
  const header = length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  if (length < 126) header[1] = length;
  else if (length < 65536) { header[1] = 126; header.writeUInt16BE(length, 2); }
  else { header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); }
  return Buffer.concat([header, payload]);
}

class Connection {
  constructor(socket) {
    this.socket = socket; this.buffer = Buffer.alloc(0); this.fragments = []; this.fragmentOpcode = 0;
    this.handlers = { message: [], close: [] }; this.open = true;
    socket.on('data', chunk => this.feed(chunk));
    socket.on('error', () => this.finish());
    socket.on('close', () => this.finish());
  }
  on(event, handler) { this.handlers[event].push(handler); return this; }
  emit(event, value) { for (const handler of this.handlers[event]) handler(value); }
  finish() { if (!this.open) return; this.open = false; this.emit('close'); this.socket.destroy(); }
  send(text) {
    if (!this.open) return;
    try { this.socket.write(frame(1, Buffer.from(text))); } catch { this.finish(); }
  }
  close(code = 1000, reason = '') {
    if (!this.open) return;
    const payload = Buffer.concat([Buffer.alloc(2), Buffer.from(reason.slice(0, 120))]);
    payload.writeUInt16BE(code, 0);
    try { this.socket.write(frame(8, payload)); } catch {}
    this.open = false; this.emit('close');
    this.socket.end();
  }
  feed(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.open) {
      const read = this.decode();
      if (!read) return;
    }
  }
  decode() {
    const b = this.buffer;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0, opcode = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
    let length = b[1] & 0x7f, offset = 2;
    if (length === 126) { if (b.length < 4) return false; length = b.readUInt16BE(2); offset = 4; }
    else if (length === 127) {
      if (b.length < 10) return false;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(LIMIT)) { this.close(1009, 'Message too large'); return false; }
      length = Number(big); offset = 10;
    }
    // Every client frame must be masked; anything else is a protocol error.
    if (!masked) { this.close(1002, 'Unmasked frame'); return false; }
    if (length > LIMIT) { this.close(1009, 'Message too large'); return false; }
    if (b.length < offset + 4 + length) return false;
    const mask = b.subarray(offset, offset + 4), payload = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i++) payload[i] = b[offset + 4 + i] ^ mask[i & 3];
    this.buffer = b.subarray(offset + 4 + length);
    if (opcode === 8) { this.close(1000); return false; }
    if (opcode === 9) { try { this.socket.write(frame(10, payload)); } catch { this.finish(); } return true; }
    if (opcode === 10) return true;
    if (opcode === 0) {
      this.fragments.push(payload);
      if (!fin) return true;
      const full = Buffer.concat(this.fragments);
      this.fragments = [];
      if (this.fragmentOpcode === 1) this.emit('message', full.toString('utf8'));
      return true;
    }
    if (opcode === 1 || opcode === 2) {
      if (!fin) { this.fragmentOpcode = opcode; this.fragments = [payload]; return true; }
      if (opcode === 1) this.emit('message', payload.toString('utf8'));
      return true;
    }
    this.close(1002, 'Unsupported frame');
    return false;
  }
}
