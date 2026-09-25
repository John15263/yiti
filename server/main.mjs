import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config, root } from './config.mjs';
import { Store } from './store.mjs';
import { createServer } from './http.mjs';
import { voiceProvider } from './voice-providers.mjs';

process.umask(0o077);
const cfg = config();
const data = join(root, 'data'); mkdirSync(data, { recursive: true, mode: 0o700 });
const tokenPath = join(data, '.local-token');
if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600 });
chmodSync(tokenPath, 0o600);
const store = new Store(join(data, 'yiti.sqlite'));
const app = createServer({ store, cfg, token: readFileSync(tokenPath, 'utf8').trim(), webRoot: join(root, 'web') });
app.server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`一题 http://127.0.0.1:${cfg.port}`);
  console.log(`Text: ${cfg.textProvider} · ${cfg.textProvider === 'deepseek' ? `${cfg.deepseekModel} · translate ${cfg.deepseekTranslateModel}` : `${cfg.geminiModel} · translate ${cfg.geminiTranslateModel}`}`);
  const voice = voiceProvider(cfg);
  console.log(`Voice: ${voice.name} ${voice.configured(cfg) ? 'configured' : 'not configured'} · ${voice.model(cfg)}`);
});
app.server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Port already in use. Choose YITI_PORT in .env.' : 'Unable to start server.'); store.close(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  app.closeStreams(); app.server.close(() => { store.close(); process.exit(0); });
});
