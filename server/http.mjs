import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { check, HttpError } from './validation.mjs';
import { Board } from './board.mjs';
import { Teach } from './teach.mjs';
import './prompts-node.mjs';
import { Voice } from './voice.mjs';
import { Usage } from './usage.mjs';
import { accept } from './ws.mjs';
import { textConfigured } from './llm.mjs';
import { DEMO } from '../web/demo.js';
import { config } from './config.mjs';
import { Settings, testServices } from './settings.mjs';
import { voiceConfigured } from './voice-providers.mjs';

// Captures come from the extension, or from a Math Academy page itself; no other site can name these origins.
const CAPTURE_ORIGIN = /^(chrome-extension:\/\/[a-p]{32}|https:\/\/(www\.)?mathacademy\.com)$/;

export function createServer({ store, cfg, settings = new Settings(), webRoot, token = randomBytes(32).toString('hex'), infer, connect }) {
  const streams = new Set();
  const usage = new Usage(store); cfg = { ...cfg, usage };
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']], ['/app.css', ['app.css', 'text/css; charset=utf-8']],
    ...['app.js', 'math.js', 'mode.js', 'voice.js', 'voice-worklet.js', 'settings.js', 'backend.js', 'demo.js'].map(f => [`/${f}`, [f, 'text/javascript; charset=utf-8']]),
  ]);
  // What the page's code is, so a page left open across a restart can tell it is running old code.
  const build = (() => { const hash = createHash('sha256'); for (const [file] of files.values()) { try { hash.update(readFileSync(join(webRoot, file))); } catch {} } return hash.digest('hex').slice(0, 12); })();
  const view = () => ({ ...board.state(), gemini: textConfigured(cfg), voice: voiceConfigured(cfg), build });
  const publish = () => { const data = `event: state\ndata: ${JSON.stringify(view())}\n\n`; for (const res of streams) res.write(data); };
  const board = new Board(store, publish);
  const teach = new Teach(board, cfg, infer);
  const voice = new Voice(board, cfg, connect);
  const sockets = new Set();
  const equal = value => typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const cookieOf = req => req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('yiti_auth='))?.slice(10);
  async function body(req, limit = 100000) {
    check(req.headers['content-type']?.split(';')[0] === 'application/json', 'Expected application/json', 415);
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; check(size <= limit, 'Request too large', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { throw new HttpError(400, 'Invalid JSON'); }
  }
  function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const port = server.address().port;
      check([`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host), 'Invalid Host', 403);
      const origin = `http://${req.headers.host}`, url = new URL(req.url, origin), path = url.pathname;
      if (path === '/api/capture') {
        const from = req.headers.origin || '';
        check(CAPTURE_ORIGIN.test(from), 'Capture origin denied', 403);
        res.setHeader('Access-Control-Allow-Origin', from); res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' });
          return res.end();
        }
        check(req.method === 'POST', 'Not found', 404);
        return json(res, board.capture(await body(req, 800000)));
      }
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      if (req.headers.origin) check(req.headers.origin === origin, 'Cross-origin request denied', 403);
      check(!['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']), 'Cross-site request denied', 403);
      if (req.method === 'GET' && path === '/api/health') return json(res, { service: 'yiti', version: '0.1.0' });
      if (req.method === 'GET' && files.has(path)) {
        const [file, mime] = files.get(path);
        if (path === '/') res.setHeader('Set-Cookie', `yiti_auth=${token}; HttpOnly; SameSite=Strict; Path=/`);
        res.writeHead(200, { 'Content-Type': mime }); return res.end(readFileSync(join(webRoot, file)));
      }
      const bearer = req.headers.authorization?.startsWith('Bearer ') && equal(req.headers.authorization.slice(7));
      check(bearer || equal(cookieOf(req)), 'Authentication required', 401);
      if (req.method !== 'GET' && !bearer) check(req.headers.origin === origin, 'Same-origin write required', 403);
      if (req.method === 'GET' && path === '/api/state') return json(res, view());
      if (req.method === 'GET' && path === '/api/usage') return json(res, usage.summary());
      if (req.method === 'GET' && path === '/api/settings') return json(res, settings.view(cfg));
      if (req.method === 'POST' && path === '/api/settings') {
        const values = settings.patch(await body(req));
        let next;
        try { next = config(settings.env(process.env, values)); } catch (e) { throw new HttpError(400, `设置不对：${e.message}`); }
        settings.save(values);
        // Everything holding cfg sees the new keys at once; no restart.
        Object.assign(cfg, next);
        publish();
        return json(res, settings.view(cfg));
      }
      if (req.method === 'POST' && path === '/api/settings/test') return json(res, await testServices(cfg, { connect }));
      if (req.method === 'GET' && path === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        streams.add(res);
        res.write(`event: state\ndata: ${JSON.stringify(view())}\n\n`);
        const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
        res.on('close', () => { clearInterval(heartbeat); streams.delete(res); });
        return;
      }
      if (req.method === 'POST') {
        if (path === '/api/command') { board.command(await body(req)); return json(res, view()); }
        // The example written for 一题 itself, followed as if it were open on Math Academy.
        if (path === '/api/demo') { await body(req); board.capture(DEMO); return json(res, view()); }
        const action = { '/api/prepare': 'prepare', '/api/translate': 'translate', '/api/check': 'check', '/api/say': 'say' }[path];
        if (action) { teach[action](await body(req)); return json(res, view()); }
      }
      throw new HttpError(404, 'Not found');
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      json(res, { error: e instanceof HttpError ? e.message : 'Internal server error' }, e instanceof HttpError ? e.status : 500);
    }
  });
  // The voice relay is the one upgraded connection; it carries the learner's audio, never the key.
  server.on('upgrade', (req, socket) => {
    try {
      const port = server.address().port, origin = `http://${req.headers.host}`;
      check([`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host), 'Invalid Host', 403);
      if (req.headers.origin) check(req.headers.origin === origin, 'Cross-origin request denied', 403);
      check(equal(cookieOf(req)), 'Authentication required', 401);
      const url = new URL(req.url, origin);
      check(url.pathname === '/api/voice', 'Not found', 404);
      const conn = accept(req, socket);
      if (!conn) return;
      sockets.add(conn); conn.on('close', () => sockets.delete(conn));
      voice.start(conn, url.searchParams);
    } catch { socket.destroy(); }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  return { server, board, teach, voice, usage, token,
    closeStreams: () => { for (const res of streams) res.end(); for (const conn of sockets) conn.close(1001, 'Server stopping'); } };
}
