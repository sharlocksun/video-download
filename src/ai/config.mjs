import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveComponentsDir, resolveDataDir } from '../core/app-paths.mjs';
import { protectSecret, unprotectSecret } from '../core/secret-protection.mjs';

const CONFIG_PATH = path.join(resolveDataDir(), 'ai-config.json');
const PROMPT_OVERRIDES_PATH = path.join(resolveDataDir(), 'ai-prompt-overrides.json');
const CUSTOM_ACTIONS_PATH = path.join(resolveDataDir(), 'ai-custom-actions.json');
const DEFAULT_WHISPER_PATH = path.join(resolveComponentsDir(), 'whisper');

const DEFAULT_AI_CONFIG = {
  provider: 'openai-compatible',
  baseUrl: '',
  apiKey: '',
  model: '',
  transcriptionMode: 'whisper',
  whisperPath: DEFAULT_WHISPER_PATH,
  whisperEngine: 'auto',
  whisperModel: 'small',
  whisperLanguage: 'auto',
  transcriptLanguage: 'zh-first',
  transcriptScript: 'simplified',
  aiTimeoutSeconds: 180,
  temperature: 0.6,
  maxTokens: 1800,
};

function normalizeAiConfig(input = {}, existing = DEFAULT_AI_CONFIG) {
  const provider = String(input.provider || existing.provider || 'openai-compatible').trim();
  const apiKeyInput = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const temperature = Number(input.temperature);
  const maxTokens = Number(input.maxTokens);
  const aiTimeoutSeconds = Number(input.aiTimeoutSeconds ?? existing.aiTimeoutSeconds ?? 180);

  return {
    provider: ['openai-compatible', 'gemini', 'anthropic'].includes(provider) ? provider : 'openai-compatible',
    baseUrl: String(input.baseUrl ?? existing.baseUrl ?? '').trim(),
    apiKey: apiKeyInput || String(existing.apiKey || ''),
    model: String(input.model ?? existing.model ?? '').trim(),
    transcriptionMode: 'whisper',
    whisperPath: String(input.whisperPath ?? existing.whisperPath ?? DEFAULT_WHISPER_PATH).trim() || DEFAULT_WHISPER_PATH,
    whisperEngine: ['auto', 'whisper-cpp', 'whisper-cpp-cpu', 'whisper-cpp-vulkan', 'python'].includes(String(input.whisperEngine || existing.whisperEngine || 'auto')) ? String(input.whisperEngine || existing.whisperEngine || 'auto') : 'auto',
    whisperModel: String(input.whisperModel ?? existing.whisperModel ?? 'small').trim() || 'small',
    whisperLanguage: ['auto', 'zh', 'en'].includes(String(input.whisperLanguage || existing.whisperLanguage || 'auto')) ? String(input.whisperLanguage || existing.whisperLanguage || 'auto') : 'auto',
    transcriptLanguage: ['zh-first', 'en-first', 'zh-only', 'en-only', 'all'].includes(String(input.transcriptLanguage || existing.transcriptLanguage || 'zh-first')) ? String(input.transcriptLanguage || existing.transcriptLanguage || 'zh-first') : 'zh-first',
    transcriptScript: ['simplified', 'bilingual', 'original'].includes(String(input.transcriptScript || existing.transcriptScript || 'simplified')) ? String(input.transcriptScript || existing.transcriptScript || 'simplified') : 'simplified',
    aiTimeoutSeconds: Number.isFinite(aiTimeoutSeconds) ? Math.max(30, Math.min(600, Math.round(aiTimeoutSeconds))) : 180,
    temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : Number(existing.temperature ?? 0.6),
    maxTokens: Number.isFinite(maxTokens) ? Math.max(256, Math.min(8000, Math.round(maxTokens))) : Number(existing.maxTokens ?? 1800),
  };
}

function publicAiConfig(config = DEFAULT_AI_CONFIG) {
  return {
    provider: config.provider || 'openai-compatible',
    baseUrl: config.baseUrl || '',
    model: config.model || '',
    transcriptionMode: 'whisper',
    whisperPath: config.whisperPath || DEFAULT_WHISPER_PATH,
    whisperEngine: config.whisperEngine || 'auto',
    whisperModel: config.whisperModel || 'small',
    whisperLanguage: config.whisperLanguage || 'auto',
    transcriptLanguage: config.transcriptLanguage || 'zh-first',
    transcriptScript: config.transcriptScript || 'simplified',
    aiTimeoutSeconds: Number(config.aiTimeoutSeconds ?? 180),
    temperature: Number(config.temperature ?? 0.6),
    maxTokens: Number(config.maxTokens ?? 1800),
    hasApiKey: Boolean(config.apiKey),
  };
}

