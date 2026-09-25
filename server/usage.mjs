// What each Gemini call actually used, read from the usageMetadata Google returns with it.
// Prices are USD per million tokens from https://ai.google.dev/gemini-api/docs/pricing (read 2026-09-23).
// Thinking tokens are billed as output. Cached-token discounts are not applied, so a figure can run
// slightly high; a model not listed here keeps its tokens but gets no price.
const PRICES = [
  { prefix: 'gemini-3.8-live', text_in: 0.75, text_out: 4.50, audio_in: 3.00, audio_out: 12.00 },
  // Speech: audio out only. Prices double on 2027-01-01.
  { prefix: 'gemini-3.8-flash-tts', text_in: 0.50, text_out: 0.50, audio_out: 9.00, from: '2027-01-01', then: { text_in: 1.00, text_out: 1.00, audio_out: 18.00 } },
  { prefix: 'gemini-3.8-flash-lite-tts', text_in: 0.50, text_out: 0.50, audio_out: 6.00, from: '2027-01-01', then: { text_in: 1.00, text_out: 1.00, audio_out: 12.00 } },
  { prefix: 'gemini-3.8-flash', text_in: 0.75, text_out: 3.75, from: '2027-01-01', then: { text_in: 1.50, text_out: 7.50 } },
  // DeepSeek direct, https://api-docs.deepseek.com/quick_start/pricing (read 2026-09-25): peak prices below,
  // half outside 01–04 and 06–10 UTC on weekdays. Chinese public holidays are not known here, so those days count as peak.
  { prefix: 'deepseek-flash', text_in: 0.30, text_out: 1.20, offpeak: true },
  { prefix: 'deepseek-v4-pro', text_in: 1.32, text_out: 3.96, offpeak: true },
  { prefix: 'gemini-3.5-flash-lite', text_in: 0.30, text_out: 2.50, audio_in: 0.30 },
];
export const PURPOSES = {
  prepare: '例题拆块', translate: '翻译', check: '默写检查', say: '一句点评', voice_learn: '语音讲解', voice_check: '检查讲解', voice_say: '点评讲解', voice_write: '语音陪练（默写）', voice_prereq: '前置知识（交答案前）',
};

const count = value => Number.isInteger(value) && value > 0 ? value : 0;
const modality = (details, kind) => (Array.isArray(details) ? details : []).reduce((n, d) => d?.modality === kind ? n + count(d.tokenCount) : n, 0);
// REST reports candidatesTokenCount, Live reports responseTokenCount; both put the rest in details.
// A Live turn's prompt already includes the whole conversation so far, which is how it is billed.
export function tokensOf(usage) {
  const prompt = count(usage?.promptTokenCount), audioIn = modality(usage?.promptTokensDetails, 'AUDIO');
  const output = count(usage?.candidatesTokenCount ?? usage?.responseTokenCount);
  const audioOut = modality(usage?.candidatesTokensDetails ?? usage?.responseTokensDetails, 'AUDIO');
  return { text_in: Math.max(0, prompt - audioIn), audio_in: audioIn, text_out: Math.max(0, output - audioOut), audio_out: audioOut,
    thoughts: count(usage?.thoughtsTokenCount) };
}
const peak = at => { const d = new Date(at), day = d.getUTCDay(), h = d.getUTCHours(); return day >= 1 && day <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10)); };
export function costOf(model, tokens, at = new Date().toISOString()) {
  const price = PRICES.filter(p => typeof model === 'string' && model.startsWith(p.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!price) return null;
  let rate = price.from && at >= price.from ? { ...price, ...price.then } : price;
  if (price.offpeak && !peak(at)) rate = { ...rate, text_in: rate.text_in / 2, text_out: rate.text_out / 2 };
  const audioIn = rate.audio_in ?? rate.text_in, audioOut = rate.audio_out ?? rate.text_out;
  return (tokens.text_in * rate.text_in + tokens.audio_in * audioIn + (tokens.text_out + tokens.thoughts) * rate.text_out + tokens.audio_out * audioOut) / 1e6;
}

export class Usage {
  constructor(store) {
    this.db = store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS usage_log (id INTEGER PRIMARY KEY, at TEXT NOT NULL, purpose TEXT NOT NULL, model TEXT NOT NULL,
      round_id TEXT, text_in INTEGER, audio_in INTEGER, text_out INTEGER, audio_out INTEGER, thoughts INTEGER, usd REAL)`);
  }
  // Metering must never break the call it measures.
  record({ purpose, model, usage, round_id = null }) {
    try {
      if (!usage || !PURPOSES[purpose]) return null;
      const at = new Date().toISOString(), tokens = tokensOf(usage), usd = costOf(model, tokens, at);
      this.db.prepare('INSERT INTO usage_log (at,purpose,model,round_id,text_in,audio_in,text_out,audio_out,thoughts,usd) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(at, purpose, String(model).slice(0, 100), round_id, tokens.text_in, tokens.audio_in, tokens.text_out, tokens.audio_out, tokens.thoughts, usd);
      return { ...tokens, usd };
    } catch { return null; }
  }
  // Days are the learner's local days, not UTC ones.
  summary(now = new Date()) {
    const day = new Date(now); day.setHours(0, 0, 0, 0);
    const week = new Date(day); week.setDate(week.getDate() - 6);
    const total = since => this.db.prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(usd),0) AS usd FROM usage_log WHERE at >= ?`).get(since);
    const first = this.db.prepare('SELECT MIN(at) AS at FROM usage_log').get().at;
    const rows = this.db.prepare(`SELECT purpose, COUNT(*) AS calls, COALESCE(SUM(usd),0) AS usd, SUM(usd IS NULL) AS unpriced,
      SUM(text_in) AS text_in, SUM(audio_in) AS audio_in, SUM(text_out) AS text_out, SUM(audio_out) AS audio_out, SUM(thoughts) AS thoughts
      FROM usage_log WHERE at >= ? GROUP BY purpose ORDER BY usd DESC`).all(week.toISOString());
    return { since: first, today: total(day.toISOString()), week: total(week.toISOString()), all: total(''),
      week_by_purpose: rows.map(r => ({ ...r, label: PURPOSES[r.purpose] })) };
  }
}
