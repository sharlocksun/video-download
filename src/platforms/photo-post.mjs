import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { makeTempDir } from '../core/temp-dir.mjs';
import { findFfmpeg } from './bilibili/index.mjs';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function reportLog(options, message) {
  options?.onLog?.(message);
  console.log(message);
}

function reportProgress(options, payload) {
  options?.onProgress?.(payload);
}

function sanitizeFilePart(value, fallback = 'untitled', maxLength = 120) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '');
  return (cleaned || fallback).slice(0, maxLength);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function outputFileName(template, info, platformSlug) {
  const date = new Date().toISOString().slice(0, 10);
  const title = sanitizeFilePart(info.title, platformSlug, 80);
  const id = sanitizeFilePart(info.id, 'post');
  const rendered = String(template || '%title%_%id%.mp4')
    .replaceAll('%id%', id)
    .replaceAll('%title%', title)
    .replaceAll('%date%', date);
  const safe = sanitizeFilePart(rendered, `${platformSlug}_${id}.mp4`);
  return path.extname(safe) ? safe : `${safe}.mp4`;
}

async function buildMaterialPaths(outDir, template, info, overwrite, platformSlug) {
  const parsed = path.parse(path.resolve(outDir, outputFileName(template, info, platformSlug)));
  for (let index = 0; index < 1000; index += 1) {
    const baseName = index === 0 ? parsed.name : `${parsed.name}_${index}`;
    const materialDir = path.join(parsed.dir, baseName);
    if (!overwrite && await exists(materialDir)) continue;
    if (overwrite) await rm(materialDir, { recursive: true, force: true });
    await mkdir(materialDir, { recursive: true });
    return {
      baseName,
      materialDir,
      outputPath: path.join(materialDir, `${baseName}.mp4`),
    };
  }
  throw new Error(`无法找到可用作品文件夹：${parsed.name}`);
}

function imageExtension(image = {}) {
  const explicit = String(image.ext || '').replace(/^\./, '').toLowerCase();
  if (/^(?:jpe?g|png|webp|avif)$/.test(explicit)) return explicit === 'jpeg' ? 'jpg' : explicit;
  try {
    const matched = new URL(image.src).pathname.match(/\.(jpe?g|png|webp|avif)(?:$|[!_])/i);
    if (matched) return matched[1].toLowerCase().replace('jpeg', 'jpg');
  } catch {}
  return 'jpg';
}

async function downloadFile(urls, outputPath, headers, options = {}, onProgress = null) {
  let lastError = null;
  for (const url of [...new Set(urls.filter(Boolean))]) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        if (options.signal?.aborted) throw new Error('任务已终止');
        const response = await fetch(url, { headers, signal: options.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!response.body) throw new Error('媒体响应没有可读取内容');
        const total = Number(response.headers.get('content-length')) || null;
        const reader = response.body.getReader();
        const file = createWriteStream(outputPath);
        let downloaded = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            downloaded += value.byteLength;
            if (!file.write(Buffer.from(value))) await once(file, 'drain');
            onProgress?.(total ? downloaded / total : 0);
          }
        } finally {
          file.end();
          await once(file, 'finish');
        }
        onProgress?.(1);
        return await stat(outputPath);
      } catch (error) {
        lastError = error;
        await rm(outputPath, { force: true }).catch(() => {});
        if (options.signal?.aborted || /任务已终止|aborted|abort/i.test(String(error?.message || error))) throw error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }
  throw lastError || new Error('没有可用的媒体地址');
}