async function loadAiConfig() {
  try {
    const text = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed.apiKeyProtected) parsed.apiKey = await unprotectSecret(parsed.apiKeyProtected).catch(() => '');
    return normalizeAiConfig(parsed, DEFAULT_AI_CONFIG);
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

async function saveAiConfig(input = {}) {
  const current = await loadAiConfig();
  const next = normalizeAiConfig(input, current);
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  const stored = { ...next, apiKeyProtected: await protectSecret(next.apiKey) };
  delete stored.apiKey;
  await writeFile(CONFIG_PATH, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  return next;
}

function promptOverrideKey(platform = 'general', action = '') {
  return `${String(platform || 'general').trim()}:${String(action || '').trim()}`;
}

async function loadAiPromptOverrides() {
  try {
    const text = await readFile(PROMPT_OVERRIDES_PATH, 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function saveAiPromptOverride(platform = 'general', action = '', prompt = '') {
  const key = promptOverrideKey(platform, action);
  if (!String(action || '').trim()) throw new Error('缺少创作模板编号。');
  const next = await loadAiPromptOverrides();
  const cleanPrompt = String(prompt || '').trim();
  if (cleanPrompt) {
    next[key] = cleanPrompt;
  } else {
    delete next[key];
  }
  await mkdir(path.dirname(PROMPT_OVERRIDES_PATH), { recursive: true });
  await writeFile(PROMPT_OVERRIDES_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

function applyPromptOverride(action, overrides = {}) {
  if (!action) return null;
  const key = promptOverrideKey(action.platform, action.id);
  const customPrompt = String(overrides[key] || '').trim();
  return customPrompt ? { ...action, prompt: customPrompt, defaultPrompt: action.prompt, customized: true } : {
    ...action,
    defaultPrompt: action.prompt,
    customized: false,
  };
}

function normalizeCustomAction(input = {}, platform = 'general') {
  const id = String(input.id || '').trim() || `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const label = String(input.label || '').trim().slice(0, 24);
  const prompt = String(input.prompt || '').trim();
  if (!label) throw new Error('请填写按钮标签。');
  if (!prompt) throw new Error('请填写模板提示词。');
  return {
    id: id.startsWith('custom_') ? id : `custom_${id}`,
    label,
    prompt,
    platform: String(platform || 'general').trim() || 'general',
    group: 'custom',
    custom: true,
    customized: true,
    defaultPrompt: prompt,
  };
}

async function loadAiCustomActions() {
  try {
    const text = await readFile(CUSTOM_ACTIONS_PATH, 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function saveAiCustomAction(platform = 'general', input = {}) {
  const cleanPlatform = String(platform || 'general').trim() || 'general';
  const action = normalizeCustomAction(input, cleanPlatform);
  const all = await loadAiCustomActions();
  const list = Array.isArray(all[cleanPlatform]) ? all[cleanPlatform] : [];
  const index = list.findIndex((item) => String(item.id) === action.id);
  if (index >= 0) {
    list[index] = action;
  } else {
    list.push(action);
  }
  all[cleanPlatform] = list;
  await mkdir(path.dirname(CUSTOM_ACTIONS_PATH), { recursive: true });
  await writeFile(CUSTOM_ACTIONS_PATH, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  return action;
}

async function deleteAiCustomAction(platform = 'general', actionId = '') {
  const cleanPlatform = String(platform || 'general').trim() || 'general';
  const all = await loadAiCustomActions();
  const list = Array.isArray(all[cleanPlatform]) ? all[cleanPlatform] : [];
  all[cleanPlatform] = list.filter((item) => String(item.id) !== String(actionId));
  await mkdir(path.dirname(CUSTOM_ACTIONS_PATH), { recursive: true });
  await writeFile(CUSTOM_ACTIONS_PATH, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  return all[cleanPlatform];
}

export {
  CONFIG_PATH,
  CUSTOM_ACTIONS_PATH,
  DEFAULT_AI_CONFIG,
  PROMPT_OVERRIDES_PATH,
  applyPromptOverride,
  deleteAiCustomAction,
  loadAiConfig,
  loadAiCustomActions,
  loadAiPromptOverrides,
  normalizeAiConfig,
  publicAiConfig,
  saveAiConfig,
  saveAiCustomAction,
  saveAiPromptOverride,
};
