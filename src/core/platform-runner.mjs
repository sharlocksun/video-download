import { detectPlatform, getPlatform } from '../platforms/index.mjs';

function platformLabel(platform) {
  return platform ? `${platform.name}(${platform.id})` : '未知平台';
}

async function downloadVideo(url, options, browserPath) {
  const selectedPlatform = options?.platform ? getPlatform(options.platform) : null;
  const platform = selectedPlatform || detectPlatform(url);
  if (!platform) {
    throw new Error(`暂不支持这个链接的平台：${url}`);
  }
  if (selectedPlatform && !selectedPlatform.supports(url)) {
    throw new Error(`当前选择的平台是 ${selectedPlatform.name}，但这个链接不属于该平台：${url}`);
  }
  options?.onLog?.(`平台识别：${platformLabel(platform)}`);
  return platform.downloadOne(url, options, browserPath);
}

export { downloadVideo, platformLabel };
