const PLATFORM_PROFILES = {
  general: {
    label: '通用',
    focus: [
      '先还原视频主旨、核心事实、信息结构和可复用素材。',
      '区分事实、推测和可再创作观点，不编造字幕里没有的内容。',
      '输出适合继续改写成短视频、图文笔记、长文、脚本或发布素材的内容。',
    ],
  },
  douyin: {
    label: '抖音',
    focus: [
      '优先提炼 3 秒开头、冲突点、反转点、情绪推进和高密度口播。',
      '输出适合短视频快速滑动场景，开头直接，节奏清晰。',
      '给出评论区互动问题、热点标签和可拍成分镜的表达。',
    ],
  },
  bilibili: {
    label: 'Bilibili',
    focus: [
      '优先整理长视频结构、章节、知识点、素材来源和观众讨论点。',
      '输出标题、封面文案、简介、分段章节、弹幕互动和置顶评论。',
      '语气兼顾信息量、梗感、系列化表达和社区讨论。',
    ],
  },
  youtube: {
    label: 'YouTube',
    focus: [
      '所有策略说明用中文写；标题、简介、口播、标签、章节和缩略图文案同时给中文与英文版本。',
      '优先关注标题、简介、章节、缩略图文字、搜索关键词、Tags、Hashtags、Shorts 拆条和长视频留存。',
      '强调前 30 秒留存、搜索意图、可点击性、跨语言表达和长视频到短视频的复用。',
    ],
  },
  xiaohongshu: {
    label: '小红书',
    focus: [
      '优先生成封面文案、笔记标题、关键词话题和可收藏的清单式正文。',
      '表达要有场景感、经验感、种草或避坑价值，避免像硬广。',
      '适合图文笔记、合集笔记和短视频口播跨平台发布。',
    ],
  },
  kuaishou: {
    label: '快手',
    focus: [
      '优先提炼接地气口播、真实体验、故事推进和强互动提问。',
      '文案要直接、有熟人感，适合社区互动和连续追更。',
      '关注开场身份、场景、评论区引导、直播预热和后续内容钩子。',
    ],
  },
  tiktok: {
    label: 'TikTok',
    focus: [
      '优先提炼 1-3 秒强钩子、竖屏节奏、反差点、可模仿动作和全球化理解成本低的表达。',
      '适合短视频发现流：开头直接给看点，正文压缩信息密度，结尾引导评论、收藏、转发或关注。',
      '标题、Caption、Hashtags 可按需要给中文策略说明，并同时提供英文发布版本，方便面向海外用户。',
    ],
  },
  instagram: {
    label: 'Instagram',
    focus: [
      '优先关注 Reels 开头停留、Caption 可读性、Hashtags/关键词、封面文字、保存/分享理由和主页转化。',
      '适合视觉优先的内容包装：把信息拆成 Reels、轮播图文、Story 互动和个人主页引流四类素材。',
      '输出时用中文说明策略，并按需要给英文 Caption、英文屏幕大字和国际化 Hashtags，方便面向海外用户。',
    ],
  },
};

