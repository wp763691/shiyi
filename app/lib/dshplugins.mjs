// DeepSeek Harness 插件：本地清单 / npm 搜索 / 安装命令拼装
// 说明：安装一律交给 dsh 自己的 CLI（`dsh plugin --profile <p> add <pkg>`，内部是它自带的 pnpm），
// 拾忆不自己实现依赖解析，避免跟着 rc 版本的内部结构走。
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const PROFILES = path.join(DSH_HOME, 'profiles');
const MODULES = path.join(PROFILES, 'node_modules');

export function dshHome() {
  return DSH_HOME;
}

export async function detectDsh(profile = 'web') {
  const profileDir = path.join(PROFILES, profile);
  const available = existsSync(path.join(profileDir, 'package.json'));
  if (!available) return { available: false, profile, pluginCount: 0, bundles: [] };
  let bundles = [];
  try {
    const pkg = JSON.parse(await readFile(path.join(profileDir, 'package.json'), 'utf8'));
    bundles = pkg?.dsh?.profile?.bundles || [];
  } catch { /* 忽略 */ }
  const local = await scanLocalPlugins();
  return { available: true, profile, pluginCount: local.length, bundles };
}

let localCache = { at: 0, items: [] };

// 本地已装插件：遍历 profiles/node_modules 下的 @scope/* 与 dsh-* 目录
export async function scanLocalPlugins() {
  if (Date.now() - localCache.at < 60000) return localCache.items;
  const items = [];
  async function readPkg(dir, name) {
    try {
      const raw = await readFile(path.join(dir, 'package.json'), 'utf8');
      const pkg = JSON.parse(raw);
      items.push({
        name: pkg.name || name,
        version: pkg.version || '',
        description: pkg.description || '',
        installed: true,
      });
    } catch { /* 忽略读不到的包 */ }
  }
  try {
    for (const entry of await readdir(MODULES, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const full = path.join(MODULES, entry.name);
      if (entry.name.startsWith('@')) {
        const subs = await readdir(full, { withFileTypes: true }).catch(() => []);
        for (const s of subs) {
          if (!s.isDirectory() && !s.isSymbolicLink()) continue;
          await readPkg(path.join(full, s.name), `${entry.name}/${s.name}`);
        }
      } else if (entry.name.startsWith('dsh')) {
        await readPkg(full, entry.name);
      }
    }
  } catch { /* profiles/node_modules 不存在 */ }
  items.sort((a, b) => a.name.localeCompare(b.name));
  localCache = { at: Date.now(), items };
  return items;
}

let npmPath = null;
async function resolveNpm() {
  if (npmPath) return npmPath;
  try {
    const { stdout } = await execFileP('/bin/bash', ['-lc', 'command -v npm'], { timeout: 5000 });
    npmPath = stdout.trim() || null;
  } catch { npmPath = null; }
  return npmPath;
}

// 联网搜索 npm registry，只保留和 dsh/harness 沾边的结果（避免搜出无关包）
export async function searchOnline(q) {
  const npm = await resolveNpm();
  if (!npm) return { ok: false, error: '找不到 npm，请先安装 Node.js' };
  const query = String(q || '').trim();
  if (!query) return { ok: false, error: '请输入关键词' };
  try {
    const { stdout } = await execFileP(npm, ['search', '--json', '--searchlimit=40', query], {
      timeout: 25000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const raw = JSON.parse(stdout || '[]');
    const hits = raw
      .map((x) => ({
        name: x.name,
        version: x.version || '',
        description: x.description || '',
      }))
      .filter((x) => /dsh|deepseek|harness/i.test(`${x.name} ${x.description}`));
    return { ok: true, items: hits.slice(0, 40) };
  } catch (e) {
    const msg = String(e?.message || e);
    if (/timed out|timeout/i.test(msg)) return { ok: false, error: '联网搜索超时（可能是网络/代理问题）' };
    return { ok: false, error: `联网搜索失败：${msg.slice(0, 160)}` };
  }
}

// 安装目标校验：包名、scope、tag、tarball/git 地址都允许，但不能以 - 开头（防选项注入）
export function validInstallTarget(target) {
  const t = String(target || '').trim();
  if (!t || t.length > 300) return false;
  if (t.startsWith('-')) return false;
  if (/[\s\r\n]/.test(t)) return false;
  return /^[\w@./:~+*!-]+$/.test(t);
}

export function validProfile(p) {
  return /^[a-z0-9-]{1,32}$/.test(String(p || ''));
}

// 拼装 dsh 插件安装命令（优先用全局 dsh，否则 npx）
export async function dshPluginCommand(action, profile, target) {
  const sub = action === 'remove' ? 'remove' : 'add';
  let bin = 'npx -y @deepseek-ai/dsh@latest';
  try {
    const { stdout } = await execFileP('/bin/bash', ['-lc', 'command -v dsh'], { timeout: 5000 });
    if (stdout.trim()) bin = 'dsh';
  } catch { /* 没有全局 dsh，用 npx */ }
  return `${bin} plugin --profile ${profile} ${sub} ${target}`;
}

export async function profileDir(profile) {
  const dir = path.join(PROFILES, profile);
  const st = await stat(dir).catch(() => null);
  return st && st.isDirectory() ? dir : null;
}
