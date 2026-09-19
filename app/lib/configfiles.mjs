import { readFile, writeFile, stat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DSH_DIR = path.join(os.homedir(), '.dsh');

const FILES = [
  {
    tool: 'claude', label: 'Claude Code settings', kind: 'json',
    file: path.join(os.homedir(), '.claude', 'settings.json'),
    hint: '模型、权限规则（allow/deny）、hooks、环境变量都在这里',
  },
  {
    tool: 'codex', label: 'Codex config', kind: 'toml',
    file: path.join(os.homedir(), '.codex', 'config.toml'),
    hint: '模型、审批策略（approval/sandbox）、MCP 服务器都在这里',
  },
  // DeepSeek Harness：凭据文件含密钥（前端默认遮罩），设置文件是普通 YAML
  {
    tool: 'dsh-credentials', label: 'DeepSeek Harness 凭据', kind: 'yaml', secret: true,
    file: path.join(DSH_DIR, '.credentials.yaml'), onlyIfDir: DSH_DIR,
    hint: '模型密钥等机密（默认遮罩显示；改动会自动重载）',
  },
  {
    tool: 'dsh-settings', label: 'DeepSeek Harness 设置', kind: 'yaml',
    file: path.join(DSH_DIR, 'settings.yaml'), onlyIfDir: DSH_DIR,
    hint: 'dsh 自己的界面与行为设置',
  },
];

export async function scanConfigFiles() {
  const out = [];
  for (const f of FILES) {
    if (f.onlyIfDir && !existsSync(f.onlyIfDir)) continue;
    const base = {
      tool: f.tool, label: f.label, path: f.file,
      kind: f.kind, secret: Boolean(f.secret), hint: f.hint || '',
      exists: false, bytes: 0, mtime: null, scope: 'global',
    };
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

function specFor(tool) {
  const hit = FILES.find((f) => f.tool === tool);
  if (!hit) throw new Error('未知工具');
  return hit;
}

function fileFor(tool) {
  return specFor(tool).file;
}

export async function readConfigFile(tool) {
  const spec = specFor(tool);
  const file = spec.file;
  let content = '';
  try {
    content = await readFile(file, 'utf8');
  } catch { /* 文件不存在返回空 */ }
  return { ok: true, tool, path: file, content, kind: spec.kind, secret: Boolean(spec.secret) };
}

export async function saveConfigFile(tool, content) {
  const spec = specFor(tool);
  const file = spec.file;
  const text = String(content || '');
  if (spec.kind === 'json') {
    try {
      JSON.parse(text);
    } catch (e) {
      throw new Error(`JSON 格式有误：${e.message}`);
    }
  }
  if (spec.kind === 'yaml') {
    // YAML 不允许用 tab 做缩进；这里只挡这个最容易犯的错，其余交给 dsh 自己报错
    const badLine = text.split('\n').findIndex((l) => /^\t/.test(l));
    if (badLine >= 0) throw new Error(`第 ${badLine + 1} 行用了 Tab 缩进，YAML 只支持空格`);
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
