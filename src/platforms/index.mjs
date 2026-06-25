import { platform as douyinPlatform, findBrowser as findDouyinBrowser } from './douyin/index.mjs';
import { platform as bilibiliPlatform } from './bilibili/index.mjs';
import { platform as youtubePlatform } from './youtube/index.mjs';
import { platform as kuaishouPlatform } from './kuaishou/index.mjs';
import { platform as xiaohongshuPlatform } from './xiaohongshu/index.mjs';

const platforms = [douyinPlatform, bilibiliPlatform, youtubePlatform, kuaishouPlatform, xiaohongshuPlatform];

function detectPlatform(url) {
  return platforms.find((platform) => platform.supports(url)) || null;
}

function getPlatform(id) {
  return platforms.find((platform) => platform.id === id) || null;
}

async function findBrowser(explicitPath) {
  return findDouyinBrowser(explicitPath);
}

export { platforms, detectPlatform, findBrowser, getPlatform };
