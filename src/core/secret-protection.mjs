import { spawn } from 'node:child_process';

const DPAPI_PREFIX = 'dpapi:';
const KEYCHAIN_PREFIX = 'keychain:';
const KEYCHAIN_SERVICE = 'MuxinVideoDownloader';
const KEYCHAIN_ACCOUNT = 'ai-api-key';

function runCommand(command, args, input = '') {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', reject);
    proc.on('exit', (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error((stderr || `${command} exited with code ${code}`).trim())));
    proc.stdin.end(input, 'utf8');
  });
}

function runPowerShell(script, input = '') {
  return runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], input);
}

async function protectSecret(value = '') {
  const clean = String(value || '');
  if (!clean) return '';
  if (process.platform === 'darwin') {
    await runCommand('security', [
      'add-generic-password', '-U',
      '-s', KEYCHAIN_SERVICE,
      '-a', KEYCHAIN_ACCOUNT,
      '-w', clean,
    ]);
    return `${KEYCHAIN_PREFIX}${KEYCHAIN_ACCOUNT}`;
  }
  if (process.platform !== 'win32') return `base64:${Buffer.from(clean, 'utf8').toString('base64')}`;
  const script = 'Add-Type -AssemblyName System.Security;$inputText=[Console]::In.ReadToEnd();$bytes=[Text.Encoding]::UTF8.GetBytes($inputText);$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($protected))';
  return `${DPAPI_PREFIX}${await runPowerShell(script, clean)}`;
}

async function unprotectSecret(value = '') {
  const clean = String(value || '');
  if (!clean) return '';
  if (clean.startsWith('base64:')) return Buffer.from(clean.slice(7), 'base64').toString('utf8');
  if (clean.startsWith(KEYCHAIN_PREFIX)) {
    if (process.platform !== 'darwin') return '';
    const account = clean.slice(KEYCHAIN_PREFIX.length) || KEYCHAIN_ACCOUNT;
    return runCommand('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w']);
  }
  if (!clean.startsWith(DPAPI_PREFIX) || process.platform !== 'win32') return clean.startsWith(DPAPI_PREFIX) ? '' : clean;
  const script = 'Add-Type -AssemblyName System.Security;$inputText=[Console]::In.ReadToEnd().Trim();$bytes=[Convert]::FromBase64String($inputText);$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))';
  return runPowerShell(script, clean.slice(DPAPI_PREFIX.length));
}

export { protectSecret, unprotectSecret };
