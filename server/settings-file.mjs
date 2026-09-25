import { existsSync, readFileSync, writeFileSync, chmodSync, renameSync } from 'node:fs';

// The local server keeps the page's settings in one owner-only file.
export function settingsFile(path) {
  return {
    read() {
      if (!existsSync(path)) return null;
      try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
    },
    // Written whole, then moved into place, so a crash never leaves half a file of keys.
    write(values) {
      writeFileSync(`${path}.tmp`, JSON.stringify(values, null, 1), { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
      chmodSync(path, 0o600);
    },
  };
}
