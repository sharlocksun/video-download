import { logoSvg } from '../assets/logo.mjs';

function escapeHtmlAttr(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function uiHtml(defaults = {}) {
  const defaultYtDlpPath = escapeHtmlAttr(defaults.ytDlpPath);
  const defaultFfmpegPath = escapeHtmlAttr(defaults.ffmpegPath);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>木辛说视频下载器</title>
  <style>
    :root {
      --ink: #20241f;
      --muted: #687266;
      --paper: #f3f5f0;
      --panel: #ffffff;
      --surface: #f7f9f5;
      --soft: #edf1e8;
      --line: #d9dece;
      --green: #52653e;
      --brown: #7b5636;
      --red: #c7342d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
      background: var(--paper);
    }
    .app { max-width: 1240px; margin: 0 auto; padding: 24px 28px 34px; }
    header { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; gap: 18px; align-items: center; margin-bottom: 18px; padding: 0 2px; }
    .brand-logo { width: 96px; height: 96px; display: block; }
    h1 { margin: 0 0 6px; font-size: 30px; line-height: 1.18; letter-spacing: 0; }
    .subtitle { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.65; max-width: 820px; }
    .app-controls { align-self: start; padding-top: 4px; }
    .app-quit { display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 12px; white-space: nowrap; }
    .app-quit .quit-icon { font-size: 19px; line-height: 1; font-weight: 400; }
    .layout { display: grid; grid-template-columns: minmax(520px, 1.18fr) minmax(360px, .82fr); gap: 16px; align-items: start; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 10px 28px rgba(45, 57, 40, .07); padding: 18px; }
    .panel h2 { margin: 0 0 14px; font-size: 18px; letter-spacing: 0; }
    label { display: block; margin: 14px 0 7px; font-size: 13px; color: #465044; font-weight: 700; }
    textarea, input, select { width: 100%; border: 1px solid #c8d1c2; border-radius: 6px; background: #ffffff; color: var(--ink); font: inherit; outline: none; }
    textarea { min-height: 156px; resize: vertical; padding: 12px; line-height: 1.6; }
    input, select { height: 42px; padding: 0 12px; }
    textarea:focus, input:focus, select:focus { border-color: var(--green); box-shadow: 0 0 0 3px rgba(82,101,62,.16); }
    .row { display: grid; grid-template-columns: 1fr 112px; gap: 10px; }
    .login-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
    .download-panel { padding: 0; overflow: hidden; }
    .download-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 18px 14px; border-bottom: 1px solid var(--line); background: var(--surface); }
    .download-head h2 { margin: 0 0 4px; }
    .download-head p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .source-pill { flex: 0 0 168px; }
    .download-body { display: grid; gap: 0; padding: 14px 16px 16px; }
    .form-block { border: 0; border-top: 1px solid var(--line); border-radius: 0; background: transparent; padding: 14px 2px 4px; }
    .download-body > .form-block:first-child { border-top: 0; padding-top: 0; }
    .form-block.compact { padding-top: 14px; }
    .form-block-title { margin: 0 0 8px; color: #2f3a31; font-size: 13px; font-weight: 800; }
    .download-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 10px; align-items: end; }
    .download-grid .wide { grid-column: 1 / -1; }
    .download-grid .half { grid-column: span 4; }
    .download-grid .quality-field { grid-column: span 8; }
    .quality-row { display: grid; grid-template-columns: minmax(0, 1fr) 90px; gap: 8px; align-items: end; }
    .quality-row select { min-width: 0; }
    .quality-row button { width: 100%; padding: 0 10px; }
    .download-panel textarea { min-height: 108px; }
    .download-panel label { margin-top: 8px; }
    .download-panel .hint { margin-top: 6px; }
    .download-actions { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 10px; align-items: center; margin-top: 14px; }
    .status-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .status-head h2 { margin: 0; }
    .status-head button { height: 32px; padding: 0 11px; font-size: 12px; }
    .status-panel { display: flex; flex-direction: column; position: sticky; top: 16px; padding: 16px; }
    .status-panel h2 { margin-bottom: 0; }
    .status-summary { padding: 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); }
    .status-summary-title { margin: 0 0 10px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .auth-box { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 12px 0 14px; margin-top: 12px; }
    .auth-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: end; }
    .auth-grid label { margin-top: 0; }
    .login-tools[hidden] { display: none; }
    .platform-tools[hidden] { display: none; }
    .login-status { border: 1px solid var(--line); border-radius: 8px; background: #fffefa; color: var(--muted); padding: 10px 12px; font-size: 13px; margin-top: 12px; }
    .login-status.ok { color: var(--green); border-color: #b9c9a4; }
    .check { display: flex; gap: 9px; align-items: center; color: #445041; margin: 14px 0; font-size: 14px; }
    .check input { width: 18px; height: 18px; accent-color: var(--green); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
    button { border: 0; border-radius: 8px; height: 42px; padding: 0 16px; font: inherit; font-weight: 700; cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .58; }
    .primary { background: var(--green); color: white; flex: 1 1 150px; }
    .secondary { background: var(--soft); color: #35452f; }
    .danger { background: #f4dad7; color: #8d2520; }
    .stop { background: #2f3a31; color: #fffaf0; }
    .status { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; overflow: hidden; border: 1px solid var(--line); border-radius: 6px; background: var(--line); }
    .metric { display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 7px; min-width: 0; padding: 9px 10px; background: #fff; }
    .metric strong { font-size: 20px; line-height: 1; color: var(--green); }
    .metric span { color: var(--muted); font-size: 12px; white-space: nowrap; }
    .progress-wrap { height: 7px; border-radius: 999px; background: #eadfdd; overflow: hidden; margin: 11px 0 0; }
    .progress { width: 0%; height: 100%; border-radius: inherit; background: #963a32; transition: width .2s ease; }
    .log-section { margin-top: 14px; overflow: hidden; border: 1px solid #354238; border-radius: 7px; background: #202a23; }
    .log-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 38px; padding: 0 12px; border-bottom: 1px solid rgba(255,255,255,.1); color: #e8eee5; font-size: 12px; font-weight: 700; }
    .log-live { display: inline-flex; align-items: center; gap: 6px; color: #aeb9aa; font-weight: 400; }
    .log-live::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #8fa875; box-shadow: 0 0 0 3px rgba(143,168,117,.13); }
    .log { height: clamp(300px, 42vh, 440px); min-height: 300px; max-height: 440px; overflow: auto; background: #202a23; color: #edf3e9; padding: 12px; font-family: Consolas, "Microsoft YaHei", monospace; font-size: 12px; line-height: 1.6; white-space: pre-wrap; scrollbar-color: #667362 #202a23; }
    #transcript { min-height: 300px; height: clamp(300px, 40vh, 440px); max-height: 440px; overflow-y: auto; resize: vertical; scrollbar-gutter: stable; }
    .hint { color: var(--muted); font-size: 12px; line-height: 1.6; margin: 10px 0 0; }
    .ai-panel { margin-top: 18px; padding: 0; overflow: hidden; }
    .ai-head { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .ai-head h2 { margin: 0; }
    .ai-head-controls { display: flex; gap: 8px; }
    .ai-head-controls button { height: 32px; padding: 0 11px; border: 1px solid var(--line); font-size: 12px; font-weight: 700; }
    .environment-panel { margin: 0 18px 14px; padding: 14px; border: 1px solid var(--line); border-radius: 7px; background: #f9fbf7; }
    .environment-panel[hidden] { display: none; }
    .environment-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
    .environment-head h3 { margin: 0; font-size: 15px; }
    .environment-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .environment-item { min-width: 0; padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
    .environment-item strong { display: block; margin-bottom: 3px; font-size: 12px; }
    .environment-item span { display: block; overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .environment-item.ok strong { color: var(--green); }
    .environment-item.missing strong { color: var(--red); }
    .environment-actions { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
    .environment-actions button { width: 100%; height: 36px; padding: 0 8px; font-size: 12px; }
    .component-progress { margin-top: 10px; }
    .component-progress .progress-wrap { margin: 0 0 6px; }
    .ai-settings { border: 1px solid var(--line); border-radius: 7px; padding: 12px 14px; background: #fffefa; margin-bottom: 14px; font-size: 13px; }
    .ai-settings label { margin-top: 10px; font-size: 12px; }
    .ai-settings input, .ai-settings select { height: 38px; font-size: 13px; }
    .ai-settings button { height: 36px; font-size: 13px; }
    .ai-settings[hidden] { display: none; }
    .ai-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 10px; }
    .setting-title { grid-column: 1 / -1; margin: 6px 0 0; padding-top: 8px; border-top: 1px solid var(--line); color: #2f3a31; font-size: 12px; font-weight: 800; }
    .ai-grid .setting-title:first-child { padding-top: 0; border-top: 0; }
    .ai-panel > .ai-head, .ai-panel > .hint, .ai-panel > .ai-settings { margin-left: 18px; margin-right: 18px; }
    .ai-panel > .ai-head { margin-top: 18px; }
    .ai-workspace { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: stretch; padding: 0 18px 18px; }
    .ai-column { min-width: 0; }
    .ai-input-column { display: flex; flex-direction: column; padding-right: 2px; }
    .ai-output-column { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; border-left: 1px solid var(--line); padding-left: 18px; }
    .tool-progress { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: #fffefa; margin-top: 12px; }
    .tool-progress .progress-wrap { height: 10px; margin: 0 0 8px; }
    .tool-progress[hidden] { display: none; }
    .advanced-tools { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
    .advanced-tools-title { margin: 0 0 9px; color: #465044; font-size: 13px; font-weight: 800; }
    .primary-flow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
    .primary-flow button { width: 100%; padding: 0 10px; }
    .primary-flow .primary { flex: initial; }
    .advanced-tools .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 0; }
    .advanced-tools .actions button { width: 100%; height: 42px; padding: 0 10px; font-size: inherit; font-weight: 700; }
    .quick-actions { margin: 10px 0 12px; }
    .template-section { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    .template-more { margin-top: 4px; }
    .template-more summary { cursor: pointer; color: #4a3b2a; font-size: 13px; font-weight: 800; margin-bottom: 8px; }
    .action-item { display: inline-flex; align-items: center; gap: 2px; border: 1px solid #e0d1b8; border-radius: 8px; background: #f7efdf; overflow: hidden; }
    .action-item.customized { border-color: #b9c9a4; background: #eef4e8; }
    .action-item button { height: 34px; padding: 0 10px; font-size: 13px; border-radius: 0; background: transparent; color: #4a3b2a; }
    .action-item .template-run { font-weight: 800; }
    .action-item .template-edit { width: 34px; padding: 0; border-left: 1px solid rgba(74,59,42,.16); }
    .prompt-editor { border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: #fffefa; margin: 8px 0 12px; }
    .prompt-editor[hidden] { display: none; }
    .prompt-editor textarea { min-height: 190px; font-size: 13px; }
    .template-head { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start; margin-bottom: 8px; }
    .template-toolbar { display: flex; justify-content: flex-end; margin: 0; }
    .template-toolbar button { height: 32px; padding: 0 10px; font-size: 12px; }
    .template-custom-title { margin: 8px 0; color: #4a3b2a; font-size: 13px; font-weight: 800; }
    .prompt-label-row { display: grid; grid-template-columns: 170px 1fr; gap: 10px; align-items: end; margin-bottom: 8px; }
    .prompt-label-row label { margin-top: 0; }
    .prompt-editor-title { margin: 0 0 8px; font-weight: 800; font-size: 13px; color: #2f3a31; }
    .prompt-editor-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 8px; }
    .prompt-editor-actions button { height: 32px; padding: 0 10px; font-size: 12px; }
    .platform-action-title { margin: 0 0 8px; color: var(--muted); font-size: 12px; line-height: 1.6; }
    .chat-window { flex: 1 1 0; height: 0; min-height: 500px; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; overscroll-behavior: contain; border: 1px solid #d7ddcc; border-radius: 6px; background: #f8fbf3; padding: 12px; }
    .message { margin: 0 0 10px; padding: 10px 12px; border-radius: 8px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
    .message.assistant { background: #eef4e8; border: 1px solid #d3dfc8; }
    .message.user { background: #f3eadb; border: 1px solid #e0d1b8; }
    .message.system { color: var(--muted); border: 1px dashed var(--line); background: transparent; }
    .chat-row { display: grid; grid-template-columns: 1fr 96px; gap: 10px; margin-top: 10px; align-items: end; }
    .chat-row textarea { min-height: 72px; }
    .ai-status { min-height: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin-top: 8px; }
    .mini-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin: 8px 0; }
    .mini-actions button { height: 32px; padding: 0 10px; font-size: 12px; }
    @media (max-width: 880px) {
      .app { padding: 18px; }
      header { grid-template-columns: 72px minmax(0, 1fr) auto; gap: 12px; }
      .brand-logo { width: 72px; height: 72px; }
      h1 { font-size: 25px; }
      .layout { grid-template-columns: 1fr; }
      .status { grid-template-columns: 1fr; }
      .row, .login-row, .auth-grid, .ai-grid, .environment-grid, .environment-actions, .ai-workspace, .chat-row, .download-grid, .download-actions, .prompt-label-row, .template-head, .quality-row, .primary-flow, .advanced-tools .actions { grid-template-columns: 1fr; }
      .download-grid .half, .download-grid .quality-field { grid-column: 1 / -1; }
      .app-quit { width: 40px; padding: 0; justify-content: center; }
      .app-quit .quit-label { display: none; }
      .status-panel { position: static; }
      .ai-output-column { border-left: 0; border-top: 1px solid var(--line); padding-left: 0; padding-top: 16px; }
      .download-head { align-items: stretch; flex-direction: column; }
      .source-pill { flex-basis: auto; }
      .log { height: 320px; min-height: 320px; max-height: 320px; }
      #transcript { height: 320px; min-height: 320px; max-height: 400px; }
      .chat-window { height: 480px; min-height: 480px; max-height: 480px; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header>
      ${logoSvg()}
      <div class="brand-copy">
        <h1>木辛说视频下载器</h1>
        <p class="subtitle">选择视频来源后粘贴链接。当前支持抖音、Bilibili、YouTube、快手、小红书、TikTok 和 Instagram，请只下载你有权保存和使用的视频。</p>
      </div>
      <div class="app-controls">
        <button class="danger app-quit" type="button" id="quit" title="关闭程序" aria-label="关闭程序"><span class="quit-icon" aria-hidden="true">&times;</span><span class="quit-label">退出程序</span></button>
      </div>
    </header>
    <section class="layout">
      <form class="panel download-panel" id="download-form">
        <div class="download-head">
          <div>
            <h2>下载任务</h2>
            <p>选择平台，粘贴链接，画质和输出规则可按需调整。</p>
          </div>
          <div class="source-pill">
            <label for="platform">视频来源</label>
            <select id="platform">
              <option value="bilibili">Bilibili</option>
              <option value="douyin">抖音</option>
              <option value="youtube">YouTube</option>
              <option value="kuaishou">快手</option>
              <option value="xiaohongshu">小红书</option>
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
            </select>
          </div>
        </div>
        <div class="download-body">
          <div class="form-block">
            <p class="form-block-title">视频链接</p>
            <textarea id="urls" placeholder="每行一个链接，支持批量下载"></textarea>
          </div>

          <div class="form-block compact login-tools" id="bili-tools" hidden>
            <p class="form-block-title">Bilibili 高码率</p>
            <div class="login-status" id="bili-status">Bilibili：高码率未登录</div>
            <div class="login-row">
              <button class="secondary" type="button" id="bili-login">高码率登录</button>
              <button class="secondary" type="button" id="bili-check">读取登录状态</button>
            </div>
            <p class="hint">普通下载不需要登录；需要 1080P+、高码率或 4K 时再登录。</p>
          </div>

          <div class="form-block compact platform-tools" id="youtube-tools" hidden>
            <p class="form-block-title">平台下载工具</p>
            <label for="ytDlpPath">yt-dlp 路径</label>
            <input id="ytDlpPath" value="${defaultYtDlpPath}" placeholder="可留空自动识别；也可填写 yt-dlp 可执行文件或所在文件夹">
            <p class="hint">安装版默认使用程序内置的 yt-dlp。</p>
            <div class="auth-box" id="youtube-auth-tools">
              <div class="auth-grid">
                <div>
                  <label for="youtubeAuth" id="platform-auth-label">YouTube 登录来源</label>
                  <select id="youtubeAuth">
                    <option value="none">不使用登录状态</option>
                    <option value="app">本程序登录窗口</option>
                  </select>
                </div>
                <div>
                  <label for="youtubeLoginBrowser">打开登录窗口使用</label>
                  <select id="youtubeLoginBrowser">
                    <option value="chrome">Chrome</option>
                    <option value="edge">Edge</option>
                    <option value="firefox">Firefox</option>
                  </select>
                </div>
              </div>
              <div class="login-status" id="youtube-status">YouTube：未读取登录状态</div>
              <div class="login-row">
                <button class="secondary" type="button" id="youtube-login">打开 YouTube 登录</button>
                <button class="secondary" type="button" id="youtube-check">确认登录来源</button>
              </div>
              <p class="hint">默认不使用登录状态；需要高画质或遇到验证时再登录。</p>
            </div>
          </div>

          <div class="form-block">
            <p class="form-block-title">输出设置</p>
            <div class="download-grid">
              <div class="wide">
                <label for="outDir">保存目录路径</label>
                <input id="outDir" value="videos" placeholder="例如 D:\\视频\\木辛说 或 videos">
                <p class="hint">相对路径会以程序所在目录为基准。</p>
              </div>
              <div class="wide">
                <label for="nameTemplate">文件名规则 / 模板</label>
                <input id="nameTemplate" value="%title%_%id%.mp4" placeholder="%title%_%id%.mp4">
                <p class="hint">可用：%title%、%id%、%date%。多条链接使用固定名称时会自动追加 _%id%。</p>
              </div>
              <div class="half">
                <label for="timeout">超时秒数</label>
                <input id="timeout" type="number" min="30" value="180">
              </div>
              <div class="quality-field">
                <label for="quality">画质偏好</label>
                <div class="quality-row">
                  <select id="quality">
                    <option value="best">最佳可用画质</option>
                    <option value="4k">4K / 2160P</option>
                    <option value="2k">2K / 1440P</option>
                    <option value="1080p+">1080P+ / 高码率</option>
                    <option value="1080">1080P</option>
                    <option value="720">720P</option>
                    <option value="540">540P</option>
                    <option value="480">480P</option>
                    <option value="360">360P</option>
                    <option value="lowest">最小文件</option>
                  </select>
                  <button class="secondary" type="button" id="detect-quality">识别</button>
                </div>
              </div>
              <div class="wide platform-tools" id="merge-tools">
                <label for="ffmpegPath">ffmpeg 路径</label>
                <input id="ffmpegPath" value="${defaultFfmpegPath}" placeholder="可填写 ffmpeg 可执行文件，或包含 ffmpeg 的文件夹">
                <p class="hint">安装版默认使用程序内置的 FFmpeg。</p>
              </div>
            </div>
            <p class="hint" id="quality-status">粘贴链接后可先识别真实可用画质；如果多条链接画质不同，会按所选偏好自动匹配。</p>
            <label class="check"><input id="overwrite" type="checkbox"> 覆盖同名文件</label>
          </div>

          <div class="download-actions">
            <button class="primary" type="submit">开始下载</button>
            <button class="stop" type="button" id="cancel-download" disabled>终止下载</button>
          </div>
        </div>
      </form>
      <section class="panel status-panel">
        <div class="status-head">
          <h2>状态</h2>
          <button class="secondary" type="button" id="clear-log" title="清空当前日志内容">清空日志</button>
        </div>
        <div class="status-summary">
          <p class="status-summary-title">任务概览</p>
          <div class="status">
            <div class="metric"><strong id="queued">0</strong><span>等待</span></div>
            <div class="metric"><strong id="done">0</strong><span>完成</span></div>
            <div class="metric"><strong id="failed">0</strong><span>失败</span></div>
          </div>
          <div class="progress-wrap"><div class="progress" id="progress"></div></div>
        </div>
        <div class="log-section">
          <div class="log-head"><span>任务日志</span><span class="log-live">自动滚动</span></div>
          <div class="log" id="log"></div>
        </div>
      </section>
    </section>
    <section class="panel ai-panel">
      <div class="ai-head">
        <h2>内容创作助手</h2>
        <div class="ai-head-controls">
          <button class="secondary" type="button" id="environment-toggle">环境与组件</button>
          <button class="secondary" type="button" id="ai-settings-toggle">AI 设置</button>
        </div>
      </div>
      <p class="hint">本地分析不需要 API；智能总结、平台化改写和实时对话需要先配置模型接口。平台侧重点会随目标发布平台自动调整。</p>
      <section class="environment-panel" id="environment-panel" hidden>
        <div class="environment-head"><h3>环境与组件</h3><span class="hint" id="environment-summary">正在检测...</span></div>
        <div class="environment-grid" id="environment-grid"></div>
        <div class="environment-actions">
          <button class="primary" type="button" id="install-whisper-small">安装 small</button>
          <button class="secondary" type="button" id="install-whisper-medium">安装 medium</button>
          <button class="secondary" type="button" id="install-whisper-large">安装 large-v3</button>
          <button class="secondary" type="button" id="install-whisper-gpu">安装 GPU 加速</button>
          <button class="secondary" type="button" id="refresh-environment">重新检测</button>
          <button class="secondary" type="button" id="check-update">检查更新</button>
        </div>
        <div class="component-progress" id="component-progress" hidden><div class="progress-wrap"><div class="progress" id="component-progress-bar"></div></div><div class="ai-status" id="component-progress-text"></div></div>
      </section>
      <div class="ai-settings" id="ai-settings" hidden>
        <div class="ai-grid">
          <div class="setting-title">AI 分析接口</div>
          <div>
            <label for="aiProvider">接口类型</label>
            <select id="aiProvider">
              <option value="openai-compatible">OpenAI 兼容 / 中转站</option>
              <option value="gemini">Gemini</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>
          <div>
            <label for="aiModel">模型名称</label>
            <input id="aiModel" placeholder="例如 gpt-4.1-mini、deepseek-chat、gemini-1.5-pro">
          </div>
          <div>
            <label for="aiBaseUrl">API 地址</label>
            <input id="aiBaseUrl" placeholder="例如 https://api.example.com/v1">
          </div>
          <div>
            <label for="aiApiKey">API Key</label>
            <input id="aiApiKey" type="password" autocomplete="off" placeholder="留空保存时会沿用已保存密钥">
          </div>
          <div>
            <label for="aiTemperature">创造性</label>
            <input id="aiTemperature" type="number" min="0" max="2" step="0.1" value="0.6">
          </div>
          <div>
            <label for="aiMaxTokens">最大输出</label>
            <input id="aiMaxTokens" type="number" min="256" max="8000" step="128" value="1800">
          </div>
          <div>
            <label for="aiTimeoutSeconds">生成超时（秒）</label>
            <input id="aiTimeoutSeconds" type="number" min="30" max="600" step="30" value="180">
          </div>
          <div class="setting-title">本地 Whisper 转写</div>
          <div>
            <label for="whisperEngine">转写引擎</label>
            <select id="whisperEngine" title="自动选择会优先检测下方用户配置的 Whisper，失败后再使用内置 whisper.cpp CPU。">
              <option value="auto">自动选择（优先用户配置）</option>
              <option value="python">用户配置的 Python Whisper / CUDA</option>
              <option value="whisper-cpp-vulkan">whisper.cpp Vulkan GPU</option>
              <option value="whisper-cpp-cpu">内置 whisper.cpp CPU</option>
            </select>
          </div>
          <div>
            <label for="whisperPath">本地 Whisper 路径</label>
            <input id="whisperPath" placeholder="由环境与组件自动配置；也可填写已有 Whisper 路径">
          </div>
          <div>
            <label for="whisperModel">Whisper 模型</label>
            <select id="whisperModel">
              <option value="small">small（约 465 MB，推荐）</option>
              <option value="medium">medium（约 1.5 GB，更准确）</option>
              <option value="large-v3">large-v3（约 3.0 GB，效果优先）</option>
            </select>
          </div>
          <div>
            <label for="whisperLanguage">识别语言</label>
            <select id="whisperLanguage">
              <option value="auto">自动识别中文/英文</option>
              <option value="zh">中文</option>
              <option value="en">英文</option>
            </select>
          </div>
          <div class="setting-title">视频文字偏好</div>
          <div>
            <label for="transcriptLanguage">字幕获取优先级</label>
            <select id="transcriptLanguage">
              <option value="zh-first">优先中文，找不到再用英文</option>
              <option value="en-first">优先英文，找不到再用中文</option>
              <option value="zh-only">优先中文字幕，必要时用英文翻译</option>
              <option value="en-only">只要英文字幕</option>
              <option value="all">下载平台可用的全部字幕</option>
            </select>
          </div>
          <div>
            <label for="transcriptScript">最终输出格式</label>
            <select id="transcriptScript">
              <option value="simplified">简体中文（英文会用 AI 翻译）</option>
              <option value="bilingual">中英双语</option>
              <option value="original">保持字幕原文</option>
            </select>
          </div>
        </div>
        <div class="actions">
          <button class="primary" type="button" id="ai-save">保存配置</button>
          <button class="secondary" type="button" id="ai-test">测试连接</button>
        </div>
        <div class="ai-status" id="ai-config-status"></div>
      </div>
      <div class="ai-workspace">
        <div class="ai-column ai-input-column">
          <label for="aiPlatform">目标发布平台</label>
          <select id="aiPlatform">
            <option value="general">通用分析</option>
            <option value="douyin">抖音</option>
            <option value="bilibili">Bilibili</option>
            <option value="youtube">YouTube</option>
            <option value="xiaohongshu">小红书</option>
            <option value="kuaishou">快手</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
          </select>
          <label for="aiSourceUrl">参考视频链接</label>
          <input id="aiSourceUrl" placeholder="可粘贴下载链接，方便 AI 对应上下文">
          <label for="aiLocalMediaPath">已下载视频 / 音频路径</label>
          <input id="aiLocalMediaPath" placeholder="例如 D:\\视频\\xxx.mp4；原链接无字幕时可从音轨转文字">
          <label for="transcript">字幕 / 转写稿 / 视频内容</label>
          <textarea id="transcript" placeholder="把字幕、转写稿或自己整理的视频内容粘贴到这里。"></textarea>
          <div class="mini-actions">
            <button class="secondary" type="button" id="ai-clear-transcript" title="清空左侧字幕/转写稿文本，不会删除已保存文件。">清空字幕框</button>
          </div>
          <div class="actions primary-flow">
            <button class="primary" type="button" id="ai-get-video-text" title="自动尝试平台字幕、内嵌字幕和本地 Whisper，拿到视频文字并保存到对应资料夹。">获取视频文字</button>
            <button class="secondary" type="button" id="ai-save-transcript" title="把当前字幕框里的最终版本导出为 txt、srt、vtt 和时间轴文件。">导出整理稿</button>
            <button class="secondary" type="button" id="ai-use-last-output" title="把最近一次下载完成的视频路径填入本地视频路径框。">最近下载</button>
            <button class="secondary" type="button" id="ai-local-analyze" title="不调用 API，对字幕做本地关键词、结构和要点分析。">本地分析</button>
          </div>
          <div class="tool-progress" id="ai-progress-box" hidden>
            <div class="progress-wrap"><div class="progress" id="ai-progress"></div></div>
            <div class="ai-status" id="ai-progress-text">等待开始</div>
          </div>
          <p class="hint">点击“获取视频文字”后会自动尝试：先找平台已有字幕；失败后检查已下载视频；仍没有字幕时再用本地 Whisper 从声音转文字。生成的 txt、srt、vtt 会保存到该视频旁边的独立资料夹。</p>
          <div class="advanced-tools">
            <p class="advanced-tools-title">高级工具</p>
            <div class="actions">
              <button class="secondary" type="button" id="ai-extract-subtitles" title="只尝试下载平台公开字幕。YouTube 成功率较高，其他平台常常没有。">只提取平台字幕</button>
              <button class="secondary" type="button" id="ai-extract-embedded-subtitles" title="从本地视频文件里的字幕轨道导出字幕，不识别画面硬字幕。">只提取内嵌字幕</button>
              <button class="secondary" type="button" id="ai-transcribe-local" title="用本地 Whisper 从视频/音频声音中识别文字，有 GPU 时自动使用 GPU。">Whisper 转文字</button>
              <button class="secondary" type="button" id="ai-extract-audio" title="从本地视频中提取音频，保存到该视频资料夹的 audio 子目录。">提取音频</button>
              <button class="secondary" type="button" id="ai-clean-transcript" title="去掉时间戳、编号、标签和重复行，把当前文本整理成适合分析和创作的文稿。">整理文稿</button>
              <button class="secondary" type="button" id="ai-fix-transcript" title="调用已配置 API 修正 Whisper 小模型带来的错字、断句和标点问题。">AI 修正字幕</button>
            </div>
          </div>
        </div>
        <div class="ai-column ai-output-column">
          <div class="template-head">
            <p class="platform-action-title" id="ai-action-title">选择目标发布平台后，这里会显示对应的创作模板。</p>
            <div class="template-toolbar">
              <button class="secondary" type="button" id="ai-add-custom-action" title="新增一个自己的创作按钮，填写按钮标签和提示词后会保存在本地。">新增自定义模板</button>
            </div>
          </div>
          <div class="quick-actions" id="ai-quick-actions"></div>
          <div class="prompt-editor" id="ai-prompt-editor" hidden>
            <p class="prompt-editor-title" id="ai-prompt-editor-title">编辑创作模板</p>
            <div class="prompt-label-row">
              <div>
                <label for="ai-prompt-editor-label">按钮标签</label>
                <input id="ai-prompt-editor-label" placeholder="例如 爆款标题">
              </div>
              <p class="hint">标签会显示成右侧的一键生成按钮；提示词决定点击后让 AI 做什么。</p>
            </div>
            <textarea id="ai-prompt-editor-text"></textarea>
            <div class="prompt-editor-actions">
              <button class="danger" type="button" id="ai-prompt-delete">删除模板</button>
              <button class="secondary" type="button" id="ai-prompt-reset">恢复默认</button>
              <button class="secondary" type="button" id="ai-prompt-cancel">取消</button>
              <button class="primary" type="button" id="ai-prompt-save">保存模板</button>
            </div>
          </div>
          <div class="chat-window" id="ai-messages">
            <div class="message system">先粘贴字幕或转写稿。没有 API 时可以点“本地分析”；配置 API 后可以直接追问、改写和生成平台化创作方案。</div>
          </div>
          <div class="mini-actions">
            <button class="secondary" type="button" id="ai-export-chat" title="把当前创作内容同时导出为 Markdown 和 TXT，保存到该视频/链接的 ai 资料夹。">导出创作内容</button>
            <button class="secondary" type="button" id="ai-clear-chat" title="清空右侧 AI 对话和输入框，不会清空字幕、链接和设置。">清空创作记录</button>
          </div>
          <div class="chat-row">
            <textarea id="aiPrompt" placeholder="输入想追问的问题，例如：帮我改成适合小红书的三段式笔记。"></textarea>
            <button class="primary" type="button" id="ai-send">发送</button>
          </div>
          <div class="ai-status" id="ai-chat-status"></div>
        </div>
      </div>
    </section>
  </main>
  <script>
    const logEl = document.getElementById('log');
    const urlsEl = document.getElementById('urls');
    const progressEl = document.getElementById('progress');
    const queuedEl = document.getElementById('queued');
    const doneEl = document.getElementById('done');
    const failedEl = document.getElementById('failed');
    const platformEl = document.getElementById('platform');
    const qualityEl = document.getElementById('quality');
    const qualityStatusEl = document.getElementById('quality-status');
    const biliToolsEl = document.getElementById('bili-tools');
    const youtubeToolsEl = document.getElementById('youtube-tools');
    const youtubeAuthToolsEl = document.getElementById('youtube-auth-tools');
    const platformAuthLabelEl = document.getElementById('platform-auth-label');
    const mergeToolsEl = document.getElementById('merge-tools');
    const biliStatusEl = document.getElementById('bili-status');
    const youtubeStatusEl = document.getElementById('youtube-status');
    const youtubeAuthEl = document.getElementById('youtubeAuth');
    const youtubeLoginBrowserEl = document.getElementById('youtubeLoginBrowser');
    const cancelDownloadEl = document.getElementById('cancel-download');
    const aiSettingsEl = document.getElementById('ai-settings');
    const environmentPanelEl = document.getElementById('environment-panel');
    const environmentGridEl = document.getElementById('environment-grid');
    const environmentSummaryEl = document.getElementById('environment-summary');
    const componentProgressEl = document.getElementById('component-progress');
    const componentProgressBarEl = document.getElementById('component-progress-bar');
    const componentProgressTextEl = document.getElementById('component-progress-text');
    const installWhisperGpuEl = document.getElementById('install-whisper-gpu');
    const aiConfigStatusEl = document.getElementById('ai-config-status');
    const aiChatStatusEl = document.getElementById('ai-chat-status');
    const aiMessagesEl = document.getElementById('ai-messages');
    const aiPromptEl = document.getElementById('aiPrompt');
    const transcriptEl = document.getElementById('transcript');
    const aiPlatformEl = document.getElementById('aiPlatform');
    const aiSourceUrlEl = document.getElementById('aiSourceUrl');
    const aiLocalMediaPathEl = document.getElementById('aiLocalMediaPath');
    const aiProgressBoxEl = document.getElementById('ai-progress-box');
    const aiProgressEl = document.getElementById('ai-progress');
    const aiProgressTextEl = document.getElementById('ai-progress-text');
    const aiQuickActionsEl = document.getElementById('ai-quick-actions');
    const aiActionTitleEl = document.getElementById('ai-action-title');
    const aiPromptEditorEl = document.getElementById('ai-prompt-editor');
    const aiPromptEditorTitleEl = document.getElementById('ai-prompt-editor-title');
    const aiPromptEditorLabelEl = document.getElementById('ai-prompt-editor-label');
    const aiPromptEditorTextEl = document.getElementById('ai-prompt-editor-text');
    const aiHistory = [];
    const state = { queued: 0, done: 0, failed: 0, running: false, stopping: false, lastOutput: '', aiActions: [], editingAction: null, lastTranscriptVariants: null };
    const platformLoginStatus = {
      youtube: { loggedIn: false, hasCookie: false },
      instagram: { loggedIn: false, hasCookie: false },
    };

    function appendLog(text) {
      const time = new Date().toLocaleTimeString();
      logEl.textContent += '[' + time + '] ' + text + '\\n';
      logEl.scrollTop = logEl.scrollHeight;
    }
    function updateMetrics() {
      queuedEl.textContent = state.queued;
      doneEl.textContent = state.done;
      failedEl.textContent = state.failed;
      cancelDownloadEl.disabled = !(state.running || state.queued) || state.stopping;
      cancelDownloadEl.textContent = state.stopping ? '正在终止' : '终止下载';
    }
    function setProgress(percent) {
      progressEl.style.width = Math.max(0, Math.min(100, percent || 0)) + '%';
    }
    function setAiProgress(percent, message) {
      aiProgressBoxEl.hidden = false;
      aiProgressEl.style.width = Math.max(0, Math.min(100, percent || 0)) + '%';
      aiProgressTextEl.textContent = message || '正在处理...';
    }
    function resetAiProgress(message) {
      aiProgressBoxEl.hidden = !message;
      aiProgressEl.style.width = '0%';
      aiProgressTextEl.textContent = message || '等待开始';
    }
    function setQualityOptions(options) {
      const previous = qualityEl.value;
      qualityEl.innerHTML = '';
      for (const option of options || []) {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = option.label;
        qualityEl.appendChild(item);
      }
      if ([...qualityEl.options].some((item) => item.value === previous)) {
        qualityEl.value = previous;
      }
    }
    function aiConfigPayload() {
      return {
        provider: document.getElementById('aiProvider').value,
        baseUrl: document.getElementById('aiBaseUrl').value.trim(),
        apiKey: document.getElementById('aiApiKey').value.trim(),
        model: document.getElementById('aiModel').value.trim(),
        transcriptionMode: 'whisper',
        whisperEngine: document.getElementById('whisperEngine').value,
        whisperPath: document.getElementById('whisperPath').value.trim(),
        whisperModel: document.getElementById('whisperModel').value,
        whisperLanguage: document.getElementById('whisperLanguage').value,
        transcriptLanguage: document.getElementById('transcriptLanguage').value,
        transcriptScript: document.getElementById('transcriptScript').value,
        aiTimeoutSeconds: Number(document.getElementById('aiTimeoutSeconds').value) || 180,
        temperature: Number(document.getElementById('aiTemperature').value) || 0.6,
        maxTokens: Number(document.getElementById('aiMaxTokens').value) || 1800,
      };
    }
    function transcriptPreferencePayload() {
      return {
        transcriptLanguage: document.getElementById('transcriptLanguage').value,
        transcriptScript: document.getElementById('transcriptScript').value,
      };
    }
    function applyAiConfig(config) {
      if (!config) return;
      document.getElementById('aiProvider').value = config.provider || 'openai-compatible';
      document.getElementById('aiBaseUrl').value = config.baseUrl || '';
      document.getElementById('aiModel').value = config.model || '';
      document.getElementById('whisperEngine').value = config.whisperEngine === 'whisper-cpp' ? 'whisper-cpp-cpu' : (config.whisperEngine || 'auto');
      document.getElementById('whisperPath').value = config.whisperPath || '';
      const savedWhisperModel = config.whisperModel || 'small';
      document.getElementById('whisperModel').value = savedWhisperModel === 'large' ? 'large-v3' : ['small', 'medium', 'large-v3'].includes(savedWhisperModel) ? savedWhisperModel : 'small';
      document.getElementById('whisperLanguage').value = config.whisperLanguage || 'auto';
      document.getElementById('transcriptLanguage').value = config.transcriptLanguage || 'zh-first';
      document.getElementById('transcriptScript').value = config.transcriptScript || 'simplified';
      document.getElementById('aiTimeoutSeconds').value = config.aiTimeoutSeconds ?? 180;
      document.getElementById('aiTemperature').value = config.temperature ?? 0.6;
      document.getElementById('aiMaxTokens').value = config.maxTokens ?? 1800;
      document.getElementById('aiApiKey').placeholder = config.hasApiKey ? '已保存密钥；留空则继续沿用' : '请输入 API Key';
      aiConfigStatusEl.textContent = config.hasApiKey ? '已保存 API Key。' : '尚未保存 API Key；本地分析仍可使用。';
    }
    function formatBytes(value) {
      const bytes = Number(value || 0);
      if (!bytes) return '未知';
      if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GB';
      return Math.round(bytes / 1024 ** 2) + ' MB';
    }
    function environmentCard(label, ok, detail) {
      return '<div class="environment-item ' + (ok ? 'ok' : 'missing') + '"><strong>' + (ok ? '可用 · ' : '缺失 · ') + label + '</strong><span title="' + String(detail || '').replaceAll('"', '&quot;') + '">' + (detail || '需要安装或修复') + '</span></div>';
    }
    async function loadEnvironment() {
      environmentSummaryEl.textContent = '正在检测本机环境...';
      try {
        const response = await fetch('/api/environment');
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || '检测失败');
        const env = result.environment;
        const engine = env.components.whisperVulkan?.installed ? env.components.whisperVulkan : env.components.whisperCpu;
        const installedModels = [
          env.components.whisperSmall?.valid ? 'small' : '',
          env.components.whisperMedium?.valid ? 'medium' : '',
          env.components.whisperLargeV3?.valid ? 'large-v3' : '',
        ].filter(Boolean);
        environmentGridEl.innerHTML = [
          environmentCard('浏览器', env.tools.browser.ok, env.tools.browser.path),
          environmentCard('yt-dlp', env.tools.ytDlp.ok, env.tools.ytDlp.version || env.tools.ytDlp.path),
          environmentCard('FFmpeg', env.tools.ffmpeg.ok, env.tools.ffmpeg.version || env.tools.ffmpeg.path),
          environmentCard('Deno', env.tools.javascript.ok, env.tools.javascript.version || env.tools.javascript.path),
          environmentCard('GPU', env.gpu.available, env.gpu.name || '将使用 CPU'),
          environmentCard('Whisper 引擎', Boolean(engine?.installed), engine?.installed ? (engine.id === 'whisperVulkan' ? 'Vulkan GPU 版' : 'CPU 版') : '首次使用时可一键安装'),
          environmentCard('Whisper 模型', installedModels.length > 0, installedModels.length ? '已安装：' + installedModels.join('、') : '可选 small / medium / large-v3'),
          environmentCard('组件磁盘空间', env.disk.freeBytes > 2 * 1024 ** 3, '可用 ' + formatBytes(env.disk.freeBytes)),
        ].join('');
        environmentSummaryEl.textContent = engine?.installed && installedModels.length ? '本地转写已就绪' : '下载功能可用；Whisper 为可选组件';
        const gpuComponentAvailable = env.components.whisperVulkan?.available !== false;
        installWhisperGpuEl.disabled = !env.gpu.vulkan || !gpuComponentAvailable || Boolean(env.components.whisperVulkan?.installed);
        installWhisperGpuEl.textContent = env.components.whisperVulkan?.installed ? 'GPU 加速已安装' : !env.gpu.vulkan ? '虚拟机 / 无 Vulkan GPU' : !gpuComponentAvailable ? 'GPU 组件待发布' : '安装 GPU 加速';
        if (!document.getElementById('whisperPath').value.trim()) document.getElementById('whisperPath').value = env.paths.whisper;
        return env;
      } catch (error) {
        environmentSummaryEl.textContent = '环境检测失败：' + error.message;
        return null;
      }
    }
    async function installWhisper(model) {
      environmentPanelEl.hidden = false;
      componentProgressEl.hidden = false;
      componentProgressBarEl.style.width = '0%';
      componentProgressTextEl.textContent = '正在准备 Whisper 组件...';
      try {
        const response = await fetch('/api/components/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'whisper-auto', model }) });
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || '组件安装失败');
        componentProgressBarEl.style.width = '100%';
        componentProgressTextEl.textContent = 'Whisper ' + model + ' 安装完成，之后可离线转写。';
        await loadEnvironment();
        return true;
      } catch (error) {
        componentProgressTextEl.textContent = '安装失败：' + error.message + '。可再次点击继续下载。';
        return false;
      }
    }
    async function installGpuAcceleration() {
      environmentPanelEl.hidden = false;
      componentProgressEl.hidden = false;
      componentProgressBarEl.style.width = '0%';
      componentProgressTextEl.textContent = '正在下载 whisper.cpp Vulkan GPU 引擎...';
      try {
        const response = await fetch('/api/components/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'whisperVulkan' }) });
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || 'GPU 组件安装失败');
        componentProgressBarEl.style.width = '100%';
        componentProgressTextEl.textContent = 'GPU 加速安装完成；转写时会优先使用 GPU，失败自动切换 CPU。';
        await loadEnvironment();
      } catch (error) {
        componentProgressTextEl.textContent = 'GPU 加速安装失败：' + error.message;
      }
    }    function shouldAutoScrollAiMessages() {
      return aiMessagesEl.scrollHeight - aiMessagesEl.scrollTop - aiMessagesEl.clientHeight < 96;
    }
    function scrollAiMessagesIfNeeded(shouldScroll) {
      if (shouldScroll) aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight;
    }
    function appendAiMessage(role, text, options = {}) {
      const shouldScroll = options.forceScroll ?? shouldAutoScrollAiMessages();
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = text;
      if (options.exportable === false) div.dataset.exportable = 'false';
      aiMessagesEl.appendChild(div);
      scrollAiMessagesIfNeeded(shouldScroll);
      return div;
    }
    function defaultSaveHint(kind) {
      const filePath = aiLocalMediaPathEl.value.trim() || state.lastOutput;
      const sourceUrl = aiSourceUrlEl.value.trim() || urlsEl.value.split(/\\r?\\n/).map((item) => item.trim()).find(Boolean) || '';
      if (filePath) return '默认保存到该视频旁边的 _assets\\\\' + kind + ' 资料夹。';
      if (sourceUrl) return '默认保存到 videos\\\\_analysis\\\\平台_视频ID\\\\' + kind + ' 资料夹。';
      return '默认保存到 videos\\\\_analysis\\\\manual\\\\' + kind + ' 资料夹。';
    }
    function askSaveOptions(kind, actionText) {
      const message = actionText + '\\n\\n' + defaultSaveHint(kind) + '\\n\\n如需自定义资料夹，请在下面输入完整路径；直接确定则使用默认位置；取消则不保存。';
      const outDir = window.prompt(message, '');
      if (outDir === null) return null;
      return outDir.trim();
    }
    async function loadAiActions() {
      const platform = aiPlatformEl.value || 'general';
      aiActionTitleEl.textContent = '正在读取该平台的创作模板...';
      try {
        const response = await fetch('/api/ai/actions?platform=' + encodeURIComponent(platform));
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || '读取失败');
        state.aiActions = result.actions || [];
        renderAiActions();
        closePromptEditor();
        aiActionTitleEl.textContent = '当前平台：' + aiPlatformEl.options[aiPlatformEl.selectedIndex].textContent + '，可直接生成发布包或继续追问。';
      } catch (error) {
        aiActionTitleEl.textContent = '创作模板读取失败：' + error.message;
      }
    }
    function createActionItem(action) {
      const item = document.createElement('span');
      item.className = 'action-item' + (action.customized ? ' customized' : '');
      item.title = action.customized ? '已使用自定义提示词' : '使用内置提示词';

      const runButton = document.createElement('button');
      runButton.type = 'button';
      runButton.className = 'template-run';
      runButton.dataset.action = action.id;
      runButton.dataset.label = action.label;
      runButton.textContent = action.label + (action.customized ? ' *' : '');
      runButton.title = action.prompt || action.label;

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'template-edit';
      editButton.dataset.editAction = action.id;
      editButton.textContent = '改';
      editButton.title = '编辑这个创作模板的提示词';

      item.append(runButton, editButton);
      return item;
    }
    function renderAiActions() {
      aiQuickActionsEl.innerHTML = '';
      const core = state.aiActions.filter((action) => action.group !== 'more');
      const more = state.aiActions.filter((action) => action.group === 'more');
      const custom = state.aiActions.filter((action) => action.group === 'custom' || action.custom);
      const builtInCore = core.filter((action) => !(action.group === 'custom' || action.custom));
      const coreWrap = document.createElement('div');
      coreWrap.className = 'template-section';
      for (const action of builtInCore) coreWrap.appendChild(createActionItem(action));
      aiQuickActionsEl.appendChild(coreWrap);
      if (more.length) {
        const details = document.createElement('details');
        details.className = 'template-more';
        const summary = document.createElement('summary');
        summary.textContent = '更多创作模板';
        const moreWrap = document.createElement('div');
        moreWrap.className = 'template-section';
        for (const action of more) moreWrap.appendChild(createActionItem(action));
        details.append(summary, moreWrap);
        aiQuickActionsEl.appendChild(details);
      }
      if (custom.length) {
        const customTitle = document.createElement('p');
        customTitle.className = 'template-custom-title';
        customTitle.textContent = '我的模板';
        const customWrap = document.createElement('div');
        customWrap.className = 'template-section';
        for (const action of custom) customWrap.appendChild(createActionItem(action));
        aiQuickActionsEl.append(customTitle, customWrap);
      }
    }
    function currentEditingAction() {
      return state.aiActions.find((action) => action.id === state.editingAction) || null;
    }
    function setPromptEditorMode(action) {
      const isNew = state.editingAction === '__new__';
      const isCustom = Boolean(action?.custom || isNew);
      aiPromptEditorLabelEl.disabled = !isCustom;
      document.getElementById('ai-prompt-reset').hidden = isCustom;
      document.getElementById('ai-prompt-delete').hidden = !action?.custom;
    }
    function openNewPromptEditor() {
      state.editingAction = '__new__';
      aiPromptEditorTitleEl.textContent = '新增自定义模板';
      aiPromptEditorLabelEl.value = '';
      aiPromptEditorTextEl.value = '';
      setPromptEditorMode(null);
      aiPromptEditorEl.hidden = false;
      aiPromptEditorLabelEl.focus();
    }
    function openPromptEditor(actionId) {
      const action = state.aiActions.find((item) => item.id === actionId);
      if (!action) return;
      state.editingAction = action.id;
      aiPromptEditorTitleEl.textContent = '编辑模板：' + action.label + (action.custom ? '（自定义）' : action.customized ? '（已自定义）' : '');
      aiPromptEditorLabelEl.value = action.label || '';
      aiPromptEditorTextEl.value = action.prompt || action.defaultPrompt || '';
      setPromptEditorMode(action);
      aiPromptEditorEl.hidden = false;
      (action.custom ? aiPromptEditorLabelEl : aiPromptEditorTextEl).focus();
    }
    function closePromptEditor() {
      state.editingAction = null;
      aiPromptEditorEl.hidden = true;
      aiPromptEditorLabelEl.value = '';
      aiPromptEditorTextEl.value = '';
    }
    async function saveCurrentPromptTemplate() {
      const action = currentEditingAction();
      const isNew = state.editingAction === '__new__';
      if (!isNew && !action) return;
      const prompt = aiPromptEditorTextEl.value.trim();
      const label = aiPromptEditorLabelEl.value.trim();
      if ((isNew || action?.custom) && !label) {
        aiChatStatusEl.textContent = '请先填写按钮标签。';
        return;
      }
      if (!prompt) {
        aiChatStatusEl.textContent = '模板提示词不能为空。';
        return;
      }
      aiChatStatusEl.textContent = '正在保存创作模板...';
      try {
        const response = await fetch((isNew || action?.custom) ? '/api/ai/custom-action' : '/api/ai/action-prompt', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            platform: aiPlatformEl.value || 'general',
            id: isNew ? '' : action.id,
            action: action?.id || '',
            label,
            prompt,
          }),
        });
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || '保存失败');
        if (isNew) {
          state.aiActions = [...state.aiActions, result.action];
        } else {
          state.aiActions = state.aiActions.map((item) => (item.id === action.id ? { ...item, ...result.action } : item));
        }
        renderAiActions();
        closePromptEditor();
        aiChatStatusEl.textContent = '创作模板已保存。';
      } catch (error) {
        aiChatStatusEl.textContent = '保存创作模板失败：' + error.message;
      }
    }
    async function resetCurrentPromptTemplate() {
      const action = currentEditingAction();
      if (!action) return;
      aiChatStatusEl.textContent = '正在恢复默认模板...';
      try {
        const response = await fetch('/api/ai/action-prompt/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            platform: aiPlatformEl.value || 'general',
            action: action.id,
          }),
        });
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || '恢复失败');
        state.aiActions = state.aiActions.map((item) => (item.id === action.id ? { ...item, ...result.action } : item));
        renderAiActions();
        closePromptEditor();
        aiChatStatusEl.textContent = '已恢复默认创作模板。';
      } catch (error) {
        aiChatStatusEl.textContent = '恢复默认模板失败：' + error.message;
      }
    }
    async function deleteCurrentPromptTemplate() {
      const action = currentEditingAction();
      if (!action?.custom) return;
      if (!window.confirm('确定删除这个自定义模板吗？')) return;
      aiChatStatusEl.textContent = '正在删除自定义模板...';
      try {
        const response = await fetch('/api/ai/custom-action/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            platform: aiPlatformEl.value || 'general',
            action: action.id,
          }),
        });
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || '删除失败');
        state.aiActions = state.aiActions.filter((item) => item.id !== action.id);
        renderAiActions();
        closePromptEditor();
        aiChatStatusEl.textContent = '自定义模板已删除。';
      } catch (error) {
        aiChatStatusEl.textContent = '删除自定义模板失败：' + error.message;
      }
    }
    async function loadAiConfig() {
      try {
        const response = await fetch('/api/ai/config');
        const result = await response.json();
        if (result.ok) applyAiConfig(result.config);
      } catch (error) {
        aiConfigStatusEl.textContent = '读取 AI 配置失败：' + error.message;
      }
    }
    async function runLocalAnalyze(updateTranscript) {
      const transcript = transcriptEl.value.trim();
      if (!transcript) {
        aiChatStatusEl.textContent = '请先粘贴字幕、转写稿或视频内容。';
        return;
      }
      aiChatStatusEl.textContent = '正在本地分析...';
      try {
        const response = await fetch('/api/ai/local-analyze', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            transcript,
            platform: aiPlatformEl.value,
          }),
        });
        const result = await response.json();
        if (!result.ok) {
          aiChatStatusEl.textContent = '本地分析失败：' + result.error;
          return;
        }
        if (updateTranscript) {
          transcriptEl.value = result.analysis.cleaned || transcript;
          state.lastTranscriptVariants = null;
        }
        appendAiMessage('assistant', updateTranscript ? '字幕已清理。' : result.analysis.result, { exportable: !updateTranscript });
        aiChatStatusEl.textContent = updateTranscript ? '字幕清理完成。' : '本地分析完成。';
      } catch (error) {
        aiChatStatusEl.textContent = '本地分析失败：' + error.message;
      }
    }
    async function extractSubtitles() {
      const sourceUrl = aiSourceUrlEl.value.trim() || urlsEl.value.split(/\\r?\\n/).map((item) => item.trim()).find(Boolean) || '';
      if (!sourceUrl) {
        aiChatStatusEl.textContent = '请先填写参考视频链接，或在下载链接框里保留一条链接。';
        return;
      }
      aiSourceUrlEl.value = sourceUrl;
      aiChatStatusEl.textContent = '正在提取平台字幕...';
      try {
        const selectedPlatform = platformEl.value;
        const response = await fetch('/api/ai/extract-subtitles', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: sourceUrl,
            filePath: currentLocalMediaPath(),
            platform: selectedPlatform,
            ytDlpPath: document.getElementById('ytDlpPath').value.trim(),
            ...youtubeAuthPayload(selectedPlatform),
            ...transcriptPreferencePayload(),
          }),
        });
        const result = await response.json();
        if (!result.ok) {
          aiChatStatusEl.textContent = '字幕提取失败：' + result.error;
          appendAiMessage('system', '字幕提取失败：' + result.error);
          return;
        }
        transcriptEl.value = result.subtitles.text || '';
        state.lastTranscriptVariants = result.subtitles.variants || result.variants || null;
        const savedText = result.saved?.files?.length ? '\\n已保存到：\\n' + result.saved.files.join('\\n') : '';
        const translateText = result.subtitles.translated ? '\\n已按“最终输出格式”完成 AI 翻译。' : (result.subtitles.note ? '\\n' + result.subtitles.note : '');
        appendAiMessage('assistant', '已提取字幕：' + result.subtitles.file + translateText + '\\n可用字幕文件：' + (result.subtitles.available || []).join('、') + savedText, { exportable: false });
        aiChatStatusEl.textContent = '字幕提取完成。';
      } catch (error) {
        aiChatStatusEl.textContent = '字幕提取失败：' + error.message;
        appendAiMessage('system', '字幕提取失败：' + error.message);
      }
    }
    function currentLocalMediaPath() {
      const filePath = aiLocalMediaPathEl.value.trim() || state.lastOutput;
      if (filePath) aiLocalMediaPathEl.value = filePath;
      return filePath;
    }
    async function getVideoText() {
      const sourceUrl = aiSourceUrlEl.value.trim() || urlsEl.value.split(/\\r?\\n/).map((item) => item.trim()).find(Boolean) || '';
      const filePath = currentLocalMediaPath();
      if (!sourceUrl && !filePath) {
        aiChatStatusEl.textContent = '请先粘贴原视频链接，或选择/填写已下载视频路径。';
        return;
      }
      if (sourceUrl) aiSourceUrlEl.value = sourceUrl;
      const button = document.getElementById('ai-get-video-text');
      button.disabled = true;
      aiChatStatusEl.textContent = '正在获取视频文字...';
      setAiProgress(5, '正在准备获取视频文字...');
      try {
        const selectedPlatform = platformEl.value;
        const response = await fetch('/api/ai/get-video-text', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: sourceUrl,
            filePath,
            platform: selectedPlatform,
            ytDlpPath: document.getElementById('ytDlpPath').value.trim(),
            ffmpegPath: document.getElementById('ffmpegPath').value.trim(),
            whisperPath: document.getElementById('whisperPath').value.trim(),
            whisperEngine: document.getElementById('whisperEngine').value,
            whisperModel: document.getElementById('whisperModel').value,
            whisperLanguage: document.getElementById('whisperLanguage').value,
            ...youtubeAuthPayload(selectedPlatform),
            ...transcriptPreferencePayload(),
          }),
        });
        const result = await response.json();
        if (!result.ok) {
          aiChatStatusEl.textContent = result.error || '获取视频文字失败。';
          appendAiMessage('system', result.error || '获取视频文字失败。');
          setAiProgress(0, '处理失败，请按提示检查下一步。');
          return;
        }
        transcriptEl.value = result.text || '';
        state.lastTranscriptVariants = result.variants || null;
        const files = result.saved?.files || [];
        const saveText = files.length ? '\\n已保存到：\\n' + files.join('\\n') : '';
        aiChatStatusEl.textContent = result.message || '已获取视频文字。';
        appendAiMessage('assistant', (result.message || '已获取视频文字。') + saveText, { exportable: false });
        setAiProgress(100, result.message || '已完成。');
      } catch (error) {
        aiChatStatusEl.textContent = '获取视频文字失败：' + error.message;
        appendAiMessage('system', '获取视频文字失败：' + error.message);
        setAiProgress(0, '处理失败：' + error.message);
      } finally {
        button.disabled = false;
      }
    }
    async function extractEmbeddedSubtitles() {
      const filePath = currentLocalMediaPath();
      if (!filePath) {
        aiChatStatusEl.textContent = '请先填写已下载视频路径，或下载完成后点“最近下载”。';
        return;
      }
      aiChatStatusEl.textContent = '正在提取本地视频内嵌字幕...';
      try {
        const response = await fetch('/api/ai/extract-embedded-subtitles', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            filePath,
            ffmpegPath: document.getElementById('ffmpegPath').value.trim(),
            format: 'srt',
            ...transcriptPreferencePayload(),
          }),
        });
        const result = await response.json();
        if (!result.ok) {
          aiChatStatusEl.textContent = '内嵌字幕提取失败：' + result.error;
          appendAiMessage('system', '内嵌字幕提取失败：' + result.error);
          return;
        }
        transcriptEl.value = result.subtitles.text || '';
        state.lastTranscriptVariants = result.subtitles.variants || result.variants || null;
        appendAiMessage('assistant', '已提取内嵌字幕：' + result.subtitles.outputPath, { exportable: false });
        aiChatStatusEl.textContent = '内嵌字幕提取完成。';
      } catch (error) {
        aiChatStatusEl.textContent = '内嵌字幕提取失败：' + error.message;
        appendAiMessage('system', '内嵌字幕提取失败：' + error.message);
      }
    }
    async function extractAudioOnly() {
      const filePath = currentLocalMediaPath();
      if (!filePath) {
        aiChatStatusEl.textContent = '请先填写已下载视频/音频路径，或下载完成后点“最近下载”。';
        return;
      }
      aiChatStatusEl.textContent = '正在提取音频...';
      try {
        const response = await fetch('/api/ai/extract-audio', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            filePath,
            ffmpegPath: document.getElementById('ffmpegPath').value.trim(),
          }),
        });
        const result = await response.json();
        if (!result.ok) {
          aiChatStatusEl.textContent = '提取音频失败：' + result.error;
          appendAiMessage('system', '提取音频失败：' + result.error);
          return;
        }
        appendAiMessage('assistant', '已保存音频：' + result.audio.outputPath, { exportable: false });
        aiChatStatusEl.textContent = '音频提取完成。';
      } catch (error) {
        aiChatStatusEl.textContent = '提取音频失败：' + error.message;
        appendAiMessage('system', '提取音频失败：' + error.message);
      }
    }
    async function saveTranscript() {
      const filePath = currentLocalMediaPath();
      const sourceUrl = aiSourceUrlEl.value.trim() || urlsEl.value.split(/\\r?\\n/).map((item) => item.trim()).find(Boolean) || '';
      const transcript = transcriptEl.value.trim();
      if (!filePath && !sourceUrl) {
        aiChatStatusEl.textContent = '请先填写已下载视频/音频路径，或填写参考视频链接，用来确定保存位置。';
        return;
      }
      if (!transcript) {
        aiChatStatusEl.textContent = '请先提取字幕、音频转文字，或粘贴字幕文本。';
        return;
      }
      const outDir = askSaveOptions('subtitles', '是否保存当前字幕/转写稿？');
      if (outDir === null) {
        aiChatStatusEl.textContent = '已取消保存。';
        return;
      }
      aiChatStatusEl.textContent = '正在清洗并保存字幕文件...';
      try {
        const response = await fetch('/api/ai/save-transcript', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            filePath,
            sourceUrl,
            outDir,
            transcript,
            variants: state.lastTranscriptVariants || undefined,
            formats: ['txt', 'srt', 'vtt'],
            timeline: true,
            ...transcriptPreferencePayload(),
          }),
        });
        const result = await response.json();
        if (!result.ok) {
          aiChatStatusEl.textContent = '导出整理稿失败：' + result.error;
          appendAiMessage('system', '导出整理稿失败：' + result.error);
          return;
        }
        transcriptEl.value = result.saved.cleaned || transcript;
        state.lastTranscriptVariants = result.saved.variants || state.lastTranscriptVariants;
        appendAiMessage('assistant', '已保存字幕文件：\\n' + (result.saved.files || []).join('\\n'), { exportable: false });
        aiChatStatusEl.textContent = '导出整理稿完成。';
      } catch (error) {
        aiChatStatusEl.textContent = '导出整理稿失败：' + error.message;
        appendAiMessage('system', '导出整理稿失败：' + error.message);
      }
    }
    async function transcribeLocalMedia() {
      const filePath = currentLocalMediaPath();
      if (!filePath) {
        aiChatStatusEl.textContent = '请先填写已下载视频/音频路径，或下载完成后点“最近下载”。';
        return;
      }
      aiChatStatusEl.textContent = '正在从本地视频/音频转文字...';
      setAiProgress(5, '正在启动本地 Whisper 转文字...');
      try {
        const response = await fetch('/api/ai/transcribe-local', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            filePath,
            ffmpegPath: document.getElementById('ffmpegPath').value.trim(),
            transcriptionMode: 'whisper',
            whisperPath: document.getElementById('whisperPath').value.trim(),
            whisperEngine: document.getElementById('whisperEngine').value,
            whisperModel: document.getElementById('whisperModel').value,
            whisperLanguage: document.getElementById('whisperLanguage').value,
            ...transcriptPreferencePayload(),
          }),
        });
        const result = await response.json();
        if (!result.ok) {
          const errorText = String(result.error || '');
          const needsWhisper = /whisper|python|module|找不到|没有找到/i.test(errorText);
          const hint = needsWhisper ? '\\n可以在“环境与组件”中一键安装，无需手动配置 Python。' : '';
          if (needsWhisper) {
            environmentPanelEl.hidden = false;
            await loadEnvironment();
            const model = document.getElementById('whisperModel').value || 'small';
            const sizeText = model === 'large-v3' ? '约 3.0 GB' : model === 'medium' ? '约 1.5 GB' : '约 465 MB';
            if (window.confirm('本地 Whisper 尚未安装。是否现在一键安装 ' + model + ' 模型？\\n需要联网下载 ' + sizeText + '，安装后可离线使用。')) {
              const installed = await installWhisper(model);
              if (installed) {
                aiChatStatusEl.textContent = 'Whisper 安装完成，正在继续刚才的转写...';
                return transcribeLocalMedia();
              }
            }
          }
          aiChatStatusEl.textContent = '音频转文字失败：' + errorText;
          appendAiMessage('system', '音频转文字失败：' + errorText + hint);
          setAiProgress(0, '音频转文字失败，请检查本地 Whisper 设置。');
          return;
        }
        transcriptEl.value = result.transcript || '';
        state.lastTranscriptVariants = result.variants || result.saved?.variants || null;
        appendAiMessage('assistant', '已从本地文件转写文字：' + result.inputPath, { exportable: false });
        aiChatStatusEl.textContent = '音频转文字完成。';
        setAiProgress(100, '音频转文字完成，字幕文件已保存。');
      } catch (error) {
        aiChatStatusEl.textContent = '音频转文字失败：' + error.message;
        appendAiMessage('system', '音频转文字失败：' + error.message);
        setAiProgress(0, '音频转文字失败：' + error.message);
      }
    }
    function collectAiMessages() {
      return [...aiMessagesEl.querySelectorAll('.message')]
      .filter((item) => item.dataset.exportable !== 'false')
      .map((item) => {
        const role = item.classList.contains('assistant') ? 'assistant'
          : item.classList.contains('system') ? 'system'
            : 'user';
        return { role, content: item.textContent.trim() };
      }).filter((item) => item.content);
    }
    function isToolNotice(item) {
      if (item.role === 'system') return true;
      return /^(已提取|已保存|保存|导出|已导出|字幕提取|获取视频文字|音频转文字|AI 修正字幕|创作内容已导出|AI 已修正字幕|已从本地文件|处理失败|任务失败|保存整理|导出整理稿|当前没有|已清空)/.test(item.content);
    }
    async function fixTranscriptWithAi() {
      const transcript = transcriptEl.value.trim();
      if (!transcript) {
        aiChatStatusEl.textContent = '请先获取或粘贴字幕文本。';
        return;
      }
      const outDir = askSaveOptions('subtitles', 'AI 修正完成后是否保存修正版字幕？');
      if (outDir === null) {
        aiChatStatusEl.textContent = '已取消 AI 修正字幕。';
        return;
      }
      aiChatStatusEl.textContent = 'AI 正在修正字幕...';
      const button = document.getElementById('ai-fix-transcript');
      button.disabled = true;
      try {
        const response = await fetch('/api/ai/fix-transcript', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            transcript,
            filePath: currentLocalMediaPath(),
            sourceUrl: aiSourceUrlEl.value.trim(),
            outDir,
            variants: state.lastTranscriptVariants || undefined,
            ...transcriptPreferencePayload(),
          }),
        });
        const result = await response.json();
        if (!result.ok) {
          aiChatStatusEl.textContent = 'AI 修正字幕失败：' + result.error;
          appendAiMessage('system', 'AI 修正字幕失败：' + result.error);
          return;
        }
        transcriptEl.value = result.transcript || transcript;
        state.lastTranscriptVariants = result.saved?.variants || null;
        const savedText = result.saved?.files?.length ? '\\n已保存到：\\n' + result.saved.files.join('\\n') : '';
        appendAiMessage('assistant', 'AI 已修正字幕。' + savedText, { exportable: false });
        aiChatStatusEl.textContent = 'AI 修正字幕完成。';
        setAiProgress(100, 'AI 修正字幕完成。');
      } catch (error) {
        aiChatStatusEl.textContent = 'AI 修正字幕失败：' + error.message;
        appendAiMessage('system', 'AI 修正字幕失败：' + error.message);
      } finally {
        button.disabled = false;
      }
    }
    async function exportAiChat() {
      const messages = collectAiMessages();
      const useful = messages.filter((item) => !isToolNotice(item));
      if (!useful.length) {
        aiChatStatusEl.textContent = '当前没有可导出的创作内容。';
        return;
      }
      const outDir = askSaveOptions('ai', '是否导出当前创作内容？');
      if (outDir === null) {
        aiChatStatusEl.textContent = '已取消导出。';
        return;
      }
      aiChatStatusEl.textContent = '正在导出创作内容...';
      try {
        const response = await fetch('/api/ai/export-chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            platform: aiPlatformEl.value,
            sourceUrl: aiSourceUrlEl.value.trim(),
            filePath: currentLocalMediaPath(),
            outDir,
            action: state.lastAiAction || 'chat',
            messages: useful,
          }),
        });
        const result = await response.json();
        if (!result.ok) {
          aiChatStatusEl.textContent = '导出失败：' + result.error;
          return;
        }
        appendAiMessage('assistant', '创作内容已导出：\\n' + (result.saved.files || []).join('\\n'), { exportable: false });
        aiChatStatusEl.textContent = '创作内容已导出为 Markdown 和 TXT。';
      } catch (error) {
        aiChatStatusEl.textContent = '导出失败：' + error.message;
      }
    }
    function clearTranscriptBox() {
      transcriptEl.value = '';
      state.lastTranscriptVariants = null;
      aiChatStatusEl.textContent = '字幕框已清空。';
    }
    function clearAiChatBox() {
      aiMessagesEl.innerHTML = '<div class="message system">已清空创作记录。可以继续点击按钮生成，或在下方输入问题。</div>';
      aiPromptEl.value = '';
      aiHistory.length = 0;
      state.lastAiAction = '';
      aiChatStatusEl.textContent = '创作记录已清空。';
    }
    function parseSseChunk(buffer, onEvent) {
      const blocks = buffer.split(/\\n\\n/);
      const rest = blocks.pop() || '';
      for (const block of blocks) {
        const lines = block.split(/\\n/);
        const eventLine = lines.find((line) => line.startsWith('event:'));
        const dataLine = lines.find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const eventName = eventLine ? eventLine.slice(6).trim() : 'message';
        try {
          onEvent(eventName, JSON.parse(dataLine.slice(5).trim()));
        } catch {}
      }
      return rest;
    }
    async function sendAiPrompt(options = {}) {
      const prompt = String(options.prompt || aiPromptEl.value || '').trim();
      const action = String(options.action || '');
      const userText = options.label || prompt;
      const clearPromptAfterSend = !options.prompt && !action;
      if (!prompt && !action) {
        aiChatStatusEl.textContent = '请输入问题，或点击一个创作模板。';
        return;
      }
      appendAiMessage('user', userText);
      if (clearPromptAfterSend) aiPromptEl.value = '';
      state.lastAiAction = action || 'chat';
      aiChatStatusEl.textContent = 'AI 已连接，正在实时生成...';
      const sendButton = document.getElementById('ai-send');
      sendButton.disabled = true;
      sendButton.textContent = '生成中';
      const assistantEl = appendAiMessage('assistant', '');
      try {
        const response = await fetch('/api/ai/chat-stream', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            platform: aiPlatformEl.value,
            sourceUrl: aiSourceUrlEl.value.trim(),
            transcript: transcriptEl.value.trim(),
            prompt,
            action,
            messages: aiHistory.slice(-10),
          }),
        });
        if (!response.ok || !response.body) {
          const result = await response.json().catch(() => null);
          throw new Error(result?.error || 'AI 生成接口没有返回可读取内容。');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalAnswer = '';
        let streamError = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\\r/g, '');
          buffer = parseSseChunk(buffer, (eventName, payload) => {
            if (eventName === 'delta') {
              const shouldScroll = shouldAutoScrollAiMessages();
              assistantEl.textContent += payload.delta || '';
              scrollAiMessagesIfNeeded(shouldScroll);
            } else if (eventName === 'done') {
              finalAnswer = payload.answer || assistantEl.textContent;
            } else if (eventName === 'error') {
              streamError = payload.error || 'AI 生成失败';
              if (payload.partial) assistantEl.textContent = payload.partial;
            }
          });
        }
        finalAnswer = finalAnswer || assistantEl.textContent;
        if (streamError) {
          if (!finalAnswer) assistantEl.remove();
          appendAiMessage('system', 'AI 生成失败：' + streamError);
          aiChatStatusEl.textContent = 'AI 生成失败：' + streamError;
          return;
        }
        if (!finalAnswer.trim()) throw new Error('模型没有返回文本内容。');
        aiHistory.push({ role: 'user', content: userText });
        aiHistory.push({ role: 'assistant', content: finalAnswer });
        aiChatStatusEl.textContent = '生成完成。';
      } catch (error) {
        if (!assistantEl.textContent.trim()) assistantEl.remove();
        appendAiMessage('system', 'AI 生成失败：' + error.message);
        aiChatStatusEl.textContent = 'AI 生成失败：' + error.message;
      } finally {
        sendButton.disabled = false;
        sendButton.textContent = '发送';
      }
    }
    function updateBiliStatus(data) {
      biliStatusEl.classList.toggle('ok', Boolean(data.loggedIn));
      if (data.loggedIn) {
        biliStatusEl.textContent = 'Bilibili：高码率登录已读取';
      } else if (data.hasCookie) {
        biliStatusEl.textContent = 'Bilibili：高码率登录已读取';
      } else {
        biliStatusEl.textContent = 'Bilibili：高码率未登录';
      }
    }
    function authPlatform() {
      return platformEl.value === 'instagram' ? 'instagram' : 'youtube';
    }
    function authPlatformLabel(platform = authPlatform()) {
      return platform === 'instagram' ? 'Instagram' : 'YouTube';
    }
    function renderPlatformAuthStatus(platform = authPlatform()) {
      const label = authPlatformLabel(platform);
      const data = platformLoginStatus[platform] || {};
      youtubeStatusEl.classList.toggle('ok', Boolean(data.loggedIn || data.hasCookie));
      if (data.loggedIn) {
        youtubeStatusEl.textContent = label + '：登录状态已读取';
        youtubeAuthEl.value = 'app';
      } else if (data.hasCookie) {
        youtubeStatusEl.textContent = label + '：Cookie 已读取';
        youtubeAuthEl.value = 'app';
      } else {
        youtubeStatusEl.textContent = label + '：未读取登录状态';
      }
    }
    function updatePlatformAuthControls() {
      const platform = authPlatform();
      const label = authPlatformLabel(platform);
      platformAuthLabelEl.textContent = label + ' 登录来源';
      document.getElementById('youtube-login').textContent = '打开 ' + label + ' 登录';
      renderPlatformAuthStatus(platform);
    }
    function updateYoutubeStatus(data) {
      platformLoginStatus.youtube = {
        loggedIn: Boolean(data.loggedIn),
        hasCookie: Boolean(data.hasCookie),
      };
      if (authPlatform() === 'youtube') renderPlatformAuthStatus('youtube');
    }
    function updateInstagramStatus(data) {
      platformLoginStatus.instagram = {
        loggedIn: Boolean(data.loggedIn),
        hasCookie: Boolean(data.hasCookie),
      };
      if (authPlatform() === 'instagram') renderPlatformAuthStatus('instagram');
    }
    function updateYoutubeAuthHint() {
      const auth = youtubeAuthEl.value || 'none';
      const label = authPlatformLabel();
      if (auth === 'app') {
        youtubeStatusEl.classList.add('ok');
        youtubeStatusEl.textContent = label + '：下载时使用本程序登录窗口';
      } else if (auth === 'none') {
        youtubeStatusEl.classList.remove('ok');
        youtubeStatusEl.textContent = label + '：不使用登录状态';
      }
    }
    function youtubeAuthPayload(platform) {
      if (platform !== 'youtube' && platform !== 'instagram') {
        return { youtubeAuth: 'none', ytDlpCookiesPath: '', ytDlpCookiesFromBrowser: '' };
      }
      const auth = youtubeAuthEl.value || 'none';
      return {
        youtubeAuth: auth,
        ytDlpCookiesPath: '',
        ytDlpCookiesFromBrowser: '',
      };
    }
    const platformPlaceholders = {
      bilibili: 'https://www.bilibili.com/video/BV...\\nhttps://b23.tv/...',
      douyin: 'https://www.douyin.com/video/...\\nhttps://v.douyin.com/...',
      youtube: 'https://www.youtube.com/watch?v=...\\nhttps://www.youtube.com/shorts/...',
      kuaishou: 'https://www.kuaishou.com/short-video/...\\nhttps://v.kuaishou.com/...',
      xiaohongshu: 'https://www.xiaohongshu.com/explore/...\\nhttps://xhslink.com/...',
      tiktok: 'https://www.tiktok.com/@user/video/...\\nhttps://vm.tiktok.com/...',
      instagram: 'https://www.instagram.com/reel/...\\nhttps://www.instagram.com/p/...',
    };
    function updatePlatformVisibility() {
      const platform = platformEl.value;
      biliToolsEl.hidden = platform !== 'bilibili';
      youtubeToolsEl.hidden = platform !== 'youtube' && platform !== 'xiaohongshu' && platform !== 'tiktok' && platform !== 'instagram';
      youtubeAuthToolsEl.hidden = platform !== 'youtube' && platform !== 'instagram';
      if (!youtubeAuthToolsEl.hidden) updatePlatformAuthControls();
      mergeToolsEl.hidden = platform !== 'bilibili' && platform !== 'youtube' && platform !== 'xiaohongshu' && platform !== 'tiktok' && platform !== 'instagram';
      urlsEl.placeholder = platformPlaceholders[platform] || '请粘贴视频链接，每行一个';
      if (aiPlatformEl && aiPlatformEl.querySelector('option[value="' + platform + '"]')) {
        aiPlatformEl.value = platform;
        loadAiActions();
      }
    }
    function urlMatchesPlatform(url, platform) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        try {
          parsed = new URL('https://' + url);
        } catch {
          return false;
        }
      }
      const host = parsed.hostname.toLowerCase();
      if (platform === 'bilibili') return host === 'b23.tv' || host === 'bilibili.com' || host.endsWith('.bilibili.com');
      if (platform === 'douyin') return host === 'douyin.com' || host.endsWith('.douyin.com');
      if (platform === 'youtube') return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
      if (platform === 'kuaishou') return host === 'kuaishou.com' || host.endsWith('.kuaishou.com')
        || host === 'kuaishouapp.com' || host.endsWith('.kuaishouapp.com')
        || host === 'gifshow.com' || host.endsWith('.gifshow.com')
        || host === 'ks.com' || host.endsWith('.ks.com');
      if (platform === 'xiaohongshu') return host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com')
        || host === 'xhslink.com' || host.endsWith('.xhslink.com')
        || host === 'xhs.cn' || host.endsWith('.xhs.cn');
      if (platform === 'tiktok') return host === 'tiktok.com' || host.endsWith('.tiktok.com')
        || host === 'tiktokv.com' || host.endsWith('.tiktokv.com');
      if (platform === 'instagram') return host === 'instagram.com' || host.endsWith('.instagram.com')
        || host === 'instagr.am' || host.endsWith('.instagr.am');
      return true;
    }

    const events = new EventSource('/events');
    events.addEventListener('log', (event) => appendLog(JSON.parse(event.data).message));
    events.addEventListener('progress', (event) => setProgress(JSON.parse(event.data).percent));
    events.addEventListener('ai-progress', (event) => {
      const data = JSON.parse(event.data);
      setAiProgress(data.percent, data.message);
    });
    events.addEventListener('component-progress', (event) => {
      const data = JSON.parse(event.data);
      componentProgressEl.hidden = false;
      componentProgressBarEl.style.width = Math.max(0, Math.min(100, data.percent || 0)) + '%';
      componentProgressTextEl.textContent = '正在下载 ' + data.id + '：' + (data.percent || 0) + '%（' + formatBytes(data.received) + ' / ' + formatBytes(data.total) + '）';
    });
    events.addEventListener('queue', (event) => {
      state.queued = JSON.parse(event.data).queued;
      updateMetrics();
    });
    events.addEventListener('run-state', (event) => {
      const data = JSON.parse(event.data);
      state.running = Boolean(data.running);
      state.stopping = Boolean(data.stopping);
      state.queued = Number(data.queued) || state.queued;
      updateMetrics();
    });
    events.addEventListener('bilibili-login', (event) => updateBiliStatus(JSON.parse(event.data)));
    events.addEventListener('youtube-login', (event) => updateYoutubeStatus(JSON.parse(event.data)));
    events.addEventListener('instagram-login', (event) => updateInstagramStatus(JSON.parse(event.data)));
    events.addEventListener('done', (event) => {
      const data = JSON.parse(event.data);
      state.queued = data.queued;
      state.done = data.done;
      state.failed = data.failed;
      updateMetrics();
      setProgress(0);
      if (data.output) {
        state.lastOutput = data.output;
        aiLocalMediaPathEl.value = data.output;
        if (data.url) aiSourceUrlEl.value = data.url;
        if (data.platform && aiPlatformEl.querySelector('option[value="' + data.platform + '"]')) {
          aiPlatformEl.value = data.platform;
          loadAiActions();
        }
        appendLog('保存完成：' + data.output);
      }
    });
    events.addEventListener('error-job', (event) => {
      const data = JSON.parse(event.data);
      state.queued = data.queued;
      state.done = data.done;
      state.failed = data.failed;
      updateMetrics();
      setProgress(0);
      appendLog('任务失败：' + data.message);
    });

    document.getElementById('bili-login').addEventListener('click', async () => {
      const response = await fetch('/api/bilibili/login', { method: 'POST' });
      const result = await response.json();
      appendLog(result.ok ? '已打开 Bilibili 高码率登录窗口。登录成功后窗口会自动关闭。' : '打开 Bilibili 登录窗口失败：' + result.error);
    });
    document.getElementById('bili-check').addEventListener('click', async () => {
      const response = await fetch('/api/bilibili/check-login', { method: 'POST' });
      const result = await response.json();
      if (result.ok) {
        updateBiliStatus(result);
        appendLog(result.hasCookie ? 'Bilibili 高码率登录状态已读取。' : '还没有读取到 Bilibili 登录状态；普通清晰度仍可直接下载。');
      } else {
        appendLog('读取 Bilibili 登录状态失败：' + result.error);
      }
    });
    document.getElementById('youtube-login').addEventListener('click', async () => {
      const platform = authPlatform();
      const label = authPlatformLabel(platform);
      const response = await fetch(platform === 'instagram' ? '/api/instagram/login' : '/api/youtube/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          loginBrowser: youtubeLoginBrowserEl.value || 'default',
        }),
      });
      const result = await response.json();
      appendLog(result.ok
        ? (result.reused ? label + ' 登录窗口已打开，将继续使用现有窗口。' : '已用 ' + (result.browserLabel || '所选浏览器') + ' 打开 ' + label + ' 登录窗口。登录后点击“确认登录来源”。')
        : '打开 ' + label + ' 登录窗口失败：' + result.error);
      if (result.ok) {
        youtubeAuthEl.value = 'app';
        updateYoutubeAuthHint();
      }
    });
    document.getElementById('youtube-check').addEventListener('click', async () => {
      const auth = youtubeAuthEl.value || 'none';
      const platform = authPlatform();
      const label = authPlatformLabel(platform);
      if (auth === 'none') {
        updateYoutubeAuthHint();
        appendLog(label + ' 当前设置为不使用登录状态。');
        return;
      }
      const response = await fetch(platform === 'instagram' ? '/api/instagram/check-login' : '/api/youtube/check-login', { method: 'POST' });
      const result = await response.json();
      if (result.ok) {
        if (platform === 'instagram') updateInstagramStatus(result);
        else updateYoutubeStatus(result);
        appendLog(result.hasCookie ? label + ' 登录状态已读取。' : '还没有读取到 ' + label + ' 登录状态。');
      } else {
        appendLog('读取 ' + label + ' 登录状态失败：' + result.error);
      }
    });
    youtubeAuthEl.addEventListener('change', updateYoutubeAuthHint);
    document.getElementById('environment-toggle').addEventListener('click', async () => {
      environmentPanelEl.hidden = !environmentPanelEl.hidden;
      if (!environmentPanelEl.hidden) await loadEnvironment();
    });
    document.getElementById('refresh-environment').addEventListener('click', loadEnvironment);
    document.getElementById('install-whisper-small').addEventListener('click', () => installWhisper('small'));
    document.getElementById('install-whisper-medium').addEventListener('click', () => installWhisper('medium'));
    document.getElementById('install-whisper-large').addEventListener('click', () => installWhisper('large-v3'));
    installWhisperGpuEl.addEventListener('click', installGpuAcceleration);
    document.getElementById('check-update').addEventListener('click', async () => {
      environmentSummaryEl.textContent = '正在检查更新...';
      try {
        const response = await fetch('/api/update/check');
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || '检查失败');
        environmentSummaryEl.textContent = result.update.available ? '发现新版本 ' + result.update.latest + '，请前往 GitHub Releases 下载。' : '当前已是最新版 ' + result.update.current;
      } catch (error) { environmentSummaryEl.textContent = '更新检查失败：' + error.message; }
    });    document.getElementById('ai-settings-toggle').addEventListener('click', () => {
      aiSettingsEl.hidden = !aiSettingsEl.hidden;
    });
    document.getElementById('ai-save').addEventListener('click', async () => {
      aiConfigStatusEl.textContent = '正在保存 AI 配置...';
      try {
        const response = await fetch('/api/ai/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(aiConfigPayload()),
        });
        const result = await response.json();
        if (!result.ok) {
          aiConfigStatusEl.textContent = '保存失败：' + result.error;
          return;
        }
        document.getElementById('aiApiKey').value = '';
        applyAiConfig(result.config);
        aiConfigStatusEl.textContent = 'AI 配置已保存。';
      } catch (error) {
        aiConfigStatusEl.textContent = '保存失败：' + error.message;
      }
    });
    document.getElementById('ai-test').addEventListener('click', async () => {
      aiConfigStatusEl.textContent = '正在测试连接...';
      try {
        const response = await fetch('/api/ai/test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(aiConfigPayload()),
        });
        const result = await response.json();
        if (!result.ok) {
          aiConfigStatusEl.textContent = '连接失败：' + result.error;
          return;
        }
        document.getElementById('aiApiKey').value = '';
        applyAiConfig(result.config);
        aiConfigStatusEl.textContent = '连接成功：' + (result.message || '模型已响应');
      } catch (error) {
        aiConfigStatusEl.textContent = '连接失败：' + error.message;
      }
    });
    document.getElementById('ai-local-analyze').addEventListener('click', () => runLocalAnalyze(false));
    document.getElementById('ai-clean-transcript').addEventListener('click', () => runLocalAnalyze(true));
    document.getElementById('ai-fix-transcript').addEventListener('click', fixTranscriptWithAi);
    document.getElementById('ai-clear-transcript').addEventListener('click', clearTranscriptBox);
    document.getElementById('ai-clear-chat').addEventListener('click', clearAiChatBox);
    document.getElementById('ai-export-chat').addEventListener('click', exportAiChat);
    document.getElementById('ai-get-video-text').addEventListener('click', getVideoText);
    document.getElementById('ai-extract-subtitles').addEventListener('click', extractSubtitles);
    document.getElementById('ai-extract-embedded-subtitles').addEventListener('click', extractEmbeddedSubtitles);
    document.getElementById('ai-extract-audio').addEventListener('click', extractAudioOnly);
    document.getElementById('ai-save-transcript').addEventListener('click', saveTranscript);
    document.getElementById('ai-transcribe-local').addEventListener('click', transcribeLocalMedia);
    transcriptEl.addEventListener('input', () => {
      state.lastTranscriptVariants = null;
    });
    document.getElementById('ai-use-last-output').addEventListener('click', () => {
      if (!state.lastOutput) {
        aiChatStatusEl.textContent = '还没有记录到最近下载完成的文件。';
        return;
      }
      aiLocalMediaPathEl.value = state.lastOutput;
      aiChatStatusEl.textContent = '已填入最近下载文件。';
    });
    document.getElementById('ai-send').addEventListener('click', () => sendAiPrompt());
    aiPromptEl.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendAiPrompt();
      }
    });
    aiPlatformEl.addEventListener('change', loadAiActions);
    aiQuickActionsEl.addEventListener('click', (event) => {
      const editButton = event.target.closest('button[data-edit-action]');
      if (editButton) {
        openPromptEditor(editButton.dataset.editAction);
        return;
      }
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      sendAiPrompt({
        action: button.dataset.action,
        label: button.dataset.label || button.textContent.trim(),
      });
    });
    document.getElementById('ai-prompt-save').addEventListener('click', saveCurrentPromptTemplate);
    document.getElementById('ai-prompt-reset').addEventListener('click', resetCurrentPromptTemplate);
    document.getElementById('ai-prompt-delete').addEventListener('click', deleteCurrentPromptTemplate);
    document.getElementById('ai-prompt-cancel').addEventListener('click', closePromptEditor);
    document.getElementById('ai-add-custom-action').addEventListener('click', openNewPromptEditor);
    urlsEl.addEventListener('input', () => {
      const firstUrl = urlsEl.value.split(/\\r?\\n/).map((item) => item.trim()).find(Boolean) || '';
      aiSourceUrlEl.value = firstUrl;
    });
    document.getElementById('detect-quality').addEventListener('click', async () => {
      const platform = platformEl.value;
      const urls = document.getElementById('urls').value.split(/\\r?\\n/).map((url) => url.trim()).filter(Boolean);
      if (!urls.length) {
        appendLog('请先粘贴一条链接，再识别画质。');
        return;
      }
      if (!urlMatchesPlatform(urls[0], platform)) {
        appendLog('当前选择的视频来源和链接不一致：' + urls[0]);
        return;
      }
      const button = document.getElementById('detect-quality');
      button.disabled = true;
      qualityStatusEl.textContent = '正在识别这条链接可用的画质...';
      appendLog('开始识别可用画质：' + urls[0]);
      try {
        const response = await fetch('/api/qualities', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: urls[0],
            platform,
            timeoutSeconds: Number(document.getElementById('timeout').value) || 180,
            ffmpegPath: document.getElementById('ffmpegPath').value.trim(),
            ytDlpPath: document.getElementById('ytDlpPath').value.trim(),
            ...youtubeAuthPayload(platform),
          }),
        });
        const result = await response.json();
        if (!result.ok) {
          appendLog('识别画质失败：' + result.error);
          qualityStatusEl.textContent = '识别失败，请查看右侧日志。';
          return;
        }
        setQualityOptions(result.options);
        if (result.detected) {
          qualityStatusEl.textContent = '已识别：' + result.availableText;
          appendLog('可选画质：' + result.availableText);
        } else {
          qualityStatusEl.textContent = '这条链接只返回单一播放源，使用“自动选择最佳”即可。';
          appendLog('未发现多个可选画质，使用自动选择最佳。');
        }
      } catch (error) {
        appendLog('识别画质失败：' + error.message);
        qualityStatusEl.textContent = '识别失败，请查看右侧日志。';
      } finally {
        button.disabled = false;
      }
    });
    platformEl.addEventListener('change', () => {
      updatePlatformVisibility();
      setProgress(0);
      fetch('/api/platform-switch', { method: 'POST' }).catch(() => {});
    });

    cancelDownloadEl.addEventListener('click', async () => {
      cancelDownloadEl.disabled = true;
      state.stopping = true;
      updateMetrics();
      appendLog('正在终止下载任务...');
      try {
        const response = await fetch('/api/cancel', { method: 'POST' });
        const result = await response.json();
        if (!result.ok) {
          appendLog('终止下载失败：' + result.error);
        }
      } catch (error) {
        appendLog('终止下载失败：' + error.message);
      }
    });

    document.getElementById('download-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const platform = platformEl.value;
      const urls = document.getElementById('urls').value.split(/\\r?\\n/).map((url) => url.trim()).filter(Boolean);
      if (!urls.length) {
        appendLog('请先粘贴至少一个链接。');
        return;
      }
      const wrongUrl = urls.find((url) => !urlMatchesPlatform(url, platform));
      if (wrongUrl) {
        appendLog('当前选择的视频来源和链接不一致：' + wrongUrl);
        return;
      }
      const nameTemplate = document.getElementById('nameTemplate').value.trim();
      if (urls.length > 1 && nameTemplate && !/%(id|title|date)%/.test(nameTemplate)) {
        appendLog('检测到多条链接且文件名固定，程序会自动追加 _%id% 避免重名。');
      }
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          urls,
          platform,
          outDir: document.getElementById('outDir').value.trim(),
          nameTemplate,
          quality: document.getElementById('quality').value,
          timeoutSeconds: Number(document.getElementById('timeout').value) || 180,
          overwrite: document.getElementById('overwrite').checked,
          ffmpegPath: document.getElementById('ffmpegPath').value.trim(),
          ytDlpPath: document.getElementById('ytDlpPath').value.trim(),
          ...youtubeAuthPayload(platform),
        }),
      });
      const result = await response.json();
      if (result.ok) {
        appendLog('已加入队列：' + result.added + ' 条，链接已保留。');
        aiSourceUrlEl.value = urls[0] || aiSourceUrlEl.value;
      } else {
        appendLog('加入队列失败：' + result.error);
      }
    });

    document.getElementById('clear-log').addEventListener('click', () => {
      logEl.textContent = '';
    });
    document.getElementById('quit').addEventListener('click', async () => {
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/quit', new Blob(['{}'], { type: 'application/json' }));
        } else {
          fetch('/api/quit', { method: 'POST', keepalive: true }).catch(() => {});
        }
      } catch {}
      window.close();
      setTimeout(() => {
        document.body.innerHTML = '';
        location.href = 'about:blank';
      }, 200);
    });

    appendLog('界面已启动，可以粘贴链接开始下载。');
    updatePlatformVisibility();
    loadAiConfig();
    loadEnvironment();
  </script>
</body>
</html>`;
}

export { uiHtml };
