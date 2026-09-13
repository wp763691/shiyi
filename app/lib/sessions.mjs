import { readdir, stat, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const CLAUDE_ROOT = path.join(os.homedir(), '.claude', 'projects');
const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');
const CODEX_ARCHIVE = path.join(os.homedir(), '.codex', 'archived_sessions');
const CODEX_INDEX = path.join(os.homedir(), '.codex', 'session_index.jsonl');

const cache = new Map(); // filePath -> { mtimeMs, size, data }

// 模型上下文窗口映射（Claude 兼容端点不返回窗口大小；可用 ~/.shiyi/model-windows.json 覆盖）
const DEFAULT_WINDOWS = [
  { re: /deepseek/i, window: 128000 },
  { re: /claude.*(opus|sonnet|haiku)/i, window: 200000 },
  { re: /gpt-5|o4|o3/i, window: 400000 },
];
let modelWindows = null;
function loadModelWindows() {
  if (modelWindows) return modelWindows;
  modelWindows = [...DEFAULT_WINDOWS];
  try {
    const file = path.join(os.homedir(), '.shiyi', 'model-windows.json');
    if (existsSync(file)) {
      const obj = JSON.parse(readFileSync(file, 'utf8'));
      for (const [pattern, window] of Object.entries(obj || {})) {
        if (typeof window === 'number') modelWindows.unshift({ re: new RegExp(pattern, 'i'), window });
      }
    }
  } catch { /* 忽略 */ }
  return modelWindows;
}
function windowForModel(model) {
  if (!model) return 0;
  for (const m of loadModelWindows()) {
    if (m.re.test(model)) return m.window;
  }
  return 128000; // 保守默认
}

// 目录重命名别名（app/path-aliases.json，不入库）：把旧项目路径映射到新路径
function loadPathAliases() {
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'path-aliases.json');
    if (!existsSync(file)) return [];
    const obj = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(obj.aliases) ? obj.aliases.filter((a) => a && a.old && a.new) : [];
  } catch {
    return [];
  }
}
const PATH_ALIASES = loadPathAliases();

function mapCwd(cwd) {
  if (!cwd) return cwd;
  for (const a of PATH_ALIASES) {
    if (cwd === a.old || cwd.startsWith(a.old + '/')) {
      return a.new + cwd.slice(a.old.length);
    }
  }
  return cwd;
}

export async function scanAllSessions() {
  const errors = [];
  const out = [];
  out.push(...(await scanClaude(errors)), ...(await scanCodex(errors)));
  out.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  return { sessions: out, errors };
}

// 把会话移入本机回收目录（~/.claude/trash-zyin 或 ~/.codex/trash-zyin），可手动找回
export async function trashSession(meta) {
  if (!meta || !meta.sessionId || !meta.tool) throw new Error('缺少会话信息');
  const home = os.homedir();
  const trashBase = path.join(home, meta.tool === 'codex' ? '.codex' : '.claude', 'trash-zyin');
  await mkdir(trashBase, { recursive: true });
  const moved = [];

  const moveToTrash = async (fp) => {
    if (!fp) return;
    let target = path.join(trashBase, path.basename(fp));
    if (target === fp) return;
    let suffix = 1;
    while (true) {
      try {
        await access(target);
        target = path.join(trashBase, `${path.basename(fp)}.${suffix++}`);
      } catch {
        break;
      }
    }
    await rename(fp, target);
    cache.delete(fp);
    moved.push(target);
  };

  if (meta.tool === 'claude') {
    if (!meta.path || !meta.path.startsWith(CLAUDE_ROOT + path.sep) || !meta.path.endsWith('.jsonl')) {
      throw new Error('非法路径，拒绝删除');
    }
    await moveToTrash(meta.path);
    // 同名的旁路目录（记忆等）
    const side = path.join(path.dirname(meta.path), meta.sessionId);
    try {
      const st = await stat(side);
      if (st.isDirectory()) await moveToTrash(side);
    } catch { /* 没有旁路目录 */ }
  } else {
    if (!meta.path || !(meta.path.startsWith(CODEX_SESSIONS + path.sep) || meta.path.startsWith(CODEX_ARCHIVE + path.sep))) {
      throw new Error('非法路径，拒绝删除');
    }
    // 同一会话可能同时存在 active 与 archived 两份 rollout
    const all = [];
    await collectJsonl(CODEX_SESSIONS, all, 0);
    await collectJsonl(CODEX_ARCHIVE, all, 0);
    for (const fp of all) {
      if (fp.includes('trash-zyin')) continue;
      if (path.basename(fp).includes(meta.sessionId)) await moveToTrash(fp);
    }
    // 从 Codex 会话索引里移除对应条目，避免残留“幽灵会话”
    try {
      const idx = await readFile(CODEX_INDEX, 'utf8');
      const kept = idx.split('\n').filter((line) => {
        if (!line.trim()) return true;
        try {
          const o = JSON.parse(line);
          return !o.id || o.id !== meta.sessionId;
        } catch {
          return true;
        }
      });
      const tmp = `${CODEX_INDEX}.tmp`;
      await writeTmpAndSwap(tmp, kept.join('\n'));
    } catch { /* 索引不存在或不可写则跳过 */ }
  }
  return { ok: true, moved };
}

