import { spawn } from 'node:child_process';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, removeTempDir } from '../core/temp-dir.mjs';
import { resolveComponentsDir } from '../core/app-paths.mjs';

async function assertReadableFile(filePath) {
  const resolved = path.resolve(String(filePath || '').trim());
  if (!resolved) throw new Error('请先填写已下载视频/音频文件路径。');
  await access(resolved);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error('填写的路径不是文件。');
  return resolved;
}

async function extractAudioWithFfmpeg(ffmpegPath, inputPath, outputPath) {
  if (!ffmpegPath) throw new Error('没有找到 ffmpeg，无法从本地视频提取音频。');
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '64k',
      outputPath,
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('ffmpeg 提取音频超时。'));
    }, 180_000);
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error((stderr || `ffmpeg exited with code ${code}`).trim()));
    });
  });
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveWhisperCommand(whisperPath) {
  const raw = String(whisperPath || '').trim() || path.join(resolveComponentsDir(), 'whisper');
  const resolved = path.resolve(raw);
  const info = await stat(resolved).catch(() => null);
  if (info?.isFile()) {
    const lower = path.basename(resolved).toLowerCase();
    if (lower === 'python.exe' || lower === 'python') return { command: resolved, argsPrefix: ['-m', 'whisper'] };
    return { command: resolved, argsPrefix: [] };
  }
  const candidates = [
    path.join(resolved, 'Scripts', 'python.exe'),
    path.join(resolved, 'python.exe'),
    path.join(resolved, 'Scripts', 'whisper.exe'),
    path.join(resolved, 'whisper.exe'),
    path.join(resolved, 'bin', 'python3'),
    path.join(resolved, 'bin', 'python'),
    path.join(resolved, 'bin', 'whisper'),
  ];
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    const lower = path.basename(candidate).toLowerCase();
    if (lower === 'python.exe' || lower === 'python') return { command: candidate, argsPrefix: ['-m', 'whisper'] };
    return { command: candidate, argsPrefix: [] };
  }
  throw new Error(`没有找到本地 Whisper。请确认路径存在：${raw}`);
}

function resolveWhisperRoot(whisperPath) {
  const raw = String(whisperPath || '').trim() || path.join(resolveComponentsDir(), 'whisper');
  const resolved = path.resolve(raw);
  const baseName = path.basename(resolved).toLowerCase();
  if (['python.exe', 'pythonw.exe', 'whisper.exe'].includes(baseName)) {
    const parent = path.dirname(resolved);
    return path.basename(parent).toLowerCase() === 'scripts' ? path.dirname(parent) : parent;
  }
  if (['python', 'python3', 'whisper'].includes(baseName)) {
    const parent = path.dirname(resolved);
    if (path.basename(parent).toLowerCase() === 'bin') return path.dirname(parent);
  }
  return resolved;
}

function isPythonCommand(command) {
  const lower = path.basename(command || '').toLowerCase();
  return lower === 'python.exe' || lower === 'python' || lower === 'python3';
}

