// Builds the browser extension (Edge and Chrome) into dist/edge from the same code the local server runs:
//   node edge/build.mjs
// Then load dist/edge with "Load unpacked", or hand out dist/yiti-extension-<version>.zip.
// This folder is the source, not an extension: its manifest is only a template, so it cannot be loaded by mistake.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'dist/edge');
const from = (...p) => join(root, ...p), to = (...p) => join(out, ...p);
rmSync(out, { recursive: true, force: true });
mkdirSync(to('web'), { recursive: true }); mkdirSync(to('server'), { recursive: true });

// The engine: the server modules that run in a browser. Extensions serve .js reliably, so .mjs is renamed.
const ENGINE = ['board', 'capture', 'config', 'gemini', 'llm', 'settings', 'teach', 'translate', 'usage', 'validation', 'voice', 'voice-providers'];
for (const name of ENGINE) {
  const code = readFileSync(from('server', `${name}.mjs`), 'utf8');
  if (/from 'node:/.test(code)) throw new Error(`server/${name}.mjs imports a Node module; it cannot run in the extension`);
  writeFileSync(to('server', `${name}.js`), code.replace(/(from '\.{1,2}\/[^']+)\.mjs'/g, "$1.js'"));
}

// The page, with the extension's backend in place of the HTTP one.
for (const file of readdirSync(from('web'))) if (file !== 'backend.js') cpSync(from('web', file), to('web', file));
for (const file of ['backend.js', 'store.js', 'rtc.js']) cpSync(from('edge', file), to('web', file));
// Text meant for the local server is swapped for the extension's (<!-- local-only -->…<!-- /local-only --><!-- edge: … -->).
const html = readFileSync(from('web/index.html'), 'utf8')
  .replace(/<!-- local-only -->[\s\S]*?<!-- \/local-only -->(\s*<!-- edge: ([\s\S]*?) -->)?/g, (all, edge, text) => text || '')
  .replace(/<!-- edge: ([\s\S]*?) -->/g, '$1');
writeFileSync(to('web/index.html'), html);

// The prompts, bundled; the local server reads the same files from prompts/.
const prompts = Object.fromEntries(readdirSync(from('prompts')).filter(f => f.endsWith('.txt')).map(f => [f.slice(0, -4), readFileSync(from('prompts', f), 'utf8')]));
writeFileSync(to('prompts.js'), `// Built from prompts/*.txt by edge/build.mjs.\nexport default ${JSON.stringify(prompts, null, 1)};\n`);

// Reading Math Academy is the same content script as the local version's.
for (const file of ['extract.js', 'relay.js']) cpSync(from('extension', file), to(file));
cpSync(from('edge/manifest.template.json'), to('manifest.json'));
for (const file of ['background.js', 'permission.html', 'permission.js']) cpSync(from('edge', file), to(file));
cpSync(from('edge/icons'), to('icons'), { recursive: true });

// Name, description and toolbar title come from _locales: the store offers a listing for each language found there.
const manifest = JSON.parse(readFileSync(from('edge/manifest.template.json'), 'utf8'));
const locales = readdirSync(from('edge/_locales'));
if (!locales.includes(manifest.default_locale)) throw new Error(`_locales has no ${manifest.default_locale}, the default locale`);
for (const locale of locales) {
  const messages = JSON.parse(readFileSync(from('edge/_locales', locale, 'messages.json'), 'utf8'));
  for (const [, key] of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) if (!messages[key]?.message) throw new Error(`_locales/${locale} has no ${key}`);
  if ([...messages.extensionDescription.message].length > 132) throw new Error(`_locales/${locale}: the description is over 132 characters`);
}
cpSync(from('edge/_locales'), to('_locales'), { recursive: true });

const zip = join(root, `dist/yiti-extension-${manifest.version}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.'], { cwd: out });
console.log(`built ${out}\nzipped ${zip}`);