const PLATFORM_ACTIONS = {
  general: [
    ['publish_pack', '发布包', '请生成通用发布包：一句话定位、核心要点、可复用素材、标题方向、短视频脚本、图文结构、评论互动。', 'core'],
    ['summary', '总结要点', '请输出一句话主旨、核心要点、事实线索、可再创作角度和待核实信息。', 'core'],
    ['outline', '内容结构', '请把内容拆成清晰结构：开头、背景、关键论点、案例/细节、转折、结论和可延展选题。', 'core'],
    ['short_video', '短视频脚本', '请改写成 30 秒、60 秒、90 秒三个版本的短视频口播脚本，并标注适合的画面/字幕节奏。', 'core'],
    ['article_note', '图文长文', '请改写成图文笔记和长文提纲，包含标题、导语、小标题、重点段落和结尾互动。', 'more'],
    ['quotes', '提取金句', '请提取适合标题、封面、开头、置顶评论的金句，并说明用途。', 'more'],
    ['risk_check', '风险核查', '请检查内容中哪些信息需要核实、哪些表达可能夸大、哪些部分不适合直接发布，并给出更稳妥写法。', 'more'],
  ],
  douyin: [
    ['publish_pack', '抖音发布包', '请生成抖音发布包：爆款标题、3 秒开头、60 秒口播稿、分镜脚本、评论互动、标签建议。', 'core'],
    ['hook', '3秒开头', '请给出 12 个适合抖音的 3 秒开头，要求直接、有冲突、有停留理由，并标注适合的情绪方向。', 'core'],
    ['talking', '口播脚本', '请生成 30 秒、60 秒、90 秒三个版本的抖音口播脚本，语言要短句、强节奏、适合竖屏字幕。', 'core'],
    ['shots', '分镜脚本', '请生成适合竖屏短视频的分镜脚本，包含画面、字幕、口播、节奏、转场和素材提示。', 'core'],
    ['comments', '评论互动', '请设计评论区置顶、引导提问、争议但不冒犯的互动话术，并给出 5 个追评方向。', 'more'],
    ['tags', '标签关键词', '请给出抖音标签、搜索关键词、热点切入方向和可蹭热点但不跑题的表达。', 'more'],
    ['series', '系列选题', '请把这个内容拆成 5 条连续更新选题，每条给标题、开头钩子和结尾追更钩子。', 'more'],
  ],
  bilibili: [
    ['publish_pack', 'B站发布包', '请生成 B站发布包：标题、封面大字、简介、章节、分区标签、弹幕互动、置顶评论。', 'core'],
    ['title_cover', '标题封面', '请给出 B站标题 12 个和封面大字 12 个，兼顾信息量、梗感、点击欲和不过度夸张。', 'core'],
    ['intro_chapters', '简介章节', '请生成视频简介、章节时间轴、知识点摘要、素材说明和适合简介区的补充链接提示。', 'core'],
    ['long_script', '长视频结构', '请把内容扩展成 B站长视频结构，包含开场、背景、论证、案例、转折、总结和观众讨论点。', 'core'],
    ['danmaku', '弹幕互动', '请设计适合 B站的弹幕互动点、梗点、投票问题和观众讨论问题。', 'more'],
    ['pinned', '置顶评论', '请生成置顶评论、评论区引导、下期选题征集和观众补充资料邀请。', 'more'],
    ['knowledge_card', '知识卡片', '请把内容整理成知识卡片：概念解释、关键事实、误区、延伸资料和适合截图收藏的短句。', 'more'],
  ],
  youtube: [
    ['publish_pack', 'YouTube发布包', '请生成 YouTube 发布包。要求：策略说明用中文；标题、简介、章节、Tags、Hashtags、缩略图文字、Shorts 拆条建议都同时给中文和英文版本。', 'core'],
    ['title_desc', '标题简介', '请给出 YouTube 标题和简介：中文标题 8 个、英文标题 8 个；中文简介 1 版、英文简介 1 版；并用中文说明每个标题更偏搜索还是点击。', 'core'],
    ['first_30s', '前30秒留存', '请设计 YouTube 长视频前 30 秒脚本：中文策略说明、中文口播稿、英文口播稿，并标注画面节奏和观众留存点。', 'core'],
    ['chapters', '章节时间轴', '请生成 YouTube 章节时间轴。每章给中文标题、英文标题、中文简介和英文简介；没有精确时间戳时按内容段落估算。', 'core'],
    ['shorts_hook', 'Shorts拆条', '请把内容拆成 YouTube Shorts 选题：每条给中文策略、英文标题、英文口播开头、中文解释和适合竖屏的画面建议。', 'more'],
    ['seo_tags', 'SEO标签', '请给出 YouTube SEO 方案：中文关键词、英文关键词、Tags、Hashtags、搜索意图、标题关键词布局和简介关键词布局。', 'more'],
    ['thumbnail', '缩略图文案', '请给出 YouTube 缩略图方案：中文缩略图文字、英文缩略图文字、画面焦点、情绪方向和避免误导点击的提醒。', 'more'],
    ['community', '社区互动', '请生成 YouTube 社区互动方案：中文置顶评论、英文置顶评论、投票问题、评论引导和下期视频征集。', 'more'],
  ],
  xiaohongshu: [
    ['publish_pack', '小红书发布包', '请生成小红书发布包：封面文案、笔记标题、正文、关键词话题、收藏清单、评论引导。', 'core'],
    ['note_title', '笔记标题', '请给出小红书笔记标题 15 个，覆盖种草、避坑、清单、经验分享、反差对比和搜索关键词。', 'core'],
    ['cover', '封面文案', '请给出小红书封面大字和副标题方案，要求一眼知道价值、适合截图传播，并避免夸张营销味。', 'core'],
    ['body', '笔记正文', '请生成小红书正文：开头场景、核心内容、清单式要点、个人经验感表达、结尾互动。', 'core'],
    ['avoid', '避坑清单', '请把内容整理成避坑清单/注意事项，适合收藏，语言像真实经验分享。', 'more'],
    ['keywords', '关键词话题', '请给出关键词、话题标签、搜索词、评论区引导和适合小红书搜索流量的表达。', 'more'],
    ['carousel', '图文分页', '请把内容拆成小红书图文分页：每页标题、正文要点、封面提示和最后一页互动。', 'more'],
  ],
  kuaishou: [
    ['publish_pack', '快手发布包', '请生成快手发布包：接地气开场、故事口播、互动问题、追更钩子、直播预热。', 'core'],
    ['plain_talk', '接地气口播', '请把内容改写成快手口播，语言直接、有熟人味、像真实分享，避免书面腔。', 'core'],
    ['story', '故事脚本', '请生成故事型脚本，包含人物、场景、矛盾、转折、结尾和评论区追问。', 'core'],
    ['comments', '评论引导', '请设计快手评论区互动话术、置顶评论、用户共鸣问题和追更引导。', 'core'],
    ['series', '连续追更', '请拆成连续更新的选题，每条给开头钩子、核心内容、结尾钩子和下集悬念。', 'more'],
    ['live', '直播预热', '请生成适合直播预热/带互动的短视频话术，包含开播理由、福利/看点和评论预约引导。', 'more'],
  ],
  tiktok: [
    ['publish_pack', 'TikTok发布包', '请生成 TikTok 发布包：中文策略说明、英文 Caption、英文标题/屏幕大字、3 秒 Hook、竖屏脚本、Hashtags、评论互动和可复拍点。', 'core'],
    ['hook', '3秒Hook', '请给出 15 个适合 TikTok 的 1-3 秒开头，要求英文可直接发布，并用中文说明每个 Hook 的停留理由、情绪方向和画面建议。', 'core'],
    ['caption', 'Caption文案', '请生成 TikTok Caption 方案：英文短版、英文叙事版、英文提问版各 5 条，并附中文策略说明和适配场景。', 'core'],
    ['vertical_script', '竖屏脚本', '请把内容改写成 15 秒、30 秒、60 秒 TikTok 竖屏脚本，包含画面、字幕大字、口播/旁白、节奏点和结尾 CTA。', 'core'],
    ['hashtags', '标签关键词', '请给出 TikTok Hashtags 和关键词组合：泛流量标签、垂直标签、长尾搜索词、地域/语言标签，并说明使用比例。', 'more'],
    ['comments', '评论互动', '请设计 TikTok 评论区互动方案：置顶评论、引导提问、二次回复视频选题和适合英文用户的互动话术。', 'more'],
    ['trend_remix', '趋势改编', '请分析这段内容可如何改编成 TikTok 趋势玩法，给出可模仿动作、反差剪辑、Duet/Stitch 角度和不依赖版权音乐的替代表达。', 'more'],
    ['series', '系列选题', '请把内容拆成 TikTok 系列短视频选题，每条给英文标题、3 秒 Hook、核心看点、结尾悬念和下一条衔接。', 'more'],
  ],
  instagram: [
    ['publish_pack', 'Instagram发布包', '请生成 Instagram 发布包：中文策略说明、Reels 标题/屏幕大字、中文 Caption、英文 Caption、Hashtags、封面文字、评论互动和主页 CTA。', 'core'],
    ['reels_hook', 'Reels开头', '请给出 15 个适合 Instagram Reels 的前 1-3 秒开头，包含中文策略说明、英文屏幕大字、镜头动作、停留理由和适合的封面文字。', 'core'],
    ['caption', 'Caption文案', '请生成 Instagram Caption 方案：中文短版、中文故事版、英文短版、英文故事版各 5 条，并说明适合 Reels、帖子还是轮播。', 'core'],
    ['hashtags', '标签关键词', '请给出 Instagram Hashtags 和关键词组合：垂直标签、受众标签、场景标签、英文标签、中文关键词，并说明每组使用比例。', 'core'],
    ['carousel', '轮播图文', '请把内容拆成 Instagram 轮播图文：封面标题、每页大字、每页正文、配图建议、最后一页互动问题和保存理由。', 'more'],
    ['story', 'Story互动', '请设计 Instagram Story 互动方案：投票、提问框、测验、倒计时、链接引导和适合连续 Story 的分镜顺序。', 'more'],
    ['bio_cta', '主页转化', '请给出 Instagram 主页转化方案：Bio 文案、置顶帖方向、Reels 结尾 CTA、评论区引导和从观看到关注/私信的路径。', 'more'],
    ['remix', 'Reels改编', '请把这段内容改编成 Instagram Reels 二创方案：30 秒与 60 秒版本、镜头节奏、屏幕字幕、Caption、封面文字和可复用素材点。', 'more'],
  ],
};

