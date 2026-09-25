import { check } from './validation.mjs';
import { geminiJSON, geminiError } from './gemini.mjs';

// Every text call (preparing, translating, checking, reviewing) goes through here; TEXT_PROVIDER picks who
// answers. Voice stays on Gemini Live either way. `cheap` asks for the provider's cheaper model (translation).
export function textJSON(packet, cfg, opts, request = fetch) {
  const { cheap, ...rest } = opts;
  if (cfg.textProvider === 'deepseek') return deepseekJSON(packet, cfg, { ...rest, model: cheap ? cfg.deepseekTranslateModel : cfg.deepseekModel }, request);
  return geminiJSON(packet, cfg, { ...rest, model: cheap ? cfg.geminiTranslateModel : cfg.geminiModel }, request);
}
export const textConfigured = cfg => Boolean(cfg.textProvider === 'deepseek' ? cfg.deepseekKey : cfg.geminiKey);
export const textKeyMissing = cfg => `请在 .env 中填写 ${cfg.textProvider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'GEMINI_API_KEY'} 并重启服务。`;

// DeepSeek promises JSON but not its shape ("json_schema" is refused), so the shape is spelled out in the
// instructions; every reply is still checked field by field by the caller, as with Gemini.
export async function deepseekJSON(packet, cfg, { instructions, schema, tokens = 4096, limit = 12000, purpose = null, key = null, timeout = cfg.geminiTimeout, model = cfg.deepseekModel }, request = fetch) {
  check(cfg.deepseekKey, '请在 .env 中填写 DEEPSEEK_API_KEY 并重启服务。', 503);
  const system = `${instructions}\n\n只输出一个 JSON 对象，不要输出任何其他文字。这个对象必须符合下面的 JSON Schema，字段名原样使用：\n${JSON.stringify(schema)}`;
  let response;
  try {
    response = await request('https://api.deepseek.com/chat/completions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${cfg.deepseekKey}`, 'Content-Type': 'application/json' },
      // It thinks before answering and the thinking counts against max_tokens, so leave room for both.
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(packet) }],
        response_format: { type: 'json_object' }, max_tokens: tokens * 2 }),
    });
  } catch { throw new Error('DeepSeek network error or timeout'); }
  if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
  const data = await response.json(), choice = data.choices?.[0], u = data.usage;
  // Thinking is inside completion_tokens and billed as output, so it is not counted a second time.
  cfg.usage?.record({ purpose, model: typeof data.model === 'string' ? data.model : model,
    usage: u && { promptTokenCount: u.prompt_tokens, candidatesTokenCount: u.completion_tokens }, round_id: key });
  check(choice?.finish_reason === 'stop', 'Invalid DeepSeek response');
  const raw = choice.message?.content;
  check(typeof raw === 'string' && raw && raw.length <= limit, 'Invalid DeepSeek response');
  return { value: JSON.parse(raw), model: typeof data.model === 'string' ? data.model.slice(0, 100) : model };
}

export function textError(error) {
  if (!/^DeepSeek/.test(error.message)) return geminiError(error);
  if (/^DeepSeek HTTP (401|403)$/.test(error.message)) return 'DeepSeek 未接受请求，请检查 DEEPSEEK_API_KEY。';
  if (error.message === 'DeepSeek HTTP 402') return 'DeepSeek 账户余额不足，充值后可以重试。';
  if (error.message === 'DeepSeek HTTP 429') return 'DeepSeek 请求太频繁，稍后再试。';
  if (error.message === 'DeepSeek network error or timeout') return 'DeepSeek 暂时连接不上或等待超时，可以重试。';
  return '这次未取得有效的 DeepSeek 内容，可以重试。';
}
