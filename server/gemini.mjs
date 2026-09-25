import { check } from './validation.mjs';

// Only server-owned prompts and schemas reach this transport.
export async function geminiJSON(packet, cfg, { instructions, schema, tokens = 4096, limit = 12000, purpose = null, key = null, timeout = cfg.geminiTimeout, model = cfg.geminiModel }, request = fetch) {
  check(cfg.geminiKey, '请在 .env 中填写 GEMINI_API_KEY 并重启服务。', 503);
  let response;
  try {
    response = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { 'x-goog-api-key': cfg.geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(packet) }] }],
        generationConfig: { maxOutputTokens: tokens, responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } },
          ...(cfg.geminiThinkingLevel ? { thinkingConfig: { thinkingLevel: cfg.geminiThinkingLevel } } : {}) },
      }),
    });
  } catch { throw new Error('Gemini network error or timeout'); }
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const data = await response.json(), candidate = data.candidates?.[0];
  // A reply that fails the checks below was still billed, so it is counted before them.
  cfg.usage?.record({ purpose, model: typeof data.modelVersion === 'string' ? data.modelVersion : model, usage: data.usageMetadata, round_id: key });
  check(candidate?.finishReason === 'STOP', 'Invalid Gemini response');
  const raw = candidate.content?.parts?.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  check(raw && raw.length <= limit, 'Invalid Gemini response');
  return { value: JSON.parse(raw), model: typeof data.modelVersion === 'string' ? data.modelVersion.slice(0, 100) : model };
}

export function geminiError(error) {
  if (/^Gemini HTTP (400|401|403)$/.test(error.message)) return 'Gemini 未接受请求，请检查 API key、模型名称及使用权限。';
  if (error.message === 'Gemini HTTP 404') return '当前 Gemini 模型不可用，请检查 .env 中的 GEMINI_MODEL。';
  if (error.message === 'Gemini HTTP 429') return 'Gemini 的额度或请求频率暂时受限，可以稍后重试。';
  if (error.message === 'Gemini network error or timeout') return 'Gemini 暂时连接不上或等待超时，可以重试。';
  return '这次未取得有效的 Gemini 内容，可以重试。';
}