async function runSlideshow(ffmpegPath, imagePaths, audioPath, duration, outputPath, dimensions, options = {}) {
  const totalDuration = Math.max(Number(duration) || imagePaths.length * 3, imagePaths.length);
  const imageDuration = totalDuration / imagePaths.length;
  const width = dimensions.width;
  const height = dimensions.height;
  const args = ['-hide_banner', '-loglevel', 'warning', '-y'];
  for (const imagePath of imagePaths) {
    args.push('-loop', '1', '-framerate', '30', '-t', imageDuration.toFixed(3), '-i', imagePath);
  }
  if (audioPath) args.push('-stream_loop', '-1', '-i', audioPath);
  const filters = imagePaths.map((_, index) => (
    `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,`
    + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,`
    + `setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v${index}]`
  ));
  filters.push(`${imagePaths.map((_, index) => `[v${index}]`).join('')}concat=n=${imagePaths.length}:v=1:a=0[vout]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (audioPath) args.push('-map', `${imagePaths.length}:a:0?`, '-c:a', 'aac', '-b:a', '192k', '-shortest');
  else args.push('-an', '-t', totalDuration.toFixed(3));
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', outputPath);

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const abort = () => {
      proc.kill();
      reject(new Error('任务已终止'));
    };
    if (options.signal?.aborted) return abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    proc.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12_000); });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      options.signal?.removeEventListener('abort', abort);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg 生成相册视频失败（退出码 ${code}）：${stderr.trim()}`));
    });
  });
}

function isPhotoPostInfo(info) {
  return info?.kind === 'photo' && Array.isArray(info.images) && info.images.length > 0;
}

async function downloadPhotoPost(info, options = {}, config = {}) {
  if (!isPhotoPostInfo(info)) throw new Error('当前作品没有可下载图片');
  const platformSlug = config.platformSlug || info.platform || 'photo';
  await mkdir(path.resolve(options.outDir), { recursive: true });
  const paths = await buildMaterialPaths(options.outDir, options.nameTemplate, info, options.overwrite, platformSlug);
  const imagePaths = [];
  const requestHeaders = (url, kind) => {
    const headers = { 'User-Agent': USER_AGENT };
    if (!config.omitReferer && (info.webpageUrl || info.href)) headers.Referer = info.webpageUrl || info.href;
    return {
      ...headers,
      ...(typeof config.headersForUrl === 'function' ? config.headersForUrl(url, kind, info) : config.headers || {}),
    };
  };

  reportLog(options, `  检测到${config.platformName || platformSlug}图文作品：${info.images.length} 张图片。`);
  for (let index = 0; index < info.images.length; index += 1) {
    const image = info.images[index];
    const ext = imageExtension(image);
    const imagePath = path.join(paths.materialDir, `图片_${String(index + 1).padStart(2, '0')}.${ext}`);
    await downloadFile([image.src, ...(image.alternatives || [])], imagePath, requestHeaders(image.src, 'image'), options, (ratio) => {
      reportProgress(options, {
        percent: 5 + ((index + ratio) / info.images.length) * 65,
        outputPath: paths.outputPath,
      });
    });
    imagePaths.push(imagePath);
  }

  const videoItems = Array.isArray(info.videos) ? info.videos : [];
  for (let index = 0; index < videoItems.length; index += 1) {
    const video = videoItems[index];
    const videoPath = path.join(paths.materialDir, `视频_${String(index + 1).padStart(2, '0')}.${String(video.ext || 'mp4').replace(/^\./, '')}`);
    await downloadFile([video.src, ...(video.alternatives || [])], videoPath, requestHeaders(video.src, 'video'), options, (ratio) => {
      reportProgress(options, {
        percent: 70 + ((index + ratio) / videoItems.length) * 10,
        outputPath: paths.outputPath,
      });
    });
  }

  const ffmpegPath = await findFfmpeg(options.ffmpegPath);
  if (!ffmpegPath) {
    reportLog(options, `  原图已保存到：${paths.materialDir}`);
    reportLog(options, '  未找到 FFmpeg，因此没有生成相册视频。');
    reportProgress(options, { percent: 100, outputPath: imagePaths[0] });
    return imagePaths[0];
  }

  const tempDir = await makeTempDir(`${platformSlug}-photo-audio`);
  let audioPath = '';
  try {
    if (info.audioSrc) {
      audioPath = path.join(tempDir, 'background-audio.m4a');
      try {
        await downloadFile([info.audioSrc, ...(info.audioAlternatives || [])], audioPath, requestHeaders(info.audioSrc, 'audio'), options, (ratio) => {
          reportProgress(options, { percent: 80 + ratio * 7, outputPath: paths.outputPath });
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        audioPath = '';
        reportLog(options, `  背景音乐下载失败，将生成无声相册视频：${error.message}`);
      }
    }
    const firstImage = info.images[0] || {};
    const landscape = Number(firstImage.width) > Number(firstImage.height);
    reportProgress(options, { percent: 88, outputPath: paths.outputPath });
    reportLog(options, '  原图下载完成，正在生成相册视频...');
    await runSlideshow(
      ffmpegPath,
      imagePaths,
      audioPath,
      info.duration,
      paths.outputPath,
      landscape ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 },
      options,
    );
    reportLog(options, `  图文作品已整理到：${paths.materialDir}`);
    reportProgress(options, { percent: 100, outputPath: paths.outputPath });
    return paths.outputPath;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export { downloadPhotoPost, isPhotoPostInfo };
