// The settings dialog: which service does the text and the voice, and their keys. The page never receives a
// key back, only its last four characters; an empty box keeps the key already saved.
import { request } from './backend.js';

const $ = id => document.getElementById(id);
const KEYS = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY'];
const NAMES = { gemini: 'Gemini', deepseek: 'DeepSeek', qwen: '阿里云百炼', none: '不用语音' };

export function createSettings({ onSaved = () => {} } = {}) {
  const form = $('settings-form'), dialog = $('settings');
  let current = null;
  const picked = name => form.querySelector(`input[name="${name}"]:checked`)?.value;

  // Only the boxes the chosen services need are shown.
  function fit() {
    const text = picked('TEXT_PROVIDER'), voice = picked('VOICE_PROVIDER');
    // One Model Studio key serves both Qwen text and Qwen voice.
    const need = { gemini: text === 'gemini' || voice === 'gemini', deepseek: text === 'deepseek', qwen: voice === 'qwen' || text === 'qwen' };
    for (const field of form.querySelectorAll('[data-need]')) field.hidden = !need[field.dataset.need];
    $('dashscope-link').href = $('DASHSCOPE_REGION').value === 'ap-southeast-1'
      ? 'https://modelstudio.console.alibabacloud.com/' : 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key';
  }
  function fill(view) {
    current = view;
    form.querySelector(`input[name="TEXT_PROVIDER"][value="${view.text}"]`).checked = true;
    form.querySelector(`input[name="VOICE_PROVIDER"][value="${view.voice}"]`).checked = true;
    $('DASHSCOPE_REGION').value = view.region;
    $('DASHSCOPE_WORKSPACE_ID').value = view.workspace || '';
    for (const k of KEYS) { $(k).value = ''; $(k).placeholder = view.keys[k] ? `已设置（${view.keys[k]}），留空不改` : '粘贴 key'; }
    fit();
  }
  function report(result) {
    const out = $('settings-result');
    out.replaceChildren();
    const line = (label, r) => {
      const span = document.createElement('span');
      span.className = r.ok ? 'ok' : 'bad';
      span.textContent = `${label}：${r.ok ? `✓ 可用${r.message ? `（${r.message}）` : ''}` : `✗ ${r.message}`}`;
      out.append(span, '\n');
    };
    line(`文字（${NAMES[current.text]}）`, result.text);
    line(`语音（${NAMES[current.voice]}）`, result.voice);
  }
  const call = request;

  form.addEventListener('change', fit);
  $('settings-close').onclick = () => dialog.close();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const body = { TEXT_PROVIDER: picked('TEXT_PROVIDER'), VOICE_PROVIDER: picked('VOICE_PROVIDER'),
      DASHSCOPE_REGION: $('DASHSCOPE_REGION').value, DASHSCOPE_WORKSPACE_ID: $('DASHSCOPE_WORKSPACE_ID').value.trim() };
    for (const k of KEYS) if ($(k).value.trim()) body[k] = $(k).value.trim();
    $('settings-save').disabled = true;
    $('settings-result').textContent = '保存中…';
    try {
      fill(await call('/api/settings', body));
      $('settings-result').textContent = '已保存，正在测试…';
      report(await call('/api/settings/test', {}));
      onSaved();
    } catch (e) { $('settings-result').textContent = e.message; }
    finally { $('settings-save').disabled = false; }
  });

  return {
    async open() {
      $('settings-result').textContent = '';
      try { fill(await call('/api/settings')); } catch (e) { $('settings-result').textContent = e.message; }
      if (!dialog.open) dialog.showModal();
    },
  };
}