async function writeTmpAndSwap(tmpPath, content) {
  await writeFile(tmpPath, content);
  await rename(tmpPath, tmpPath.replace(/\.tmp$/, ''));
}

async function scanClaude(errors) {
  const out = [];
  let dirs;
  try {
    dirs = await readdir(CLAUDE_ROOT, { withFileTypes: true });
  } catch (e) {
    errors.push({ scope: 'claude', detail: `无法读取 ${CLAUDE_ROOT}: ${e.message}` });
    return out;
  }

  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dirPath = path.join(CLAUDE_ROOT, d.name);
    let files;
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(dirPath, f);
      const data = await cachedParse(fp, parseClaudeFile);
      if (data) out.push(data);
    }
  }
  return out;
}

async function scanCodex(errors) {
  const out = [];
  const titles = new Map();
  try {
    const idx = await readFile(CODEX_INDEX, 'utf8');
    for (const line of idx.split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.id && o.thread_name) titles.set(o.id, o.thread_name);
      } catch { /* 忽略坏行 */ }
    }
  } catch { /* 索引可能不存在 */ }

  for (const root of [CODEX_SESSIONS, CODEX_ARCHIVE]) {
    const files = [];
    await collectJsonl(root, files, 0);
    for (const fp of files) {
      if (!/rollout-.*\.jsonl$/.test(fp)) continue;
      const data = await cachedParse(fp, (filePath, s) => parseCodexFile(filePath, s, titles));
      if (data) out.push(data);
    }
  }
  return out;
}

async function collectJsonl(dir, acc, depth) {
  if (depth > 8) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await collectJsonl(p, acc, depth + 1);
    else if (e.isFile() && e.name.endsWith('.jsonl')) acc.push(p);
  }
}

async function cachedParse(fp, parseFn) {
  let s;
  try { s = await stat(fp); } catch { return null; }
  const hit = cache.get(fp);
  if (hit && hit.mtimeMs === s.mtimeMs && hit.size === s.size) return hit.data;
  const data = await parseFn(fp, s);
  if (data) cache.set(fp, { mtimeMs: s.mtimeMs, size: s.size, data });
  return data;
}

function cleanText(text, max = 240) {
  let t = String(text).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.startsWith('Base directory for this skill')) return '';
  if (t.startsWith('<task-notification')) return '';
  if (t.startsWith('<bash-') || t.startsWith('<local-command') || t.startsWith('<error')) return '';
  if (t.startsWith('=') && t.length > 40) return '';
  if (t.length > max) t = t.slice(0, max).trimEnd() + '…';
  return t;
}

function extractUserText(message) {
  if (!message || typeof message !== 'object') return '';
  const c = message.content;
  if (typeof c === 'string') return cleanText(c);
  if (Array.isArray(c)) {
    const parts = [];
    for (const block of c) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        const t = cleanText(block.text);
        if (t) parts.push(t);
      }
    }
    return parts.join(' / ');
  }
  return '';
}

function shortPath(cwd) {
  const parts = String(cwd).split('/').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('/') : (cwd || '');
}

function baseMeta(fp, s, tool) {
  return {
    sessionId: path.basename(fp, '.jsonl'),
    tool,
    title: null,
    cwd: null,
    branch: null,
    firstTs: null,
    lastTs: null,
    fileMtime: s.mtimeMs,
    size: s.size,
    mb: +(s.size / 1048576).toFixed(2),
    assistantTurns: 0,
    userPrompts: 0,
    lastUserText: '',
    exchanges: 0,
    path: fp,
  };
}

function finalizeMeta(meta) {
  if (meta.firstTitle) meta.title = meta.firstTitle;
  if (!meta.title) meta.title = meta.lastUserText ? meta.lastUserText.slice(0, 42) : '未命名会话';
  // 目录被重命名时，用"最近一次写入的 cwd"（存在则直接采用）
  if (meta.cwdLatest && existsSync(meta.cwdLatest)) meta.cwd = meta.cwdLatest;
  meta.cwd = mapCwd(meta.cwd);
  meta.cwdMissing = Boolean(meta.cwd) && !existsSync(meta.cwd);
  if (meta.ctxTokens && !meta.ctxMax) meta.ctxMax = windowForModel(meta.model);
  meta.dirName = meta.cwd ? shortPath(meta.cwd) : path.basename(path.dirname(meta.path));
  meta.exchanges = meta.assistantTurns;
  if (!meta.lastTs) meta.lastTs = meta.fileMtime;
  return meta;
}