const ACTION_LOOKUP = Object.fromEntries(
  Object.entries(PLATFORM_ACTIONS).flatMap(([platform, actions]) => (
    actions.map(([id, label, prompt, group = 'core']) => [`${platform}:${id}`, {
      id,
      label,
      prompt,
      platform,
      group,
    }])
  )),
);

function platformProfile(platform = 'general') {
  return PLATFORM_PROFILES[platform] || PLATFORM_PROFILES.general;
}

function platformActions(platform = 'general') {
  return PLATFORM_ACTIONS[platform] || PLATFORM_ACTIONS.general;
}

function quickAction(action = 'summary', platform = 'general') {
  const exact = ACTION_LOOKUP[`${platform}:${action}`];
  if (exact) return exact;
  return ACTION_LOOKUP[`general:${action}`] || null;
}

function buildSystemPrompt(platform = 'general') {
  const profile = platformProfile(platform);
  return [
    '你是一个中文视频内容分析与内容创作策划助手。',
    '你帮助用户从字幕、转写稿或手动整理文本中提炼信息、总结观点，并生成适合不同平台的发布素材。',
    '不要编造字幕里没有的事实；不确定内容标注为“待核实”。',
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
  PLATFORM_ACTIONS,
  PLATFORM_PROFILES,
  buildSystemPrompt,
  buildTranscriptContext,
  platformActions,
  platformProfile,
  quickAction,
};
