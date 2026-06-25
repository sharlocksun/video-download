const STOP_WORDS = new Set([
  '一个', '这个', '那个', '这里', '那里', '我们', '你们', '他们', '它们', '因为', '所以', '但是', '然后',
  '就是', '什么', '可以', '不是', '没有', '如果', '还是', '已经', '进行', '这种', '这些', '那些', '自己',
  'the', 'and', 'that', 'this', 'with', 'you', 'for', 'are', 'was', 'were', 'from', 'have', 'not',
]);

function cleanTranscript(text = '') {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/^WEBVTT/i.test(line))
    .map((line) => line.replace(/<[^>]+>/g, '').replace(/\s+/g, ' '))
    .join('\n');
}

function splitSentences(text = '') {
  return cleanTranscript(text)
    .replace(/\n+/g, ' ')
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
}

function extractTimestampLines(text = '') {
  const lines = cleanTranscript(text).split('\n');
  const result = [];
  for (const line of lines) {
    const matched = line.match(/(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*(?:-->|-)?\s*(.*)/);
    if (!matched) continue;
    const content = matched[2].trim();
    if (content) result.push({ time: matched[1], text: content });
  }
  return result.slice(0, 40);
}

function tokenize(text = '') {
  const source = cleanTranscript(text).toLowerCase();
  const words = source.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9][a-z0-9-]{2,}/g) || [];
  return words.filter((word) => !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}

function topKeywords(text = '', limit = 18) {
  const counts = new Map();
  for (const word of tokenize(text)) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

function pickHighlights(text = '', limit = 8) {
  const sentences = splitSentences(text);
  const scored = sentences.map((sentence, index) => {
    const score = Math.min(sentence.length, 90)
      + (/但|然而|其实|关键|重点|没想到|为什么|如何|必须|一定|最/.test(sentence) ? 25 : 0)
      + (/[!?！？]/.test(sentence) ? 10 : 0)
      - index * 0.06;
    return { sentence, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.sentence);
}

function roughSections(text = '') {
  const timestampLines = extractTimestampLines(text);
  if (timestampLines.length) {
    return timestampLines.slice(0, 12).map((item) => `${item.time} ${item.text}`);
  }
  const sentences = splitSentences(text);
  const sections = [];
  const size = Math.max(3, Math.ceil(sentences.length / 6));
  for (let i = 0; i < sentences.length; i += size) {
    const chunk = sentences.slice(i, i + size);
    if (chunk.length) sections.push(chunk[0]);
  }
  return sections.slice(0, 8);
}

function analyzeTranscriptLocal(text = '', platform = 'general') {
  const cleaned = cleanTranscript(text);
  const plain = cleaned.replace(/\n+/g, ' ');
  const characters = plain.length;
  const sentences = splitSentences(cleaned);
  const keywords = topKeywords(cleaned);
  const highlights = pickHighlights(cleaned);
  const sections = roughSections(cleaned);
  const minutes = Math.max(1, Math.round(characters / 330));

  const lines = [
    '【本地分析】',
    `目标平台：${platform || 'general'}`,
    `文本长度：约 ${characters} 字符，估算口播时长 ${minutes} 分钟`,
    '',
    '【关键词】',
    keywords.length ? keywords.map((item) => `${item.word}(${item.count})`).join('、') : '未提取到明显关键词',
    '',
    '【结构线索】',
    sections.length ? sections.map((item, index) => `${index + 1}. ${item}`).join('\n') : '字幕内容较短，暂未形成清晰段落。',
    '',
    '【可复用句子】',
    highlights.length ? highlights.map((item, index) => `${index + 1}. ${item}`).join('\n') : '暂无可复用句子。',
    '',
    '【下一步建议】',
    '如果需要更像人工的总结、平台化标题、口播脚本或追问式对话，请在“AI 设置”里配置 API 后使用右侧对话。',
  ];

  return {
    cleaned,
    characters,
    sentences: sentences.length,
    keywords,
    highlights,
    sections,
    result: lines.join('\n'),
  };
}

export {
  analyzeTranscriptLocal,
  cleanTranscript,
  extractTimestampLines,
  pickHighlights,
  roughSections,
  topKeywords,
};
