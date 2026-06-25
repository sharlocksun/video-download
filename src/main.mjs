import { runUiSession } from './app/ui-server.mjs';
import { downloadVideo } from './core/platform-runner.mjs';
import { closeDouyinSession, createDouyinSession } from './platforms/douyin/index.mjs';
import { detectPlatform, findBrowser, getPlatform } from './platforms/index.mjs';

const DEFAULT_TIMEOUT_MS = 180_000;

function printHelp() {
  console.log(`
木辛说视频下载器

Usage:
  muxin-video-downloader.exe <video-url> [more-urls...] [options]
  node src/main.mjs <video-url> [more-urls...] [options]

Options:
  -o, --out <dir>              保存目录。默认：当前目录
  -n, --name <template>        文件名模板。默认：%title%_%id%.mp4
                               可用变量：%id%、%title%、%date%
  --browser <path>             Chrome 或 Edge 可执行文件路径
  --show-browser               显示浏览器窗口
  --keep-profile               保留临时浏览器配置目录，便于排查
  --overwrite                  覆盖同名文件
  --info                       只解析信息，不下载
  --quality <quality>          画质偏好：best、4k、2k、1080p60、1080p+、1080、720、540、480、360、lowest。默认：best
  --platform <platform>        指定平台：douyin、bilibili、youtube、kuaishou、xiaohongshu
  --bilibili-cookie <cookie>   使用你自己浏览器里的 Bilibili Cookie
  --ffmpeg <path>              ffmpeg 路径；可留空自动查找程序目录下的 downloads 文件夹
  --yt-dlp <path>              yt-dlp 路径；可留空自动查找程序目录或 downloads 文件夹
  --yt-dlp-cookies <path>      cookies.txt 路径；YouTube 登录验证时使用
  --yt-dlp-browser <browser>   从浏览器读取 Cookie：chrome、edge、firefox、brave
  --timeout <seconds>          页面/视频检测超时。默认：180
  -h, --help                   显示帮助

Examples:
  muxin-video-downloader.exe https://www.douyin.com/video/7645407223488728347
  node src/main.mjs "https://www.bilibili.com/video/BV1ZEjz6nEQh/" --quality 720 -o videos
`);
}

function parseArgs(argv) {
  const options = {
    outDir: process.cwd(),
    nameTemplate: '%title%_%id%.mp4',
    browser: null,
    showBrowser: false,
    keepProfile: false,
    overwrite: false,
    infoOnly: false,
    quality: 'best',
    platform: '',
    bilibiliCookieHeader: '',
    ffmpegPath: '',
    ytDlpPath: '',
    ytDlpCookiesPath: '',
    ytDlpCookiesFromBrowser: '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    urls: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-o' || arg === '--out') {
      options.outDir = argv[++i];
    } else if (arg === '-n' || arg === '--name') {
      options.nameTemplate = argv[++i];
    } else if (arg === '--browser') {
      options.browser = argv[++i];
    } else if (arg === '--show-browser') {
      options.showBrowser = true;
    } else if (arg === '--keep-profile') {
      options.keepProfile = true;
    } else if (arg === '--overwrite') {
      options.overwrite = true;
    } else if (arg === '--info') {
      options.infoOnly = true;
    } else if (arg === '--quality') {
      options.quality = String(argv[++i] || 'best').toLowerCase();
    } else if (arg === '--platform') {
      options.platform = String(argv[++i] || '').toLowerCase();
    } else if (arg === '--bilibili-cookie') {
      options.bilibiliCookieHeader = String(argv[++i] || '');
    } else if (arg === '--ffmpeg') {
      options.ffmpegPath = String(argv[++i] || '');
    } else if (arg === '--yt-dlp') {
      options.ytDlpPath = String(argv[++i] || '');
    } else if (arg === '--yt-dlp-cookies') {
      options.ytDlpCookiesPath = String(argv[++i] || '');
    } else if (arg === '--yt-dlp-browser') {
      options.ytDlpCookiesFromBrowser = String(argv[++i] || '');
    } else if (arg === '--timeout') {
      const seconds = Number(argv[++i]);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('--timeout 必须是正数秒数');
      }
      options.timeoutMs = seconds * 1000;
    } else if (arg?.startsWith('-')) {
      throw new Error(`未知选项：${arg}`);
    } else {
      options.urls.push(arg);
    }
  }

  if (!options.help && options.urls.length === 0) {
    throw new Error('请提供至少一个视频链接，或不带参数启动 UI。');
  }

  return options;
}

function isDouyinJob(url, options) {
  const selectedPlatform = options.platform ? getPlatform(options.platform) : null;
  if (selectedPlatform && !selectedPlatform.supports(url)) {
    return false;
  }
  const platform = selectedPlatform || detectPlatform(url);
  return platform?.id === 'douyin';
}

async function main() {
  if (process.argv.length <= 2 && process.stdin.isTTY) {
    await runUiSession();
    return;
  }

  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const browserPath = await findBrowser(options.browser);
  const outputs = [];
  let douyinSession = null;
  try {
    for (const url of options.urls) {
      let jobOptions = options;
      if (isDouyinJob(url, options)) {
        if (!douyinSession) {
          console.log('抖音批量任务将复用同一个浏览器窗口。');
          douyinSession = await createDouyinSession(browserPath, {
            timeoutMs: options.timeoutMs,
          });
        }
        jobOptions = { ...options, douyinSession };
      } else if (douyinSession) {
        await closeDouyinSession(douyinSession, options).catch(() => {});
        douyinSession = null;
      }
      outputs.push(await downloadVideo(url, jobOptions, browserPath));
    }
  } finally {
    if (douyinSession) {
      await closeDouyinSession(douyinSession, options).catch(() => {});
    }
  }

  const downloaded = outputs.filter(Boolean);
  if (downloaded.length) {
    console.log('\nDownloaded files:');
    for (const file of downloaded) {
      console.log(`  ${file}`);
    }
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
