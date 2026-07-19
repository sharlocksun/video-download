import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');const release=path.join(root,'release','app');
async function exists(p){try{await access(p);return true;}catch{return false;}}
async function download(url,out){await mkdir(path.dirname(out),{recursive:true});let lastError;for(let attempt=1;attempt<=3;attempt+=1){try{const r=await fetch(url,{redirect:'follow'});if(!r.ok)throw new Error(`Download failed ${r.status}: ${url}`);await pipeline(Readable.fromWeb(r.body),await import('node:fs').then(m=>m.createWriteStream(out)));return;}catch(error){lastError=error;await rm(out,{force:true});if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*2000));}}throw lastError;}async function expand(zip,dest){await mkdir(dest,{recursive:true});await new Promise((resolve,reject)=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath '${zip.replaceAll("'","''")}' -DestinationPath '${dest.replaceAll("'","''")}' -Force`],{stdio:'inherit',windowsHide:true});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(new Error(`Expand failed ${c}`)));});}
async function hash(p){const h=createHash('sha256');await pipeline(createReadStream(p),h);return h.digest('hex');}
await mkdir(path.join(root,'release'),{recursive:true});await rm(release,{recursive:true,force:true});await mkdir(path.join(release,'runtime'),{recursive:true});
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await copyFile(path.join(root,'dist','muxin-video-downloader.exe'),path.join(release,'木辛说视频下载器.exe'));
await copyFile(path.join(root,'downloads','yt-dlp','yt-dlp.exe'),path.join(release,'runtime','yt-dlp.exe'));
const ffroot=path.join(root,'downloads','ffmpeg','ffmpeg-release-essentials');
async function find(name,dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){const f=await find(name,p);if(f)return f;}else if(e.name.toLowerCase()===name)return p;}return '';}
for(const name of ['ffmpeg.exe','ffprobe.exe']){const source=await find(name,ffroot);if(!source)throw new Error(`${name} not found`);await copyFile(source,path.join(release,'runtime',name));}
await cp(path.join(root,'downloads','whisper-cpp','engine-cpu'),path.join(release,'runtime','whisper','engine-cpu'),{recursive:true,force:true});
const denoExe=path.join(root,'downloads','deno','deno.exe');const cache=path.join(root,'downloads','deno','deno-x64.zip');if(await exists(denoExe)){await copyFile(denoExe,path.join(release,'runtime','deno.exe'));}else{if(!await exists(cache))await download('https://github.com/denoland/deno/releases/download/v2.9.2/deno-x86_64-pc-windows-msvc.zip',cache);await expand(cache,path.join(release,'runtime'));await copyFile(path.join(release,'runtime','deno.exe'),denoExe);}
await mkdir(path.join(release,'legal'),{recursive:true});for(const name of ['THIRD-PARTY-NOTICES.txt','SMARTSCREEN.txt'])await copyFile(path.join(root,'legal',name),path.join(release,'legal',name));
await writeFile(path.join(release,'version.json'),JSON.stringify({version:pkg.version,channel:'stable',builtAt:new Date().toISOString()},null,2),'utf8');
const files=[];async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else files.push({file:path.relative(release,p).replaceAll('\\','/'),sha256:await hash(p)});}}await walk(release);await writeFile(path.join(root,'release','SHA256SUMS.json'),JSON.stringify(files,null,2),'utf8');console.log(`Prepared ${release}`);
