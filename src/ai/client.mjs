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

function requestTimeoutMs(config, fallbackSeconds = 180) {
  const seconds = Number(config?.aiTimeoutSeconds ?? fallbackSeconds);
  const safeSeconds = Number.isFinite(seconds) ? Math.max(30, Math.min(600, Math.round(seconds))) : fallbackSeconds;
  return safeSeconds * 1000;
}

function normalizeAbortError(error, timeoutMs) {
  if (error?.name !== 'AbortError') throw error;
  throw new Error(`AI 请求超时，已等待 ${Math.round(timeoutMs / 1000)} 秒。可以在“AI 设置”里调大生成超时，或减少字幕内容/最大输出。`);
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
  const timeoutMs = requestTimeoutMs(config);
  const { controller, timer } = withTimeout(timeoutMs);
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
  } catch (error) {
    normalizeAbortError(error, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

function parseOpenAiStreamLine(line = '') {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('data:')) return { done: false, text: '' };
  const data = trimmed.slice(5).trim();
  if (!data || data === '[DONE]') return { done: data === '[DONE]', text: '' };
  try {
    const json = JSON.parse(data);
    return {
      done: false,
      text: json?.choices?.[0]?.delta?.content || json?.choices?.[0]?.message?.content || '',
    };
  } catch {
    return { done: false, text: '' };
  }
}

async function streamOpenAiCompatible(config, messages, onDelta) {
  const timeoutMs = requestTimeoutMs(config);
  const { controller, timer } = withTimeout(timeoutMs);
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
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) await parseJsonResponse(response);
    if (!response.body) throw new Error('模型接口没有返回可读取的流。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const parsed = parseOpenAiStreamLine(line);
        if (parsed.done) return content;
        if (!parsed.text) continue;
        content += parsed.text;
        await onDelta?.(parsed.text, content);
      }
    }
    if (!content) throw new Error('模型没有返回文本内容。');
    return content;
  } catch (error) {
    normalizeAbortError(error, timeoutMs);
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
  const timeoutMs = requestTimeoutMs(config);
  const { controller, timer } = withTimeout(timeoutMs);
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
  } catch (error) {
    normalizeAbortError(error, timeoutMs);
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
  const timeoutMs = requestTimeoutMs(config);
  const { controller, timer } = withTimeout(timeoutMs);
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
  } catch (error) {
    normalizeAbortError(error, timeoutMs);
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

async function streamChatWithAi(config, messages = [], onDelta) {
  requireConfig(config);
  const normalized = normalizeMessages(messages);
  if (!normalized.some((message) => message.role === 'user')) {
    throw new Error('没有可发送给模型的用户消息。');
  }
  if (config.provider !== 'openai-compatible') {
    const content = await chatWithAi(config, normalized);
    await onDelta?.(content, content);
    return content;
  }
  return streamOpenAiCompatible(config, normalized, onDelta);
}

async function testAiConfig(config) {
  const content = await chatWithAi({ ...config, aiTimeoutSeconds: 45 }, [
    { role: 'system', content: '你只需要用中文简短回复连接测试结果。' },
    { role: 'user', content: '请回复“连接成功”。' },
  ]);
  return content;
}

export {
  chatWithAi,
  streamChatWithAi,
  testAiConfig,
};
