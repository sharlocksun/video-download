import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { uiHtml } from './ui-html.mjs';
import { downloadVideo } from '../core/platform-runner.mjs';
import { normalizeNameTemplateForBatch, resolveBaseDir, resolveOutDir } from '../core/filename.mjs';
import { ensureDefaultVideoDir, resolveDataDir, resolveDefaultVideoDir } from '../core/app-paths.mjs';
import { componentStatus, ensureBundledWhisperCpu, installComponent, listComponentStatus, removeComponent } from '../core/component-manager.mjs';
import { diagnoseEnvironment } from '../core/environment.mjs';
import { findBundledTool } from '../core/runtime-tools.mjs';
import { checkForUpdates } from '../core/updater.mjs';
import { cdp, cookiesToHeader, getAllCookies, getCookiesForUrls, startCdpBrowser, waitForPage } from '../core/cdp-browser.mjs';
import { makeTempDir, removeTempDir } from '../core/temp-dir.mjs';
import { findBrowser } from '../platforms/index.mjs';
import { findFfmpeg, getVideoInfo as getBilibiliVideoInfo } from '../platforms/bilibili/index.mjs';
import { closeDouyinSession, createDouyinSession } from '../platforms/douyin/index.mjs';
import { closeKuaishouSession, createKuaishouSession } from '../platforms/kuaishou/index.mjs';
import { findYtDlp } from '../platforms/youtube/index.mjs';
import { chatWithAi, streamChatWithAi, testAiConfig } from '../ai/client.mjs';
import { applyPromptOverride, deleteAiCustomAction, loadAiConfig, loadAiCustomActions, loadAiPromptOverrides, publicAiConfig, saveAiConfig, saveAiCustomAction, saveAiPromptOverride } from '../ai/config.mjs';
import { analyzeTranscriptLocal } from '../ai/local-analysis.mjs';
import { analysisDirForSource, assetDirForMedia, extractAudioFile, extractEmbeddedSubtitle, saveAiArtifacts, saveTranscriptArtifacts, sanitizeFilePart } from '../ai/media-tools.mjs';
import { transcribeLocalMedia } from '../ai/media-transcription.mjs';
import { buildSystemPrompt, buildTranscriptContext, platformActions, quickAction } from '../ai/prompts.mjs';
import { extractSubtitlesFromUrl } from '../ai/subtitles.mjs';
import { normalizeTranscriptText } from '../ai/transcript-normalize.mjs';

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function buildAiChatMessages(body, platform, actionPrompt) {
  const transcript = String(body.transcript || '');
  const sourceUrl = String(body.sourceUrl || '');
  const history = Array.isArray(body.messages) ? body.messages : [];
  const messages = [
    { role: 'system', content: buildSystemPrompt(platform) },
    { role: 'user', content: buildTranscriptContext(transcript, sourceUrl) },
    ...history.map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content || ''),
    })),
  ];
  if (actionPrompt) messages.push({ role: 'user', content: actionPrompt });
  return messages;
}

function transcriptPrefsFromBody(body = {}, config = {}) {
  const transcriptLanguage = ['zh-first', 'en-first', 'zh-only', 'en-only', 'all'].includes(String(body.transcriptLanguage || ''))
    ? String(body.transcriptLanguage)
    : String(config.transcriptLanguage || 'zh-first');
  const transcriptScript = ['simplified', 'bilingual', 'original'].includes(String(body.transcriptScript || ''))
    ? String(body.transcriptScript)
    : String(config.transcriptScript || 'simplified');
  return { transcriptLanguage, transcriptScript };
}

function normalizeTranscriptForResponse(text = '', prefs = {}) {
  return normalizeTranscriptText(text, prefs);
}