async function detectWhisperDevice(whisper, whisperPath) {
  const root = resolveWhisperRoot(whisperPath);
  const candidates = isPythonCommand(whisper.command)
    ? [whisper.command]
    : [
        path.join(root, 'python.exe'),
        path.join(root, 'Scripts', 'python.exe'),
        path.join(root, 'bin', 'python3'),
        path.join(root, 'bin', 'python'),
      ];
  const code = [
    'import torch',
    "print('cuda' if torch.cuda.is_available() else 'cpu')",
    "print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')",
  ].join('; ');
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    try {
      const result = await new Promise((resolve) => {
        const proc = spawn(candidate, ['-c', code], {
          env: {
            ...process.env,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          proc.kill();
          resolve({ ok: false, stderr: 'device check timeout' });
        }, 15_000);
        proc.stdout.setEncoding('utf8');
        proc.stderr.setEncoding('utf8');
        proc.stdout.on('data', (chunk) => { stdout += chunk; });
        proc.stderr.on('data', (chunk) => { stderr += chunk; });
        proc.on('error', (error) => {
          clearTimeout(timer);
          resolve({ ok: false, stderr: error.message });
        });
        proc.on('exit', (code) => {
          clearTimeout(timer);
          resolve({ ok: code === 0, stdout, stderr });
        });
      });
      if (!result.ok) continue;
      const lines = String(result.stdout || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      if (lines[0] === 'cuda') return { device: 'cuda', name: lines[1] || 'CUDA GPU' };
      return { device: 'cpu', name: '' };
    } catch {
      // Try the next local Python candidate before falling back to CPU.
    }
  }
  return { device: 'cpu', name: '' };
}

function languageArg(language) {
  if (language === 'zh') return 'Chinese';
  if (language === 'en') return 'English';
  return '';
}

function ffmpegPathEnv(ffmpegPath) {
  if (!ffmpegPath) return '';
  const lower = path.basename(ffmpegPath).toLowerCase();
  return lower === 'ffmpeg.exe' || lower === 'ffmpeg' ? path.dirname(ffmpegPath) : ffmpegPath;
}

async function newestTextFile(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.txt')) continue;
    const filePath = path.join(dir, entry.name);
    const info = await stat(filePath);
    files.push({ filePath, mtimeMs: info.mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || '';
}

async function listFilesRecursive(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(filePath));
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(filePath);
    files.push({ filePath, mtimeMs: info.mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

async function newestTranscriptFile(dir) {
  const files = await listFilesRecursive(dir);
  for (const ext of ['.txt', '.json', '.srt', '.vtt', '.tsv']) {
    const file = files.find((item) => path.extname(item.filePath).toLowerCase() === ext);
    if (file) return file.filePath;
  }
  return '';
}

function cleanSubtitleLikeText(text = '') {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^WEBVTT|^NOTE|^STYLE/i.test(line))
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s+-->/i.test(line))
    .filter((line) => !/^(?:start|end|text)\t/i.test(line))
    .map((line) => line
      .replace(/^\d+(?:[.,]\d+)?\t\d+(?:[.,]\d+)?\t/, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
    .join('\n');
}

async function readTranscriptOutput(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const raw = await readFile(filePath, 'utf8');
  if (ext === '.json') {
    const parsed = JSON.parse(raw);
    if (String(parsed.text || '').trim()) return String(parsed.text).trim();
    if (Array.isArray(parsed.segments)) {
      return parsed.segments.map((item) => String(item?.text || '').trim()).filter(Boolean).join('\n');
    }
    return '';
  }
  if (ext === '.txt') return raw.trim();
  return cleanSubtitleLikeText(raw);
}

function tailText(text = '', maxLength = 1600) {
  const clean = String(text || '').trim();
  return clean.length > maxLength ? clean.slice(-maxLength) : clean;
}

async function transcribeWithPythonWhisper(filePath, ffmpegPath, options = {}) {
  const inputPath = await assertReadableFile(filePath);
  const tempDir = await makeTempDir('muxin-whisper');
  let keepTempDir = false;
  try {
    options.onProgress?.({ percent: 8, stage: 'prepare', message: '正在准备本地视频/音频...' });
    const whisper = await resolveWhisperCommand(options.whisperPath);
    const modelDir = path.join(resolveWhisperRoot(options.whisperPath), 'models');
    const language = languageArg(options.language || 'auto');
    const device = await detectWhisperDevice(whisper, options.whisperPath);
    options.onProgress?.({
      percent: 18,
      stage: 'model',
      message: device.device === 'cuda'
        ? `正在加载 Whisper ${options.model || 'small'} 模型，使用 GPU：${device.name}...`
        : `正在加载 Whisper ${options.model || 'small'} 模型，当前使用 CPU...`,
    });
    const args = [
      ...whisper.argsPrefix,
      inputPath,
      '--model',
      String(options.model || 'small'),
      '--model_dir',
      modelDir,
      '--task',
      'transcribe',
      '--device',
      device.device,
      '--output_format',
      'all',
      '--output_dir',
      tempDir,
    ];
    if (language) args.push('--language', language);
    const extraPath = ffmpegPathEnv(ffmpegPath);
    const env = {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      PATH: extraPath ? `${extraPath}${path.delimiter}${process.env.PATH || ''}` : process.env.PATH,
    };
    const startedAt = Date.now();
    const processOutput = await new Promise((resolve, reject) => {
      const proc = spawn(whisper.command, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stderr = '';
      let stdout = '';
      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');
      const handleOutput = (chunk) => {
        const text = String(chunk || '');
        const matched = text.match(/(\d{1,3})%\|/);
        if (matched) {
          const rawPercent = Math.max(0, Math.min(100, Number(matched[1]) || 0));
          options.onProgress?.({
            percent: Math.max(25, Math.min(92, 25 + rawPercent * 0.67)),
            stage: 'transcribe',
            message: `Whisper 正在识别语音 ${rawPercent}%...`,
          });
          return;
        }
        const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        options.onProgress?.({
          percent: 45,
          stage: 'transcribe',
          message: `Whisper 正在识别语音，已用时 ${elapsed} 秒...`,
        });
      };
      proc.stdout.on('data', (chunk) => {
        stdout += chunk;
        handleOutput(chunk);
      });
      proc.stderr.on('data', (chunk) => {
        stderr += chunk;
        handleOutput(chunk);
      });
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error((stderr || stdout || `whisper exited with code ${code}`).trim()));
      });
    });
    options.onProgress?.({ percent: 94, stage: 'finalize', message: '正在整理转写文本...' });
    const textFile = await newestTextFile(tempDir);
    const outputFile = textFile || await newestTranscriptFile(tempDir);
    if (!outputFile) {
      keepTempDir = true;
      const files = (await listFilesRecursive(tempDir)).map((item) => path.relative(tempDir, item.filePath));
      const detail = [
        'Whisper 已结束，但没有生成可读取的转写文件。',
        `输出目录已保留：${tempDir}`,
        files.length ? `已生成文件：${files.join(', ')}` : '输出目录为空。',
        tailText(processOutput.stderr || processOutput.stdout) ? `最近输出：${tailText(processOutput.stderr || processOutput.stdout)}` : '',
      ].filter(Boolean).join('\n');
      throw new Error(detail);
    }
    const text = await readTranscriptOutput(outputFile);
    if (!text.trim()) {
      keepTempDir = true;
      throw new Error(`Whisper 生成了结果文件，但内容为空：${outputFile}\n输出目录已保留：${tempDir}`);
    }
    return {
      inputPath,
      text: text.trim(),
    };
  } finally {
    if (!keepTempDir) await removeTempDir(tempDir);
  }
}


async function resolveWhisperCpp(options = {}) {
  const roots = [
    String(options.whisperPath || '').trim(),
    path.join(resolveComponentsDir(), 'whisper'),
  ].filter(Boolean);
  const enginePreference = String(options.engine || 'auto');
  const backendPreference = String(options.forceBackend || 'auto');
  const engineDirs = enginePreference === 'python' ? [] : backendPreference === 'cpu' ? ['engine-cpu', ''] : backendPreference === 'vulkan' ? ['engine-vulkan'] : ['engine-vulkan', 'engine-cpu', ''];
  const executableNames = ['whisper-cli.exe', 'main.exe', 'whisper-cli', 'main'];
  for (const root of roots) {
    for (const engineDir of engineDirs) {
      for (const name of executableNames) {
        const candidate = path.join(root, engineDir, 'Release', name);
        if (await exists(candidate)) return { command: candidate, backend: engineDir.includes('vulkan') ? 'vulkan' : 'cpu', root };
        const flatCandidate = path.join(root, engineDir, name);
        if (await exists(flatCandidate)) return { command: flatCandidate, backend: engineDir.includes('vulkan') ? 'vulkan' : 'cpu', root };
      }
    }
  }
  return null;
}

async function diagnoseWhisperSelection(options = {}) {
  const configuredPath = String(options.whisperPath || '').trim();
  const engine = String(options.engine || 'auto');
  const model = String(options.model || 'small').replace(/\.pt$/i, '');
  let pythonError = null;

  if (configuredPath && (engine === 'auto' || engine === 'python')) {
    try {
      const whisper = await resolveWhisperCommand(configuredPath);
      const device = await detectWhisperDevice(whisper, configuredPath);
      const modelPath = path.join(resolveWhisperRoot(configuredPath), 'models', `${model}.pt`);
      const modelInstalled = await exists(modelPath);
      return {
        configured: true,
        engineAvailable: true,
        modelInstalled,
        kind: 'python',
        path: configuredPath,
        command: whisper.command,
        model,
        modelPath,
        device: device.device,
        gpuName: device.name || '',
        error: modelInstalled ? '' : `没有找到模型文件：${modelPath}`,
      };
    } catch (error) {
      pythonError = error;
      if (engine === 'python') {
        return {
          configured: true,
          engineAvailable: false,
          modelInstalled: false,
          kind: 'python',
          path: configuredPath,
          model,
          error: error.message,
        };
      }
    }
  }

  const forceBackend = engine === 'whisper-cpp-cpu'
    ? 'cpu'
    : engine === 'whisper-cpp-vulkan'
      ? 'vulkan'
      : 'auto';
  const cpp = await resolveWhisperCpp({
    whisperPath: configuredPath,
    engine,
    forceBackend,
  });
  if (cpp) {
    const modelPath = (await Promise.all(
      whisperCppModelPath({ model }, cpp.root).map(async (item) => await exists(item) ? item : ''),
    )).find(Boolean) || whisperCppModelPath({ model }, cpp.root)[0];
    const modelInstalled = await exists(modelPath);
    return {
      configured: Boolean(configuredPath),
      engineAvailable: true,
      modelInstalled,
      kind: 'whisper-cpp',
      path: cpp.root,
      command: cpp.command,
      model,
      modelPath,
      device: cpp.backend,
      gpuName: '',
      error: modelInstalled ? '' : `没有找到模型文件：${modelPath}`,
    };
  }

  return {
    configured: Boolean(configuredPath),
    engineAvailable: false,
    modelInstalled: false,
    kind: engine === 'python' ? 'python' : 'none',
    path: configuredPath,
    model,
    error: pythonError?.message || '没有找到可用的本地 Whisper 转写引擎。',
  };
}

function whisperCppModelPath(options = {}, root = '') {
  const model = String(options.model || 'small').replace(/^ggml-/, '').replace(/\.bin$/i, '');
  const candidates = [
    path.join(root, 'models', `ggml-${model}.bin`),
    path.join(resolveComponentsDir(), 'whisper', 'models', `ggml-${model}.bin`),
  ];
  return candidates;
}

async function transcribeWithWhisperCpp(filePath, ffmpegPath, options = {}) {
  const inputPath = await assertReadableFile(filePath);
  const whisper = await resolveWhisperCpp(options);
  if (!whisper) throw new Error('没有找到 whisper.cpp 转写引擎。');
  const modelCandidates = whisperCppModelPath(options, whisper.root);
  const modelPath = (await Promise.all(modelCandidates.map(async (item) => await exists(item) ? item : ''))).find(Boolean);
  if (!modelPath) throw new Error(`没有安装 Whisper ${options.model || 'small'} 模型，请在“环境与组件”中安装。`);
  const tempDir = await makeTempDir('muxin-whisper-cpp');
  try {
    options.onProgress?.({ percent: 8, stage: 'prepare', message: '正在提取 16kHz 单声道音频...' });
    const wavPath = path.join(tempDir, 'audio.wav');
    await extractAudioWithFfmpeg(ffmpegPath, inputPath, wavPath);
    const outputPrefix = path.join(tempDir, 'transcript');
    const language = options.language === 'zh' ? 'zh' : options.language === 'en' ? 'en' : 'auto';
    options.onProgress?.({ percent: 18, stage: 'model', message: `正在加载 Whisper ${options.model || 'small'} 模型，使用 ${whisper.backend === 'vulkan' ? 'GPU（Vulkan）' : 'CPU'}...` });
    const args = ['-m', modelPath, '-f', wavPath, '-l', language, '-otxt', '-of', outputPrefix, '-np'];
    const startedAt = Date.now();
    await new Promise((resolve, reject) => {
      const proc = spawn(whisper.command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      let stderr = '';
      const onData = (chunk) => {
        const text = String(chunk || '');
        const match = text.match(/(?:progress\s*=|\b)(\d{1,3})%/i);
        const raw = match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
        const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        options.onProgress?.({ percent: raw === null ? 45 : Math.max(22, Math.min(92, 22 + raw * .7)), stage: 'transcribe', message: raw === null ? `Whisper 正在识别语音，已用时 ${elapsed} 秒...` : `Whisper 正在识别语音 ${raw}%...` });
      };
      proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => { stdout += chunk; onData(chunk); });
      proc.stderr.on('data', (chunk) => { stderr += chunk; onData(chunk); });
      proc.on('error', reject);
      proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error((stderr || stdout || `whisper.cpp exited with code ${code}`).trim())));
    });
    const outputFile = `${outputPrefix}.txt`;
    const text = (await readFile(outputFile, 'utf8')).trim();
    if (!text) throw new Error('whisper.cpp 没有生成有效文字。');
    options.onProgress?.({ percent: 96, stage: 'finalize', message: '正在整理转写文本...' });
    return { inputPath, text, engine: 'whisper-cpp', backend: whisper.backend };
  } finally {
    await removeTempDir(tempDir);
  }
}

async function transcribeWithWhisper(filePath, ffmpegPath, options = {}) {
  const engine = String(options.engine || 'auto');
  const configuredPath = String(options.whisperPath || '').trim();
  const bundledWhisperPath = path.resolve(path.join(resolveComponentsDir(), 'whisper'));
  const hasCustomWhisperPath = Boolean(configuredPath) && path.resolve(configuredPath) !== bundledWhisperPath;
  const tryPythonFirst = engine === 'python' || (engine === 'auto' && hasCustomWhisperPath);

  if (tryPythonFirst) {
    try {
      const whisper = await resolveWhisperCommand(configuredPath);
      const device = await detectWhisperDevice(whisper, configuredPath);
      options.onProgress?.({
        percent: 5,
        stage: 'engine',
        message: device.device === 'cuda'
          ? `已检测到用户配置的 Python Whisper，将优先使用 GPU：${device.name}。`
          : '已检测到用户配置的 Python Whisper，将优先使用该引擎（CPU）。',
      });
      return await transcribeWithPythonWhisper(filePath, ffmpegPath, options);
    } catch (error) {
      if (engine === 'python') throw error;
      options.onProgress?.({
        percent: 10,
        stage: 'fallback',
        message: `用户配置的 Whisper 不可用，正在自动回退到内置引擎：${error.message}`,
      });
    }
  }

  if (engine !== 'python') {
    const forceBackend = engine === 'whisper-cpp-cpu'
      ? 'cpu'
      : engine === 'whisper-cpp-vulkan'
        ? 'vulkan'
        : options.forceBackend;
    const cppOptions = { ...options, forceBackend };
    const cpp = await resolveWhisperCpp(cppOptions);
    if (cpp) {
      try {
        options.onProgress?.({
          percent: 12,
          stage: 'engine',
          message: cpp.backend === 'vulkan'
            ? '正在使用 whisper.cpp Vulkan GPU 引擎。'
            : '正在使用内置 whisper.cpp CPU 引擎。',
        });
        return await transcribeWithWhisperCpp(filePath, ffmpegPath, cppOptions);
      } catch (error) {
        if (cpp.backend !== 'vulkan') throw error;
        const cpu = await resolveWhisperCpp({ ...options, forceBackend: 'cpu' });
        if (!cpu) throw error;
        options.onProgress?.({ percent: 16, stage: 'fallback', message: 'GPU 加速启动失败，正在自动切换到内置 CPU 转写...' });
        return transcribeWithWhisperCpp(filePath, ffmpegPath, { ...options, forceBackend: 'cpu' });
      }
    }
    if (engine.startsWith('whisper-cpp')) throw new Error('whisper.cpp 尚未安装，请打开“环境与组件”进行安装。');
  }
  return transcribeWithPythonWhisper(filePath, ffmpegPath, options);
}async function transcribeLocalMedia(filePath, ffmpegPath, aiConfig, options = {}) {
  const inputPath = await assertReadableFile(filePath);
  return transcribeWithWhisper(inputPath, ffmpegPath, {
    whisperPath: options.whisperPath || aiConfig.whisperPath,
    engine: options.whisperEngine || aiConfig.whisperEngine || 'auto',
    model: options.whisperModel || aiConfig.whisperModel,
    language: options.whisperLanguage || aiConfig.whisperLanguage,
    onProgress: options.onProgress,
  });
}

export {
  diagnoseWhisperSelection,
  transcribeLocalMedia,
  transcribeWithWhisper,
  transcribeWithWhisperCpp,
};
