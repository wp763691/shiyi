// 自定义启动命令（~/.shiyi/launchers.json）
// 让用户把任意长命令变成拾忆里的一键入口，例如 `npx @deepseek-ai/dsh web`
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILE = path.join(os.homedir(), '.shiyi', 'launchers.json');

// 首次使用时预置一条（可在「配置 → 设置」里改或删）
const SEED = {
  version: 1,
  items: [
    {
      id: 'dsh-web',
      label: 'DeepSeek Harness (web)',
      command: 'npx -y @deepseek-ai/dsh@latest web',
      cwd: '',
    },
  ],
};

let cache = null;

function sanitize(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const id = String(it?.id || '').trim().slice(0, 64);
    const label = String(it?.label || '').trim().slice(0, 60);
    const command = String(it?.command || '').trim().slice(0, 600);
    const cwd = String(it?.cwd || '').trim().slice(0, 400);
    if (!id || !label || !command || seen.has(id)) continue;
    if (/[\r\n]/.test(command)) continue;
    seen.add(id);
    out.push({ id, label, command, cwd });
  }
  return out.slice(0, 30);
}

export async function loadLaunchers() {
  if (cache) return cache;
  try {
    if (!existsSync(FILE)) {
      cache = sanitize(SEED);
      await saveLaunchers(cache);
      return cache;
    }
    cache = sanitize(JSON.parse(readFileSync(FILE, 'utf8')));
  } catch {
    cache = sanitize(SEED);
  }
  return cache;
}

async function saveLaunchers(items) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, `${JSON.stringify({ version: 1, items }, null, 2)}\n`);
  cache = items;
  return items;
}

// 新增或更新一条；label 为空视为删除
export async function saveLauncher(input) {
  const items = [...(await loadLaunchers())];
  const id = String(input?.id || '').trim() || `cmd-${Date.now().toString(36)}`;
  const idx = items.findIndex((x) => x.id === id);
  const next = sanitize({
    items: [{ ...(idx >= 0 ? items[idx] : {}), ...input, id }],
  })[0];
  if (!next) return { ok: false, error: '名称和命令都不能为空，且命令不能含换行' };
  if (idx >= 0) items[idx] = next;
  else items.push(next);
  await saveLaunchers(items);
  return { ok: true, launcher: next };
}

export async function deleteLauncher(id) {
  const items = (await loadLaunchers()).filter((x) => x.id !== id);
  await saveLaunchers(items);
  return { ok: true };
}

export function launcherFilePath() {
  return FILE;
}
