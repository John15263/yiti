// Records and a few named values in the browser's own storage. They are held in memory so the engine reads
// them synchronously, exactly as it reads SQLite on the local server; every write goes through to storage.
export class BrowserStore {
  static async open() { return new BrowserStore(await chrome.storage.local.get(null)); }
  constructor(all) {
    this.records = new Map(); this.meta = new Map();
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('step:')) this.records.set(k.slice(5), v);
      else if (k.startsWith('meta:')) this.meta.set(k.slice(5), v);
    }
  }
  // Callers change what they are given and save it back, so they are always given a copy.
  step(key) { const r = this.records.get(key); return r ? structuredClone(r) : null; }
  putStep(rec) {
    const copy = structuredClone(rec);
    this.records.set(rec.key, copy);
    void chrome.storage.local.set({ [`step:${rec.key}`]: copy });
  }
  steps() { return [...this.records.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).map(r => structuredClone(r)); }
  get(name) { return this.meta.has(name) ? structuredClone(this.meta.get(name)) : null; }
  set(name, value) {
    this.meta.set(name, structuredClone(value));
    void chrome.storage.local.set({ [`meta:${name}`]: value });
  }
}
