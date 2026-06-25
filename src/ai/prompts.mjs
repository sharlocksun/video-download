const PLATFORM_PROFILES = {
  general: {
    label: '通用',
    focus: [
      '先还原视频主旨、核心论点、事实线索和可复用素材。',
      '输出要区分事实、推测和可二创观点。',
      '给出短视频、图文和长文都能复用的结构建议。',
    ],
  },
  douyin: {
    label: '抖音',
    focus: [
      '优先提炼 3 秒钩子、冲突点、反转点和高密度口播。',
      '强调节奏、情绪推进、评论区互动问题和可拍成分镜的表达。',
      '标题和开头要直接，不绕弯，适合短视频快速滑动场景。',
    ],
  },
  bilibili: {
    label: 'Bilibili',
    focus: [
      '优先整理长视频结构、章节、知识点、素材来源和观众讨论点。',
      '给出标题、封面文案、简介、分 P/章节和弹幕互动设计。',
      '语气可以更完整，兼顾信息量、梗感和系列化表达。',
    ],
  },
  youtube: {
    label: 'YouTube',
    focus: [
      '优先生成英文或中英双语标题、描述、章节、Shorts hook 和 tags。',
      '注意前 30 秒留存、搜索关键词、缩略图文案和结尾 CTA。',
      '把长视频内容拆成 Shorts/Reels/TikTok 可复用片段。',
    ],
  },
  xiaohongshu: {
    label: '小红书',
    focus: [
      '优先生成封面标题、笔记标题、关键词、种草/避坑/清单式正文。',
      '表达要有场景感、经验感和可收藏价值。',
      '输出适合图文笔记、合集笔记和短视频口播的版本。',
    ],
  },
  kuaishou: {
    label: '快手',
    focus: [
      '优先提炼接地气口播、真实体验、强互动提问和连续追更点。',
      '文案要直接、有人味，适合熟人感和社区互动。',
      '关注开场身份/场景、故事推进和评论区二次传播。',
    ],
  },
};

const QUICK_ACTIONS = {
  summary: {
    label: '总结全文',
    prompt: '请基于字幕/文稿输出：1. 一句话主旨；2. 5-8 条核心要点；3. 事实线索；4. 值得二创的角度。',
  },
  outline: {
    label: '时间轴大纲',
    prompt: '请按时间顺序整理视频大纲。如果字幕里没有时间戳，就按内容段落推测章节，并标出每段主题、重点和可剪辑片段。',
  },
  quotes: {
    label: '提取金句',
    prompt: '请提取适合做标题、封面、口播开头、评论区置顶的金句。每条说明适合的平台和使用场景。',
  },
  douyin: {
    label: '抖音二创',
    prompt: '请把内容改写成抖音二创方案：爆款标题 10 个、3 秒开头 5 个、60 秒口播稿、分镜脚本、评论区互动问题。',
  },
  bilibili: {
    label: 'B站二创',
    prompt: '请把内容改写成 B站二创方案：标题 8 个、封面字 8 个、简介、章节、弹幕互动点、可扩展成长视频的结构。',
  },
  youtube: {
    label: 'YouTube二创',
    prompt: '请把内容改写成 YouTube/Shorts 方案：中英双语标题、description、chapters、Shorts hooks、tags 和缩略图文字。',
  },
  xiaohongshu: {
    label: '小红书笔记',
    prompt: '请把内容改写成小红书笔记：封面标题、笔记标题、正文结构、关键词/话题、收藏型清单和短视频口播版。',
  },
  kuaishou: {
    label: '快手二创',
    prompt: '请把内容改写成快手二创方案：接地气开场、故事口播、互动问题、追更钩子和评论区引导。',
  },
};

function platformProfile(platform = 'general') {
  return PLATFORM_PROFILES[platform] || PLATFORM_PROFILES.general;
}

function quickAction(action = 'summary') {
  return QUICK_ACTIONS[action] || null;
}

function buildSystemPrompt(platform = 'general') {
  const profile = platformProfile(platform);
  return [
    '你是一个中文视频内容分析与二创策划助手。',
    '你需要帮助用户从下载后的视频字幕、转写稿或手动整理内容中，提炼信息、总结观点，并生成适合不同平台的二创方案。',
    '不要编造字幕里没有的事实；不确定的内容要标注为“待核实”。',
    '输出要可直接复制使用，必要时用清晰标题和分段。',
    `当前目标平台：${profile.label}。`,
    '平台侧重点：',
    ...profile.focus.map((item) => `- ${item}`),
  ].join('\n');
}

function buildTranscriptContext(transcript = '', sourceUrl = '') {
  const clean = String(transcript || '').trim();
  const limited = clean.length > 24000 ? `${clean.slice(0, 24000)}\n\n[内容过长，已截取前 24000 字符。]` : clean;
  return [
    sourceUrl ? `参考链接：${sourceUrl}` : '',
    limited ? `字幕/文稿：\n${limited}` : '用户暂未提供字幕/文稿。请先提醒用户粘贴字幕或转写内容，再给出可执行建议。',
  ].filter(Boolean).join('\n\n');
}

export {
  PLATFORM_PROFILES,
  QUICK_ACTIONS,
  buildSystemPrompt,
  buildTranscriptContext,
  platformProfile,
  quickAction,
};
