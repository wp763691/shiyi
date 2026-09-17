// 拾忆的本地偏好设置（~/.shiyi/prefs.json）
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILE = path.join(os.homedir(), '.shiyi', 'prefs.json');

const DEFAULTS = {
  // 打开历史会话 / 转为内置终端时用的权限模式：
  // original = 沿用该会话记录里的模式；default = 一律默认权限；auto = 一律全自动
  resumePerm: 'original',
};
const ALLOWED = {
  resumePerm: ['original', 'default', 'auto'],
};

let cache = null;

export function loadPrefs() {
  if (cache) return cache;
  cache = { ...DEFAULTS };
  try {
    if (existsSync(FILE)) {
      const obj = JSON.parse(readFileSync(FILE, 'utf8'));
      for (const k of Object.keys(DEFAULTS)) {
        if (ALLOWED[k]?.includes(obj?.[k])) cache[k] = obj[k];
      }
    }
  } catch { /* 忽略坏文件，用默认值 */ }
  return cache;
}

export async function setPref(key, value) {
  if (!ALLOWED[key]) return { ok: false, error: `未知设置项：${key}` };
  const v = String(value ?? '');
  if (!ALLOWED[key].includes(v)) return { ok: false, error: `不支持的取值：${v}` };
  const prefs = { ...loadPrefs(), [key]: v };
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, `${JSON.stringify(prefs, null, 2)}\n`);
    cache = prefs;
    return { ok: true, key, value: v };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
