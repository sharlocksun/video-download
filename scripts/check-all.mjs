import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(target);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(target);
  }
}

async function check(file) {
  await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit', windowsHide: true });
    proc.on('error', reject);
    proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Syntax check failed: ${file}`)));
  });
}

await walk(path.join(root, 'src'));
await walk(path.join(root, 'scripts'));
for (const file of files) await check(file);
console.log(`Checked ${files.length} module files.`);
