import { spawn } from 'node:child_process';
import { mkdir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { listComponentStatus } from './component-manager.mjs';
import { resolveComponentsDir, resolveDataDir, resolveDefaultVideoDir, resolveInstallDir } from './app-paths.mjs';
import { findJavaScriptRuntime } from './runtime-tools.mjs';
function commandOutput(command, args=['--version'], timeout=8000) { return new Promise((resolve) => { if(!command) return resolve(''); const proc=spawn(command,args,{stdio:['ignore','pipe','pipe'],windowsHide:true}); let out=''; const timer=setTimeout(()=>{proc.kill();resolve('');},timeout); proc.stdout.setEncoding('utf8');proc.stderr.setEncoding('utf8');proc.stdout.on('data',(c)=>{out+=c;});proc.stderr.on('data',(c)=>{out+=c;});proc.on('error',()=>{clearTimeout(timer);resolve('');});proc.on('exit',(code)=>{clearTimeout(timer);resolve(code===0?out.trim():'');}); }); }
async function detectGpu() {
  if (process.platform === 'darwin') {
    const output = await commandOutput('system_profiler', ['SPDisplaysDataType', '-json'], 15_000);
    const names = [];
    try {
      const parsed = JSON.parse(output);
      for (const item of parsed.SPDisplaysDataType || []) {
        const name = item.sppci_model || item._name;
        if (name) names.push(String(name));
      }
    } catch {}
    return { available: names.length > 0, vulkan: false, metal: names.length > 0, name: [...new Set(names)].join(', ') };
  }
  if (process.platform !== 'win32') return { available: false, vulkan: false, metal: false, name: '' };
  const nvidia = await commandOutput('nvidia-smi.exe', ['--query-gpu=name', '--format=csv,noheader']);
  const script = "$items = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Video\\*\\0000' -Name DriverDesc -ErrorAction SilentlyContinue; $items | ForEach-Object { $_.DriverDesc }";
  const registry = await commandOutput('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const names = [...new Set(`${nvidia}\n${registry}`.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).filter((item) => !/Microsoft Basic|Remote Display|IddDriver|Indirect Display|Oray|VMware|VirtualBox|Parallels|Hyper-V|QXL|VirtIO/i.test(item)))];
  const vulkanDll = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'vulkan-1.dll');
  let vulkan = false;
  try { const { access } = await import('node:fs/promises'); await access(vulkanDll); vulkan = names.length > 0; } catch {}
  return { available: names.length > 0, vulkan, metal: false, name: names.join(', ') };
}
async function freeSpace(target) { try { const info=await statfs(target); return Number(info.bavail)*Number(info.bsize); } catch { return 0; } }
async function diagnoseEnvironment(options={}) { await mkdir(resolveDataDir(), { recursive: true }); const runtime=await findJavaScriptRuntime(); const components=await listComponentStatus(); const gpu=await detectGpu(); const componentDir=resolveComponentsDir(); return { platform:process.platform,arch:process.arch,paths:{install:resolveInstallDir(),data:resolveDataDir(),components:componentDir,whisper:path.join(componentDir,'whisper'),videos:resolveDefaultVideoDir()}, tools:{browser:{ok:Boolean(options.browserPath),path:options.browserPath||''},ytDlp:{ok:Boolean(options.ytDlpPath),path:options.ytDlpPath||'',version:await commandOutput(options.ytDlpPath,['--version'])},ffmpeg:{ok:Boolean(options.ffmpegPath),path:options.ffmpegPath||'',version:(await commandOutput(options.ffmpegPath,['-version'])).split(/\r?\n/)[0]||''},javascript:{ok:Boolean(runtime),name:runtime?.name||'',path:runtime?.path||'',version:runtime?await commandOutput(runtime.path,['--version']):''}},gpu,components,disk:{freeBytes:await freeSpace(resolveDataDir())}}; }
export { diagnoseEnvironment, detectGpu };
