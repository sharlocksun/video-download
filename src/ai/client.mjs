function requireConfig(config) {
  if (!config?.apiKey) {
    throw new Error('还没有配置 API Key。请先打开“AI 设置”保存密钥。');
  }
  if (!config?.model) {
    throw new Error('还没有配置模型名称。请先在“AI 设置”里填写 model。');
  }
}

function withTimeout(ms = 45_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, timer };
}

function trimTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function openAiChatUrl(baseUrl = '') {
  const base = trimTrailingSlash(baseUrl || 'https://api.openai.com/v1');
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

function geminiUrl(config) {
  const base = trimTrailingSlash(config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
  if (/:(generateContent|streamGenerateContent)$/i.test(base)) {
    return `${base}?key=${encodeURIComponent(config.apiKey)}`;
  }
  return `${base}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
}

function anthropicUrl(baseUrl = '') {
  const base = trimTrailingSlash(baseUrl || 'https://api.anthropic.com/v1');
  if (/\/messages$/i.test(base)) return base;
  return `${base}/messages`;
}

function normalizeMessages(messages = []) {
  return (messages || [])
    .map((message) => ({
      role: ['system', 'assistant', 'user'].includes(message.role) ? message.role : 'user',
      content: String(message.content || '').trim(),
    }))
    .filter((message) => message.content);
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const message = json?.error?.message || json?.message || text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

async function chatOpenAiCompatible(config, messages) {
  const { controller, timer } = withTimeout();
  try {
    const response = await fetch(openAiChatUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: Number(config.temperature ?? 0.6),
        max_tokens: Number(config.maxTokens ?? 1800),
      }),
      signal: controller.signal,
    });
    const json = await parseJsonResponse(response);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw new Error('模型没有返回文本内容。');
    return String(content);
  } finally {
    clearTimeout(timer);
  }
}

function messagesToGeminiContents(messages) {
  const system = [];
  const contents = [];
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content);
      continue;
    }
    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    });
  }
  return {
    systemInstruction: system.length ? { parts: [{ text: system.join('\n\n') }] } : undefined,
    contents,
  };
}

async function chatGemini(config, messages) {
  const { controller, timer } = withTimeout();
  try {
    const payload = messagesToGeminiContents(messages);
    const response = await fetch(geminiUrl(config), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        generationConfig: {
          temperature: Number(config.temperature ?? 0.6),
          maxOutputTokens: Number(config.maxTokens ?? 1800),
        },
      }),
      signal: controller.signal,
    });
    const json = await parseJsonResponse(response);
    const content = json?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!content) throw new Error('Gemini 没有返回文本内容。');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function messagesToAnthropic(messages) {
  const system = [];
  const converted = [];
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content);
    } else {
      converted.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: 'text', text: message.content }],
      });
    }
  }
  return { system: system.join('\n\n'), messages: converted };
}

async function chatAnthropic(config, messages) {
  const { controller, timer } = withTimeout();
  try {
    const converted = messagesToAnthropic(messages);
    const response = await fetch(anthropicUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        system: converted.system || undefined,
        messages: converted.messages,
        temperature: Number(config.temperature ?? 0.6),
        max_tokens: Number(config.maxTokens ?? 1800),
      }),
      signal: controller.signal,
    });
    const json = await parseJsonResponse(response);
    const content = json?.content?.map((part) => part.text || '').join('').trim();
    if (!content) throw new Error('Anthropic 没有返回文本内容。');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function chatWithAi(config, messages = []) {
  requireConfig(config);
  const normalized = normalizeMessages(messages);
  if (!normalized.some((message) => message.role === 'user')) {
    throw new Error('没有可发送给模型的用户消息。');
  }
  if (config.provider === 'gemini') return chatGemini(config, normalized);
  if (config.provider === 'anthropic') return chatAnthropic(config, normalized);
  return chatOpenAiCompatible(config, normalized);
}

async function testAiConfig(config) {
  const content = await chatWithAi(config, [
    { role: 'system', content: '你只需要用中文简短回复连接测试结果。' },
    { role: 'user', content: '请回复“连接成功”。' },
  ]);
  return content;
}

export {
  chatWithAi,
  testAiConfig,
};
