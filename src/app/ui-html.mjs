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
      --paper: #fffaf0;
      --panel: #ffffff;
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
      background:
        linear-gradient(135deg, rgba(82,101,62,.10), transparent 36%),
        linear-gradient(315deg, rgba(199,52,45,.08), transparent 32%),
        var(--paper);
    }
    .app { max-width: 1180px; margin: 0 auto; padding: 28px; }
    header { display: grid; grid-template-columns: 132px 1fr; gap: 22px; align-items: center; margin-bottom: 22px; }
    .brand-logo { width: 132px; height: 132px; display: block; }
    h1 { margin: 0 0 8px; font-size: 34px; line-height: 1.15; letter-spacing: 0; }
    .subtitle { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.7; max-width: 760px; }
    .layout { display: grid; grid-template-columns: minmax(360px, 440px) 1fr; gap: 18px; align-items: start; }
    .panel { background: rgba(255,255,255,.92); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 20px 60px rgba(69, 56, 35, .12); padding: 18px; }
    .panel h2 { margin: 0 0 14px; font-size: 18px; letter-spacing: 0; }
    label { display: block; margin: 14px 0 7px; font-size: 13px; color: #465044; font-weight: 700; }
    textarea, input, select { width: 100%; border: 1px solid #cbd3c0; border-radius: 8px; background: #fffefa; color: var(--ink); font: inherit; outline: none; }
    textarea { min-height: 156px; resize: vertical; padding: 12px; line-height: 1.6; }
    input, select { height: 42px; padding: 0 12px; }
    textarea:focus, input:focus, select:focus { border-color: var(--green); box-shadow: 0 0 0 3px rgba(82,101,62,.16); }
    .row { display: grid; grid-template-columns: 1fr 112px; gap: 10px; }
    .login-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
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
    .secondary { background: #efe7d7; color: #4a3b2a; }
    .danger { background: #f4dad7; color: #8d2520; }
    .stop { background: #2f3a31; color: #fffaf0; }
    .status { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
    .metric { border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: #fffefa; }
    .metric strong { display: block; font-size: 22px; line-height: 1.1; color: var(--green); }
    .metric span { color: var(--muted); font-size: 12px; }
    .progress-wrap { height: 12px; border-radius: 999px; background: #eee8db; overflow: hidden; margin-bottom: 14px; border: 1px solid #dfd6c6; }
    .progress { width: 0%; height: 100%; background: linear-gradient(90deg, var(--green), var(--red)); transition: width .2s ease; }
    .log { height: 470px; overflow: auto; border-radius: 8px; border: 1px solid #d7ddcc; background: #172019; color: #eef8e8; padding: 14px; font-family: Consolas, "Microsoft YaHei", monospace; font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
    .hint { color: var(--muted); font-size: 12px; line-height: 1.6; margin: 10px 0 0; }
    @media (max-width: 880px) {
      .app { padding: 18px; }
      header { grid-template-columns: 90px 1fr; gap: 14px; }
      .brand-logo { width: 90px; height: 90px; }
      h1 { font-size: 25px; }
      .layout { grid-template-columns: 1fr; }
      .status { grid-template-columns: 1fr; }
      .row, .login-row, .auth-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header>
      ${logoSvg()}
      <div>
        <h1>木辛说视频下载器</h1>
        <p class="subtitle">选择视频来源后粘贴链接。当前支持抖音、Bilibili、YouTube、快手和小红书，请只下载你有权保存和使用的视频。</p>
      </div>
    </header>
    <section class="layout">
      <form class="panel" id="download-form">
        <h2>下载任务</h2>
        <label for="platform">视频来源</label>
        <select id="platform">
          <option value="bilibili">Bilibili</option>
          <option value="douyin">抖音</option>
          <option value="youtube">YouTube</option>
          <option value="kuaishou">快手</option>
          <option value="xiaohongshu">小红书</option>
        </select>
        <label for="urls">视频链接，每行一个</label>
        <textarea id="urls"></textarea>

        <div class="login-tools" id="bili-tools" hidden>
          <div class="login-status" id="bili-status">Bilibili：高码率未登录</div>
          <div class="login-row">
            <button class="secondary" type="button" id="bili-login">高码率登录</button>
            <button class="secondary" type="button" id="bili-check">读取登录状态</button>
          </div>
          <p class="hint">普通下载不需要登录；需要 1080P+、高码率或 4K 时再登录。登录成功后窗口会自动关闭。</p>
        </div>

        <div class="platform-tools" id="youtube-tools" hidden>
          <label for="ytDlpPath">yt-dlp 路径</label>
          <input id="ytDlpPath" value="${defaultYtDlpPath}" placeholder="可留空自动识别；也可填 yt-dlp.exe 或所在文件夹">
          <p class="hint">默认使用程序目录下的 downloads\\yt-dlp\\yt-dlp.exe；移动工具位置后可在这里修改。</p>
          <div class="auth-box" id="youtube-auth-tools">
            <div class="auth-grid">
              <div>
                <label for="youtubeAuth">YouTube 登录来源</label>
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
            <p class="hint">默认不使用登录状态；需要高画质或遇到验证时，先打开本程序登录窗口并登录。</p>
          </div>
        </div>

        <div class="platform-tools" id="merge-tools">
          <label for="ffmpegPath">ffmpeg 路径</label>
          <input id="ffmpegPath" value="${defaultFfmpegPath}" placeholder="可填 ffmpeg.exe，或填包含 ffmpeg 的文件夹">
          <p class="hint">默认使用程序目录下的 downloads\\ffmpeg\\ffmpeg-release-essentials；移动工具位置后可在这里修改。</p>
        </div>

        <label for="outDir">保存目录路径</label>
        <input id="outDir" value="videos" placeholder="例如 D:\\视频\\木辛说 或 videos">
        <p class="hint">相对路径会以程序所在目录为基准。</p>
        <div class="row">
          <div>
            <label for="nameTemplate">文件名规则 / 模板</label>
            <input id="nameTemplate" value="%title%_%id%.mp4" placeholder="%title%_%id%.mp4">
            <p class="hint">可用：%title%、%id%、%date%。多条链接使用固定名称时会自动追加 _%id%。</p>
          </div>
          <div>
            <label for="timeout">超时秒数</label>
            <input id="timeout" type="number" min="30" value="180">
          </div>
        </div>
        <label for="quality">画质偏好</label>
        <div class="row">
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
          <button class="secondary" type="button" id="detect-quality">识别画质</button>
        </div>
        <p class="hint" id="quality-status">粘贴链接后可先识别真实可用画质；如果多条链接画质不同，会按所选偏好自动匹配。</p>
        <label class="check"><input id="overwrite" type="checkbox"> 覆盖同名文件</label>
        <div class="actions">
          <button class="primary" type="submit">开始下载</button>
          <button class="stop" type="button" id="cancel-download" disabled>终止下载</button>
          <button class="secondary" type="button" id="clear-log">清空日志</button>
          <button class="danger" type="button" id="quit">关闭程序</button>
        </div>
      </form>
      <section class="panel">
        <h2>状态</h2>
        <div class="status">
          <div class="metric"><strong id="queued">0</strong><span>等待</span></div>
          <div class="metric"><strong id="done">0</strong><span>完成</span></div>
          <div class="metric"><strong id="failed">0</strong><span>失败</span></div>
        </div>
        <div class="progress-wrap"><div class="progress" id="progress"></div></div>
        <div class="log" id="log"></div>
      </section>
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
    const mergeToolsEl = document.getElementById('merge-tools');
    const biliStatusEl = document.getElementById('bili-status');
    const youtubeStatusEl = document.getElementById('youtube-status');
    const youtubeAuthEl = document.getElementById('youtubeAuth');
    const youtubeLoginBrowserEl = document.getElementById('youtubeLoginBrowser');
    const cancelDownloadEl = document.getElementById('cancel-download');
    const state = { queued: 0, done: 0, failed: 0, running: false, stopping: false };

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
    function updateYoutubeStatus(data) {
      youtubeStatusEl.classList.toggle('ok', Boolean(data.loggedIn || data.hasCookie));
      if (data.loggedIn) {
        youtubeStatusEl.textContent = 'YouTube：登录状态已读取';
        youtubeAuthEl.value = 'app';
      } else if (data.hasCookie) {
        youtubeStatusEl.textContent = 'YouTube：Cookie 已读取';
        youtubeAuthEl.value = 'app';
      } else {
        youtubeStatusEl.textContent = 'YouTube：未读取登录状态';
      }
    }
    function updateYoutubeAuthHint() {
      const auth = youtubeAuthEl.value || 'none';
      if (auth === 'app') {
        youtubeStatusEl.classList.add('ok');
        youtubeStatusEl.textContent = 'YouTube：下载时使用本程序登录窗口';
      } else if (auth === 'none') {
        youtubeStatusEl.classList.remove('ok');
        youtubeStatusEl.textContent = 'YouTube：不使用登录状态';
      }
    }
    function youtubeAuthPayload(platform) {
      if (platform !== 'youtube') {
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
    };
    function updatePlatformVisibility() {
      const platform = platformEl.value;
      biliToolsEl.hidden = platform !== 'bilibili';
      youtubeToolsEl.hidden = platform !== 'youtube' && platform !== 'xiaohongshu';
      youtubeAuthToolsEl.hidden = platform !== 'youtube';
      mergeToolsEl.hidden = platform !== 'bilibili' && platform !== 'youtube' && platform !== 'xiaohongshu';
      urlsEl.placeholder = platformPlaceholders[platform] || '请粘贴视频链接，每行一个';
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
      return true;
    }

    const events = new EventSource('/events');
    events.addEventListener('log', (event) => appendLog(JSON.parse(event.data).message));
    events.addEventListener('progress', (event) => setProgress(JSON.parse(event.data).percent));
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
    events.addEventListener('done', (event) => {
      const data = JSON.parse(event.data);
      state.queued = data.queued;
      state.done = data.done;
      state.failed = data.failed;
      updateMetrics();
      setProgress(0);
      if (data.output) appendLog('保存完成：' + data.output);
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
      const response = await fetch('/api/youtube/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          loginBrowser: youtubeLoginBrowserEl.value || 'default',
        }),
      });
      const result = await response.json();
      appendLog(result.ok
        ? (result.reused ? 'YouTube 登录窗口已打开，将继续使用现有窗口。' : '已用 ' + (result.browserLabel || '所选浏览器') + ' 打开 YouTube 登录窗口。登录后点击“确认登录来源”。')
        : '打开 YouTube 登录窗口失败：' + result.error);
      if (result.ok) {
        youtubeAuthEl.value = 'app';
        updateYoutubeAuthHint();
      }
    });
    document.getElementById('youtube-check').addEventListener('click', async () => {
      const auth = youtubeAuthEl.value || 'none';
      if (auth === 'none') {
        updateYoutubeAuthHint();
        appendLog('YouTube 当前设置为不使用登录状态。');
        return;
      }
      const response = await fetch('/api/youtube/check-login', { method: 'POST' });
      const result = await response.json();
      if (result.ok) {
        updateYoutubeStatus(result);
        appendLog(result.hasCookie ? 'YouTube 登录状态已读取。' : '还没有读取到 YouTube 登录状态。');
      } else {
        appendLog('读取 YouTube 登录状态失败：' + result.error);
      }
    });
    youtubeAuthEl.addEventListener('change', updateYoutubeAuthHint);
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
        appendLog('已加入队列：' + result.added + ' 条');
        document.getElementById('urls').value = '';
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
  </script>
</body>
</html>`;
}

export { uiHtml };
