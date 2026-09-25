import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function config(env = process.env) {
  const number = (key, fallback, min, max) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
    return n;
  };
  // 一句 keeps 4317; the two run side by side.
  const port = number('YITI_PORT', 4318, 1, 65535);
  if (!Number.isInteger(port)) throw new Error('Invalid YITI_PORT');
  const geminiModel = env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
  if (!/^[a-zA-Z0-9.-]{1,100}$/.test(geminiModel)) throw new Error('Invalid GEMINI_MODEL');
  // Translating is plain work done once per step, so it gets the cheaper model.
  const geminiTranslateModel = env.GEMINI_TRANSLATE_MODEL?.trim() || 'gemini-3.5-flash-lite';
  if (!/^[a-zA-Z0-9.-]{1,100}$/.test(geminiTranslateModel)) throw new Error('Invalid GEMINI_TRANSLATE_MODEL');
  // Who answers the text calls; voice stays on Gemini Live either way.
  const textProvider = env.TEXT_PROVIDER?.trim().toLowerCase() || 'gemini';
  if (!['gemini', 'deepseek'].includes(textProvider)) throw new Error('Invalid TEXT_PROVIDER');
  const deepseekModel = env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash', deepseekTranslateModel = env.DEEPSEEK_TRANSLATE_MODEL?.trim() || deepseekModel;
  for (const m of [deepseekModel, deepseekTranslateModel]) if (!/^[a-zA-Z0-9.-]{1,100}$/.test(m)) throw new Error('Invalid DEEPSEEK_MODEL');
  const geminiThinkingLevel = (env.GEMINI_THINKING_LEVEL ?? 'low').trim().toLowerCase();
  if (!['', 'minimal', 'low', 'medium', 'high'].includes(geminiThinkingLevel)) throw new Error('Invalid GEMINI_THINKING_LEVEL');
  // Live models answer only on bidiGenerateContent, so they are named separately from the text model.
  const geminiLiveModel = env.GEMINI_LIVE_MODEL?.trim() || 'gemini-3.8-live-extended-thinking';
  if (!/^[a-zA-Z0-9.-]{1,100}$/.test(geminiLiveModel)) throw new Error('Invalid GEMINI_LIVE_MODEL');
  const voiceThinkingLevel = (env.VOICE_THINKING_LEVEL?.trim() || 'LOW').toUpperCase();
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(voiceThinkingLevel)) throw new Error('Invalid VOICE_THINKING_LEVEL');
  return {
    port,
    textProvider, deepseekKey: env.DEEPSEEK_API_KEY?.trim() || '', deepseekModel, deepseekTranslateModel,
    geminiKey: env.GEMINI_API_KEY?.trim() || '', geminiModel, geminiTranslateModel, geminiThinkingLevel, geminiLiveModel, voiceThinkingLevel,
    geminiTimeout: number('GEMINI_TIMEOUT_MS', 30000, 100, 120000),
    geminiPreparationTimeout: number('GEMINI_PREPARATION_TIMEOUT_MS', 60000, 100, 180000),
    voiceMaxSeconds: number('VOICE_MAX_SECONDS', 600, 30, 3600),
    // A call nobody is talking in ends before it runs up the bill.
    voiceIdleSeconds: number('VOICE_IDLE_SECONDS', 90, 15, 3600),
  };
}
