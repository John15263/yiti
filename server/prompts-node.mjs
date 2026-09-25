import { readdirSync, readFileSync } from 'node:fs';
import { usePrompts } from './teach.mjs';

// The local server reads the prompts from disk; the extension bundles the same files.
const dir = new URL('../prompts/', import.meta.url);
usePrompts(Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.txt')).map(f => [f.slice(0, -4), readFileSync(new URL(f, dir), 'utf8')])));
