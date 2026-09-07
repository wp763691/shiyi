import { readFile, writeFile, stat, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const FILES = [
  { tool: 'claude', label: 'Claude Code settings', file: path.join(os.homedir(), '.claude', 'settings.json') },
  { tool: 'codex', label: 'Codex config', file: path.join(os.homedir(), '.codex', 'config.toml') },
];

export async function scanConfigFiles() {
  const out = [];
  for (const f of FILES) {
    const base = { tool: f.tool, label: f.label, path: f.file, exists: false, bytes: 0, mtime: null, scope: 'global' };
    try {
      const st = await stat(f.file);
      base.exists = true;
      base.bytes = st.size;
      base.mtime = st.mtimeMs;
    } catch { /* 不存在 */ }
    out.push(base);
  }
  return out;
}

function fileFor(tool) {
  const hit = FILES.find((f) => f.tool === tool);
  if (!hit) throw new Error('未知工具');
  return hit.file;
}

export async function readConfigFile(tool) {
  const file = fileFor(tool);
  let content = '';
  try {
    content = await readFile(file, 'utf8');
  } catch { /* 文件不存在返回空 */ }
  return { ok: true, tool, path: file, content };
}

export async function saveConfigFile(tool, content) {
  const file = fileFor(tool);
  const text = String(content || '');
  if (tool === 'claude') {
    try {
      JSON.parse(text);
    } catch (e) {
      throw new Error(`JSON 格式有误：${e.message}`);
    }
  }
  // 先备份再写入
  const backup = `${file}.bak-${Date.now()}`;
  try {
    await rename(file, backup);
  } catch { /* 原文件不存在也允许直接写 */ }
  try {
    await writeFile(file, text, 'utf8');
  } catch (e) {
    try { await rename(backup, file); } catch { /* 还原失败 */ }
    throw e;
  }
  return { ok: true, path: file, backup };
}