async function parseClaudeFile(fp, s) {
  let raw;
  try {
    raw = await readFile(fp, 'utf8');
  } catch {
    return null;
  }

  const meta = baseMeta(fp, s, 'claude');

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }

    if (typeof o.timestamp === 'string') {
      const t = Date.parse(o.timestamp);
      if (!Number.isNaN(t)) {
        if (meta.firstTs === null || t < meta.firstTs) meta.firstTs = t;
        if (meta.lastTs === null || t > meta.lastTs) meta.lastTs = t;
      }
    }
    if (typeof o.cwd === 'string' && o.cwd) {
      if (!meta.cwd) meta.cwd = o.cwd;
      meta.cwdLatest = o.cwd; // 最近一次记录的 cwd（目录重命名后会变成新路径）
    }
    if (!meta.branch && typeof o.gitBranch === 'string' && o.gitBranch) meta.branch = o.gitBranch;

    switch (o.type) {
      case 'ai-title':
        if (o.aiTitle) {
          if (!meta.firstTitle) meta.firstTitle = o.aiTitle;
          meta.latestTitle = o.aiTitle;
        }
        break;
      case 'user': {
        const txt = extractUserText(o.message);
        if (txt) {
          meta.userPrompts += 1;
          meta.lastUserText = txt;
        }
        break;
      }
      case 'assistant':
        meta.assistantTurns += 1;
        if (o.message && typeof o.message === 'object') {
          if (o.message.model) meta.model = o.message.model;
          const u = o.message.usage;
          if (u && typeof u === 'object') {
            const input = u.input_tokens || 0;
            const cacheRead = u.cache_read_input_tokens || 0;
            const cacheCreate = u.cache_creation_input_tokens || 0;
            const ctx = input + cacheRead + cacheCreate;
            if (ctx > 0) {
              meta.ctxTokens = ctx;
              meta.ctxDetail = { input, cacheRead, cacheCreate, output: u.output_tokens || 0 };
            }
          }
        }
        break;
      default:
        break;
    }
  }

  return finalizeMeta(meta);
}

async function parseCodexFile(fp, s, titles) {
  let raw;
  try {
    raw = await readFile(fp, 'utf8');
  } catch {
    return null;
  }

  const meta = baseMeta(fp, s, 'codex');
  const uuidMatch = path.basename(fp).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (uuidMatch) meta.sessionId = uuidMatch[1];

  const userTexts = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (typeof o.timestamp === 'string') {
      const ms = Date.parse(o.timestamp);
      if (!Number.isNaN(ms)) {
        if (meta.firstTs === null || ms < meta.firstTs) meta.firstTs = ms;
        if (meta.lastTs === null || ms > meta.lastTs) meta.lastTs = ms;
      }
    }
    const pl = o.payload || {};
    if (o.type === 'session_meta' || o.type === 'turn_context') {
      if (typeof pl.cwd === 'string' && pl.cwd) {
        if (!meta.cwd) meta.cwd = pl.cwd;
        meta.cwdLatest = pl.cwd;
      }
      if (typeof pl.model === 'string' && pl.model) meta.model = pl.model;
      if (typeof pl.model_context_window === 'number' && pl.model_context_window > 0) {
        meta.ctxMax = pl.model_context_window;
      }
    } else if (o.type === 'event_msg' && pl.type === 'token_count') {
      const info = pl.info && typeof pl.info === 'object' ? pl.info : pl;
      const last = info.last_token_usage || pl.last_token_usage;
      if (last && typeof last === 'object') {
        const input = last.input_tokens || 0;
        const cacheRead = last.cached_input_tokens || last.cache_read_input_tokens || 0;
        const ctx = input + cacheRead;
        if (ctx > 0) {
          meta.ctxTokens = ctx;
          meta.ctxDetail = { input, cacheRead, output: last.output_tokens || 0 };
        }
      }
      if (typeof info.model_context_window === 'number' && info.model_context_window > 0) {
        meta.ctxMax = info.model_context_window;
      }
    } else if (o.type === 'event_msg' && pl.type === 'user_message') {
      const texts = [];
      if (Array.isArray(pl.text_elements)) {
        for (const x of pl.text_elements) {
          if (x && typeof x.text === 'string') texts.push(cleanText(x.text, 300));
        }
      }
      if (pl.message && typeof pl.message.content === 'string') texts.push(cleanText(pl.message.content, 300));
      const joined = texts.filter(Boolean).join(' / ');
      if (joined) {
        meta.userPrompts += 1;
        userTexts.push(joined);
      }
    } else if (o.type === 'response_item') {
      if (pl.role === 'assistant') {
        meta.assistantTurns += 1;
      } else if (pl.role === 'user' && Array.isArray(pl.content)) {
        for (const it of pl.content) {
          if (it && typeof it.text === 'string' && (it.type === 'input_text' || it.type === 'text')) {
            const t = cleanText(it.text, 300);
            if (t && userTexts[userTexts.length - 1] !== t) {
              meta.userPrompts += 1;
              userTexts.push(t);
            }
          }
        }
      }
    }
  }
  if (userTexts.length) meta.lastUserText = userTexts[userTexts.length - 1];
  if (titles.has(meta.sessionId)) meta.title = titles.get(meta.sessionId);
  return finalizeMeta(meta);
}
