#!/usr/bin/env node
// 目录重命名后，迁移 Codex 会话文件中记录的旧项目路径。
// 用法: node scripts/migrate-codex-path.mjs <旧绝对路径> <新绝对路径> [--dry]
// 注意: 正在运行的 Codex 会话会持有文件句柄，请先退出/恢复后再执行本脚本。

import { readdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';

const [oldPath, newPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dry = process.argv.includes('--dry');

if (!oldPath || !newPath) {
  console.error('用法: node scripts/migrate-codex-path.mjs <旧路径> <新路径> [--dry]');
  process.exit(1);
}

const roots = [
  path.join(os.homedir(), '.codex', 'sessions'),
  path.join(os.homedir(), '.codex', 'archived_sessions'),
];

async function collect(dir, acc, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await collect(p, acc, depth + 1);
    else if (e.isFile() && e.name.endsWith('.jsonl')) acc.push(p);
  }
}

const files = [];
for (const r of roots) await collect(r, files);

let touched = 0;
for (const file of files) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    continue;
  }
  if (!raw.includes(oldPath)) continue;
  touched += 1;
  const next = raw.split(oldPath).join(newPath);
  console.log(`  ${dry ? '[dry] 将更新' : '已更新'} ${file}（${raw.split(oldPath).length - 1} 处）`);
  if (!dry) {
    const tmp = `${file}.shiyi-tmp`;
    await writeFile(tmp, next);
    await rename(tmp, file);
  }
}

console.log(`${dry ? '预检' : '迁移'}完成：匹配 ${touched} 个文件`);
if (touched && dry) console.log('（dry 模式未写入；确认 Codex 已退出后去掉 --dry 执行）');
