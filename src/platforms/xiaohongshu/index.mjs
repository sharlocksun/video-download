import { downloadWithYtDlp, getYtDlpVideoInfo } from '../youtube/index.mjs';

function supportsXiaohongshuUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'xiaohongshu.com'
      || host.endsWith('.xiaohongshu.com')
      || host === 'xhslink.com'
      || host.endsWith('.xhslink.com')
      || host === 'xhs.cn'
      || host.endsWith('.xhs.cn');
  } catch {
    return false;
  }
}

async function getVideoInfo(url, options = {}) {
  return getYtDlpVideoInfo(url, options, '小红书');
}

async function downloadOne(url, options = {}) {
  return downloadWithYtDlp(url, options, '小红书', 'xiaohongshu');
}

const platform = {
  id: 'xiaohongshu',
  name: '小红书',
  supports: supportsXiaohongshuUrl,
  downloadOne,
};

export { downloadOne, getVideoInfo, platform };
