# 木辛说视频下载器

一个面向多平台的视频下载器项目。当前已经迁移并可用的平台：

- 抖音：支持标准视频页和带 `modal_id` 的精选/搜索链接，优先解析无水印播放源。
- Bilibili：支持普通下载和高码率登录状态读取。
- YouTube：通过 `yt-dlp.exe` 下载公开视频，支持本程序登录窗口、画质识别、终止下载；`ffmpeg` 用于高画质音视频合并。
- 快手：通过临时浏览器会话探测公开视频播放源。
- 小红书：通过 `yt-dlp.exe` 解析公开视频，支持 `xiaohongshu.com`、`xhslink.com`、`xhs.cn` 链接。

请仅下载你有权保存和使用的视频，并遵守各平台规则及版权要求。

## 项目结构

```text
src/
  app/                 本地 UI 服务和页面
  assets/              内置“木辛说”石榴树 logo
  core/                平台识别、运行器等通用能力
  platforms/
    douyin/            抖音解析和下载逻辑
    bilibili/          Bilibili 解析和下载逻辑
    youtube/           YouTube / yt-dlp 通用下载逻辑
    kuaishou/          快手公开视频探测逻辑
    xiaohongshu/       小红书 yt-dlp 下载逻辑
    index.mjs          平台注册表
  main.mjs             CLI / UI 入口
scripts/
  build-exe.mjs        Windows 单文件 exe 打包脚本
```

## 开发运行

```powershell
npm.cmd install
npm.cmd run start
```

无参数启动会打开本地 UI。命令行下载示例：

```powershell
npm.cmd run start -- "https://www.douyin.com/jingxuan?modal_id=7654416789203438911" -o videos
```

## 命令行参数

- `-o, --out <dir>`：保存目录，默认当前目录。
- `-n, --name <template>`：文件名模板，默认 `%title%_%id%.mp4`。
- `--quality <quality>`：画质偏好，支持 `best`、`4k`、`2k`、`1080p+`、`1080`、`720`、`540`、`lowest`。
- `--platform <platform>`：指定平台，支持 `douyin`、`bilibili`、`youtube`、`kuaishou`、`xiaohongshu`。
- `--yt-dlp <path>`：yt-dlp 路径，默认使用程序目录下的 `downloads\yt-dlp\yt-dlp.exe`，也可留空自动查找。
- `--yt-dlp-browser <browser>`：从浏览器读取 Cookie，YouTube 登录验证时可用，例如 `chrome`、`edge`、`firefox`、`brave`。
- `--yt-dlp-cookies <path>`：cookies.txt 路径，填写后优先于浏览器 Cookie。
- `--ffmpeg <path>`：ffmpeg 路径，默认使用程序目录下的 `downloads\ffmpeg\ffmpeg-release-essentials`，部分高画质音视频合并需要。

YouTube 遇到“确认不是机器人”时：在程序里点击“登录 YouTube”，在弹出的专用窗口完成登录，再点击“读取登录状态”。程序会自动生成本次下载使用的 cookies 文件，不需要关闭用户平时使用的浏览器。
- `--browser <path>`：手动指定 Chrome 或 Edge。
- `--show-browser`：显示浏览器窗口，适合排查验证码。
- `--overwrite`：覆盖同名文件。
- `--info`：只解析信息，不下载。
- `--timeout <seconds>`：解析超时，默认 180 秒。

## 打包 exe

```powershell
npm.cmd install
npm.cmd run build:exe
```

输出：

```text
dist\muxin-video-downloader.exe
```

仓库里已经包含一个打包好的 Windows 单文件程序：

```text
dist\muxin-video-downloader.exe
```

## 客户安装包

客户版支持 Windows 10/11 x64。安装后不需要客户预装 Node.js、Python、yt-dlp 或 FFmpeg。

```powershell
npm.cmd run build:installer
```

输出：

```text
release\木辛说视频下载器-Setup-x64.exe
release\SHA256SUMS.json
```

安装包内置主程序、yt-dlp、精简 FFmpeg 和 Deno。客户数据与安装目录分离：

- 配置、Cookie、登录资料和可选组件：`%LOCALAPPDATA%\MuxinVideoDownloader`
- 默认下载视频：`%USERPROFILE%\Videos\木辛说视频下载器`
- Whisper 引擎和模型：`%LOCALAPPDATA%\MuxinVideoDownloader\components\whisper`

首次使用音频转文字时，在“环境与组件”中点击“一键安装 Whisper small”。程序优先尝试 Vulkan GPU 组件，失败后自动安装 CPU 版；已配置的旧 Python Whisper 仍可继续使用。

环境诊断：

```powershell
木辛说视频下载器.exe --diagnose
```

AI Key 使用当前 Windows 用户的 DPAPI 加密保存。卸载程序默认保留下载视频，并允许用户选择是否清除配置、登录资料和 Whisper 模型。

### 自动发布

推送 `v*` 标签或手动运行 `.github/workflows/windows-release.yml`，可在 GitHub Actions 中构建安装包并上传到 GitHub Releases。首版未签名，客户应从官方 Releases 下载并核对 SHA-256。

## macOS 安装包

运行 `.github/workflows/macos-release.yml` 会在真实 macOS runner 上构建 universal DMG，同时支持 Intel 与 Apple Silicon：

```bash
npm ci
npm run check:all
npm run build:macos
```

产物为 `release/macos/木辛说视频下载器-macOS-universal.dmg`。应用内置 universal 版本的 Node SEA、yt-dlp、FFmpeg、FFprobe、Deno 和 whisper.cpp CPU 引擎；Whisper 模型仍由用户按需下载。配置与模型保存在 `~/Library/Application Support/MuxinVideoDownloader`，视频默认保存到 `~/Movies/木辛说视频下载器`。

当前 macOS 包使用 ad-hoc 签名，尚未使用 Apple Developer ID 公证。首次打开时如被 Gatekeeper 拦截，可在 Finder 中右键应用并选择“打开”。
