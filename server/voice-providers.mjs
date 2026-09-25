// The live voice services the relay can talk to (VOICE_PROVIDER). Each one turns the relay's few intentions
// into its own protocol — set up the call, pass on the microphone, ask for an answer, add context that
// wants no answer — and reads its messages back as the same few events:
//   { ready, audio: [base64 16-bit PCM, 24 kHz mono], heard, said, interrupted, done, usage, error }
// so the relay and the page never depend on which service is speaking.

const GEMINI_LIVE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const gemini = {
  name: 'Gemini Live',
  configured: cfg => Boolean(cfg.geminiKey),
  missing: 'GEMINI_API_KEY',
  model: cfg => cfg.geminiLiveModel,
  open: (cfg, connect) => connect(`${GEMINI_LIVE}?key=${encodeURIComponent(cfg.geminiKey)}`),
  setup: (cfg, system) => [{ setup: {
    model: `models/${cfg.geminiLiveModel}`,
    generationConfig: { responseModalities: ['AUDIO'],
      // The extended-thinking live model refuses a session without an explicit level.
      ...(/thinking/i.test(cfg.geminiLiveModel) ? { thinkingConfig: { thinkingLevel: cfg.voiceThinkingLevel } } : {}) },
    systemInstruction: { parts: [{ text: system }] },
    inputAudioTranscription: {}, outputAudioTranscription: {},
  } }],
  audio: data => [{ realtimeInput: { audio: { data, mimeType: 'audio/pcm;rate=16000' } } }],
  audioEnd: () => [{ realtimeInput: { audioStreamEnd: true } }],
  ask: text => [{ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }],
  tell: text => [{ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: false } }],
  read(m) {
    const c = m.serverContent;
    // Each Live usage report already includes the conversation so far, which is what the turn is billed for.
    const out = { ready: !!m.setupComplete, usage: m.usageMetadata || null };
    if (c) Object.assign(out, { audio: (c.modelTurn?.parts || []).map(p => p.inlineData?.data).filter(Boolean),
      heard: c.inputTranscription?.text, said: c.outputTranscription?.text, interrupted: !!c.interrupted, done: !!c.turnComplete });
    return out;
  },
};

// Alibaba Cloud Model Studio (百炼), https://help.aliyun.com/zh/model-studio/realtime (read 2026-09-25).
// A workspace address is the documented one; without a workspace id the older shared address is tried.
function qwenURL(cfg) {
  const model = encodeURIComponent(cfg.qwenRealtimeModel);
  if (cfg.dashscopeWorkspace) return `wss://${cfg.dashscopeWorkspace}.${cfg.dashscopeRegion}.maas.aliyuncs.com/api-ws/v1/realtime?model=${model}`;
  return `wss://${cfg.dashscopeRegion === 'cn-beijing' ? 'dashscope' : 'dashscope-intl'}.aliyuncs.com/api-ws/v1/realtime?model=${model}`;
}
const said = text => ({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
// Its usage is in OpenAI's shape; metering reads Gemini's.
const qwenUsage = u => u && { promptTokenCount: u.input_tokens, candidatesTokenCount: u.output_tokens,
  promptTokensDetails: [{ modality: 'AUDIO', tokenCount: u.input_token_details?.audio_tokens || 0 }],
  candidatesTokensDetails: [{ modality: 'AUDIO', tokenCount: u.output_token_details?.audio_tokens || 0 }] };

const qwen = {
  name: 'Qwen-Omni-Realtime',
  configured: cfg => Boolean(cfg.dashscopeKey),
  missing: 'DASHSCOPE_API_KEY',
  model: cfg => cfg.qwenRealtimeModel,
  open: (cfg, connect) => connect(qwenURL(cfg), { headers: { Authorization: `Bearer ${cfg.dashscopeKey}` } }),
  setup: (cfg, system) => [{ type: 'session.update', session: {
    modalities: ['text', 'audio'], instructions: system,
    // The service decides when he has finished speaking, and hears him when he talks over the tutor.
    turn_detection: { type: 'semantic_vad', threshold: 0.5, silence_duration_ms: 800 },
    input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
    audio: {
      input: { format: { type: 'pcm', sample_rate: 16000, sample_format: 's16le', channels: 1, packing: 'interleaved', channel_layout: 'mono' } },
      output: { voice: cfg.qwenVoice, format: { type: 'pcm', sample_rate: 24000 } },
    },
  } }],
  audio: data => [{ type: 'input_audio_buffer.append', audio: data }],
  // Turn detection is the service's, so the end of the microphone needs no message.
  audioEnd: () => [],
  ask: text => [said(text), { type: 'response.create' }],
  tell: text => [said(text)],
  read(m) {
    switch (m.type) {
      case 'session.updated': return { ready: true };
      case 'response.audio.delta': return { audio: [m.delta] };
      case 'response.audio_transcript.delta': return { said: m.delta };
      case 'conversation.item.input_audio_transcription.completed': return { heard: m.transcript };
      case 'input_audio_buffer.speech_started': return { interrupted: true };
      case 'response.done': return { done: true, usage: qwenUsage(m.response?.usage) };
      case 'error': return { error: String(m.error?.message || m.error?.code || '未知错误').slice(0, 200) };
      default: return {};
    }
  },
};

export const PROVIDERS = { gemini, qwen };
export const voiceProvider = cfg => PROVIDERS[cfg.voiceProvider] || gemini;
export const voiceConfigured = cfg => voiceProvider(cfg).configured(cfg);
