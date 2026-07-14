import { downloadWithYtDlp, getYtDlpVideoInfo } from '../youtube/index.mjs';

function supportsInstagramUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'instagram.com'
      || host.endsWith('.instagram.com')
      || host === 'instagr.am'
      || host.endsWith('.instagr.am');
  } catch {
    return false;
  }
}

async function getVideoInfo(url, options = {}) {
  return getYtDlpVideoInfo(url, options, 'Instagram');
}

async function downloadOne(url, options = {}) {
  return downloadWithYtDlp(url, options, 'Instagram', 'instagram');
}

const platform = {
  id: 'instagram',
  name: 'Instagram',
  supports: supportsInstagramUrl,
  downloadOne,
};

export { downloadOne, getVideoInfo, platform };