function looksEnglishSubtitle(subtitles = {}, text = '') {
  const file = String(subtitles.file || '').toLowerCase();
  if (/(^|[._-])en([._-]|$)/i.test(file)) return true;
  if (/(^|[._-])zh|hans|hant|cn/i.test(file)) return false;
  const sample = String(text || '').slice(0, 4000);
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  const cjk = (sample.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (sample.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
  if (cjk === 0) return latin >= 12 || words >= 3;
  return words >= 3 && latin > cjk * 2;
}

function looksEnglishLine(line = '') {
  const sample = String(line || '');
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  const cjk = (sample.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (sample.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
  if (cjk === 0) return latin >= 2 || words >= 1;
  return words >= 1 && latin > cjk * 2;
}

function transcriptOutputMode(prefs = {}) {
  return String(prefs.transcriptScript || 'simplified');
}

function wantsChineseTranscript(prefs = {}) {
  return transcriptOutputMode(prefs) === 'simplified';
}

function wantsBilingualTranscript(prefs = {}) {
  return transcriptOutputMode(prefs) === 'bilingual';
}

function chunkTranscriptForAi(text = '', maxLength = 5000) {
  const paragraphs = String(text || '').split(/\n{2,}|\r?\n/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if ((current + '\n' + paragraph).trim().length > maxLength && current) {
      chunks.push(current.trim());
      current = '';
    }
    if (paragraph.length > maxLength) {
      if (current) chunks.push(current.trim());
      current = '';
      for (let i = 0; i < paragraph.length; i += maxLength) chunks.push(paragraph.slice(i, i + maxLength));
      continue;
    }
    current = current ? `${current}\n${paragraph}` : paragraph;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [String(text || '').trim()].filter(Boolean);
}

function splitSentenceFragments(line = '') {
  const clean = String(line || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  return clean.match(/[^.!?。！？…]+[.!?。！？…]+["'”’）】]*|[^.!?。！？…]+$/g)
    ?.map((item) => item.trim())
    .filter(Boolean) || [clean];
}

function transcriptSentenceUnits(text = '') {
  const units = [];
  let current = '';
  const flush = () => {
    const clean = current.replace(/\s+/g, ' ').trim();
    if (clean) units.push(clean);
    current = '';
  };
  for (const rawLine of transcriptLineItems(text)) {
    if (/^【?(中文|English|英文|Chinese)】?$/i.test(rawLine)) continue;
    for (const fragment of splitSentenceFragments(rawLine)) {
      current = current ? `${current} ${fragment}` : fragment;
      if (/[.!?。！？…]["'”’）】]*$/.test(fragment) || current.length >= 140) flush();
    }
  }
  flush();
  return units;
}

function chunkNumberedUnits(units = [], maxLength = 4200, maxItems = 80) {
  const chunks = [];
  let current = [];
  let length = 0;
  for (let i = 0; i < units.length; i += 1) {
    const line = `${i + 1}. ${units[i]}`;
    if (current.length && (length + line.length > maxLength || current.length >= maxItems)) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push({ index: i, line });
    length += line.length + 1;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function parseNumberedTranslations(answer = '', expected = []) {
  const parsed = new Map();
  for (const rawLine of String(answer || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^(\d+)[.)、:：\-\s]+(.+)$/);
    if (!match) continue;
    parsed.set(Number(match[1]) - 1, match[2].trim());
  }
  if (parsed.size) {
    return expected.map((item) => parsed.get(item.index) || '');
  }
  return String(answer || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, expected.length);
}

async function translateTranscriptUnits(text = '', config = {}, options = {}) {
  const target = options.target === 'english' ? 'english' : 'chinese';
  const sourceLabel = String(options.sourceLabel || '视频文字');
  const sourceUnits = transcriptSentenceUnits(text);
  if (!sourceUnits.length) {
    return { sourceUnits: [], translatedUnits: [], translated: false, reason: '' };
  }
  if (!config?.apiKey || !config?.model) {
    return {
      sourceUnits,
      translatedUnits: sourceUnits,
      translated: false,
      reason: `${sourceLabel}需要翻译，但未配置 AI API，暂时保留原文。需要自动逐句翻译时请先在“AI 设置”里配置 API。`,
    };
  }
  const chunks = chunkNumberedUnits(sourceUnits);
  const translatedUnits = new Array(sourceUnits.length).fill('');
  let missingCount = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    options.onProgress?.({
      percent: Math.min(92, 45 + Math.round((i / Math.max(1, chunks.length)) * 45)),
      stage: 'translate',
      message: `${sourceLabel}正在逐句翻译成${target === 'english' ? '英文' : '中文'}（${i + 1}/${chunks.length}）...`,
    });
    const answer = await chatWithAi({ ...config, temperature: 0.1, maxTokens: Math.max(Number(config.maxTokens || 0), 4000) }, [
      {
        role: 'system',
        content: target === 'english'
          ? [
              '你是字幕逐句翻译助手。请把中文逐句翻译成自然、准确的英文。',
              '必须保留输入编号，输出与输入相同数量的行，每行格式为“编号. 译文”。',
              '不要合并句子，不要拆分句子，不要添加解释，不要输出原文。',
            ].join('\n')
          : [
              '你是字幕逐句翻译助手。请把英文逐句翻译成自然、准确的简体中文。',
              '必须保留输入编号，输出与输入相同数量的行，每行格式为“编号. 译文”。',
              '不要合并句子，不要拆分句子，不要添加解释，不要输出原文。',
            ].join('\n'),
      },
      { role: 'user', content: chunks[i].map((item) => item.line).join('\n') },
    ]);
    const parsed = parseNumberedTranslations(answer, chunks[i]);
    for (let j = 0; j < chunks[i].length; j += 1) {
      if (!parsed[j]) missingCount += 1;
      translatedUnits[chunks[i][j].index] = parsed[j] || sourceUnits[chunks[i][j].index];
    }
  }
  return {
    sourceUnits,
    translatedUnits,
    translated: true,
    reason: missingCount ? `有 ${missingCount} 句未被模型按编号返回，已临时保留原句。建议重新生成或使用更稳定的模型。` : '',
  };
}

async function translateTranscriptText(text = '', config = {}, options = {}) {
  const target = options.target === 'english' ? 'english' : 'chinese';
  const sourceLabel = String(options.sourceLabel || '视频文字');
  if (!config?.apiKey || !config?.model) {
    return {
      text,
      translated: false,
      reason: `${sourceLabel}需要翻译，但未配置 AI API，暂时保留原文。需要自动翻译时请先在“AI 设置”里配置 API。`,
    };
  }
  const chunks = chunkTranscriptForAi(text);
  const translated = [];
  for (let i = 0; i < chunks.length; i += 1) {
    options.onProgress?.({
      percent: Math.min(92, 45 + Math.round((i / Math.max(1, chunks.length)) * 45)),
      stage: 'translate',
      message: `${sourceLabel}正在用 AI 翻译成${target === 'english' ? '英文' : '中文'}（${i + 1}/${chunks.length}）...`,
    });
    const answer = await chatWithAi({ ...config, temperature: 0.1, maxTokens: Math.max(Number(config.maxTokens || 0), 3000) }, [
      {
        role: 'system',
        content: target === 'english'
          ? [
              '你是字幕翻译助手。请把中文视频文字翻译成自然、准确的英文。',
              '保留原意，不要扩写，不要总结，不要添加新信息。',
              '请逐行翻译，尽量保持与原文相同的行数和顺序，便于生成双语字幕。',
              '只输出译文正文，不要解释过程。',
            ].join('\n')
          : [
              '你是字幕翻译助手。请把英文视频文字翻译成自然、准确的简体中文。',
              '保留原意，不要扩写，不要总结，不要添加新信息。',
              '请逐行翻译，尽量保持与原文相同的行数和顺序，便于生成双语字幕。',
              '只输出译文正文，不要解释过程。',
            ].join('\n'),
      },
      { role: 'user', content: chunks[i] },
    ]);
    translated.push(answer.trim());
  }
  return {
    text: translated.join('\n').trim(),
    translated: true,
    reason: '',
  };
}

function transcriptLineItems(text = '') {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function bilingualText(chinese = '', english = '') {
  return bilingualUnits(transcriptLineItems(chinese), transcriptLineItems(english));
}

function bilingualUnits(chineseUnits = [], englishUnits = []) {
  const zhLines = chineseUnits.map((line) => String(line || '').trim()).filter(Boolean);
  const enLines = englishUnits.map((line) => String(line || '').trim()).filter(Boolean);
  const count = Math.max(zhLines.length, enLines.length);
  const lines = [];
  for (let i = 0; i < count; i += 1) {
    if (zhLines[i]) lines.push(zhLines[i]);
    if (enLines[i]) lines.push(enLines[i]);
    if (i < count - 1) lines.push('');
  }
  return lines.join('\n').trim();
}

function bilingualVariants(chineseUnits = [], englishUnits = []) {
  const zhLines = chineseUnits.map((line) => String(line || '').trim()).filter(Boolean);
  const enLines = englishUnits.map((line) => String(line || '').trim()).filter(Boolean);
  const count = Math.max(zhLines.length, enLines.length);
  const pairs = [];
  for (let i = 0; i < count; i += 1) {
    pairs.push({
      index: i + 1,
      zh: zhLines[i] || '',
      en: enLines[i] || '',
    });
  }
  return {
    chinese: zhLines.join('\n').trim(),
    english: enLines.join('\n').trim(),
    mixed: bilingualUnits(zhLines, enLines),
    sourceText: '',
    sourceLanguage: '',
    pairs,
  };
}

function normalizeBilingualVariants(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const sourceLanguage = ['english', 'chinese'].includes(String(input.sourceLanguage || ''))
    ? String(input.sourceLanguage)
    : '';
  return {
    chinese: String(input.chinese || '').trim(),
    english: String(input.english || '').trim(),
    mixed: String(input.mixed || '').trim(),
    original: String(input.original || '').trim(),
    sourceText: String(input.sourceText || '').trim(),
    sourceLanguage,
    pairs: Array.isArray(input.pairs) ? input.pairs : [],
  };
}

function compactRepeatedTranscriptLines(text = '') {
  const result = [];
  let previous = '';
  for (const line of transcriptLineItems(text)) {
    const key = line.replace(/\s+/g, ' ').trim().toLowerCase();
    if (key && key === previous) continue;
    result.push(line);
    previous = key;
  }
  return result.join('\n').trim();
}

function sourceVariantFromText(text = '', sourceMeta = {}) {
  const normalized = String(text || '').trim();
  const english = looksEnglishSubtitle(sourceMeta, normalized);
  return {
    original: normalized,
    sourceText: normalized,
    sourceLanguage: english ? 'english' : 'chinese',
  };
}

async function loadStoredSourceVariant(filePath = '', sourceUrl = '') {
  const roots = [];
  const localPath = String(filePath || '').trim();
  const url = String(sourceUrl || '').trim();
  if (localPath) roots.push(assetDirForMedia(path.resolve(localPath)));
  if (url) roots.push(analysisDirForSource(url));

  const relativeCandidates = [
    path.join('subtitles', '01_platform_original', 'platform_original.txt'),
    path.join('subtitles', '02_embedded_original', 'embedded_original.txt'),
    path.join('subtitles', '03_whisper_original', 'whisper_original.txt'),
  ];
  const candidates = [];
  for (const root of [...new Set(roots)]) {
    for (const relativePath of relativeCandidates) {
      const candidatePath = path.join(root, relativePath);
      try {
        const info = await stat(candidatePath);
        if (info.isFile()) candidates.push({ filePath: candidatePath, mtimeMs: info.mtimeMs });
      } catch {}
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!candidates.length) return {};
  const selected = candidates[0];
  const sourceText = compactRepeatedTranscriptLines(await readFile(selected.filePath, 'utf8'));
  if (!sourceText) return {};
  return {
    ...sourceVariantFromText(sourceText, { file: selected.filePath }),
    sourcePath: selected.filePath,
  };
}
function splitBilingualTranscript(text = '') {
  const raw = String(text || '').trim();
  const blockMatch = raw.match(/【中文】([\s\S]*?)【English】([\s\S]*)/i);
  if (blockMatch) {
    return {
      chinese: blockMatch[1].trim(),
      english: blockMatch[2].trim(),
      mixed: bilingualText(blockMatch[1], blockMatch[2]),
    };
  }
  const zh = [];
  const en = [];
  for (const line of transcriptLineItems(raw)) {
    if (/^【?(中文|English)】?$/i.test(line)) continue;
    if (looksEnglishLine(line)) en.push(line);
    else zh.push(line);
  }
  return {
    chinese: zh.join('\n').trim(),
    english: en.join('\n').trim(),
    mixed: raw,
  };
}

async function prepareTranscriptText(text = '', config = {}, prefs = {}, options = {}) {
  const sourceLabel = String(options.sourceLabel || '视频文字');
  const sourceMeta = options.sourceMeta || {};
  const normalized = normalizeTranscriptForResponse(text, prefs);
  const english = looksEnglishSubtitle(sourceMeta, normalized);
  if (wantsBilingualTranscript(prefs)) {
    const result = await translateTranscriptUnits(normalized, config, {
      ...options,
      target: english ? 'chinese' : 'english',
      sourceLabel,
    });
    if (!result.translated) {
      return {
        text: normalized,
        translated: false,
        note: result.reason,
        variants: sourceVariantFromText(normalized, sourceMeta),
      };
    }
    const sourceUnits = result.sourceUnits || transcriptSentenceUnits(normalized);
    const translatedUnits = result.translatedUnits || [];
    const variants = english
      ? bilingualVariants(translatedUnits, sourceUnits)
      : bilingualVariants(sourceUnits, translatedUnits);
    variants.sourceLanguage = english ? 'english' : 'chinese';
    variants.sourceText = normalized;
    return {
      text: variants.mixed,
      translated: true,
      note: result.reason,
      variants,
    };
  }
  if (wantsChineseTranscript(prefs) && english) {
    const result = await translateTranscriptText(normalized, config, {
      ...options,
      target: 'chinese',
      sourceLabel,
    });
    return {
      text: normalizeTranscriptForResponse(result.text, prefs),
      translated: result.translated,
      note: result.reason,
      variants: result.translated
        ? { chinese: normalizeTranscriptForResponse(result.text, prefs), sourceLanguage: 'english', sourceText: normalized }
        : { original: normalized, sourceLanguage: 'english', sourceText: normalized },
    };
  }
  return {
    text: normalized,
    translated: false,
    note: '',
    variants: sourceVariantFromText(normalized, sourceMeta),
  };
}

async function correctTranscriptWithAi(text = '', config = {}) {
  return chatWithAi(config, [
    {
      role: 'system',
      content: [
        '你是字幕校对助手。请只修正错别字、断句、标点、明显听写错误和专有名词。',
        '先识别原文语言，并保持原文语言进行校对；不要在这一步翻译。',
        '不要扩写，不要删减原意，不要添加字幕里没有的新事实。',
        '如果输入中有重复句，请只保留一份自然的修正版。',
        '输出纯净修正版文稿，不要解释过程。',
      ].join('\n'),
    },
    { role: 'user', content: text },
  ]);
}

async function fixTranscriptForOutput(transcript = '', config = {}, prefs = {}, variants = {}, options = {}) {
  if (variants.sourceText) {
    const sourceLanguage = variants.sourceLanguage
      || (looksEnglishSubtitle({}, variants.sourceText) ? 'english' : 'chinese');
    const fixedSource = await correctTranscriptWithAi(compactRepeatedTranscriptLines(variants.sourceText), config);
    return prepareTranscriptText(fixedSource, config, prefs, {
      ...options,
      sourceLabel: 'AI 修正字幕',
      sourceMeta: { file: sourceLanguage === 'english' ? 'source.en.txt' : 'source.zh.txt' },
    });
  }
  if (wantsBilingualTranscript(prefs)) {
    const candidate = (variants.mixed && (variants.chinese || variants.english))
      ? variants
      : splitBilingualTranscript(transcript);
    if (candidate.chinese && candidate.english) {
      const sourceLanguage = candidate.sourceLanguage
        || (candidate.sourceText && looksEnglishSubtitle({}, candidate.sourceText) ? 'english' : '')
        || (candidate.english ? 'english' : 'chinese');
      const sourceText = compactRepeatedTranscriptLines(
        candidate.sourceText || (sourceLanguage === 'english' ? candidate.english : candidate.chinese),
      );
      const fixedSource = await correctTranscriptWithAi(sourceText, config);
      return prepareTranscriptText(fixedSource, config, prefs, {
        ...options,
        sourceLabel: 'AI 修正字幕',
        sourceMeta: { file: sourceLanguage === 'english' ? 'source.en.txt' : 'source.zh.txt' },
      });
    }
  }
  const fixed = await correctTranscriptWithAi(transcript, config);
  return prepareTranscriptText(fixed, config, prefs, {
    ...options,
    sourceLabel: 'AI 修正字幕',
  });
}

async function preparePlatformSubtitleText(subtitles = {}, config = {}, prefs = {}, options = {}) {
  return prepareTranscriptText(subtitles.text, config, prefs, {
    ...options,
    sourceLabel: '平台字幕',
    sourceMeta: subtitles,
  });
}

async function saveFinalTranscriptArtifacts(inputFile, prepared = {}, options = {}) {
  const formats = Array.isArray(options.formats) && options.formats.length
    ? options.formats.map((item) => String(item))
    : ['txt', 'srt', 'vtt'];
  const common = {
    sourceUrl: String(options.sourceUrl || ''),
    outDir: String(options.outDir || ''),
    group: '05_final',
    formats,
    timeline: options.timeline !== false,
  };
  const variants = prepared.variants || {};
  if (wantsBilingualTranscript(options.prefs || {}) && variants.mixed && (variants.chinese || variants.english)) {
    const files = [];
    let lastSaved = null;
    if (variants.chinese) {
      lastSaved = await saveTranscriptArtifacts(inputFile, variants.chinese, {
        ...common,
        baseName: 'final_transcript_zh',
      });
      files.push(...lastSaved.files);
    }
    if (variants.english) {
      lastSaved = await saveTranscriptArtifacts(inputFile, variants.english, {
        ...common,
        baseName: 'final_transcript_en',
      });
      files.push(...lastSaved.files);
    }
    const bilingualSubtitleChunks = Array.isArray(variants.pairs)
      ? variants.pairs
          .map((pair) => [String(pair?.zh || '').trim(), String(pair?.en || '').trim()].filter(Boolean).join('\n'))
          .filter(Boolean)
      : [];
    lastSaved = await saveTranscriptArtifacts(inputFile, variants.mixed, {
      ...common,
      baseName: 'final_transcript_bilingual',
      subtitleChunks: bilingualSubtitleChunks,
    });
    files.push(...lastSaved.files);
    return {
      ...lastSaved,
      files: [...new Set(files)],
      cleaned: variants.mixed,
      variants,
      bilingual: true,
    };
  }

  const text = String(prepared.text || variants.chinese || variants.english || variants.original || '').trim();
  const saved = await saveTranscriptArtifacts(inputFile, text, {
    ...common,
    baseName: 'final_transcript',
  });
  return {
    ...saved,
    variants,
  };
}

function mergeSavedArtifacts(primary = {}, ...related) {
  const files = [];
  for (const item of related) {
    if (Array.isArray(item?.files)) files.push(...item.files);
  }
  if (Array.isArray(primary.files)) files.push(...primary.files);
  return {
    ...primary,
    files: [...new Set(files)],
    related: related.filter(Boolean),
  };
}

async function resolveAiAction(platform, actionId) {
  const cleanPlatform = String(platform || 'general');
  const cleanActionId = String(actionId || '');
  if (!cleanActionId) return null;
  const overrides = await loadAiPromptOverrides();
  const builtIn = applyPromptOverride(quickAction(cleanActionId, cleanPlatform), overrides);
  if (builtIn) return builtIn;
  const customActions = await loadAiCustomActions();
  const list = Array.isArray(customActions[cleanPlatform]) ? customActions[cleanPlatform] : [];
  return list.find((item) => String(item.id) === cleanActionId) || null;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isYoutubeCookie(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
  return domain === 'youtube.com'
    || domain.endsWith('.youtube.com')
    || domain === 'google.com'
    || domain.endsWith('.google.com')
    || domain === 'youtu.be'
    || domain.endsWith('.youtu.be')
    || domain === 'youtube-nocookie.com'
    || domain.endsWith('.youtube-nocookie.com');
}

function isInstagramCookie(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
  return domain === 'instagram.com'
    || domain.endsWith('.instagram.com');
}

function cookieFilterForPlatform(platform = 'youtube') {
  return String(platform || '').toLowerCase() === 'instagram' ? isInstagramCookie : isYoutubeCookie;
}

function platformCookieLoginLikely(cookies, platform = 'youtube') {
  const filter = cookieFilterForPlatform(platform);
  return (cookies || []).some((cookie) => {
    if (!filter(cookie)) return false;
    if (String(platform || '').toLowerCase() === 'instagram') {
      return /^(sessionid|ds_user_id|csrftoken)$/i.test(cookie.name || '');
    }
    return /^(LOGIN_INFO|SID|HSID|SSID|APISID|SAPISID|__Secure-\d?PSID|__Secure-\d?PAPISID)$/i.test(cookie.name || '');
  });
}

function youtubeCookieLoginLikely(cookies) {
  return platformCookieLoginLikely(cookies, 'youtube');
}

function cookiesToNetscape(cookies, platform = 'youtube') {
  const filter = cookieFilterForPlatform(platform);
  const rows = [
    '# Netscape HTTP Cookie File',
    '# Generated by 木辛说视频下载器. Keep this file private.',
  ];

  for (const cookie of cookies || []) {
    if (!filter(cookie) || !cookie.name) continue;
    const rawDomain = String(cookie.domain || '').trim();
    if (!rawDomain) continue;
    const includeSubdomains = rawDomain.startsWith('.') ? 'TRUE' : 'FALSE';
    const domain = cookie.httpOnly ? `#HttpOnly_${rawDomain}` : rawDomain;
    const pathValue = cookie.path || '/';
    const secure = cookie.secure ? 'TRUE' : 'FALSE';
    const expires = Number.isFinite(Number(cookie.expires)) && Number(cookie.expires) > 0
      ? String(Math.floor(Number(cookie.expires)))
      : '0';
    rows.push([
      domain,
      includeSubdomains,
      pathValue,
      secure,
      expires,
      String(cookie.name),
      String(cookie.value || ''),
    ].join('\t'));
  }

  return `${rows.join('\n')}\n`;
}

function hasBilibiliLoginCookie(cookieHeader) {
  return /(?:^|;\s*)(SESSDATA|DedeUserID|bili_jct)=/.test(cookieHeader || '');
}

function qualityValueFromLabel(label) {
  const text = String(label || '').trim();
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  if (!normalized) return '';
  if (/4k|2160/.test(normalized)) return '4k';
  if (/2k|1440/.test(normalized)) return '2k';
  if (/1080p?60|60帧/.test(normalized)) return '1080p60';
  if (/1080p?\+|高码率/.test(normalized)) return '1080p+';
  const matched = normalized.match(/(\d{3,4})p?/);
  if (matched) return matched[1];
  return '';
}

function parseQualityOptions(logs) {
  const line = logs.find((item) => /Available qualities:/i.test(item));
  const text = line ? line.replace(/^.*Available qualities:\s*/i, '').trim() : '';
  const options = [{ value: 'best', label: '自动选择最佳' }];
  const seen = new Set(options.map((item) => item.value));

  for (const rawPart of text.split(/[,，、]/)) {
    const label = rawPart.trim();
    const value = qualityValueFromLabel(label);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label });
  }

  return {
    availableText: text,
    options,
    detected: options.length > 1,
  };
}

const BILIBILI_QUALITY_PROBES = [
  { value: '4k', qn: 120 },
  { value: '1080p60', qn: 116 },
  { value: '1080p+', qn: 112 },
  { value: '1080', qn: 80 },
  { value: '720', qn: 64 },
  { value: '480', qn: 32 },
  { value: '360', qn: 16 },
];

function bilibiliValueForQn(qn) {
  const matched = BILIBILI_QUALITY_PROBES.find((item) => item.qn === Number(qn));
  return matched?.value || String(qn || '');
}

async function detectBilibiliQualityOptions(videoUrl, cookieHeader) {
  const found = new Map();
  for (const probe of BILIBILI_QUALITY_PROBES) {
    const info = await getBilibiliVideoInfo(videoUrl, {
      quality: probe.value,
      bilibiliCookieHeader: cookieHeader || '',
    });
    const qn = Number(info.selectedQn) || probe.qn;
    if (!found.has(qn)) {
      found.set(qn, {
        value: bilibiliValueForQn(qn),
        label: info.selectedQuality || `${qn}`,
      });
    }
  }

  const options = [{ value: 'best', label: '自动选择最佳' }];
  for (const qn of [...found.keys()].sort((a, b) => b - a)) {
    const option = found.get(qn);
    if (option?.value) options.push(option);
  }

  const availableText = options.slice(1).map((item) => item.label).join(', ');
  return {
    availableText,
    options,
    detected: options.length > 1,
  };
}

function uniqueCookies(cookies) {
  const seen = new Set();
  const result = [];
  for (const cookie of cookies || []) {
    const key = `${cookie.domain || ''}\n${cookie.path || ''}\n${cookie.name || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cookie);
  }
  return result;
}

async function verifyBilibiliCookie(cookieHeader) {
  if (!cookieHeader) return false;
  try {
    const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Referer: 'https://www.bilibili.com/',
        Cookie: cookieHeader,
      },
    });
    if (!response.ok) return false;
    const json = await response.json();
    return Boolean(json?.data?.isLogin);
  } catch {
    return false;
  }
}

async function openUiBrowser(browserPath, uiUrl) {
  if (!browserPath && process.platform === 'darwin') {
    const proc = spawn('open', [uiUrl], { detached: true, stdio: 'ignore' });
    proc.unref();
    return { proc, profileDir: '' };
  }
  if (!browserPath) {
    throw new Error('没有找到可用浏览器，请安装 Chrome、Edge 或 Firefox。');
  }
  const profileDir = await makeTempDir('muxin-video-downloader-ui');
  const args = [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--app=${uiUrl}`,
  ];

  const proc = spawn(browserPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  proc.unref();
  return { proc, profileDir };
}

async function runUiSession() {
  await ensureDefaultVideoDir();
  const browserPath = await findBrowser(null).catch(() => '');
  const baseDir = resolveBaseDir();
  const dataDir = resolveDataDir();
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  const defaultToolPaths = {
    ytDlpPath: await findBundledTool('yt-dlp') || path.join(baseDir, 'runtime', `yt-dlp${executableSuffix}`),
    ffmpegPath: await findBundledTool('ffmpeg') || path.join(baseDir, 'runtime', `ffmpeg${executableSuffix}`),
  };
  const clients = new Set();
  const queue = [];
  const douyinSourceCache = new Map();
  const kuaishouSourceCache = new Map();
  const stats = { done: 0, failed: 0 };
  const bilibiliLogin = {
    browser: null,
    cookieHeader: '',
    loggedIn: false,
    uname: '',
    monitor: null,
    profileDir: path.join(dataDir, 'bilibili-profile'),
  };
  const youtubeLogin = {
    browser: null,
    browserChoice: '',
    browserLabel: '',
    browserMode: '',
    cookiesPath: path.join(dataDir, 'youtube-cookies.txt'),
    loggedIn: false,
    hasCookie: false,
    profileDir: path.join(dataDir, 'youtube-profile'),
  };
  const instagramLogin = {
    browser: null,
    browserChoice: '',
    browserLabel: '',
    browserMode: '',
    cookiesPath: path.join(dataDir, 'instagram-cookies.txt'),
    loggedIn: false,
    hasCookie: false,
    profileDir: path.join(dataDir, 'instagram-profile'),
  };
  let running = false;
  let stoppingDownloads = false;
  let activeJobController = null;
  let activeJobUrl = '';
  let activeDouyinSession = null;
  let activeKuaishouSession = null;
  const sourceCacheKey = (videoUrl) => String(videoUrl || '').trim();
  const getCachedSource = (cache, videoUrl) => {
    const key = sourceCacheKey(videoUrl);
    const cached = cache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.savedAt > 10 * 60 * 1000) {
      cache.delete(key);
      return null;
    }
    return cached.payload;
  };
  const kuaishouCacheKey = (videoUrl) => String(videoUrl || '').trim();
  const getCachedKuaishouSource = (videoUrl) => {
    return getCachedSource(kuaishouSourceCache, videoUrl);
  };
  const getCachedDouyinSource = (videoUrl) => getCachedSource(douyinSourceCache, videoUrl);

  const emit = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
  };
  const emitQueue = () => emit('queue', { queued: queue.length });
  const emitRunState = () => emit('run-state', {
    running,
    stopping: stoppingDownloads,
    current: activeJobUrl,
    queued: queue.length,
  });
  const emitAiProgress = (payload) => emit('ai-progress', payload);
  let hadUiClient = false;
  let shutdownTimer = null;
  let shuttingDown = false;
  let uiBrowser = null;
  const shutdownServer = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
    for (const client of clients) {
      client.end();
    }
    clients.clear();
    await closeBilibiliLoginBrowser().catch(() => {});
    if (youtubeLogin.browser?.proc && !youtubeLogin.browser.proc.killed) {
      youtubeLogin.browser.proc.kill();
    }
    if (instagramLogin.browser?.proc && !instagramLogin.browser.proc.killed) {
      instagramLogin.browser.proc.kill();
    }
    if (activeDouyinSession) {
      await closeDouyinSession(activeDouyinSession).catch(() => {});
      activeDouyinSession = null;
    }
    if (activeKuaishouSession) {
      await closeKuaishouSession(activeKuaishouSession).catch(() => {});
      activeKuaishouSession = null;
    }
    if (uiBrowser?.proc && !uiBrowser.proc.killed && uiBrowser.proc.exitCode === null) {
      uiBrowser.proc.kill();
      await Promise.race([
        once(uiBrowser.proc, 'exit'),
        sleep(2000),
      ]).catch(() => {});
    }
    await removeTempDir(uiBrowser?.profileDir);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  const scheduleShutdownIfUiClosed = () => {
    if (!hadUiClient || clients.size || shuttingDown) return;
    if (shutdownTimer) clearTimeout(shutdownTimer);
    shutdownTimer = setTimeout(() => {
      if (!clients.size) {
        shutdownServer().catch(() => process.exit(0));
      }
    }, 2500);
  };
  const cancelScheduledShutdown = () => {
    if (!shutdownTimer) return;
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  };
  const emitBilibiliLogin = () => emit('bilibili-login', {
    loggedIn: bilibiliLogin.loggedIn,
    hasCookie: Boolean(bilibiliLogin.cookieHeader),
    uname: bilibiliLogin.uname,
  });
  const emitYoutubeLogin = () => emit('youtube-login', {
    loggedIn: youtubeLogin.loggedIn,
    hasCookie: youtubeLogin.hasCookie,
  });
  const emitInstagramLogin = () => emit('instagram-login', {
    loggedIn: instagramLogin.loggedIn,
    hasCookie: instagramLogin.hasCookie,
  });
  const resolveYoutubeAuthOptions = (body, platform) => {
    if (platform !== 'youtube' && platform !== 'instagram') {
      return {
        ytDlpCookiesPath: '',
        ytDlpCookiesFromBrowser: '',
      };
    }
    const loginState = platform === 'instagram' ? instagramLogin : youtubeLogin;
    const explicitCookiesPath = body.ytDlpCookiesPath ? String(body.ytDlpCookiesPath) : '';
    const auth = String(body.youtubeAuth || 'none').trim().toLowerCase();
    if (auth === 'app' && loginState.browserMode === 'firefox' && loginState.hasCookie) {
      return {
        ytDlpCookiesPath: '',
        ytDlpCookiesFromBrowser: `firefox:${loginState.browser?.profileDir || loginState.profileDir}`,
      };
    }
    return {
      ytDlpCookiesPath: explicitCookiesPath || (auth === 'app' && loginState.hasCookie ? loginState.cookiesPath : ''),
      ytDlpCookiesFromBrowser: '',
    };
  };
  const browserChoiceLabel = (choice) => ({
    chrome: 'Chrome',
    edge: 'Edge',
    firefox: 'Firefox',
  }[choice] || 'Chrome');
  const findYoutubeLoginBrowser = async (choiceInput) => {
    const choice = String(choiceInput || 'chrome').trim().toLowerCase();
    const localAppData = process.env.LOCALAPPDATA || '';
    const candidatesByChoice = process.platform === 'darwin' ? {
      chrome: [
        process.env.CHROME_PATH,
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        path.join(process.env.HOME || '', 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      ],
      edge: [
        process.env.EDGE_PATH,
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        path.join(process.env.HOME || '', 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
      ],
      firefox: [
        process.env.FIREFOX_PATH,
        '/Applications/Firefox.app/Contents/MacOS/firefox',
        path.join(process.env.HOME || '', 'Applications', 'Firefox.app', 'Contents', 'MacOS', 'firefox'),
      ],
    } : {
      chrome: [
        process.env.CHROME_PATH,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      ],
      edge: [
        process.env.EDGE_PATH,
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      ],
      firefox: [
        process.env.FIREFOX_PATH,
        'C:/Program Files/Mozilla Firefox/firefox.exe',
        'C:/Program Files (x86)/Mozilla Firefox/firefox.exe',
        localAppData ? path.join(localAppData, 'Mozilla Firefox', 'firefox.exe') : '',
      ],
    };
    const candidates = candidatesByChoice[choice];
    if (!candidates) {
      return { choice: 'chrome', label: browserChoiceLabel('chrome'), path: browserPath };
    }
    for (const candidate of candidates.filter(Boolean)) {
      if (await fileExists(candidate)) {
        return { choice, label: browserChoiceLabel(choice), path: candidate };
      }
    }
    throw new Error(`没有找到 ${browserChoiceLabel(choice)}，请换一个登录浏览器`);
  };

  const closeBilibiliLoginBrowser = async () => {
    if (bilibiliLogin.monitor) {
      clearInterval(bilibiliLogin.monitor);
      bilibiliLogin.monitor = null;
    }
    const browser = bilibiliLogin.browser;
    bilibiliLogin.browser = null;
    if (browser?.page?.webSocketDebuggerUrl) {
      await cdp(browser.page.webSocketDebuggerUrl, 'Browser.close', {}, 3000).catch(() => {});
    }
    if (browser?.proc && !browser.proc.killed && browser.proc.exitCode === null) {
      browser.proc.kill();
    }
  };

  const readBilibiliCookieFromBrowser = async () => {
    const browser = bilibiliLogin.browser;
    if (!browser?.port) return false;
    browser.page = await waitForPage(
      browser.port,
      10_000,
      (page) => /bilibili\.com/i.test(String(page.url || '')),
    );
    const cookies = uniqueCookies([
      ...await getAllCookies(browser.page),
      ...await getCookiesForUrls(browser.page, [
        'https://www.bilibili.com/',
        'https://passport.bilibili.com/',
        'https://api.bilibili.com/',
      ]),
    ]);
    const cookieHeader = cookiesToHeader(cookies, 'bilibili.com');
    const verified = await verifyBilibiliCookie(cookieHeader);
    if (!verified) {
      return false;
    }
    bilibiliLogin.cookieHeader = cookieHeader;
    bilibiliLogin.loggedIn = true;
    bilibiliLogin.uname = '';
    emitBilibiliLogin();
    return true;
  };

  const startBilibiliLoginMonitor = () => {
    if (bilibiliLogin.monitor) clearInterval(bilibiliLogin.monitor);
    let attempts = 0;
    bilibiliLogin.monitor = setInterval(() => {
      attempts += 1;
      readBilibiliCookieFromBrowser()
        .then(async (success) => {
          if (success) {
            emit('log', { message: 'Bilibili 登录成功，后续高码率下载会使用该登录态。' });
            await closeBilibiliLoginBrowser();
          } else if (attempts >= 180) {
            clearInterval(bilibiliLogin.monitor);
            bilibiliLogin.monitor = null;
            emit('log', { message: 'Bilibili 登录等待超时，可以重新点击高码率登录。' });
          }
        })
        .catch(() => {});
    }, 1500);
  };

  const ensureBilibiliLoginBrowser = async () => {
    if (bilibiliLogin.browser?.port) {
      return bilibiliLogin.browser;
    }
    await mkdir(bilibiliLogin.profileDir, { recursive: true });
    bilibiliLogin.browser = await startCdpBrowser(browserPath, {
      url: 'https://passport.bilibili.com/login',
      profileDir: bilibiliLogin.profileDir,
      showBrowser: true,
      timeoutMs: 30_000,
      pagePredicate: (page) => String(page.url || '').includes('bilibili.com'),
      waitForPage: false,
    });
    await sleep(600);
    try {
      bilibiliLogin.browser.page = await waitForPage(
        bilibiliLogin.browser.port,
        15_000,
        (page) => /bilibili\.com/i.test(String(page.url || '')),
      );
    } catch {
      bilibiliLogin.browser = null;
      throw new Error('Bilibili 登录窗口已打开，但程序没有连上登录窗口。请关闭该窗口后重试。');
    }
    startBilibiliLoginMonitor();
    return bilibiliLogin.browser;
  };

  const refreshBilibiliCookie = async () => {
    if (!bilibiliLogin.browser?.port) {
      return {
        loggedIn: bilibiliLogin.loggedIn,
        hasCookie: Boolean(bilibiliLogin.cookieHeader),
        uname: bilibiliLogin.uname,
      };
    }
    await readBilibiliCookieFromBrowser();
    bilibiliLogin.uname = '';
    emitBilibiliLogin();
    return {
      loggedIn: bilibiliLogin.loggedIn,
      hasCookie: Boolean(bilibiliLogin.cookieHeader),
      uname: bilibiliLogin.uname,
    };
  };

  const hasYoutubeLoginBrowser = () => Boolean(
    youtubeLogin.browser?.proc
      && !youtubeLogin.browser.proc.killed
      && youtubeLogin.browser.proc.exitCode === null,
  );
  const youtubeLoginBrowserAlive = async () => {
    if (!hasYoutubeLoginBrowser()) return false;
    if (youtubeLogin.browserMode === 'firefox') return true;
    try {
      const response = await fetch(`http://127.0.0.1:${youtubeLogin.browser.port}/json/version`);
      return response.ok;
    } catch {
      youtubeLogin.browser = null;
      youtubeLogin.browserChoice = '';
      youtubeLogin.browserLabel = '';
      youtubeLogin.browserMode = '';
      return false;
    }
  };
  const probeFirefoxYoutubeLogin = async () => {
    const profileDir = youtubeLogin.browser?.profileDir || youtubeLogin.profileDir;
    const ytDlpPath = await findYtDlp(defaultToolPaths.ytDlpPath);
    if (!ytDlpPath) {
      throw new Error('没有找到 yt-dlp，无法读取 Firefox 登录状态');
    }
    const result = await new Promise((resolve) => {
      const proc = spawn(ytDlpPath, [
        '--ignore-config',
        '--cookies-from-browser',
        `firefox:${profileDir}`,
        '--simulate',
        '--skip-download',
        '--no-warnings',
        'https://www.youtube.com/',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => { stdout += chunk; });
      proc.stderr.on('data', (chunk) => { stderr += chunk; });
      proc.on('error', (error) => resolve({ ok: false, error: error.message }));
      proc.on('exit', (code) => resolve({
        ok: code === 0,
        error: code === 0 ? '' : (stderr || stdout || `yt-dlp exited with code ${code}`).trim(),
      }));
    });
    youtubeLogin.hasCookie = result.ok;
    youtubeLogin.loggedIn = result.ok;
    emitYoutubeLogin();
    if (!result.ok) {
      throw new Error(`读取 Firefox 登录状态失败：${result.error || '没有读取到 YouTube Cookie'}`);
    }
    return { loggedIn: youtubeLogin.loggedIn, hasCookie: youtubeLogin.hasCookie };
  };

  const ensureYoutubeLoginBrowser = async (loginBrowser = 'default') => {
    if (await youtubeLoginBrowserAlive()) {
      return youtubeLogin.browser;
    }
    const resolvedBrowser = await findYoutubeLoginBrowser(loginBrowser);
    youtubeLogin.browserChoice = resolvedBrowser.choice;
    youtubeLogin.browserLabel = resolvedBrowser.label;
    youtubeLogin.browserMode = resolvedBrowser.choice === 'firefox' ? 'firefox' : 'cdp';
    if (youtubeLogin.browserMode === 'firefox') {
      await mkdir(youtubeLogin.profileDir, { recursive: true });
      const proc = spawn(resolvedBrowser.path, [
        '-no-remote',
        '-profile',
        youtubeLogin.profileDir,
        'https://www.youtube.com/',
      ], {
        detached: false,
        stdio: 'ignore',
        windowsHide: false,
      });
      youtubeLogin.browser = {
        proc,
        profileDir: youtubeLogin.profileDir,
        port: null,
        page: null,
      };
      await sleep(600);
      if (proc.exitCode !== null) {
        youtubeLogin.browser = null;
        youtubeLogin.browserMode = '';
        throw new Error('Firefox 登录窗口启动后立即退出，请换 Chrome 或 Edge 重试');
      }
      return youtubeLogin.browser;
    }
    youtubeLogin.browser = await startCdpBrowser(resolvedBrowser.path, {
      url: 'https://www.youtube.com/',
      profileDir: youtubeLogin.profileDir,
      showBrowser: true,
      timeoutMs: 30_000,
      pagePredicate: (page) => /(?:youtube|google)\.com/i.test(String(page.url || '')),
      waitForPage: false,
    });
    await sleep(600);
    if (youtubeLogin.browser.proc.exitCode !== null) {
      youtubeLogin.browser = null;
      youtubeLogin.browserMode = '';
      throw new Error(`YouTube 登录窗口启动后立即退出，请换一个登录浏览器重试`);
    }
    return youtubeLogin.browser;
  };

  const refreshYoutubeCookie = async () => {
    if (youtubeLogin.browserMode === 'firefox') {
      return probeFirefoxYoutubeLogin();
    }
    const browser = await ensureYoutubeLoginBrowser();
    browser.page = await waitForPage(
      browser.port,
      10_000,
      (page) => /(?:youtube|google)\.com/i.test(String(page.url || '')),
    );
    const cookies = await getAllCookies(browser.page);
    const relevantCookies = cookies.filter(isYoutubeCookie);
    await mkdir(path.dirname(youtubeLogin.cookiesPath), { recursive: true });
    await writeFile(youtubeLogin.cookiesPath, cookiesToNetscape(relevantCookies), 'utf8');
    youtubeLogin.hasCookie = relevantCookies.length > 0;
    youtubeLogin.loggedIn = youtubeCookieLoginLikely(relevantCookies);
    emitYoutubeLogin();
    return {
      loggedIn: youtubeLogin.loggedIn,
      hasCookie: youtubeLogin.hasCookie,
    };
  };
  const refreshYoutubeCookieForRequest = async (body, platform) => {
    if (platform !== 'youtube') return;
    if (String(body.youtubeAuth || 'none').trim().toLowerCase() !== 'app') return;
    if (hasYoutubeLoginBrowser()) {
      await refreshYoutubeCookie();
    }
    if (youtubeLogin.browserMode === 'firefox') {
      await probeFirefoxYoutubeLogin();
      return;
    }
    youtubeLogin.hasCookie = youtubeLogin.hasCookie || await fileExists(youtubeLogin.cookiesPath);
    if (!youtubeLogin.hasCookie) {
      throw new Error('YouTube 已选择本程序登录窗口，但还没有读取到登录状态。请先打开 YouTube 登录窗口并登录，再点“确认登录来源”或直接重新识别画质。');
    }
  };
  const hasInstagramLoginBrowser = () => Boolean(
    instagramLogin.browser?.proc
      && !instagramLogin.browser.proc.killed
      && instagramLogin.browser.proc.exitCode === null,
  );
  const instagramLoginBrowserAlive = async () => {
    if (!hasInstagramLoginBrowser()) return false;
    if (instagramLogin.browserMode === 'firefox') return true;
    try {
      const response = await fetch(`http://127.0.0.1:${instagramLogin.browser.port}/json/version`);
      return response.ok;
    } catch {
      instagramLogin.browser = null;
      instagramLogin.browserChoice = '';
      instagramLogin.browserLabel = '';
      instagramLogin.browserMode = '';
      return false;
    }
  };
  const probeFirefoxInstagramLogin = async () => {
    const profileDir = instagramLogin.browser?.profileDir || instagramLogin.profileDir;
    const ytDlpPath = await findYtDlp(defaultToolPaths.ytDlpPath);
    if (!ytDlpPath) {
      throw new Error('没有找到 yt-dlp，无法读取 Firefox 登录状态');
    }
    const result = await new Promise((resolve) => {
      const proc = spawn(ytDlpPath, [
        '--ignore-config',
        '--cookies-from-browser',
        `firefox:${profileDir}`,
        '--simulate',
        '--skip-download',
        '--no-warnings',
        'https://www.instagram.com/',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => { stdout += chunk; });
      proc.stderr.on('data', (chunk) => { stderr += chunk; });
      proc.on('error', (error) => resolve({ ok: false, error: error.message }));
      proc.on('exit', (code) => resolve({
        ok: code === 0,
        error: code === 0 ? '' : (stderr || stdout || `yt-dlp exited with code ${code}`).trim(),
      }));
    });
    instagramLogin.hasCookie = result.ok;
    instagramLogin.loggedIn = result.ok;
    emitInstagramLogin();
    if (!result.ok) {
      throw new Error(`读取 Firefox Instagram 登录状态失败：${result.error || '没有读取到 Instagram Cookie'}`);
    }
    return { loggedIn: instagramLogin.loggedIn, hasCookie: instagramLogin.hasCookie };
  };

  const ensureInstagramLoginBrowser = async (loginBrowser = 'default') => {
    if (await instagramLoginBrowserAlive()) {
      return instagramLogin.browser;
    }
    const resolvedBrowser = await findYoutubeLoginBrowser(loginBrowser);
    instagramLogin.browserChoice = resolvedBrowser.choice;
    instagramLogin.browserLabel = resolvedBrowser.label;
    instagramLogin.browserMode = resolvedBrowser.choice === 'firefox' ? 'firefox' : 'cdp';
    if (instagramLogin.browserMode === 'firefox') {
      await mkdir(instagramLogin.profileDir, { recursive: true });
      const proc = spawn(resolvedBrowser.path, [
        '-no-remote',
        '-profile',
        instagramLogin.profileDir,
        'https://www.instagram.com/',
      ], {
        detached: false,
        stdio: 'ignore',
        windowsHide: false,
      });
      instagramLogin.browser = {
        proc,
        profileDir: instagramLogin.profileDir,
        port: null,
        page: null,
      };
      await sleep(600);
      if (proc.exitCode !== null) {
        instagramLogin.browser = null;
        instagramLogin.browserMode = '';
        throw new Error('Firefox 登录窗口启动后立即退出，请换 Chrome 或 Edge 重试');
      }
      return instagramLogin.browser;
    }
    instagramLogin.browser = await startCdpBrowser(resolvedBrowser.path, {
      url: 'https://www.instagram.com/',
      profileDir: instagramLogin.profileDir,
      showBrowser: true,
      timeoutMs: 30_000,
      pagePredicate: (page) => /instagram\.com/i.test(String(page.url || '')),
      waitForPage: false,
    });
    await sleep(600);
    if (instagramLogin.browser.proc.exitCode !== null) {
      instagramLogin.browser = null;
      instagramLogin.browserMode = '';
      throw new Error('Instagram 登录窗口启动后立即退出，请换一个登录浏览器重试');
    }
    return instagramLogin.browser;
  };

  const refreshInstagramCookie = async () => {
    if (instagramLogin.browserMode === 'firefox') {
      return probeFirefoxInstagramLogin();
    }
    const browser = await ensureInstagramLoginBrowser();
    browser.page = await waitForPage(
      browser.port,
      10_000,
      (page) => /instagram\.com/i.test(String(page.url || '')),
    );
    const cookies = uniqueCookies([
      ...await getAllCookies(browser.page),
      ...await getCookiesForUrls(browser.page, [
        'https://www.instagram.com/',
        'https://instagram.com/',
      ]),
    ]);
    const relevantCookies = cookies.filter(isInstagramCookie);
    await mkdir(path.dirname(instagramLogin.cookiesPath), { recursive: true });
    await writeFile(instagramLogin.cookiesPath, cookiesToNetscape(relevantCookies, 'instagram'), 'utf8');
    instagramLogin.hasCookie = relevantCookies.length > 0;
    instagramLogin.loggedIn = platformCookieLoginLikely(relevantCookies, 'instagram');
    emitInstagramLogin();
    return {
      loggedIn: instagramLogin.loggedIn,
      hasCookie: instagramLogin.hasCookie,
    };
  };
  const refreshInstagramCookieForRequest = async (body, platform) => {
    if (platform !== 'instagram') return;
    if (String(body.youtubeAuth || 'none').trim().toLowerCase() !== 'app') return;
    if (hasInstagramLoginBrowser()) {
      await refreshInstagramCookie();
    }
    if (instagramLogin.browserMode === 'firefox') {
      await probeFirefoxInstagramLogin();
      return;
    }
    instagramLogin.hasCookie = instagramLogin.hasCookie || await fileExists(instagramLogin.cookiesPath);
    if (!instagramLogin.hasCookie) {
      throw new Error('Instagram 已选择本程序登录窗口，但还没有读取到登录状态。请先打开 Instagram 登录窗口并登录，再点“确认登录来源”或直接重新识别画质。');
    }
  };
  const refreshPlatformCookieForRequest = async (body, platform) => {
    if (platform === 'youtube') return refreshYoutubeCookieForRequest(body, platform);
    if (platform === 'instagram') return refreshInstagramCookieForRequest(body, platform);
  };

  const processQueue = async () => {
    if (running) return;
    running = true;
    stoppingDownloads = false;
    emitRunState();
    let douyinSession = null;
    let kuaishouSession = null;
    try {
      while (queue.length) {
        if (stoppingDownloads) break;
        const job = queue.shift();
        activeJobUrl = job.url;
        activeJobController = new AbortController();
        emitQueue();
        emitRunState();
        emit('log', { message: `开始任务：${job.url}` });
        try {
          let jobOptions = { ...job.options, signal: activeJobController.signal };
          if (jobOptions.platform === 'douyin' && !jobOptions.douyinResolvedInfo) {
            if (kuaishouSession) {
              await closeKuaishouSession(kuaishouSession, jobOptions).catch(() => {});
              kuaishouSession = null;
            }
            if (!douyinSession) {
              emit('log', { message: '抖音批量任务将复用同一个浏览器窗口。' });
              douyinSession = await createDouyinSession(browserPath, {
                timeoutMs: jobOptions.timeoutMs,
              });
              activeDouyinSession = douyinSession;
            }
            jobOptions = { ...jobOptions, douyinSession };
          } else if (jobOptions.platform === 'kuaishou' && !jobOptions.kuaishouResolvedInfo) {
            if (douyinSession) {
              await closeDouyinSession(douyinSession, jobOptions).catch(() => {});
              douyinSession = null;
              activeDouyinSession = null;
            }
            if (!kuaishouSession) {
              emit('log', { message: '快手批量任务将复用同一个浏览器窗口。' });
              kuaishouSession = await createKuaishouSession(browserPath, {
                timeoutMs: jobOptions.timeoutMs,
              });
              activeKuaishouSession = kuaishouSession;
            }
            jobOptions = { ...jobOptions, kuaishouSession };
          } else {
            if (douyinSession && jobOptions.platform !== 'douyin') {
              await closeDouyinSession(douyinSession, jobOptions).catch(() => {});
              douyinSession = null;
              activeDouyinSession = null;
            }
            if (kuaishouSession && jobOptions.platform !== 'kuaishou') {
              await closeKuaishouSession(kuaishouSession, jobOptions).catch(() => {});
              kuaishouSession = null;
              activeKuaishouSession = null;
            }
          }
          const output = await downloadVideo(job.url, {
            ...jobOptions,
            onLog: (message) => emit('log', { message }),
            onProgress: (payload) => emit('progress', payload),
          }, browserPath);
          stats.done += 1;
          emit('done', {
            queued: queue.length,
            done: stats.done,
            failed: stats.failed,
            url: job.url,
            platform: jobOptions.platform || '',
            output,
          });
        } catch (error) {
          if (activeJobController?.signal.aborted || /任务已终止|aborted|abort/i.test(error.message || '')) {
            emit('log', { message: `任务已终止：${job.url}` });
            emit('progress', { percent: 0 });
            continue;
          }
          stats.failed += 1;
          emit('error-job', {
            queued: queue.length,
            done: stats.done,
            failed: stats.failed,
            message: error.message,
          });
        }
      }
    } finally {
      activeJobController = null;
      activeJobUrl = '';
      if (douyinSession) {
        await closeDouyinSession(douyinSession).catch(() => {});
        activeDouyinSession = null;
      }
      if (kuaishouSession) {
        await closeKuaishouSession(kuaishouSession).catch(() => {});
        activeKuaishouSession = null;
      }
      running = false;
      stoppingDownloads = false;
      emitRunState();
    }
  };

  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/') {
        const body = uiHtml(defaultToolPaths);
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': Buffer.byteLength(body),
        });
        res.end(body);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        hadUiClient = true;
        cancelScheduledShutdown();
        clients.add(res);
        res.write(`event: queue\ndata: ${JSON.stringify({ queued: queue.length })}\n\n`);
        res.write(`event: run-state\ndata: ${JSON.stringify({ running, stopping: stoppingDownloads, current: activeJobUrl, queued: queue.length })}\n\n`);
        res.write(`event: bilibili-login\ndata: ${JSON.stringify({ loggedIn: bilibiliLogin.loggedIn, hasCookie: Boolean(bilibiliLogin.cookieHeader), uname: bilibiliLogin.uname })}\n\n`);
        res.write(`event: youtube-login\ndata: ${JSON.stringify({ loggedIn: youtubeLogin.loggedIn, hasCookie: youtubeLogin.hasCookie })}\n\n`);
        res.write(`event: instagram-login\ndata: ${JSON.stringify({ loggedIn: instagramLogin.loggedIn, hasCookie: instagramLogin.hasCookie })}\n\n`);
        req.on('close', () => {
          clients.delete(res);
          scheduleShutdownIfUiClosed();
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/environment') {
        const browserPath = await findBrowser(null).catch(() => '');
        const ytDlpPath = await findYtDlp(defaultToolPaths.ytDlpPath).catch(() => '');
        const ffmpegPath = await findFfmpeg(defaultToolPaths.ffmpegPath).catch(() => '');
        sendJson(res, 200, { ok: true, environment: await diagnoseEnvironment({ browserPath, ytDlpPath, ffmpegPath }) });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/update/check') {
        sendJson(res, 200, { ok: true, update: await checkForUpdates() });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/components/install') {
        const body = await readJsonBody(req);
        const requested = String(body.id || 'whisperSmall');
        const installOne = async (id) => installComponent(id, { onProgress: (progress) => emit('component-progress', { id, ...progress }) });
        let engine = '';
        if (requested === 'whisper-auto') {
          await ensureBundledWhisperCpu();
          const bundledCpu = await componentStatus('whisperCpu');
          if (!bundledCpu.installed) await installOne('whisperCpu');
          engine = 'whisperCpu';
          const selectedModel = String(body.model || 'small');
          await installOne(selectedModel === 'large-v3' ? 'whisperLargeV3' : selectedModel === 'medium' ? 'whisperMedium' : 'whisperSmall');
        } else {
          await installOne(requested);
          engine = requested;
        }
        sendJson(res, 200, { ok: true, engine, components: await listComponentStatus() });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/components/remove') {
        const body = await readJsonBody(req);
        await removeComponent(String(body.id || ''));
        sendJson(res, 200, { ok: true, components: await listComponentStatus() });
        return;
      }      if (req.method === 'GET' && url.pathname === '/api/ai/config') {
        const config = await loadAiConfig();
        sendJson(res, 200, { ok: true, config: publicAiConfig(config) });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/ai/actions') {
        const platform = String(url.searchParams.get('platform') || 'general');
        const overrides = await loadAiPromptOverrides();
        const customActions = await loadAiCustomActions();
        const actions = platformActions(platform).map(([id, label, prompt, group = 'core']) => {
          const action = applyPromptOverride({ id, label, prompt, platform, group }, overrides);
          return {
            id,
            label,
            group,
            prompt: action.prompt,
            description: action.prompt,
            defaultPrompt: action.defaultPrompt,
            customized: action.customized,
          };
        });
        const custom = (Array.isArray(customActions[platform]) ? customActions[platform] : []).map((action) => ({
          id: action.id,
          label: action.label,
          group: 'custom',
          prompt: action.prompt,
          description: action.prompt,
          defaultPrompt: action.prompt,
          customized: true,
          custom: true,
        }));
        actions.push(...custom);
        sendJson(res, 200, { ok: true, actions });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/custom-action') {
        const body = await readJsonBody(req);
        const platform = String(body.platform || 'general');
        const action = await saveAiCustomAction(platform, {
          id: String(body.id || ''),
          label: String(body.label || ''),
          prompt: String(body.prompt || ''),
        });
        sendJson(res, 200, {
          ok: true,
          action: {
            id: action.id,
            label: action.label,
            group: 'custom',
            prompt: action.prompt,
            description: action.prompt,
            defaultPrompt: action.prompt,
            customized: true,
            custom: true,
          },
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/custom-action/delete') {
        const body = await readJsonBody(req);
        await deleteAiCustomAction(String(body.platform || 'general'), String(body.action || ''));
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/action-prompt') {
        const body = await readJsonBody(req);
        const platform = String(body.platform || 'general');
        const actionId = String(body.action || '');
        const action = quickAction(actionId, platform);
        if (!action) {
          sendJson(res, 404, { ok: false, error: '没有找到这个创作模板。' });
          return;
        }
        await saveAiPromptOverride(platform, actionId, String(body.prompt || ''));
        const overrides = await loadAiPromptOverrides();
        const next = applyPromptOverride(action, overrides);
        sendJson(res, 200, {
          ok: true,
          action: {
            id: next.id,
            label: next.label,
            group: next.group || 'core',
            prompt: next.prompt,
            description: next.prompt,
            defaultPrompt: next.defaultPrompt,
            customized: next.customized,
          },
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/action-prompt/reset') {
        const body = await readJsonBody(req);
        const platform = String(body.platform || 'general');
        const actionId = String(body.action || '');
        const action = quickAction(actionId, platform);
        if (!action) {
          sendJson(res, 404, { ok: false, error: '没有找到这个创作模板。' });
          return;
        }
        await saveAiPromptOverride(platform, actionId, '');
        sendJson(res, 200, {
          ok: true,
          action: {
            id: action.id,
            label: action.label,
            group: action.group || 'core',
            prompt: action.prompt,
            description: action.prompt,
            defaultPrompt: action.prompt,
            customized: false,
          },
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/config') {
        const body = await readJsonBody(req);
        const config = await saveAiConfig(body);
        sendJson(res, 200, { ok: true, config: publicAiConfig(config) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/test') {
        const body = await readJsonBody(req);
        const config = await saveAiConfig(body);
        const message = await testAiConfig(config);
        sendJson(res, 200, { ok: true, message, config: publicAiConfig(config) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/local-analyze') {
        const body = await readJsonBody(req);
        const transcript = String(body.transcript || '').trim();
        if (!transcript) {
          sendJson(res, 400, { ok: false, error: '请先粘贴字幕、转写稿或视频内容文本。' });
          return;
        }
        const analysis = analyzeTranscriptLocal(transcript, String(body.platform || 'general'));
        sendJson(res, 200, { ok: true, analysis });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/extract-subtitles') {
        const body = await readJsonBody(req);
        const videoUrl = String(body.url || '').trim();
        const platform = body.platform ? String(body.platform) : '';
        const config = await loadAiConfig();
        const prefs = transcriptPrefsFromBody(body, config);
        const ytDlpPath = await findYtDlp(body.ytDlpPath ? String(body.ytDlpPath) : defaultToolPaths.ytDlpPath);
        await refreshPlatformCookieForRequest(body, platform);
        const authOptions = resolveYoutubeAuthOptions(body, platform);
        const subtitles = await extractSubtitlesFromUrl(videoUrl, ytDlpPath, { ...prefs, ...authOptions });
        const prepared = await preparePlatformSubtitleText(subtitles, config, prefs);
        const text = prepared.text;
        const originalSaved = await saveTranscriptArtifacts(String(body.filePath || ''), subtitles.text, {
          sourceUrl: videoUrl,
          baseName: 'platform_original',
          group: '01_platform_original',
          formats: ['txt'],
          timeline: false,
        });
        const finalSaved = await saveFinalTranscriptArtifacts(String(body.filePath || ''), prepared, {
          sourceUrl: videoUrl,
          prefs,
          formats: ['txt', 'srt', 'vtt'],
          timeline: true,
        });
        const saved = mergeSavedArtifacts(finalSaved, originalSaved);
        sendJson(res, 200, { ok: true, subtitles: { ...subtitles, text, translated: prepared.translated, note: prepared.note, variants: prepared.variants || {} }, variants: prepared.variants || {}, saved });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/get-video-text') {
        const body = await readJsonBody(req);
        const videoUrl = String(body.url || '').trim();
        const filePath = String(body.filePath || '').trim();
        const platform = body.platform ? String(body.platform) : '';
        const errors = [];
        const ytDlpPath = await findYtDlp(body.ytDlpPath ? String(body.ytDlpPath) : defaultToolPaths.ytDlpPath);
        const ffmpegPath = await findFfmpeg(body.ffmpegPath ? String(body.ffmpegPath) : defaultToolPaths.ffmpegPath);
        const config = await loadAiConfig();
        const prefs = transcriptPrefsFromBody(body, config);
        await refreshPlatformCookieForRequest(body, platform);
        const authOptions = resolveYoutubeAuthOptions(body, platform);

        if (videoUrl && ytDlpPath) {
          emitAiProgress({ percent: 8, stage: 'platform', message: '正在查找平台已有字幕...' });
          try {
            const subtitles = await extractSubtitlesFromUrl(videoUrl, ytDlpPath, { ...prefs, ...authOptions });
            const prepared = await preparePlatformSubtitleText(subtitles, config, prefs, {
              onProgress: (payload) => emitAiProgress(payload),
            });
            const text = prepared.text;
            const originalSaved = await saveTranscriptArtifacts(filePath, subtitles.text, {
              sourceUrl: videoUrl,
              baseName: 'platform_original',
              group: '01_platform_original',
              formats: ['txt'],
              timeline: false,
            });
            const finalSaved = await saveFinalTranscriptArtifacts(filePath, prepared, {
              sourceUrl: videoUrl,
              prefs,
              formats: ['txt', 'srt', 'vtt'],
              timeline: true,
            });
            const saved = mergeSavedArtifacts(finalSaved, originalSaved);
            emitAiProgress({ percent: 100, stage: 'done', message: '已获取平台已有字幕。' });
            sendJson(res, 200, {
              ok: true,
              method: 'platform',
              message: prepared.note || (prepared.translated ? '已获取平台字幕，并按最终输出格式完成处理。' : '已获取平台已有字幕。'),
              text,
              variants: prepared.variants || {},
              saved,
              details: { ...subtitles, text, translated: prepared.translated, note: prepared.note },
            });
            return;
          } catch (error) {
            errors.push(`平台字幕：${error.message}`);
            emitAiProgress({
              percent: 25,
              stage: 'platform-failed',
              message: filePath ? '平台字幕不可用，继续检查本地视频内嵌字幕。' : '平台字幕不可用。请先下载视频，或手动使用 Whisper 转文字。',
            });
          }
        }

        if (!filePath) {
          sendJson(res, 400, {
            ok: false,
            error: `没有可用平台字幕。你可以先下载视频，再点“获取视频文字”尝试内嵌字幕；如果需要从声音识别文字，请手动点击“Whisper 转文字”。${errors.length ? `\n${errors.join('\n')}` : ''}`,
          });
          return;
        }

        if (ffmpegPath) {
          emitAiProgress({ percent: 35, stage: 'embedded', message: '正在检查本地视频内嵌字幕...' });
          try {
            const subtitles = await extractEmbeddedSubtitle(filePath, ffmpegPath, 'srt');
            const prepared = await prepareTranscriptText(subtitles.text, config, prefs, {
              sourceLabel: '内嵌字幕',
              onProgress: (payload) => emitAiProgress(payload),
            });
            const text = prepared.text;
            const originalSaved = await saveTranscriptArtifacts(filePath, subtitles.text, {
              sourceUrl: videoUrl,
              baseName: 'embedded_original',
              group: '02_embedded_original',
              formats: ['txt'],
              timeline: false,
            });
            const finalSaved = await saveFinalTranscriptArtifacts(filePath, prepared, {
              sourceUrl: videoUrl,
              prefs,
              formats: ['txt', 'srt', 'vtt'],
              timeline: true,
            });
            const saved = mergeSavedArtifacts(finalSaved, originalSaved);
            emitAiProgress({ percent: 100, stage: 'done', message: '已获取本地视频内嵌字幕。' });
            sendJson(res, 200, {
              ok: true,
              method: 'embedded',
              message: prepared.note || (prepared.translated ? '已获取本地视频内嵌字幕，并按最终输出格式完成处理。' : '已获取本地视频内嵌字幕。'),
              text,
              variants: prepared.variants || {},
              saved,
              details: { ...subtitles, text, translated: prepared.translated, note: prepared.note },
            });
            return;
          } catch (error) {
            errors.push(`内嵌字幕：${error.message}`);
            emitAiProgress({ percent: 48, stage: 'embedded-failed', message: '本地视频没有可提取的内嵌字幕，继续使用 Whisper 从声音转文字。' });
          }
        }

        emitAiProgress({ percent: 55, stage: 'whisper', message: '正在启动本地 Whisper 音频转文字...' });
        try {
          const result = await transcribeLocalMedia(filePath, ffmpegPath, config, {
            mode: 'whisper',
            whisperPath: body.whisperPath ? String(body.whisperPath) : config.whisperPath,
            whisperEngine: body.whisperEngine ? String(body.whisperEngine) : config.whisperEngine,
            whisperModel: body.whisperModel ? String(body.whisperModel) : config.whisperModel,
            whisperLanguage: body.whisperLanguage ? String(body.whisperLanguage) : config.whisperLanguage,
            onProgress: (payload) => emitAiProgress(payload),
          });
          const prepared = await prepareTranscriptText(result.text, config, prefs, {
            sourceLabel: 'Whisper 转写',
            onProgress: (payload) => emitAiProgress(payload),
          });
          const text = prepared.text;
          const originalSaved = await saveTranscriptArtifacts(filePath, result.text, {
            sourceUrl: videoUrl,
            baseName: 'whisper_original',
            group: '03_whisper_original',
            formats: ['txt'],
            timeline: false,
          });
          const finalSaved = await saveFinalTranscriptArtifacts(filePath, prepared, {
            sourceUrl: videoUrl,
            prefs,
            formats: ['txt', 'srt', 'vtt'],
            timeline: true,
          });
          const saved = mergeSavedArtifacts(finalSaved, originalSaved);
          emitAiProgress({ percent: 100, stage: 'done', message: 'Whisper 转写完成，字幕文件已保存。' });
          sendJson(res, 200, {
            ok: true,
            method: 'whisper',
            message: prepared.note || (prepared.translated ? '已使用本地 Whisper 从声音转文字，并按最终输出格式完成处理。' : '已使用本地 Whisper 从声音转文字。'),
            text,
            variants: prepared.variants || {},
            saved,
            details: { ...result, text, translated: prepared.translated, note: prepared.note },
          });
          return;
        } catch (error) {
          errors.push(`Whisper：${error.message}`);
          emitAiProgress({ percent: 0, stage: 'failed', message: '获取视频文字失败。' });
          sendJson(res, 500, {
            ok: false,
            error: `获取视频文字失败。请检查本地视频是否包含音轨、ffmpeg 和 Whisper 设置，或手动粘贴字幕文本。\n${errors.join('\n')}`,
          });
          return;
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/extract-embedded-subtitles') {
        const body = await readJsonBody(req);
        const config = await loadAiConfig();
        const prefs = transcriptPrefsFromBody(body, config);
        const ffmpegPath = await findFfmpeg(body.ffmpegPath ? String(body.ffmpegPath) : defaultToolPaths.ffmpegPath);
        const filePath = String(body.filePath || '');
        const subtitles = await extractEmbeddedSubtitle(filePath, ffmpegPath, String(body.format || 'srt'));
        const prepared = await prepareTranscriptText(subtitles.text, config, prefs, { sourceLabel: '内嵌字幕' });
        const text = prepared.text;
        const saved = await saveTranscriptArtifacts(filePath, subtitles.text, {
          baseName: 'embedded_original',
          group: '02_embedded_original',
          formats: ['txt'],
          timeline: false,
        });
        sendJson(res, 200, {
          ok: true,
          subtitles: {
            ...subtitles,
            text,
            translated: prepared.translated,
            note: prepared.note,
            variants: prepared.variants || {},
          },
          variants: prepared.variants || {},
          saved,
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/extract-audio') {
        const body = await readJsonBody(req);
        const ffmpegPath = await findFfmpeg(body.ffmpegPath ? String(body.ffmpegPath) : defaultToolPaths.ffmpegPath);
        const audio = await extractAudioFile(String(body.filePath || ''), ffmpegPath);
        sendJson(res, 200, { ok: true, audio });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/save-transcript') {
        const body = await readJsonBody(req);
        const config = await loadAiConfig();
        const prefs = transcriptPrefsFromBody(body, config);
        const transcript = normalizeTranscriptForResponse(String(body.transcript || ''), prefs);
        const bodyVariants = normalizeBilingualVariants(body.variants);
        if (wantsBilingualTranscript(prefs)) {
          const variants = bodyVariants.mixed && (bodyVariants.chinese || bodyVariants.english)
            ? bodyVariants
            : splitBilingualTranscript(transcript);
          const saved = await saveFinalTranscriptArtifacts(String(body.filePath || ''), {
            text: variants.mixed || transcript,
            variants,
          }, {
            sourceUrl: String(body.sourceUrl || ''),
            outDir: String(body.outDir || ''),
            prefs,
            formats: Array.isArray(body.formats) ? body.formats.map((item) => String(item)) : ['txt', 'srt', 'vtt'],
            timeline: body.timeline !== false,
          });
          sendJson(res, 200, { ok: true, saved });
          return;
        }
        const saved = await saveFinalTranscriptArtifacts(String(body.filePath || ''), {
          text: transcript,
          variants: bodyVariants.original || bodyVariants.chinese || bodyVariants.english ? bodyVariants : { original: transcript },
        }, {
          sourceUrl: String(body.sourceUrl || ''),
          outDir: String(body.outDir || ''),
          prefs,
          formats: Array.isArray(body.formats) ? body.formats.map((item) => String(item)) : ['txt', 'srt', 'vtt'],
          timeline: body.timeline !== false,
        });
        sendJson(res, 200, { ok: true, saved });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/fix-transcript') {
        const body = await readJsonBody(req);
        const config = await loadAiConfig();
        const transcript = String(body.transcript || '').trim();
        const filePath = String(body.filePath || '');
        const sourceUrl = String(body.sourceUrl || '');
        if (!transcript) {
          sendJson(res, 400, { ok: false, error: '请先粘贴或生成字幕文本。' });
          return;
        }
        const prefs = transcriptPrefsFromBody(body, config);
        let sourceVariants = normalizeBilingualVariants(body.variants);
        if (!sourceVariants.sourceText) {
          const storedSource = await loadStoredSourceVariant(filePath, sourceUrl);
          if (storedSource.sourceText) sourceVariants = { ...sourceVariants, ...storedSource };
        }
        const prepared = await fixTranscriptForOutput(
          transcript,
          config,
          prefs,
          sourceVariants,
          { onProgress: (payload) => emitAiProgress(payload) },
        );
        const fixedOutput = prepared.text;
        const saved = await saveTranscriptArtifacts(filePath, fixedOutput, {
          sourceUrl,
          outDir: String(body.outDir || '') || (!filePath && !sourceUrl ? path.join(resolveDefaultVideoDir(), '_analysis', 'manual') : ''),
          baseName: 'transcript_ai_fixed',
          group: '05_ai_fixed',
          formats: ['txt'],
          timeline: false,
        });
        sendJson(res, 200, { ok: true, transcript: fixedOutput, saved: { ...saved, variants: prepared.variants || {} }, translated: prepared.translated, note: prepared.note });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/export-chat') {
        const body = await readJsonBody(req);
        const messages = Array.isArray(body.messages) ? body.messages.map((item) => ({
          role: item?.role === 'assistant' ? 'assistant' : item?.role === 'system' ? 'system' : 'user',
          content: String(item?.content || ''),
        })).filter((item) => item.content.trim()) : [];
        if (!messages.length) {
          sendJson(res, 400, { ok: false, error: '当前没有可导出的创作内容。' });
          return;
        }
        const platform = String(body.platform || 'general');
        const filePath = String(body.filePath || '');
        const sourceUrl = String(body.sourceUrl || '');
        const saved = await saveAiArtifacts({
          filePath,
          sourceUrl,
          outDir: String(body.outDir || '') || (!filePath && !sourceUrl ? path.join(resolveDefaultVideoDir(), '_analysis', 'manual') : ''),
          platform,
          messages,
          formats: ['md', 'txt'],
          baseName: sanitizeFilePart(`ai_${platform}_${String(body.action || 'chat')}`, 'ai_chat'),
        });
        sendJson(res, 200, { ok: true, saved });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/transcribe-local') {
        const body = await readJsonBody(req);
        const config = await loadAiConfig();
        const prefs = transcriptPrefsFromBody(body, config);
        const ffmpegPath = await findFfmpeg(body.ffmpegPath ? String(body.ffmpegPath) : defaultToolPaths.ffmpegPath);
        const result = await transcribeLocalMedia(String(body.filePath || ''), ffmpegPath, config, {
          mode: 'whisper',
          whisperPath: body.whisperPath ? String(body.whisperPath) : config.whisperPath,
          whisperEngine: body.whisperEngine ? String(body.whisperEngine) : config.whisperEngine,
          whisperModel: body.whisperModel ? String(body.whisperModel) : config.whisperModel,
          whisperLanguage: body.whisperLanguage ? String(body.whisperLanguage) : config.whisperLanguage,
          onProgress: (payload) => emitAiProgress(payload),
        });
        const prepared = await prepareTranscriptText(result.text, config, prefs, {
          sourceLabel: 'Whisper 转写',
          onProgress: (payload) => emitAiProgress(payload),
        });
        const text = prepared.text;
        const originalSaved = await saveTranscriptArtifacts(String(body.filePath || ''), result.text, {
          baseName: 'whisper_original',
          group: '03_whisper_original',
          formats: ['txt'],
          timeline: false,
        });
        const finalSaved = await saveFinalTranscriptArtifacts(String(body.filePath || ''), prepared, {
          prefs,
          formats: ['txt', 'srt', 'vtt'],
          timeline: true,
        });
        const saved = mergeSavedArtifacts(finalSaved, originalSaved);
        emitAiProgress({ percent: 100, stage: 'done', message: '音频转文字完成，字幕文件已保存。' });
        sendJson(res, 200, {
          ok: true,
          transcript: text,
          inputPath: result.inputPath,
          saved,
          translated: prepared.translated,
          note: prepared.note,
          variants: prepared.variants || {},
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
        const body = await readJsonBody(req);
        const config = await loadAiConfig();
        const platform = String(body.platform || 'general');
        const action = await resolveAiAction(platform, String(body.action || ''));
        const prompt = action?.prompt || String(body.prompt || '').trim();
        if (!prompt && !(Array.isArray(body.messages) && body.messages.length)) {
          sendJson(res, 400, { ok: false, error: '请输入想问 AI 的问题，或点击一个创作模板。' });
          return;
        }
        const messages = buildAiChatMessages(body, platform, prompt);
        const answer = await chatWithAi(config, messages);
        sendJson(res, 200, { ok: true, answer });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/chat-stream') {
        const body = await readJsonBody(req);
        const config = await loadAiConfig();
        const platform = String(body.platform || 'general');
        const action = await resolveAiAction(platform, String(body.action || ''));
        const prompt = action?.prompt || String(body.prompt || '').trim();
        if (!prompt && !(Array.isArray(body.messages) && body.messages.length)) {
          sendJson(res, 400, { ok: false, error: '请输入想问 AI 的问题，或点击一个创作模板。' });
          return;
        }
        const messages = buildAiChatMessages(body, platform, prompt);
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        let answer = '';
        const sendEvent = (eventName, payload) => {
          res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
        };
        try {
          answer = await streamChatWithAi(config, messages, async (delta, full) => {
            answer = full;
            sendEvent('delta', { delta });
          });
          sendEvent('done', { answer });
          res.end();
        } catch (error) {
          sendEvent('error', { error: error.message, partial: answer });
          res.end();
        }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/bilibili/login') {
        await closeBilibiliLoginBrowser();
        bilibiliLogin.cookieHeader = '';
        bilibiliLogin.loggedIn = false;
        bilibiliLogin.uname = '';
        emitBilibiliLogin();
        await ensureBilibiliLoginBrowser();
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/bilibili/check-login') {
        const status = await refreshBilibiliCookie();
        sendJson(res, 200, { ok: true, ...status });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/youtube/login') {
        const body = await readJsonBody(req);
        const reused = hasYoutubeLoginBrowser();
        await ensureYoutubeLoginBrowser(body.loginBrowser);
        sendJson(res, 200, {
          ok: true,
          reused,
          browser: youtubeLogin.browserChoice,
          browserLabel: youtubeLogin.browserLabel,
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/youtube/check-login') {
        const status = await refreshYoutubeCookie();
        sendJson(res, 200, { ok: true, ...status });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/instagram/login') {
        const body = await readJsonBody(req);
        const reused = hasInstagramLoginBrowser();
        await ensureInstagramLoginBrowser(body.loginBrowser);
        sendJson(res, 200, {
          ok: true,
          reused,
          browser: instagramLogin.browserChoice,
          browserLabel: instagramLogin.browserLabel,
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/instagram/check-login') {
        const status = await refreshInstagramCookie();
        sendJson(res, 200, { ok: true, ...status });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/qualities') {
        const body = await readJsonBody(req);
        const videoUrl = String(body.url || '').trim();
        if (!videoUrl) {
          sendJson(res, 400, { ok: false, error: '请先粘贴一条链接。' });
          return;
        }
        const platform = body.platform ? String(body.platform) : '';
        if (platform === 'bilibili' && bilibiliLogin.browser?.port) {
          await refreshBilibiliCookie().catch(() => {});
        }
        if (platform === 'bilibili') {
          const parsed = await detectBilibiliQualityOptions(videoUrl, bilibiliLogin.cookieHeader);
          emit('log', {
            message: parsed.detected
              ? `Bilibili 实际可选画质：${parsed.availableText}`
              : 'Bilibili 未识别到多个实际可选画质，将使用自动选择最佳。',
          });
          sendJson(res, 200, {
            ok: true,
            logs: [],
            ...parsed,
          });
          return;
        }
        const logs = [];
        const timeoutSeconds = Number(body.timeoutSeconds) || 180;
        await refreshPlatformCookieForRequest(body, platform);
        const authOptions = resolveYoutubeAuthOptions(body, platform);
        const probeOutput = await downloadVideo(videoUrl, {
          outDir: resolveOutDir('videos'),
          nameTemplate: '%title%_%id%.mp4',
          browser: null,
          showBrowser: false,
          keepProfile: false,
          overwrite: false,
          infoOnly: true,
          platform,
          quality: 'best',
          timeoutMs: Math.max(30, timeoutSeconds) * 1000,
          bilibiliCookieHeader: platform === 'bilibili' ? bilibiliLogin.cookieHeader : '',
          ffmpegPath: body.ffmpegPath ? String(body.ffmpegPath) : '',
          ytDlpPath: body.ytDlpPath ? String(body.ytDlpPath) : '',
          ...authOptions,
          onLog: (message) => {
            logs.push(String(message || ''));
            emit('log', { message });
          },
          onProgress: (payload) => emit('progress', payload),
        }, browserPath);
        if (platform === 'douyin' && probeOutput?.info?.src) {
          douyinSourceCache.set(sourceCacheKey(videoUrl), {
            savedAt: Date.now(),
            payload: probeOutput,
          });
          emit('log', { message: '已锁定当前抖音视频源，稍后点击下载会直接使用这个视频，不再重新打开页面。' });
        }
        if (platform === 'kuaishou' && probeOutput?.info?.src) {
          kuaishouSourceCache.set(sourceCacheKey(videoUrl), {
            savedAt: Date.now(),
            payload: probeOutput,
          });
          emit('log', { message: '已锁定当前快手视频源，稍后点击下载会直接使用这个视频，不再重新打开页面。' });
        }
        const parsed = parseQualityOptions(logs);
        sendJson(res, 200, {
          ok: true,
          logs,
          ...parsed,
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/download') {
        const body = await readJsonBody(req);
        const urls = Array.isArray(body.urls) ? body.urls.map((item) => String(item).trim()).filter(Boolean) : [];
        if (!urls.length) {
          sendJson(res, 400, { ok: false, error: '没有提供链接。' });
          return;
        }
        if (String(body.platform || '') === 'bilibili' && bilibiliLogin.browser?.port) {
          await refreshBilibiliCookie().catch(() => {});
        }
        const platform = body.platform ? String(body.platform) : '';
        await refreshPlatformCookieForRequest(body, platform);
        const authOptions = resolveYoutubeAuthOptions(body, platform);
        const timeoutSeconds = Number(body.timeoutSeconds) || 180;
        const requestedNameTemplate = body.nameTemplate ? String(body.nameTemplate) : '%title%_%id%.mp4';
        const nameTemplate = normalizeNameTemplateForBatch(requestedNameTemplate, urls.length);
        const options = {
          outDir: resolveOutDir(body.outDir),
          nameTemplate,
          browser: null,
          showBrowser: false,
          keepProfile: false,
          overwrite: Boolean(body.overwrite),
          infoOnly: false,
          platform,
          quality: body.quality ? String(body.quality).toLowerCase() : 'best',
          timeoutMs: Math.max(30, timeoutSeconds) * 1000,
          bilibiliCookieHeader: String(body.platform || '') === 'bilibili' ? bilibiliLogin.cookieHeader : '',
          ffmpegPath: body.ffmpegPath ? String(body.ffmpegPath) : '',
          ytDlpPath: body.ytDlpPath ? String(body.ytDlpPath) : '',
          ...authOptions,
        };
        for (const item of urls) {
          const jobOptions = { ...options };
          if (jobOptions.platform === 'douyin') {
            const cached = getCachedDouyinSource(item);
            if (cached?.info?.src) {
              jobOptions.douyinResolvedInfo = cached;
              emit('log', { message: `抖音已使用识别画质时锁定的视频源：${item}` });
            }
          }
          if (jobOptions.platform === 'kuaishou') {
            const cached = getCachedKuaishouSource(item);
            if (cached?.info?.src) {
              jobOptions.kuaishouResolvedInfo = cached;
              emit('log', { message: `快手已使用识别画质时锁定的视频源：${item}` });
            }
          }
          queue.push({ url: item, options: jobOptions });
        }
        if (nameTemplate !== requestedNameTemplate) {
          emit('log', { message: `文件名规则已调整为：${nameTemplate}` });
        }
        emitQueue();
        processQueue().catch((error) => emit('log', { message: `队列异常：${error.message}` }));
        sendJson(res, 200, { ok: true, added: urls.length });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/cancel') {
        const cleared = queue.length;
        const hadRunning = running;
        queue.length = 0;
        stoppingDownloads = true;
        if (activeJobController && !activeJobController.signal.aborted) {
          activeJobController.abort();
        }
        if (activeDouyinSession) {
          await closeDouyinSession(activeDouyinSession).catch(() => {});
          activeDouyinSession = null;
        }
        if (activeKuaishouSession) {
          await closeKuaishouSession(activeKuaishouSession).catch(() => {});
          activeKuaishouSession = null;
        }
        if (!hadRunning) {
          stoppingDownloads = false;
        }
        emitQueue();
        emitRunState();
        emit('progress', { percent: 0 });
        emit('log', { message: cleared ? `已终止当前任务，并清空等待队列 ${cleared} 条。` : '已请求终止当前下载任务。' });
        sendJson(res, 200, { ok: true, cleared, running });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/platform-switch') {
        if (!running) {
          if (activeDouyinSession) {
            await closeDouyinSession(activeDouyinSession).catch(() => {});
            activeDouyinSession = null;
          }
          if (activeKuaishouSession) {
            await closeKuaishouSession(activeKuaishouSession).catch(() => {});
            activeKuaishouSession = null;
          }
        }
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/quit') {
        sendJson(res, 200, { ok: true });
        setTimeout(() => {
          shutdownServer().catch(() => process.exit(0));
        }, 100);
        return;
      }
      sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const uiUrl = `http://127.0.0.1:${port}/`;
  console.log(`UI: ${uiUrl}`);

  uiBrowser = await openUiBrowser(browserPath, uiUrl);
}

export { runUiSession };
