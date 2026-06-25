import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveBaseDir } from '../core/filename.mjs';

const CONFIG_PATH = path.join(resolveBaseDir(), 'user-data', 'ai-config.json');

const DEFAULT_AI_CONFIG = {
  provider: 'openai-compatible',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.6,
  maxTokens: 1800,
};

function normalizeAiConfig(input = {}, existing = DEFAULT_AI_CONFIG) {
  const provider = String(input.provider || existing.provider || 'openai-compatible').trim();
  const apiKeyInput = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const temperature = Number(input.temperature);
  const maxTokens = Number(input.maxTokens);

  return {
    provider: ['openai-compatible', 'gemini', 'anthropic'].includes(provider) ? provider : 'openai-compatible',
    baseUrl: String(input.baseUrl ?? existing.baseUrl ?? '').trim(),
    apiKey: apiKeyInput || String(existing.apiKey || ''),
    model: String(input.model ?? existing.model ?? '').trim(),
    temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : Number(existing.temperature ?? 0.6),
    maxTokens: Number.isFinite(maxTokens) ? Math.max(256, Math.min(8000, Math.round(maxTokens))) : Number(existing.maxTokens ?? 1800),
  };
}

function publicAiConfig(config = DEFAULT_AI_CONFIG) {
  return {
    provider: config.provider || 'openai-compatible',
    baseUrl: config.baseUrl || '',
    model: config.model || '',
    temperature: Number(config.temperature ?? 0.6),
    maxTokens: Number(config.maxTokens ?? 1800),
    hasApiKey: Boolean(config.apiKey),
  };
}

async function loadAiConfig() {
  try {
    const text = await readFile(CONFIG_PATH, 'utf8');
    return normalizeAiConfig(JSON.parse(text), DEFAULT_AI_CONFIG);
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

async function saveAiConfig(input = {}) {
  const current = await loadAiConfig();
  const next = normalizeAiConfig(input, current);
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export {
  CONFIG_PATH,
  DEFAULT_AI_CONFIG,
  loadAiConfig,
  normalizeAiConfig,
  publicAiConfig,
  saveAiConfig,
};
