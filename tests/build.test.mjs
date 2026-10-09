import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The extension runs the engine from the server modules named in edge/build.mjs; one imported but not named there is
// missing from the extension, and it fails only when loaded in a browser.
test('every server module the extension\'s engine imports is built into it', () => {
  const build = readFileSync(new URL('../edge/build.mjs', import.meta.url), 'utf8');
  const engine = new Set(JSON.parse(build.match(/const ENGINE = (\[[^\]]*\])/)[1].replaceAll("'", '"')));
  const backend = readFileSync(new URL('../edge/backend.js', import.meta.url), 'utf8');
  const needed = [...backend.matchAll(/from '\.\.\/server\/([\w-]+)\.js'/g)].map(m => m[1]);
  for (let i = 0; i < needed.length; i++) {
    const code = readFileSync(new URL(`../server/${needed[i]}.mjs`, import.meta.url), 'utf8');
    for (const [, name] of code.matchAll(/from '\.\/([\w-]+)\.mjs'/g)) if (!needed.includes(name)) needed.push(name);
  }
  for (const name of needed) assert.ok(engine.has(name), `server/${name}.mjs is imported by the extension but not in ENGINE (edge/build.mjs)`);
});
