import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveInstallDir } from './app-paths.mjs';

const UPDATE_REPO = 'sharlocksun/video-download';

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const difference = (pa[i] || 0) - (pb[i] || 0);
    if (difference) return difference;
  }
  return 0;
}

async function currentVersion() {
  try {
    const pkg = JSON.parse(await readFile(path.join(resolveInstallDir(), 'version.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return process.env.MUXIN_APP_VERSION || '0.1.0';
  }
}

async function checkForUpdates() {
  const current = await currentVersion();
  const response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: { 'user-agent': 'MuxinVideoDownloader' },
  });
  if (!response.ok) throw new Error(`更新检查失败：HTTP ${response.status}`);
  const release = await response.json();
  const latest = String(release.tag_name || '').replace(/^v/, '');
  const matcher = process.platform === 'darwin' ? /\.dmg$/i : /Setup-x64\.exe$/i;
  const asset = (release.assets || []).find((item) => matcher.test(item.name));
  return {
    current,
    latest,
    available: Boolean(latest && compareVersions(latest, current) > 0),
    url: asset?.browser_download_url || release.html_url || '',
    name: asset?.name || '',
    notes: String(release.body || '').slice(0, 4000),
  };
}

export { checkForUpdates, compareVersions };
